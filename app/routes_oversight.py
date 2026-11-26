"""لوحة المتابعة الإدارية: حساب «متابع إداري» للقراءة فقط.

مؤشرات مجمّعة عن سير العمل، مع روابط للاطلاع على تفاصيل الموظفين وطلباتهم دون أي إجراء. لا يكتب هذا المسار شيئاً في قاعدة البيانات
(عدا سجل التدقيق عند التصدير)، ولا يستدعي التصعيد.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db import get_db
from .models import Department, Employee, LeaveRequest, Recommendation, User
from .routes_core import _report_data, _sheet, _xlsx_response, pick_year, years
from .charts import dept_slots, donut_parts, month_series
from .services import LATE_DAYS, audit, compute_balance
from .web import client_ip, render, require

router = APIRouter()
VIEWERS = ("supervisor", "admin")  # الأدمن يستطيع معاينة اللوحة كما يراها المتابع
MIN_GROUP = 0  # المتابع يطّلع على أرصدة الأفراد، فلا حاجة لدمج الأقسام الصغيرة
TOP_DEPTS = 7
OTHER = "أقسام أخرى"
NO_DEPT = "— بلا قسم —"


def _scope(db: Session, user: User, dept: int | None) -> tuple[list[Employee], int | None, Department | None]:
    """الموظفون في نطاق المتابع. نطاق الحساب (User.department_id) يتقدّم على الفلتر."""
    locked = db.get(Department, user.department_id) if user.role == "supervisor" and user.department_id else None
    if locked:
        dept = locked.id
    q = select(Employee).order_by(Employee.id)
    if dept:
        q = q.where(Employee.department_id == dept)
    return list(db.scalars(q)), dept, locked


def _pct(v: float, tot: float) -> int:
    return round(v / tot * 100) if tot else 0


def oversight_data(db: Session, user: User, year, dept: int | None, sort: str = "late") -> dict:
    emps, dept, locked = _scope(db, user, dept)
    active = [e for e in emps if e.is_active]
    ids = [e.id for e in emps] or [0]
    hpd = year.hours_per_day or 7
    now = datetime.now()
    rep = _report_data(db, user, year, None, None, emps=emps)
    st = rep["stats"]

    # --- ألوان الأقسام ثابتة على مستوى الجهة (أكبر 8 أقسام) فلا تتغير بالفلترة
    sizes = db.execute(select(Employee.department_id, func.count(Employee.id)).where(
        Employee.is_active.is_(True), Employee.department_id.is_not(None)).group_by(Employee.department_id)).all()
    slots = dept_slots([d for d, _ in sorted(sizes, key=lambda x: (-x[1], x[0]))])
    by_d: dict = {}
    for e in active:
        by_d.setdefault(e.department_id, [e.department.name if e.department else NO_DEPT, 0])[1] += 1
    rows = sorted(by_d.items(), key=lambda kv: (int(slots[kv[0]][4:]) if kv[0] in slots else 99, -kv[1][1]))
    dept_donut = donut_parts([dict(key=str(k or 0), label=n, value=v, cls=slots.get(k)) for k, (n, v) in rows],
                             other_label=OTHER)
    status_donut = donut_parts([dict(key=k, label=l, value=next((x["value"] for x in rep["st_pie"] if x["key"] == k), 0),
                                     cls=f"sv-st-{k}")
                                for k, l in (("approved", "معتمدة"), ("pending", "بانتظار الاعتماد"),
                                             ("rejected", "مرفوضة"), ("cancelled", "ملغاة"))])

    # --- توزيع الموظفين على الأقسام (دائرة): أكبر الأقسام ثم «أقسام أخرى»
    counts: dict[str, int] = defaultdict(int)
    dept_ids: dict[str, int | None] = {}
    for e in active:
        n = e.department.name if e.department else NO_DEPT
        counts[n] += 1
        dept_ids[n] = e.department_id
    ordered = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    head, tail = ordered[:TOP_DEPTS], ordered[TOP_DEPTS:]
    if len(tail) == 1:
        head, tail = ordered, []
    tot_e = len(active)
    dept_pie = [dict(key=f"c{i + 1}", label=n, value=v, pct=_pct(v, tot_e), dept_id=dept_ids.get(n))
                for i, (n, v) in enumerate(head)]
    if tail:
        v = sum(c for _, c in tail)
        dept_pie.append(dict(key="c8", label=f"{OTHER} ({len(tail)})", value=v, pct=_pct(v, tot_e), dept_id=None))

    # --- التوصيات حسب الحالة
    rec_by = dict(db.execute(select(Recommendation.status, func.count(Recommendation.id)).where(
        Recommendation.fiscal_year_id == year.id, Recommendation.employee_id.in_(ids)).group_by(Recommendation.status)).all())
    rec_tot = sum(rec_by.values())
    rec_pie = [dict(key=k, label=l, value=rec_by.get(k, 0), pct=_pct(rec_by.get(k, 0), rec_tot))
               for k, l in (("active", "سارية"), ("pending", "بانتظار الاعتماد"), ("rejected", "مرفوضة"), ("cancelled", "ملغاة"))]

    # --- المعلّق والمتأخر (مجهّل: الرقم المرجعي والقسم والمسؤول فقط)
    pend_reqs = list(db.scalars(select(LeaveRequest).where(LeaveRequest.status == "pending",
                                                           LeaveRequest.employee_id.in_(ids)).order_by(LeaveRequest.created_at)))
    pend_recs = list(db.scalars(select(Recommendation).where(Recommendation.status == "pending",
                                                             Recommendation.employee_id.in_(ids)).order_by(Recommendation.created_at)))
    late = []
    for kind, rows in (("طلب معالجة غياب", pend_reqs), ("توصية مرفوعة من الموظف", pend_recs)):
        for r in rows:
            age = (now - r.created_at).days
            if age >= LATE_DAYS:
                e = r.employee
                late.append(dict(cls=slots.get(e.department_id, "sv-c-other"), employee=e.full_name,
                                 href=f"/requests/{r.id}" if kind.startswith("طلب") else f"/employees/{e.id}", ref=r.ref_code or f"#{r.id}", kind=kind,
                                 amount=r.amount_label if kind.startswith("طلب") else (f"{r.amount:g} " + ("يوم" if r.kind == "days" else "ساعة")),
                                 dept=e.department.name if e.department else NO_DEPT,
                                 officer=e.manager.full_name if e.manager else "— غير مُسند (مدير النظام) —",
                                 created=r.created_at, age=age))
    late.sort(key=lambda x: -x["age"])

    # --- الأرصدة والحد الأقصى (أعداد فقط)
    at_cap = near_cap = no_rec = 0
    lapse_n, lapse_days = 0, 0.0
    today = date.today()
    lapse_window = year.start_date <= today <= year.end_date and (year.end_date - today).days <= 90
    for e in active:
        b = compute_balance(db, e.id, year)
        if b.cap_left_hours <= 0:
            at_cap += 1
        elif b.cap_pct >= 80:
            near_cap += 1
        if not (b.granted_days or b.granted_hours):
            no_rec += 1
        if lapse_window and b.bookable_days > 0:
            lapse_n += 1
            lapse_days += b.bookable_days

    # --- الطلبات والتوصيات شهرياً (بالعدد، حسب تاريخ التقديم)
    req_m = db.execute(select(LeaveRequest.created_at).where(LeaveRequest.fiscal_year_id == year.id,
                                                             LeaveRequest.employee_id.in_(ids))).scalars().all()
    rec_m = db.execute(select(Recommendation.rec_date).where(Recommendation.fiscal_year_id == year.id,
                                                             Recommendation.status.in_(("active", "pending")),
                                                             Recommendation.employee_id.in_(ids))).scalars().all()
    mrows = [dict(label=m["label"], short=str(m["key"][1]), year=m["year"], key=m["key"], vals={"req": 0, "rec": 0})
             for m in rep["months"]]
    mi = {m["key"]: m for m in mrows}
    for d0 in req_m:
        if (m := mi.get((d0.year, d0.month))):
            m["vals"]["req"] += 1
    for d0 in rec_m:
        if (m := mi.get((d0.year, d0.month))):
            m["vals"]["rec"] += 1
    months = month_series(mrows, ["req", "rec"])

    # --- ترتيب الأقسام: المتأخرات ثم المعلّقة (الأرصدة تُخفى للأقسام الصغيرة)
    late_by: dict[str, int] = defaultdict(int)
    for x in late:
        late_by[x["dept"]] += 1
    rank = []
    for name, d in rep["by_dept"]:
        did = next((e.department_id for e in active if (e.department.name if e.department else NO_DEPT) == name), None)
        small_g = d["count"] < MIN_GROUP
        rank.append(dict(id=did, name=name, cls=slots.get(did, "sv-c-other"), emp=d["count"], pending=d["n_pending"],
                         late=late_by.get(name, 0), small=small_g,
                         granted=None if small_g else round(d["granted"], 1), used=None if small_g else round(d["used"], 1),
                         rate=None if small_g else d["util"], avg_lead=d["avg_lead"]))
    keyf = {"emp": lambda r: -r["emp"], "pending": lambda r: -r["pending"], "granted": lambda r: -(r["granted"] or -1),
            "used": lambda r: -(r["used"] or -1), "rate": lambda r: -(r["rate"] if r["rate"] is not None else -1)}
    rank.sort(key=lambda r: (-r["late"], -r["pending"], r["name"]))
    if sort in keyf:
        rank.sort(key=keyf[sort])

    # --- أداء الأقسام مع حماية الأعداد الصغيرة
    by_dept, small = [], dict(count=0, granted=0.0, used=0.0, pending=0.0, n_pending=0, approved=0, rejected=0, lead=[], n=0)
    for name, d in rep["by_dept"]:
        if d["count"] < MIN_GROUP:
            small["n"] += 1
            for k in ("count", "granted", "used", "pending", "n_pending", "approved", "rejected"):
                small[k] += d[k]
            small["lead"] += d["lead"]
        else:
            by_dept.append((name, d, False))
    if small["n"]:
        small["left"] = round(small["granted"] - small["used"] - small["pending"], 1)
        small["util"] = _pct(small["used"], small["granted"])
        small["avg_lead"] = round(sum(small["lead"]) / len(small["lead"]), 1) if small["lead"] else None
        by_dept.append((f"{OTHER} ({small['n']}) — أقل من {MIN_GROUP} موظفين لكلٍّ منها", small, True))

    # --- الجهات المعتمِدة: المتوسط والمعلّق والأقدم
    oldest_by: dict[str, int] = defaultdict(int)
    for r in pend_reqs + pend_recs:
        k = r.employee.manager.full_name if r.employee.manager else "— غير مُسند —"
        oldest_by[k] = max(oldest_by[k], (now - r.created_at).days)
    by_officer = [(n, d, oldest_by.get(n, 0)) for n, d in rep["by_officer"]]
    by_officer.sort(key=lambda x: (x[0].startswith("—"), -(x[1]["avg_lead"] or 0)))

    kpi = dict(
        employees=tot_e, departments=len([n for n in counts if n != NO_DEPT]),
        unassigned=sum(1 for e in active if not e.manager_id), no_rec=no_rec,
        pending_reqs=len(pend_reqs), pending_recs=len(pend_recs), late=len(late),
        oldest=max((x["age"] for x in late), default=0), avg_lead=st["avg_lead"],
        recs=st["recs"], rec_days=st["rec_days"], rec_hours=st["rec_hours"],
        granted_eq=st["granted_eq"], used_eq=st["used_eq"], util=st["util"],
        requests=st["requests"], approved=st["approved"], rejected=st["rejected"],
        reject_rate=_pct(st["rejected"], st["approved"] + st["rejected"]),
        at_cap=at_cap, near_cap=near_cap, no_attachment=st["no_attachment"],
        lapse=lapse_n, lapse_days=round(lapse_days, 1), lapse_window=lapse_window,
    )
    return dict(kpi_data=kpi, dept=dept, locked=locked, dept_pie=dept_pie, dept_donut=dept_donut, status_donut=status_donut,
                rank=rank, sort=sort if sort in keyf else "late", months_n=months, st_pie=rep["st_pie"], st_total=rep["st_total"],
                rec_pie=rec_pie, rec_total=rec_tot, months=rep["months"], by_dept=by_dept, by_officer=by_officer,
                late=late, hpd=hpd)


@router.get("/oversight")
def oversight(request: Request, year_id: int | None = None, dept: str = "", sort: str = "late",
              user: User = Depends(require(*VIEWERS)), db: Session = Depends(get_db)):
    year = pick_year(db, year_id)
    dept_id = int(dept) if dept.isdigit() else None
    data = oversight_data(db, user, year, dept_id, sort)
    depts = list(db.scalars(select(Department).order_by(Department.name)))
    sel_dept = db.get(Department, data["dept"]) if data["dept"] else None
    qs = f"year_id={year.id}" + (f"&dept={data['dept']}" if data["dept"] and not data["locked"] else "")
    return render(request, db, "oversight.html", user=user, sel_year=year, years=years(db), depts=depts,
                  sel_dept=sel_dept, qs=qs, updated_at=datetime.now().strftime("%H:%M"), **data)


@router.get("/oversight/export.xlsx")
def oversight_export(request: Request, year_id: int | None = None, dept: str = "",
                     user: User = Depends(require(*VIEWERS)), db: Session = Depends(get_db)):
    """ملخص مجمّع بلا أسماء موظفين."""
    from openpyxl import Workbook

    year = pick_year(db, year_id)
    d = oversight_data(db, user, year, int(dept) if dept.isdigit() else None)
    wb = Workbook()
    wb.remove(wb.active)
    k = d["kpi_data"]
    _sheet(wb, "المؤشرات", ["المؤشر", "القيمة"], [
        ["الموظفون النشطون", k["employees"]], ["الأقسام", k["departments"]],
        ["طلبات بانتظار الاعتماد", k["pending_reqs"]], ["توصيات بانتظار الاعتماد", k["pending_recs"]],
        [f"متأخرة عن {LATE_DAYS} أيام", k["late"]], ["متوسط مدة الاعتماد (يوم)", k["avg_lead"]],
        ["التوصيات السارية", k["recs"]], ["الممنوح (يوم معادل)", k["granted_eq"]],
        ["المستخدم (يوم معادل)", k["used_eq"]], ["نسبة الاستخدام %", k["util"]],
        ["بلغوا الحد الأقصى", k["at_cap"]], ["قاربوا الحد الأقصى", k["near_cap"]],
        ["موظفون غير مُسندين", k["unassigned"]], ["توصيات سارية بلا مرفق", k["no_attachment"]]])
    _sheet(wb, "الموظفون حسب القسم", ["القسم", "عدد الموظفين", "النسبة %"],
           [[p["label"], p["value"], p["pct"]] for p in d["dept_pie"]])
    _sheet(wb, "أداء الأقسام", ["القسم", "الموظفون", "الممنوح", "المستخدم", "المتاح", "الاستخدام %", "معلّقة",
                                "متوسط مدة القرار (يوم)"],
           [[n, x["count"], round(x["granted"], 1), round(x["used"], 1), x["left"], x["util"], x["n_pending"],
             x["avg_lead"] if x["avg_lead"] is not None else ""] for n, x, _ in d["by_dept"]])
    _sheet(wb, "الجهات المعتمدة", ["مسؤول شؤون الموظفين", "الموظفون", "معتمدة", "مرفوضة", "معلّقة",
                                   "متوسط مدة القرار (يوم)", "أقدم معلّق (يوم)"],
           [[n, x["count"], x["approved"], x["rejected"], x["n_pending"],
             x["avg_lead"] if x["avg_lead"] is not None else "", old] for n, x, old in d["by_officer"]])
    _sheet(wb, "المتأخرات", ["الرقم المرجعي", "الموظف", "النوع", "المدة", "القسم", "الجهة المعتمدة", "تاريخ التقديم", "العمر (يوم)"],
           [[x["ref"], x["employee"], x["kind"], x["amount"], x["dept"], x["officer"], x["created"].strftime("%Y-%m-%d"), x["age"]]
            for x in d["late"]])
    _sheet(wb, "شهرياً", ["الشهر", "السنة", "الممنوح (يوم معادل)", "المستخدم (يوم معادل)"],
           [[m["label"], m["year"], m["granted"], m["used"]] for m in d["months"]])
    audit(db, user, "data_exported", "export", None, ip=client_ip(request), kind="oversight", year=year.name)
    db.commit()
    return _xlsx_response(wb, f"لوحة المتابعة الإدارية {year.name}.xlsx")

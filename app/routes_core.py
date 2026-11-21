"""الشاشات التشغيلية: اللوحة، رصيدي، الموظفون، التوصيات، الطلبات، الاعتمادات، المراسلات، التقارير."""
from __future__ import annotations

import io
from collections import defaultdict
from datetime import date, datetime

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import false, func, or_, select, true
from sqlalchemy.orm import Session

from .db import UPLOAD_DIR, get_db
from .models import (
    Attachment,
    Department,
    Employee,
    FiscalYear,
    LEAVE_KINDS,
    LeaveRequest,
    Message,
    REC_KINDS,
    Recommendation,
    User,
)
from .security import save_pdf
from .services import (
    RuleError,
    active_year,
    audit,
    can_manage,
    can_view_employee,
    check_can_approve_leave,
    check_can_cancel_leave,
    check_can_cancel_recommendation,
    compute_balance,
    days_ar,
    employee_user,
    hours_ar,
    message_recipients,
    notify,
    officer_users_for,
    alert_keys,
    assign_ref,
    notify_balance_alerts,
    validate_leave,
    validate_recommendation,
    visible_employee_ids,
)
from .web import (
    back,
    client_ip,
    current_user,
    flash,
    parse_date,
    parse_float,
    redirect,
    render,
    require,
)

router = APIRouter()
STAFF = ("admin", "officer")


def pick_year(db: Session, year_id: int | None) -> FiscalYear:
    year = db.get(FiscalYear, year_id) if year_id else active_year(db)
    if not year:
        year = db.scalar(select(FiscalYear).order_by(FiscalYear.start_date.desc()))
    if not year:
        raise HTTPException(404, "لا توجد سنة معرّفة. أنشئ سنة من الإعدادات.")
    return year


def years(db: Session) -> list[FiscalYear]:
    return list(db.scalars(select(FiscalYear).order_by(FiscalYear.start_date.desc())))


def get_employee_or_404(db: Session, emp_id: int, user: User) -> Employee:
    emp = db.get(Employee, emp_id)
    if not emp:
        raise HTTPException(404, "الموظف غير موجود.")
    if not can_view_employee(user, emp):
        raise HTTPException(403, "ليست لديك صلاحية لعرض بيانات هذا الموظف.")
    return emp


def scoped_employees(db: Session, user: User, include_inactive: bool = False, managed_only: bool = False):
    """الموظفون الظاهرون للمستخدم. managed_only: من يملك المستخدم إدارتهم (دون نفسه)."""
    q = select(Employee).order_by(Employee.full_name)
    ids = visible_employee_ids(db, user)
    if ids is not None:
        q = q.where(Employee.id.in_(ids))
    if managed_only and user.employee_id:
        q = q.where(Employee.id != user.employee_id)
    if not include_inactive:
        q = q.where(Employee.is_active.is_(True))
    return q


def officers(db: Session) -> list[Employee]:
    """سجلات الموظفين الذين لهم حساب «الشؤون الإدارية» (يُسند لهم موظفون)."""
    return list(db.scalars(select(Employee).join(User, User.employee_id == Employee.id)
                           .where(User.role == "officer", User.is_active.is_(True)).order_by(Employee.full_name)))


def ref_no(prefix: str, obj_id: int, d: date | datetime) -> str:
    return f"{prefix}-{d:%Y}-{obj_id:05d}"


# ================================================================ اللوحة
@router.get("/dashboard")
def dashboard(request: Request, year_id: int | None = None, user: User = Depends(current_user),
              db: Session = Depends(get_db)):
    if user.role == "employee":
        return redirect("/me")
    year = pick_year(db, year_id)
    emps = list(db.scalars(scoped_employees(db, user, managed_only=True)))
    ids = [e.id for e in emps]
    t = dict(employees=len(emps), granted_days=0.0, granted_hours=0.0, used_days=0, used_hours=0.0,
             left_hours=0.0, at_cap=0, no_rec=0, granted_eq=0.0, used_eq=0.0, pending_eq=0.0)
    by_officer: dict[str, dict] = defaultdict(lambda: dict(count=0, granted=0.0, used=0.0, left=0.0))
    near_cap = []
    for e in emps:
        b = compute_balance(db, e.id, year)
        t["granted_days"] += b.granted_days
        t["granted_hours"] += b.granted_hours
        t["used_days"] += b.used_days
        t["used_hours"] += b.used_hours
        t["left_hours"] += b.total_left_hours
        t["granted_eq"] += b.granted_equiv_days
        t["used_eq"] += b.used_equiv_days
        t["pending_eq"] += b.pending_days + b.pending_hours / year.hours_per_day
        if b.cap_left_hours <= 0:
            t["at_cap"] += 1
        elif b.cap_pct >= 80:
            near_cap.append((e, b))
        if not (b.granted_days or b.granted_hours):
            t["no_rec"] += 1
        o = by_officer[e.manager.full_name if e.manager else "— غير مُسند —"]
        o["count"] += 1
        o["granted"] += b.granted_equiv_days
        o["used"] += b.used_equiv_days
        o["left"] += b.total_left_hours / year.hours_per_day
    hpd = year.hours_per_day
    t["left_days"], t["left_rem"] = int(t["left_hours"] // hpd), round(t["left_hours"] % hpd, 2)
    # توزيع الرصيد الممنوح (بالأيام المعادلة) للرسم الدائري
    g = round(t["granted_eq"], 2)
    used, pend = round(t["used_eq"], 2), round(t["pending_eq"], 2)
    avail = round(max(g - used - pend, 0), 2)
    pie = [("used", "مستخدم", used), ("pending", "معلّق بانتظار القرار", pend), ("avail", "متاح", avail)]
    pie = [dict(key=k, label=l, value=v, pct=(round(v / g * 100) if g else 0)) for k, l, v in pie]
    monthly = [0.0] * 12
    for r in db.scalars(select(Recommendation).where(Recommendation.fiscal_year_id == year.id,
                        Recommendation.status == "active",
                        Recommendation.employee_id.in_(ids) if ids else false())):
        monthly[r.rec_date.month - 1] += r.amount if r.kind == "days" else r.amount / hpd
    monthly = [round(v, 1) for v in monthly]
    pending = list(db.scalars(select(LeaveRequest).where(
        LeaveRequest.status == "pending", LeaveRequest.employee_id.in_(ids) if ids else false())
        .order_by(LeaveRequest.created_at)))
    pending = [r for r in pending if can_manage(user, r.employee)]
    recent = list(db.scalars(select(Recommendation).where(Recommendation.employee_id.in_(ids) if ids else false())
                             .order_by(Recommendation.created_at.desc()).limit(6)))
    backup_due = None
    if user.role == "admin":
        from .models import AuditLog
        last = db.scalar(select(AuditLog.created_at).where(AuditLog.action == "backup_downloaded")
                         .order_by(AuditLog.id.desc()))
        if not last or (datetime.now() - last).days >= 7:
            backup_due = (datetime.now() - last).days if last else -1
    return render(request, db, "dashboard.html", user=user, sel_year=year, years=years(db), t=t, pie=pie, backup_due=backup_due,
                  pie_total=g,
                  by_officer=sorted(by_officer.items(), key=lambda kv: -kv[1]["count"]),
                  monthly=monthly, monthly_max=max(monthly) or 1, pending=pending[:8],
                  pending_count=len(pending), recent=recent, near_cap=near_cap[:8])


# ================================================================ رصيدي وكشف الموظف
def statement_ctx(db: Session, emp: Employee, year: FiscalYear) -> dict:
    recs = list(db.scalars(select(Recommendation).where(Recommendation.employee_id == emp.id,
                Recommendation.fiscal_year_id == year.id).order_by(Recommendation.rec_date.desc(),
                                                                    Recommendation.id.desc())))
    reqs = list(db.scalars(select(LeaveRequest).where(LeaveRequest.employee_id == emp.id,
                LeaveRequest.fiscal_year_id == year.id).order_by(LeaveRequest.start_date.desc(),
                                                                  LeaveRequest.id.desc())))
    return dict(emp=emp, sel_year=year, info=compute_balance(db, emp.id, year), recs=recs, reqs=reqs)


@router.get("/me")
def me(request: Request, year_id: int | None = None, user: User = Depends(current_user),
       db: Session = Depends(get_db)):
    if not user.employee_id:
        if user.role == "employee":
            raise HTTPException(404, "حسابك غير مرتبط بسجل موظف. تواصل مع مدير النظام.")
        return redirect("/dashboard")
    year = pick_year(db, year_id)
    emp = db.get(Employee, user.employee_id)
    return render(request, db, "me.html", user=user, years=years(db), **statement_ctx(db, emp, year))


@router.get("/employees/{emp_id}")
def employee_statement(request: Request, emp_id: int, year_id: int | None = None,
                       user: User = Depends(current_user), db: Session = Depends(get_db)):
    emp = get_employee_or_404(db, emp_id, user)
    if emp.id == user.employee_id and not request.query_params.get("print"):
        return redirect(f"/me?year_id={year_id}" if year_id else "/me")
    year = pick_year(db, year_id)
    tpl = "statement_print.html" if request.query_params.get("print") else "statement.html"
    return render(request, db, tpl, user=user, years=years(db), can_manage=can_manage(user, emp),
                  ref=f"ST-{year.name}-{emp.employee_no}-{datetime.now():%m%d%H%M}",
                  **statement_ctx(db, emp, year))


# ================================================================ الموظفون
@router.get("/employees")
def employees(request: Request, q: str = "", dept: int | None = None, officer: int | None = None,
              state: str = "", year_id: int | None = None,
              user: User = Depends(require(*STAFF)), db: Session = Depends(get_db)):
    year = pick_year(db, year_id)
    stmt = scoped_employees(db, user, include_inactive=(state == "inactive"), managed_only=True)
    if state == "inactive":
        stmt = stmt.where(Employee.is_active.is_(False))
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Employee.full_name.like(like), Employee.employee_no.like(like)))
    if dept:
        stmt = stmt.where(Employee.department_id == dept)
    if officer == -1:
        stmt = stmt.where(Employee.manager_id.is_(None))
    elif officer:
        stmt = stmt.where(Employee.manager_id == officer)
    rows = []
    for e in db.scalars(stmt):
        b = compute_balance(db, e.id, year)
        if state == "cap" and b.cap_left_hours > 0:
            continue
        if state == "none" and (b.granted_days or b.granted_hours):
            continue
        rows.append((e, b))
    depts = list(db.scalars(select(Department).order_by(Department.name)))
    return render(request, db, "employees.html", user=user, rows=rows, depts=depts, q=q, dept=dept,
                  officer=officer, officers=officers(db), state=state, sel_year=year, years=years(db))


def employee_form_ctx(db: Session) -> dict:
    return dict(
        depts=list(db.scalars(select(Department).where(Department.is_active.is_(True)).order_by(Department.name))),
        officers=officers(db),
    )


@router.get("/employees/new/form")
def employee_new(request: Request, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    return render(request, db, "employee_form.html", user=user, emp=None, **employee_form_ctx(db))


@router.get("/employees/{emp_id}/edit")
def employee_edit(request: Request, emp_id: int, user: User = Depends(require("admin")),
                  db: Session = Depends(get_db)):
    emp = db.get(Employee, emp_id)
    if not emp:
        raise HTTPException(404, "الموظف غير موجود.")
    return render(request, db, "employee_form.html", user=user, emp=emp, **employee_form_ctx(db))


@router.post("/employees/save")
def employee_save(request: Request, emp_id: int | None = Form(None), employee_no: str = Form(...),
                  full_name: str = Form(...), department_id: int | None = Form(None),
                  manager_id: int | None = Form(None), job_title: str = Form(""), email: str = Form(""),
                  notes: str = Form(""), is_active: str = Form(""),
                  user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    employee_no, full_name = employee_no.strip(), " ".join(full_name.split())
    emp = db.get(Employee, emp_id) if emp_id else Employee()
    err = None
    if not employee_no or not full_name:
        err = "الرقم الوظيفي والاسم حقلان إلزاميان."
    else:
        dup = db.scalar(select(Employee).where(Employee.employee_no == employee_no, Employee.id != (emp_id or 0)))
        if dup:
            err = f"الرقم الوظيفي مستخدم لموظف آخر: {dup.full_name}."
        dupn = db.scalar(select(Employee).where(Employee.full_name == full_name, Employee.id != (emp_id or 0)))
        if not err and dupn:
            err = "يوجد موظف مسجل بنفس الاسم. أضف ما يميّزه (مثل الاسم الرباعي)."
        if not err and emp_id and manager_id == emp_id:
            err = "لا يمكن إسناد الموظف إلى نفسه."
    if err:
        flash(request, err, "error")
        return back(request, "/employees")
    before = dict(no=emp.employee_no, name=emp.full_name, dept=emp.department_id, officer=emp.manager_id) if emp_id else {}
    was_active, old_officer = (emp.is_active, emp.manager_id) if emp_id else (True, None)
    emp.employee_no, emp.full_name = employee_no, full_name
    emp.department_id, emp.manager_id = department_id or None, manager_id or None
    emp.job_title, emp.email, emp.notes = job_title.strip(), email.strip(), notes.strip()
    if emp_id:
        emp.is_active = bool(is_active)
    else:
        emp.is_active = True
        db.add(emp)
    db.flush()
    from .services import notify_reassignment
    if emp.manager_id and emp.manager_id != old_officer:
        notify_reassignment(db, emp, emp.manager_id, sender=user)
    if emp_id and was_active != emp.is_active:
        acct = db.scalar(select(User).where(User.employee_id == emp.id))
        pend = db.scalar(select(func.count(LeaveRequest.id)).where(LeaveRequest.employee_id == emp.id,
                                                                  LeaveRequest.status == "pending")) or 0
        if acct and acct.role != "admin":
            acct.is_active = emp.is_active
            flash(request, f"{'عُطّل' if not emp.is_active else 'أُعيد تفعيل'} حساب الدخول ({acct.username}) تبعاً لحالة الموظف.", "info")
        if not emp.is_active and pend:
            flash(request, f"تنبيه: للموظف {pend} طلب بانتظار القرار — راجعها من «الاعتمادات» (تُبتّ أو تُلغى).", "warn")
    audit(db, user, "employee_updated" if emp_id else "employee_created", "employee", emp.id,
          ip=client_ip(request), before=before,
          after=dict(no=employee_no, name=full_name, dept=department_id, officer=manager_id, active=emp.is_active))
    db.commit()
    flash(request, "تم حفظ بيانات الموظف.")
    return redirect(f"/employees/{emp.id}")


# ================================================================ التوصيات
@router.get("/recommendations")
def recommendations(request: Request, kind: str = "", emp: int | None = None, year_id: int | None = None,
                    user: User = Depends(current_user), db: Session = Depends(get_db)):
    year = pick_year(db, year_id)
    stmt = select(Recommendation).where(Recommendation.fiscal_year_id == year.id) \
        .order_by(Recommendation.rec_date.desc(), Recommendation.id.desc())
    ids = visible_employee_ids(db, user)
    if ids is not None:
        stmt = stmt.where(Recommendation.employee_id.in_(ids))
    if kind in REC_KINDS:
        stmt = stmt.where(Recommendation.kind == kind)
    if emp:
        stmt = stmt.where(Recommendation.employee_id == emp)
    return render(request, db, "recommendations.html", user=user, rows=list(db.scalars(stmt.limit(1000))),
                  kind=kind, emp=emp, sel_year=year, years=years(db),
                  employees=list(db.scalars(scoped_employees(db, user, managed_only=True))))


@router.get("/recommendations/new")
def recommendation_new(request: Request, kind: str = "days", emp: int | None = None,
                       user: User = Depends(require(*STAFF)), db: Session = Depends(get_db)):
    kind = kind if kind in REC_KINDS else "days"
    emps = list(db.scalars(scoped_employees(db, user, managed_only=True)))
    year = pick_year(db, None)
    caps = {e.id: compute_balance(db, e.id, year) for e in emps}
    return render(request, db, "recommendation_form.html", user=user, kind=kind, emp=emp, employees=emps,
                  caps=caps, sel_year=year)


@router.post("/recommendations/new")
async def recommendation_create(request: Request, user: User = Depends(require(*STAFF)),
                                db: Session = Depends(get_db)):
    form = await request.form()
    kind = str(form.get("kind") or "days")
    back_url = f"/recommendations/new?kind={kind}"
    try:
        emp = db.get(Employee, int(form.get("emp") or 0))
        if not emp or not can_manage(user, emp):
            raise RuleError("اختر موظفاً من الموظفين المسندين إليك.")
        amount = parse_float(str(form.get("amount") or ""))
        rec_date = parse_date(str(form.get("rec_date") or "")) or date.today()
        upload = form.get("file")
        has_file = bool(getattr(upload, "filename", ""))
        year = validate_recommendation(db, emp, kind, amount, rec_date, has_file)
        att = await save_pdf(db, upload, user) if has_file else None
    except (RuleError, ValueError) as e:
        flash(request, str(e), "error")
        return redirect(back_url + (f"&emp={form.get('emp')}" if form.get("emp") else ""))
    before_alerts = alert_keys(compute_balance(db, emp.id, year))
    rec = Recommendation(employee_id=emp.id, fiscal_year_id=year.id, kind=kind, amount=amount, rec_date=rec_date,
                         ref_no=str(form.get("ref_no") or "").strip()[:64],
                         subject=str(form.get("subject") or "").strip(), attachment_id=att.id if att else None,
                         entered_by=user.id, created_at=datetime.now())
    db.add(rec)
    db.flush()
    assign_ref(db, rec, "REC")
    amount_txt = days_ar(amount) if kind == "days" else hours_ar(amount)
    audit(db, user, "recommendation_added", "recommendation", rec.id, ip=client_ip(request),
          employee=emp.full_name, kind=kind, amount=amount)
    notify(db, employee_user(db, emp), f"منحك بدل راحة: {amount_txt}",
           f"أُضيفت إلى رصيدك توصية بمنحك {rec.kind_label}: {amount_txt}"
           f"{' — ' + rec.subject if rec.subject else ''}.", f"/me", sender=user)
    db.flush()
    notify_balance_alerts(db, emp, year, before_alerts, sender=user)
    db.commit()
    flash(request, f"تم رفع التوصية وإضافة {amount_txt} إلى رصيد {emp.full_name}.")
    return redirect(f"/employees/{emp.id}" if emp.id != user.employee_id else "/me")


@router.post("/recommendations/{rec_id}/cancel")
def recommendation_cancel(request: Request, rec_id: int, note: str = Form(""),
                          user: User = Depends(require(*STAFF)), db: Session = Depends(get_db)):
    rec = db.get(Recommendation, rec_id)
    if not rec or not can_manage(user, rec.employee):
        raise HTTPException(403, "ليست لديك صلاحية على هذه التوصية.")
    try:
        if not note.strip():
            raise RuleError("اذكر سبب إلغاء التوصية.")
        check_can_cancel_recommendation(db, rec)
    except RuleError as e:
        flash(request, str(e), "error")
        return back(request)
    rec.status, rec.cancelled_by, rec.cancel_note = "cancelled", user.id, note.strip()
    rec.cancelled_at = datetime.now()
    audit(db, user, "recommendation_cancelled", "recommendation", rec.id, ip=client_ip(request), note=note)
    notify(db, employee_user(db, rec.employee), "إلغاء توصية بدل راحة",
           f"أُلغيت التوصية ({rec.kind_label}). السبب: {note.strip()}", "/me", sender=user)
    db.commit()
    flash(request, "تم إلغاء التوصية وتحديث الرصيد.")
    return back(request)


@router.get("/recommendations/{rec_id}/print")
def recommendation_print(request: Request, rec_id: int, user: User = Depends(current_user),
                         db: Session = Depends(get_db)):
    rec = db.get(Recommendation, rec_id)
    if not rec or not can_view_employee(user, rec.employee):
        raise HTTPException(404, "التوصية غير موجودة.")
    year = db.get(FiscalYear, rec.fiscal_year_id)
    return render(request, db, "recommendation_print.html", user=user, rec=rec, sel_year=year,
                  info=compute_balance(db, rec.employee_id, year), ref=rec.ref_code or ref_no("REC", rec.id, rec.created_at))


# ================================================================ الطلبات (استبدال / تعويض)
@router.get("/requests")
def requests_list(request: Request, status: str = "", kind: str = "", emp: int | None = None,
                  year_id: int | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    year = pick_year(db, year_id)
    stmt = select(LeaveRequest).where(LeaveRequest.fiscal_year_id == year.id) \
        .order_by(LeaveRequest.created_at.desc())
    ids = visible_employee_ids(db, user)
    if ids is not None:
        stmt = stmt.where(LeaveRequest.employee_id.in_(ids))
    if status:
        stmt = stmt.where(LeaveRequest.status == status)
    if kind in LEAVE_KINDS:
        stmt = stmt.where(LeaveRequest.kind == kind)
    if emp:
        stmt = stmt.where(LeaveRequest.employee_id == emp)
    rows = list(db.scalars(stmt.limit(1000)))
    return render(request, db, "requests.html", user=user, rows=rows, status=status, kind=kind, emp=emp,
                  sel_year=year, years=years(db), employees=list(db.scalars(scoped_employees(db, user))),
                  can_manage=lambda e: can_manage(user, e))


@router.get("/requests/new")
def request_new(request: Request, kind: str = "use", emp: int | None = None, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    kind = kind if kind in LEAVE_KINDS else "use"
    year = pick_year(db, None)
    managed = list(db.scalars(scoped_employees(db, user, managed_only=True))) if user.role in STAFF else []
    self_emp = db.get(Employee, user.employee_id) if user.employee_id else None
    if not managed and not self_emp:
        raise HTTPException(403, "حسابك غير مرتبط بسجل موظف.")
    if self_emp and not managed and not year.employee_can_request:
        raise HTTPException(403, "تقديم الطلبات من الموظفين غير مفعّل حالياً. تواصل مع مسؤول الشؤون الإدارية.")
    target = emp or (self_emp.id if self_emp and not managed else None)
    info = compute_balance(db, target, year) if target else None
    return render(request, db, "request_form.html", user=user, kind=kind, emp=target, managed=managed,
                  self_emp=self_emp, info=info, sel_year=year)


@router.post("/requests/new")
async def request_create(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    form = await request.form()
    kind, unit = str(form.get("kind") or "use"), "days"  # الطلبات بالأيام فقط؛ الساعات تُحوَّل إلى أيام
    try:
        emp_id = int(form.get("emp") or user.employee_id or 0)
        emp = db.get(Employee, emp_id)
        if not emp:
            raise RuleError("اختر الموظف.")
        own = emp.id == user.employee_id
        if not own and not can_manage(user, emp):
            raise RuleError("ليست لديك صلاحية لتقديم طلب لهذا الموظف.")
        if own and user.role == "employee" and not (active_year(db) and active_year(db).employee_can_request):
            raise RuleError("تقديم الطلبات من الموظفين غير مفعّل حالياً.")
        start = parse_date(str(form.get("start_date") or ""))
        end = parse_date(str(form.get("end_date") or "")) if unit == "days" else start
        hours = parse_float(str(form.get("hours") or "")) if unit == "hours" else None
        upload = form.get("file")
        has_file = bool(getattr(upload, "filename", ""))
        year, ndays, nhours = validate_leave(db, emp, kind, unit, start, end, hours, has_file)
        att = await save_pdf(db, upload, user) if has_file else None
    except (RuleError, ValueError) as e:
        flash(request, str(e), "error")
        return redirect(f"/requests/new?kind={kind}" + (f"&emp={form.get('emp')}" if form.get("emp") else ""))
    req = LeaveRequest(employee_id=emp.id, fiscal_year_id=year.id, kind=kind, unit=unit, start_date=start,
                       end_date=end or start, days=ndays, hours=nhours, reason=str(form.get("reason") or "").strip(),
                       attachment_id=att.id if att else None, requested_by=user.id, created_at=datetime.now())
    db.add(req)
    db.flush()
    assign_ref(db, req, "REQ")
    audit(db, user, "leave_requested", "leave_request", req.id, ip=client_ip(request),
          employee=emp.full_name, kind=kind, unit=unit, days=ndays, hours=nhours)
    if own:
        for o in officer_users_for(db, emp) or list(db.scalars(select(User).where(User.role == "admin"))):
            notify(db, o, f"طلب {req.kind_label} جديد من {emp.full_name}",
                   f"{req.kind_label} — {req.amount_label} بتاريخ {start:%Y-%m-%d}. {req.reason}",
                   "/approvals", sender=user)
    db.commit()
    flash(request, f"تم رفع طلب {req.kind_label} ({req.amount_label})" + (" وهو بانتظار اعتماد مسؤول الشؤون الإدارية." if own else "."))
    return redirect("/requests")


def _decide_leave(db: Session, user: User, req: LeaveRequest, action: str, note: str, ip: str) -> None:
    if req.status != "pending":
        raise RuleError("الطلب ليس بانتظار الاعتماد.")
    if not can_manage(user, req.employee):
        raise RuleError("لا يمكنك البت في هذا الطلب.")
    if action == "approve":
        check_can_approve_leave(db, req)
        before_alerts = alert_keys(compute_balance(db, req.employee_id, db.get(FiscalYear, req.fiscal_year_id)))
        req.status = "approved"
    elif action == "reject":
        if not note.strip():
            raise RuleError("اذكر سبب الرفض.")
        req.status = "rejected"
    else:
        raise RuleError("إجراء غير معروف.")
    req.decided_by, req.decided_at, req.decision_note = user.id, datetime.now(), note.strip()
    audit(db, user, f"leave_{req.status}", "leave_request", req.id, ip=ip, note=note)
    word = "اعتماد" if req.status == "approved" else "رفض"
    notify(db, employee_user(db, req.employee), f"تم {word} طلب {req.kind_label}",
           f"طلبك ({req.amount_label} بتاريخ {req.start_date:%Y-%m-%d}): {req.status_label}."
           f"{' الملاحظة: ' + note.strip() if note.strip() else ''}", "/requests", sender=user)
    if req.status == "approved":
        db.flush()
        notify_balance_alerts(db, req.employee, db.get(FiscalYear, req.fiscal_year_id), before_alerts, sender=user)


@router.post("/requests/{req_id}/decide")
def request_decide(request: Request, req_id: int, action: str = Form(...), note: str = Form(""),
                   user: User = Depends(require(*STAFF)), db: Session = Depends(get_db)):
    req = db.get(LeaveRequest, req_id)
    if not req:
        raise HTTPException(404, "الطلب غير موجود.")
    try:
        _decide_leave(db, user, req, action, note, client_ip(request))
        db.commit()
        flash(request, f"تم تحديث الطلب: {req.status_label}.")
    except RuleError as e:
        db.rollback()
        flash(request, str(e), "error")
    return back(request, "/approvals")


@router.post("/requests/{req_id}/cancel")
def request_cancel(request: Request, req_id: int, note: str = Form(""), user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    req = db.get(LeaveRequest, req_id)
    if not req:
        raise HTTPException(404, "الطلب غير موجود.")
    own = req.employee_id == user.employee_id
    if not (can_manage(user, req.employee) or (own and req.status == "pending")):
        raise HTTPException(403, "ليست لديك صلاحية لإلغاء هذا الطلب.")
    try:
        check_can_cancel_leave(db, req, user)
        if req.status == "approved" and not note.strip():
            raise RuleError("اذكر سبب إلغاء طلب معتمد.")
    except RuleError as e:
        flash(request, str(e), "error")
        return back(request, "/requests")
    prev = req.status
    req.status = "cancelled"
    req.cancelled_by, req.cancelled_at, req.cancel_note = user.id, datetime.now(), (note.strip() or "إلغاء")
    audit(db, user, "leave_cancelled", "leave_request", req.id, ip=client_ip(request), prev=prev, note=note)
    if not own:
        notify(db, employee_user(db, req.employee), f"إلغاء طلب {req.kind_label}",
               f"أُلغي طلبك ({req.amount_label} بتاريخ {req.start_date:%Y-%m-%d}). {note.strip()}",
               "/requests", sender=user)
    db.commit()
    flash(request, "تم إلغاء الطلب وإعادة الرصيد.")
    return back(request, "/requests")


@router.get("/requests/{req_id}/print")
def request_print(request: Request, req_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    req = db.get(LeaveRequest, req_id)
    if not req or not can_view_employee(user, req.employee):
        raise HTTPException(404, "الطلب غير موجود.")
    year = db.get(FiscalYear, req.fiscal_year_id)
    return render(request, db, "request_print.html", user=user, req=req, sel_year=year,
                  info=compute_balance(db, req.employee_id, year), ref=req.ref_code or ref_no("REQ", req.id, req.created_at))


# ================================================================ الاعتمادات
@router.get("/approvals")
def approvals(request: Request, user: User = Depends(require(*STAFF)), db: Session = Depends(get_db)):
    ids = visible_employee_ids(db, user)
    stmt = select(LeaveRequest).where(LeaveRequest.status == "pending").order_by(LeaveRequest.created_at)
    if ids is not None:
        stmt = stmt.where(LeaveRequest.employee_id.in_(ids))
    rows = []
    for r in db.scalars(stmt):
        if can_manage(user, r.employee):
            rows.append((r, compute_balance(db, r.employee_id, db.get(FiscalYear, r.fiscal_year_id))))
    return render(request, db, "approvals.html", user=user, rows=rows)


@router.post("/approvals/bulk")
async def approvals_bulk(request: Request, user: User = Depends(require(*STAFF)), db: Session = Depends(get_db)):
    form = await request.form()
    action = str(form.get("action") or "")
    note = str(form.get("note") or "")
    ok = fail = 0
    msgs = []
    for raw in form.getlist("req_ids"):
        obj = db.get(LeaveRequest, int(raw))
        if not obj:
            continue
        try:
            _decide_leave(db, user, obj, action, note, client_ip(request))
            db.commit()
            ok += 1
        except RuleError as e:
            db.rollback()
            fail += 1
            msgs.append(f"{obj.employee.full_name}: {e}")
    flash(request, f"تمت معالجة {ok} طلب." + (f" تعذّر {fail}." if fail else ""), "ok" if not fail else "error")
    for m in msgs[:5]:
        flash(request, m, "error")
    return redirect("/approvals")


# ================================================================ المراسلات
@router.get("/messages")
def messages(request: Request, box: str = "in", user: User = Depends(current_user), db: Session = Depends(get_db)):
    if box == "sent":
        stmt = select(Message).where(Message.sender_id == user.id)
    else:
        box = "in"
        stmt = select(Message).where(Message.recipient_id == user.id)
    rows = list(db.scalars(stmt.order_by(Message.created_at.desc()).limit(300)))
    return render(request, db, "messages.html", user=user, rows=rows, box=box)


@router.get("/messages/new")
def message_new(request: Request, to: int | None = None, re: int | None = None, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    subject = body = ""
    if re:
        orig = db.get(Message, re)
        if orig and user.id in (orig.recipient_id, orig.sender_id):
            to = to or orig.sender_id
            subject = orig.subject if orig.subject.startswith("رد:") else f"رد: {orig.subject}"
            body = "\n\n—— الرسالة الأصلية ——\n" + orig.body
    return render(request, db, "message_form.html", user=user, recipients=message_recipients(db, user),
                  to=to, subject=subject, body=body)


@router.post("/messages/new")
def message_send(request: Request, to: list[int] = Form([]), subject: str = Form(""), body: str = Form(""),
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    allowed = {u.id: u for u in message_recipients(db, user)}
    targets = [allowed[i] for i in to if i in allowed]
    if not targets or not subject.strip() or not body.strip():
        flash(request, "اختر المستلم واكتب الموضوع ونص الرسالة.", "error")
        return redirect("/messages/new")
    for u in targets:
        notify(db, u, subject.strip(), body.strip(), sender=user)
    audit(db, user, "message_sent", "message", None, ip=client_ip(request), to=[u.username for u in targets],
          subject=subject.strip())
    db.commit()
    flash(request, "تم إرسال الرسالة." + (" وأُرسل إشعار بالبريد لمن لديه بريد مسجّل." if any(
        u.employee and u.employee.email for u in targets) else ""))
    return redirect("/messages?box=sent")


@router.get("/messages/{msg_id}")
def message_view(request: Request, msg_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = db.get(Message, msg_id)
    if not m or user.id not in (m.recipient_id, m.sender_id):
        raise HTTPException(404, "الرسالة غير موجودة.")
    if m.recipient_id == user.id and not m.read_at:
        m.read_at = datetime.now()
        db.commit()
    can_reply = bool(m.sender_id) and m.sender_id != user.id and \
        m.sender_id in {u.id for u in message_recipients(db, user)}
    tpl = "message_print.html" if request.query_params.get("print") else "message_view.html"
    return render(request, db, tpl, user=user, m=m, can_reply=can_reply, ref=ref_no("MSG", m.id, m.created_at))


# ================================================================ المرفقات
@router.get("/files/{att_id}")
def file_download(att_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    att = db.get(Attachment, att_id)
    if not att:
        raise HTTPException(404, "الملف غير موجود.")
    owners = [r.employee for r in db.scalars(select(Recommendation).where(Recommendation.attachment_id == att_id))]
    owners += [r.employee for r in db.scalars(select(LeaveRequest).where(LeaveRequest.attachment_id == att_id))]
    if user.role != "admin" and not any(can_view_employee(user, e) for e in owners):
        raise HTTPException(403, "ليست لديك صلاحية لهذا الملف.")
    path = UPLOAD_DIR / att.stored_name
    if not path.exists():
        raise HTTPException(404, "الملف غير موجود على الخادم.")
    return FileResponse(path, media_type="application/pdf", filename=att.original_name,
                        content_disposition_type="inline")


# ================================================================ التقارير والتصدير
@router.get("/reports")
def reports(request: Request, year_id: int | None = None, user: User = Depends(require(*STAFF)),
            db: Session = Depends(get_db)):
    year = pick_year(db, year_id)
    ids = visible_employee_ids(db, user)
    rq = select(LeaveRequest).where(LeaveRequest.fiscal_year_id == year.id)
    rc = select(Recommendation).where(Recommendation.fiscal_year_id == year.id, Recommendation.status == "active")
    if ids is not None:
        rq = rq.where(LeaveRequest.employee_id.in_(ids))
        rc = rc.where(Recommendation.employee_id.in_(ids))
    reqs, recs = list(db.scalars(rq)), list(db.scalars(rc))
    by = defaultdict(int)
    lead = []
    for r in reqs:
        by[r.status] += 1
        by[f"k_{r.kind}"] += 1
        if r.decided_at and r.status in ("approved", "rejected"):
            lead.append((r.decided_at - r.created_at).total_seconds() / 86400)
    stats = dict(
        recs=len(recs), rec_days=sum(r.amount for r in recs if r.kind == "days"),
        rec_hours=sum(r.amount for r in recs if r.kind == "hours"),
        requests=len(reqs), approved=by["approved"], pending=by["pending"], rejected=by["rejected"],
        cancelled=by["cancelled"], use=by["k_use"], compensation=by["k_compensation"],
        avg_lead=round(sum(lead) / len(lead), 1) if lead else 0,
        no_attachment=sum(1 for r in recs if not r.attachment_id),
    )
    return render(request, db, "reports.html", user=user, sel_year=year, years=years(db), stats=stats)


def _xlsx_response(wb, filename: str) -> StreamingResponse:
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    from urllib.parse import quote

    return StreamingResponse(
        buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


def _sheet(wb, title: str, headers: list[str], rows: list[list]):
    from openpyxl.styles import Alignment, Font, PatternFill

    ws = wb.create_sheet(title)
    ws.sheet_view.rightToLeft = True
    ws.append(headers)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="00427A")
        c.alignment = Alignment(horizontal="center")
    for r in rows:
        ws.append(r)
    for i, h in enumerate(headers, 1):
        ws.column_dimensions[ws.cell(1, i).column_letter].width = max(12, len(h) + 6)
    ws.freeze_panes = "A2"
    return ws


@router.get("/export/{kind}.xlsx")
def export(kind: str, year_id: int | None = None, user: User = Depends(require(*STAFF)),
           db: Session = Depends(get_db)):
    from openpyxl import Workbook

    year = pick_year(db, year_id)
    wb = Workbook()
    wb.remove(wb.active)
    ids = visible_employee_ids(db, user)
    if kind == "balances":
        rows = []
        for i, e in enumerate(db.scalars(scoped_employees(db, user, managed_only=True)), 1):
            b = compute_balance(db, e.id, year)
            rows.append([i, e.full_name, e.employee_no, e.department.name if e.department else "",
                         e.manager.full_name if e.manager else "", b.granted_days, b.granted_hours,
                         b.used_days, b.used_hours, b.days_left, b.hours_left, b.total_left_days,
                         b.total_left_rem, b.granted_equiv_days, b.cap_days])
        _sheet(wb, "أرصدة الموظفين", ["م", "اسم الموظف", "الرقم الوظيفي", "القسم", "مسؤول الشؤون الإدارية", "أيام ممنوحة",
               "ساعات ممنوحة", "أيام مستخدمة", "ساعات مستخدمة", "رصيد الأيام", "رصيد الساعات",
               "الإجمالي (أيام)", "+ ساعات", "الممنوح بالأيام المعادلة", "الحد الأقصى"], rows)
        name = f"أرصدة بدل الراحة {year.name}.xlsx"
    elif kind == "recommendations":
        q = select(Recommendation).where(Recommendation.fiscal_year_id == year.id).order_by(Recommendation.rec_date)
        if ids is not None:
            q = q.where(Recommendation.employee_id.in_(ids))
        rows = [[i, r.employee.full_name, r.employee.employee_no, r.rec_date, r.kind_label, r.amount, r.ref_no,
                 r.subject, r.status_label, "نعم" if r.attachment_id else ""] for i, r in enumerate(db.scalars(q), 1)]
        _sheet(wb, "التوصيات", ["م", "اسم الموظف", "الرقم الوظيفي", "تاريخ التوصية", "النوع", "القيمة",
               "رقم التوصية", "الموضوع", "الحالة", "ملف PDF"], rows)
        name = f"توصيات بدل الراحة {year.name}.xlsx"
    elif kind == "requests":
        q = select(LeaveRequest).where(LeaveRequest.fiscal_year_id == year.id).order_by(LeaveRequest.start_date)
        if ids is not None:
            q = q.where(LeaveRequest.employee_id.in_(ids))
        rows = [[i, r.employee.full_name, r.employee.employee_no, r.kind_label, r.start_date, r.end_date,
                 r.days if r.unit == "days" else "", r.hours if r.unit == "hours" else "", r.status_label,
                 r.reason, r.decision_note] for i, r in enumerate(db.scalars(q), 1)]
        _sheet(wb, "الطلبات", ["م", "اسم الموظف", "الرقم الوظيفي", "نوع الطلب", "من", "إلى", "أيام", "ساعات",
               "الحالة", "السبب", "ملاحظة القرار"], rows)
        name = f"طلبات بدل الراحة {year.name}.xlsx"
    else:
        raise HTTPException(404, "نوع تصدير غير معروف.")
    for ws in wb.worksheets:
        for row in ws.iter_rows(min_row=2):
            for c in row:
                if isinstance(c.value, date):
                    c.number_format = "yyyy-mm-dd"
    return _xlsx_response(wb, name)


# ================================================================ الأرشيف (مسؤول الشؤون الإدارية والأدمن)
def _archive_rows(db: Session, user: User, year: FiscalYear, emp: int | None, kind: str, q: str, status: str = ""):
    from .services import norm_ar
    ids = [e.id for e in db.scalars(scoped_employees(db, user, include_inactive=True, managed_only=True))]
    recs, reqs = [], []
    if kind in ("", "recs"):
        st = select(Recommendation).where(Recommendation.fiscal_year_id == year.id,
                                          Recommendation.employee_id.in_(ids) if ids else false())
        if emp:
            st = st.where(Recommendation.employee_id == emp)
        if status in ("active", "cancelled"):
            st = st.where(Recommendation.status == status)
        elif status:
            st = st.where(false())
        recs = list(db.scalars(st.order_by(Recommendation.rec_date.desc(), Recommendation.id.desc())))
    if kind in ("", "reqs"):
        st = select(LeaveRequest).where(LeaveRequest.fiscal_year_id == year.id,
                                        LeaveRequest.employee_id.in_(ids) if ids else false())
        if emp:
            st = st.where(LeaveRequest.employee_id == emp)
        if status in ("pending", "approved", "rejected", "cancelled"):
            st = st.where(LeaveRequest.status == status)
        elif status:
            st = st.where(false())
        reqs = list(db.scalars(st.order_by(LeaveRequest.start_date.desc(), LeaveRequest.id.desc())))
    if q.strip():
        words = norm_ar(q).lower().split()
        hit = lambda txt: all(w in norm_ar(txt).lower() for w in words)  # noqa: E731
        recs = [r for r in recs if hit(" ".join([r.employee.full_name, r.employee.employee_no, r.subject, r.ref_no,
                                                 r.ref_code or "", r.cancel_note or ""]))]
        reqs = [r for r in reqs if hit(" ".join([r.employee.full_name, r.employee.employee_no, r.reason, r.ref_code or "",
                                                 r.decision_note or "", r.cancel_note or ""]))]
    return ids, recs, reqs


@router.get("/archive")
def archive(request: Request, year_id: int | None = None, emp: int | None = None, kind: str = "", q: str = "",
            status: str = "", user: User = Depends(require(*STAFF)), db: Session = Depends(get_db)):
    year = pick_year(db, year_id)
    ids, recs, reqs = _archive_rows(db, user, year, emp, kind, q, status)
    msgs = [] if kind else list(db.scalars(select(Message).where(
        or_(Message.sender_id == user.id, Message.recipient_id == user.id),
        Message.created_at >= datetime.combine(year.start_date, datetime.min.time()),
        Message.created_at <= datetime.combine(year.end_date, datetime.max.time()))
        .order_by(Message.created_at.desc()).limit(500)))
    return render(request, db, "archive.html", user=user, sel_year=year, years=years(db), recs=recs, reqs=reqs,
                  msgs=msgs, emp=emp, kind=kind, q=q, status=status,
                  employees=list(db.scalars(scoped_employees(db, user, include_inactive=True, managed_only=True))))


@router.get("/archive/export.zip")
def archive_export(request: Request, year_id: int | None = None, user: User = Depends(require(*STAFF)),
                   db: Session = Depends(get_db)):
    """حزمة أرشيف للسنة: ملف Excel فهرس (التوصيات، الطلبات، الأرصدة) + ملفات PDF المرفقة."""
    import zipfile
    from urllib.parse import quote

    from fastapi.responses import Response
    from openpyxl import Workbook

    year = pick_year(db, year_id)
    ids, recs, reqs = _archive_rows(db, user, year, None, "", "")
    wb = Workbook()
    wb.remove(wb.active)
    D = lambda v: v.strftime("%Y-%m-%d %H:%M") if v else ""  # noqa: E731
    pdf = lambda r: f"pdf/{r.ref_code}.pdf" if r.attachment_id else ""  # noqa: E731
    _sheet(wb, "التوصيات", ["الرقم الصادر", "اسم الموظف", "الرقم الوظيفي", "تاريخ التوصية", "النوع", "القيمة",
           "رقم خطاب العميد", "الموضوع", "رفعها", "تاريخ الرفع", "الحالة", "ألغاها", "تاريخ الإلغاء", "سبب الإلغاء", "ملف PDF"],
           [[r.ref_code, r.employee.full_name, r.employee.employee_no, r.rec_date, r.kind_label, r.amount, r.ref_no,
             r.subject, r.enterer.display_name if r.enterer else "", D(r.created_at), r.status_label,
             r.canceller.display_name if r.canceller else "", D(r.cancelled_at), r.cancel_note, pdf(r)] for r in recs])
    _sheet(wb, "الطلبات", ["الرقم الصادر", "اسم الموظف", "الرقم الوظيفي", "نوع الطلب", "من", "إلى", "أيام", "ساعات",
           "السبب", "تاريخ الطلب", "الحالة", "صاحب القرار", "تاريخ القرار", "ملاحظة القرار", "ألغاه", "تاريخ الإلغاء",
           "سبب الإلغاء", "مستند PDF"],
           [[r.ref_code, r.employee.full_name, r.employee.employee_no, r.kind_label, r.start_date, r.end_date,
             r.days if r.unit == "days" else "", r.hours if r.unit == "hours" else "", r.reason, D(r.created_at),
             r.status_label, r.decider.display_name if r.decider else "", D(r.decided_at), r.decision_note,
             r.canceller.display_name if r.canceller else "", D(r.cancelled_at), r.cancel_note, pdf(r)] for r in reqs])
    msgs = list(db.scalars(select(Message).where(
        or_(Message.sender_id == user.id, Message.recipient_id == user.id) if user.role != "admin" else true(),
        Message.created_at >= datetime.combine(year.start_date, datetime.min.time()),
        Message.created_at <= datetime.combine(year.end_date, datetime.max.time())).order_by(Message.created_at)))
    _sheet(wb, "المراسلات", ["الرقم", "التاريخ", "من", "إلى", "الموضوع", "النص", "قُرئت"],
           [[ref_no("MSG", m.id, m.created_at), D(m.created_at), m.sender.display_name if m.sender else "إشعار النظام",
             m.recipient.display_name, m.subject, m.body, "نعم" if m.read_at else ""] for m in msgs])
    bal = []
    for e in db.scalars(select(Employee).where(Employee.id.in_(ids) if ids else false()).order_by(Employee.full_name)):
        b = compute_balance(db, e.id, year)
        bal.append([e.full_name, e.employee_no, b.granted_days, b.granted_hours, b.days_left, b.hours_left,
                    b.total_left_days, b.total_left_rem])
    _sheet(wb, "الأرصدة", ["اسم الموظف", "الرقم الوظيفي", "أيام ممنوحة", "ساعات ممنوحة", "رصيد الأيام", "رصيد الساعات",
           "الإجمالي (أيام)", "+ ساعات"], bal)
    for ws in wb.worksheets:
        for row in ws.iter_rows(min_row=2):
            for c in row:
                if isinstance(c.value, date):
                    c.number_format = "yyyy-mm-dd"
    xbuf = io.BytesIO()
    wb.save(xbuf)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"فهرس الأرشيف {year.name}.xlsx", xbuf.getvalue())
        for r, prefix in [(r, "REC") for r in recs] + [(r, "REQ") for r in reqs]:
            if r.attachment_id:
                att = db.get(Attachment, r.attachment_id)
                p = UPLOAD_DIR / att.stored_name if att else None
                if p and p.exists():
                    z.write(p, f"pdf/{r.ref_code or prefix + '-' + str(r.id)}.pdf")
    audit(db, user, "archive_exported", "archive", None, ip=client_ip(request), year=year.name,
          recs=len(recs), reqs=len(reqs))
    db.commit()
    name = f"أرشيف بدل الراحة {year.name}.zip"
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})

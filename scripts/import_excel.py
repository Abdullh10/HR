"""ترحيل بيانات ملفات الإكسل الحالية إلى النظام.

الاستخدام:
    python -m scripts.import_excel --balances "إدارة أيام بدل الراحة.xlsx" --hours "آلية حساب الساعات.xlsx"
    (تجربة دون حفظ — الافتراضي)  ثم أضف --commit للحفظ الفعلي.

يُخرج تقريراً بكل الاستثناءات في data/import_report.xlsx
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import date, datetime
from pathlib import Path

import openpyxl
from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import DATA_DIR, Base, SessionLocal, engine  # noqa: E402
from app.models import (  # noqa: E402
    AppSetting,
    Department,
    Employee,
    FiscalYear,
    RestDayRequest,
    Task,
)
from app.services import audit  # noqa: E402

_DIAC = re.compile(r"[ً-ٰٟـ]")


def norm(s) -> str:
    """تطبيع النص العربي للمطابقة: الهمزات، التاء المربوطة، الألف المقصورة، التشكيل، المسافات."""
    if s is None:
        return ""
    s = _DIAC.sub("", str(s))
    s = re.sub("[أإآٱ]", "ا", s).replace("ة", "ه").replace("ى", "ي")
    return " ".join(s.split())


def clean(s) -> str:
    return " ".join(str(s).split()) if s is not None else ""


def as_no(v) -> str:
    if v is None or str(v).strip() == "":
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def as_date(v) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        try:
            return date.fromisoformat(v.strip()[:10])
        except ValueError:
            return None
    return None


class Report:
    def __init__(self):
        self.rows: list[list] = []

    def add(self, level: str, source: str, ref: str, issue: str, action: str):
        self.rows.append([level, source, ref, issue, action])

    def save(self, path: Path):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "تقرير الترحيل"
        ws.sheet_view.rightToLeft = True
        ws.append(["المستوى", "المصدر", "المرجع", "الملاحظة", "الإجراء المتخذ"])
        for r in self.rows:
            ws.append(r)
        for col, w in zip("ABCDE", (10, 30, 30, 60, 50)):
            ws.column_dimensions[col].width = w
        wb.save(path)


def read_balances_file(path: Path, rep: Report):
    wb = openpyxl.load_workbook(path, data_only=False)
    out = dict(settings={}, employees=[], log=[])
    if "الإعدادات" in wb.sheetnames:
        ws = wb["الإعدادات"]
        out["settings"] = dict(base=ws["B4"].value, owner=ws["B5"].value, uni=ws["B6"].value, college=ws["B7"].value)
    ws = wb["أسماء الموظفين"]
    for r in range(5, ws.max_row + 1):
        name = clean(ws.cell(r, 2).value)
        if not name:
            continue
        out["employees"].append(dict(name=name, no=as_no(ws.cell(r, 3).value), dept=clean(ws.cell(r, 4).value),
                                     notes=clean(ws.cell(r, 9).value), ref=f"أسماء الموظفين!B{r}"))
    ws = wb["سجل أيام التمتع"]
    for r in range(5, ws.max_row + 1):
        name = clean(ws.cell(r, 2).value)
        if not name:
            continue
        out["log"].append(dict(name=name, date=ws.cell(r, 4).value, status=clean(ws.cell(r, 5).value),
                               file=clean(ws.cell(r, 6).value), notes=clean(ws.cell(r, 7).value),
                               ref=f"سجل أيام التمتع!B{r}"))
    return out


def read_hours_file(path: Path, rep: Report):
    wb = openpyxl.load_workbook(path, data_only=False)
    ws = wb.worksheets[0]
    hpd = ws["D5"].value
    staff, tasks = [], []
    for r in range(7, ws.max_row + 1):
        name = clean(ws.cell(r, 11).value)
        if name:
            staff.append(dict(name=name, no=as_no(ws.cell(r, 12).value), ref=f"{ws.title}!K{r}"))
        tname = clean(ws.cell(r, 2).value)
        if tname or ws.cell(r, 6).value not in (None, ""):
            tasks.append(dict(name=tname, date=ws.cell(r, 4).value, desc=clean(ws.cell(r, 5).value),
                              hours=ws.cell(r, 6).value, notes=clean(ws.cell(r, 7).value), ref=f"{ws.title}!B{r}"))
    return dict(hpd=hpd, staff=staff, tasks=tasks)


def run(balances: Path | None, hours: Path | None, commit: bool, force: bool = False) -> Report:
    Base.metadata.create_all(engine)
    rep = Report()
    db = SessionLocal()
    try:
        from app.models import AuditLog

        if commit and not force and db.scalar(select(AuditLog.id).where(AuditLog.action == "excel_import")):
            raise SystemExit("سبق تنفيذ الترحيل على قاعدة البيانات هذه. لإعادته استخدم --force (قد يكرر السجلات).")
        B = read_balances_file(balances, rep) if balances else dict(settings={}, employees=[], log=[])
        H = read_hours_file(hours, rep) if hours else dict(hpd=None, staff=[], tasks=[])

        active = db.scalar(select(FiscalYear).where(FiscalYear.is_active.is_(True)))
        if not active:
            active = FiscalYear(name="2027", start_date=date(2027, 1, 1), end_date=date(2027, 12, 31), is_active=True)
            db.add(active)
            db.flush()

        # ---------------- الإعدادات
        s = B["settings"]
        if isinstance(s.get("base"), (int, float)):
            active.base_days = int(s["base"])
            rep.add("معلومة", "الإعدادات", "B4", f"الرصيد الأساسي {int(s['base'])} يوماً", f"طُبّق على السنة {active.name}")
        if isinstance(H["hpd"], (int, float)) and H["hpd"] > 0:
            active.hours_per_day = float(H["hpd"])
            rep.add("معلومة", "بدل الراحة", "D5", f"ساعات اليوم {H['hpd']}", f"طُبّق على السنة {active.name}")
        for key, val in (("university", s.get("uni")), ("college", s.get("college"))):
            if val:
                db.merge(AppSetting(key=key, value=clean(val)))
        if s.get("owner"):
            db.merge(AppSetting(key="credit", value=f"تصميم وتطوير: {clean(s['owner'])} – جميع الحقوق محفوظة"))

        # ---------------- الأقسام
        dept_by_key: dict[str, Department] = {d_.name and norm(d_.name): d_ for d_ in db.scalars(select(Department))}
        variants: dict[str, set[str]] = {}

        def dept_for(name: str) -> Department | None:
            if not name:
                return None
            k = norm(name)
            variants.setdefault(k, set()).add(name)
            if k not in dept_by_key:
                d_ = Department(name=name)
                db.add(d_)
                db.flush()
                dept_by_key[k] = d_
            return dept_by_key[k]

        # ---------------- الموظفون (دمج الملفين بالاسم المطبّع)
        emp_by_key: dict[str, Employee] = {norm(e.full_name): e for e in db.scalars(select(Employee))}
        numbers_from_hours = {norm(x["name"]): x["no"] for x in H["staff"] if x["no"]}
        used_nos = {e.employee_no for e in emp_by_key.values()}
        tmp_seq = [len([n for n in used_nos if n.startswith("TMP-")])]

        def next_tmp() -> str:
            while True:
                tmp_seq[0] += 1
                n = f"TMP-{tmp_seq[0]:03d}"
                if n not in used_nos:
                    used_nos.add(n)
                    return n

        def upsert_employee(name: str, no: str, dept: str, notes: str, ref: str) -> Employee:
            k = norm(name)
            e = emp_by_key.get(k)
            no = no or numbers_from_hours.get(k, "")
            if no and len(no) <= 4:
                rep.add("تنبيه", ref, name, f"الرقم الوظيفي «{no}» قصير وقد يكون تجريبياً", "رُحّل كما هو — راجعه")
            if e is None:
                if no and no in used_nos:
                    rep.add("خطأ", ref, name, f"الرقم الوظيفي {no} مكرر", "أُعطي رقماً مؤقتاً")
                    no = ""
                if not no:
                    no = next_tmp()
                    rep.add("تنبيه", ref, name, "لا يوجد رقم وظيفي", f"أُعطي الرقم المؤقت {no}")
                used_nos.add(no)
                e = Employee(employee_no=no, full_name=name, department=dept_for(dept), notes=notes, is_active=True)
                db.add(e)
                db.flush()
                emp_by_key[k] = e
            else:
                if dept and not e.department_id:
                    e.department = dept_for(dept)
                if no and e.is_temp_no and no not in used_nos:
                    used_nos.add(no)
                    e.employee_no = no
            return e

        for x in B["employees"]:
            if norm(x["name"]) in emp_by_key and x["ref"].startswith("أسماء") and \
                    sum(1 for y in B["employees"] if norm(y["name"]) == norm(x["name"])) > 1:
                rep.add("خطأ", x["ref"], x["name"], "اسم مكرر في سجل الموظفين", "دُمج في سجل واحد")
            upsert_employee(x["name"], x["no"], x["dept"], x["notes"], x["ref"])
        for x in H["staff"]:
            if norm(x["name"]) not in emp_by_key:
                rep.add("تنبيه", x["ref"], x["name"], "موجود في ملف الساعات فقط", "أُضيف موظفاً بلا قسم")
            upsert_employee(x["name"], x["no"], "", "", x["ref"])

        for k, names in variants.items():
            if len(names) > 1:
                rep.add("معلومة", "الأقسام", " / ".join(sorted(names)), "صيغ متعددة لنفس القسم", "وُحّدت تلقائياً")
        rep.add("معلومة", "الأقسام", "", "المديرون المباشرون غير موجودين في الإكسل",
                "حدّد المدير المباشر لكل موظف من شاشة الموظفين (إلى ذلك الحين يعتمد الأدمن)")

        # ---------------- السنوات
        years = list(db.scalars(select(FiscalYear)))

        def year_for(d: date) -> FiscalYear:
            for y in years:
                if y.start_date <= d <= y.end_date:
                    return y
            y = FiscalYear(name=str(d.year), start_date=date(d.year, 1, 1), end_date=date(d.year, 12, 31),
                           is_active=False, balance_mode=active.balance_mode, base_days=active.base_days,
                           hours_per_day=active.hours_per_day)
            db.add(y)
            db.flush()
            years.append(y)
            rep.add("تنبيه", "السنوات", str(d.year), f"حركات خارج السنة النشطة {active.name}",
                    f"أُنشئت سنة {d.year} مستقلة (الرصيد سنوي) — راجعها")
            return y

        # ---------------- المهام
        n_tasks = 0
        for x in H["tasks"]:
            d = as_date(x["date"])
            hrs = x["hours"] if isinstance(x["hours"], (int, float)) else None
            if not x["name"] or not d or not hrs or hrs <= 0:
                rep.add("مستبعد", x["ref"], x["name"] or "—", "صف ناقص (الاسم/التاريخ/الساعات)", "لم يُرحّل")
                continue
            e = emp_by_key.get(norm(x["name"]))
            if not e:
                rep.add("خطأ", x["ref"], x["name"], "الموظف غير موجود", "لم يُرحّل")
                continue
            y = year_for(d)
            db.add(Task(employee_id=e.id, fiscal_year_id=y.id, task_date=d, description=x["desc"] or "مهمة مرحّلة",
                        hours=float(hrs), notes=(x["notes"] + " (مرحّل من الإكسل)").strip(), status="approved",
                        decision_note="مرحّل من الإكسل — اعتُبر معتمداً"))
            n_tasks += 1

        # ---------------- سجل التمتع
        seen: set[tuple[int, date]] = set()
        n_req = 0
        for x in B["log"]:
            d = as_date(x["date"])
            e = emp_by_key.get(norm(x["name"]))
            if not e:
                rep.add("خطأ", x["ref"], x["name"], "الموظف غير مسجل", "لم يُرحّل")
                continue
            if not d:
                rep.add("مستبعد", x["ref"], x["name"], "لا يوجد تاريخ", "لم يُرحّل")
                continue
            status = {"معتمد": "approved", "ملغى": "cancelled"}.get(x["status"])
            if not status:
                rep.add("تنبيه", x["ref"], x["name"], f"حالة غير معروفة «{x['status']}»", "رُحّل بانتظار الاعتماد")
                status = "pending"
            note, dnote = x["notes"], "مرحّل من الإكسل"
            if x["file"]:
                note = (note + f" | ملف التوصية الأصلي: {x['file']}").strip(" |")
                rep.add("تنبيه", x["ref"], x["name"], "رابط ملف توصية خارجي", "حُفظ الرابط في الملاحظات — ارفع الملف يدوياً")
            if status != "cancelled":
                if (e.id, d) in seen:
                    rep.add("خطأ", x["ref"], x["name"], f"تاريخ مكرر {d}", "رُحّل ملغى بسبب «مكرر – ترحيل»")
                    status, dnote = "cancelled", "مكرر – ترحيل"
                seen.add((e.id, d))
            y = year_for(d)
            db.add(RestDayRequest(employee_id=e.id, fiscal_year_id=y.id, rest_date=d, status=status, notes=note,
                                  decision_note=dnote, decided_at=datetime.now() if status != "pending" else None))
            n_req += 1

        rep.add("ملخص", "الترحيل", "", f"{len(emp_by_key)} موظف، {len(dept_by_key)} قسم، {n_tasks} مهمة، {n_req} سجل تمتع",
                "تم الحفظ" if commit else "تجربة فقط (لم يُحفظ) — أعد التشغيل مع --commit")
        if commit:
            audit(db, None, "excel_import", "import", None, employees=len(emp_by_key), tasks=n_tasks, requests=n_req)
            db.commit()
        else:
            db.rollback()
    finally:
        db.close()
    return rep


def main():
    ap = argparse.ArgumentParser(description="ترحيل ملفات الإكسل إلى نظام بدل الراحة")
    ap.add_argument("--balances", type=Path, help="ملف «إدارة أيام بدل الراحة للموظفين»")
    ap.add_argument("--hours", type=Path, help="ملف «آلية حساب ساعات بدل الراحة»")
    ap.add_argument("--commit", action="store_true", help="حفظ فعلي (بدونه تجربة فقط)")
    ap.add_argument("--force", action="store_true", help="السماح بإعادة الترحيل")
    ap.add_argument("--report", type=Path, default=DATA_DIR / "import_report.xlsx")
    a = ap.parse_args()
    if not a.balances and not a.hours:
        ap.error("حدّد ملفاً واحداً على الأقل")
    rep = run(a.balances, a.hours, a.commit, a.force)
    rep.save(a.report)
    counts: dict[str, int] = {}
    for r in rep.rows:
        counts[r[0]] = counts.get(r[0], 0) + 1
    for r in rep.rows:
        if r[0] in ("ملخص", "خطأ"):
            print(" | ".join(str(c) for c in r))
    print("التقرير:", a.report, "|", ", ".join(f"{k}: {v}" for k, v in counts.items()))


if __name__ == "__main__":
    main()

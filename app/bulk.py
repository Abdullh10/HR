"""استيراد الموظفين دفعة واحدة من ملف Excel/CSV أو من نص منسوخ، وإنشاء حساباتهم."""
from __future__ import annotations

import csv
import io
import secrets
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import ASSIGNABLE_ROLES, Department, Employee, User
from .security import hash_password
from .services import norm_ar

MAX_ROWS = 2000
MAX_FILE = 2 * 1024 * 1024

# عناوين الأعمدة المقبولة (بعد التطبيع) ← الحقل
HEADERS = {
    "name": ("الاسم", "اسم الموظف", "الاسم الكامل", "الموظف", "name", "full name"),
    "no": ("الرقم الوظيفي", "الرقم", "رقم الموظف", "رقم وظيفي", "employee no", "employee number", "id"),
    "dept": ("القسم", "الوحده", "الاداره", "الجهه", "department"),
    "role": ("المنصب", "الدور", "الصلاحيه", "نوع الحساب", "role"),
    "manager": ("رقم المدير المباشر", "المدير المباشر", "رقم المدير", "المدير", "manager"),
    "title": ("المسمى الوظيفي", "المسمى", "الوظيفه", "title", "job title"),
    "email": ("البريد", "البريد الالكتروني", "البريد الجامعي", "الايميل", "email"),
}
POSITIONAL = ("name", "no", "dept", "role", "manager", "title", "email")

ROLE_WORDS = {
    "موظف": "employee", "employee": "employee",
    "مسؤول": "officer", "مسئول": "officer", "مسؤول الادخال": "officer", "مسؤول ادخال": "officer",
    "مدخل بيانات": "officer", "officer": "officer",
    "مدير مباشر": "manager", "مدير": "manager", "رئيس مباشر": "manager", "manager": "manager",
    "متابع": "viewer", "مراقب": "viewer", "viewer": "viewer",
}
_HEADER_LOOKUP = {norm_ar(v).lower(): k for k, vals in HEADERS.items() for v in vals}


def parse_role(text: str) -> str | None:
    """None = غير محدد. يرفع ValueError لقيمة غير معروفة."""
    t = norm_ar(text).lower()
    if not t:
        return None
    if t in ROLE_WORDS:
        return ROLE_WORDS[t]
    raise ValueError(f"منصب غير معروف «{text}» (المسموح: موظف، مسؤول، مدير مباشر، متابع)")


def _clean(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return " ".join(str(v).split())


def read_table(filename: str, data: bytes | None, pasted: str) -> list[list[str]]:
    """يعيد صفوفاً من خلايا نصية، من ملف xlsx/csv أو من نص منسوخ من Excel."""
    rows: list[list[str]] = []
    if data:
        if len(data) > MAX_FILE:
            raise ValueError("حجم الملف يتجاوز 2 ميجابايت.")
        name = (filename or "").lower()
        if name.endswith((".xlsx", ".xlsm")) or data[:2] == b"PK":
            import openpyxl

            try:
                wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            except Exception as e:  # noqa: BLE001
                raise ValueError("تعذّر قراءة ملف Excel. تأكد أنه بصيغة ‎.xlsx") from e
            ws = wb.worksheets[0]
            for r in ws.iter_rows(values_only=True):
                rows.append([_clean(c) for c in r])
                if len(rows) > MAX_ROWS + 1:
                    break
        else:
            text = data.decode("utf-8-sig", errors="replace")
            rows = _parse_text(text)
    elif pasted and pasted.strip():
        rows = _parse_text(pasted)
    rows = [r for r in rows if any(c for c in r)]
    if len(rows) > MAX_ROWS + 1:
        raise ValueError(f"الحد الأقصى {MAX_ROWS} صف في المرة الواحدة.")
    return rows


def _parse_text(text: str) -> list[list[str]]:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []
    sample = "\n".join(lines[:20])
    if "\t" in sample:
        delim = "\t"
    elif ";" in sample and "," not in sample:
        delim = ";"
    elif "," in sample or "،" in sample:
        delim = ","
        lines = [ln.replace("،", ",") for ln in lines]
    else:
        delim = "\t"
    return [[_clean(c) for c in r] for r in csv.reader(lines, delimiter=delim)]


def map_columns(rows: list[list[str]]) -> tuple[dict[str, int], list[list[str]], int]:
    """يكتشف صف العناوين إن وُجد، وإلا يعتمد الترتيب: الاسم، الرقم، القسم، المنصب، رقم المدير، المسمى، البريد."""
    if not rows:
        return {}, [], 1
    first = [norm_ar(c).lower() for c in rows[0]]
    mapping: dict[str, int] = {}
    for i, h in enumerate(first):
        key = _HEADER_LOOKUP.get(h)
        if key and key not in mapping:
            mapping[key] = i
    if "name" in mapping:
        return mapping, rows[1:], 2
    # بلا عناوين: إن كان العمود الأول رقمياً والثاني نصياً نبدّل الترتيب
    body = rows
    a, b = (rows[0] + ["", ""])[:2]
    if a.replace("-", "").isdigit() and b and not b.replace("-", "").isdigit():
        return {"no": 0, "name": 1, "dept": 2, "role": 3, "manager": 4, "title": 5, "email": 6}, body, 1
    return {k: i for i, k in enumerate(POSITIONAL)}, body, 1


@dataclass
class Row:
    line: int
    name: str
    no: str
    dept: str = ""
    role: str | None = None
    manager: str = ""
    title: str = ""
    email: str = ""
    errors: list[str] = field(default_factory=list)
    action: str = ""  # new / update / error
    note: str = ""

    def to_dict(self) -> dict:
        return dict(line=self.line, name=self.name, no=self.no, dept=self.dept, role=self.role or "",
                    manager=self.manager, title=self.title, email=self.email)


def build_rows(mapping: dict[str, int], body: list[list[str]], start: int = 1) -> list[Row]:
    out = []
    for n, r in enumerate(body, start=start):
        def g(k):
            i = mapping.get(k)
            return r[i] if i is not None and i < len(r) else ""

        row = Row(line=n, name=g("name"), no=g("no"), dept=g("dept"), manager=g("manager"), title=g("title"),
                  email=g("email"))
        try:
            row.role = parse_role(g("role"))
        except ValueError as e:
            row.errors.append(str(e))
        out.append(row)
    return out


def rows_from_dicts(items: list[dict]) -> list[Row]:
    out = []
    for d in items[:MAX_ROWS]:
        row = Row(line=int(d.get("line", 0)), name=_clean(d.get("name")), no=_clean(d.get("no")),
                  dept=_clean(d.get("dept")), manager=_clean(d.get("manager")), title=_clean(d.get("title")),
                  email=_clean(d.get("email")))
        try:
            row.role = parse_role(d.get("role") or "")
        except ValueError as e:
            row.errors.append(str(e))
        out.append(row)
    return out


def validate(db: Session, rows: list[Row]) -> list[Row]:
    seen_no: dict[str, int] = {}
    seen_name: dict[str, int] = {}
    file_nos = {r.no for r in rows if r.no}
    by_no = {e.employee_no: e for e in db.scalars(select(Employee))}
    by_name = {norm_ar(e.full_name): e for e in by_no.values()}
    for r in rows:
        if not r.name:
            r.errors.append("الاسم فارغ")
        if not r.no:
            r.errors.append("الرقم الوظيفي فارغ")
        elif r.no.upper().startswith("TMP-"):
            r.errors.append("لا يُقبل رقم مؤقت")
        elif len(r.no) > 32:
            r.errors.append("الرقم الوظيفي طويل جداً")
        if r.no and r.no in seen_no:
            r.errors.append(f"الرقم مكرر في السطر {seen_no[r.no]}")
        seen_no.setdefault(r.no, r.line)
        k = norm_ar(r.name)
        if k and k in seen_name:
            r.errors.append(f"الاسم مكرر في السطر {seen_name[k]}")
        seen_name.setdefault(k, r.line)
        if r.manager and r.manager == r.no:
            r.errors.append("لا يكون الموظف مديراً لنفسه")
        elif r.manager and r.manager not in file_nos and r.manager not in by_no:
            r.errors.append(f"رقم المدير المباشر {r.manager} غير موجود")
        if r.errors:
            r.action = "error"
            continue
        existing = by_no.get(r.no)
        same_name = by_name.get(k)
        if existing:
            r.action = "update"
            if norm_ar(existing.full_name) != k:
                r.note = f"سيُحدَّث الاسم من «{existing.full_name}»"
        elif same_name and same_name.is_temp_no:
            r.action = "update"
            r.note = f"سيُستبدل الرقم المؤقت {same_name.employee_no}"
        elif same_name:
            r.action = "error"
            r.errors.append(f"الاسم مسجل مسبقاً برقم آخر ({same_name.employee_no})")
        else:
            r.action = "new"
    return rows


@dataclass
class ApplyResult:
    created: int = 0
    updated: int = 0
    accounts: list[tuple[str, str, str, str]] = field(default_factory=list)  # name, username, password, role key
    roles_changed: int = 0
    skipped: int = 0


def apply(db: Session, rows: list[Row], create_accounts: bool, update_roles: bool) -> ApplyResult:
    res = ApplyResult()
    rows = validate(db, rows)
    by_no = {e.employee_no: e for e in db.scalars(select(Employee))}
    by_name = {norm_ar(e.full_name): e for e in by_no.values()}
    depts = {norm_ar(d.name): d for d in db.scalars(select(Department))}

    def dept_for(name: str) -> Department | None:
        if not name:
            return None
        k = norm_ar(name)
        if k not in depts:
            d = Department(name=name)
            db.add(d)
            db.flush()
            depts[k] = d
        return depts[k]

    touched: list[tuple[Row, Employee]] = []
    for r in rows:
        if r.action not in ("new", "update"):
            res.skipped += 1
            continue
        e = by_no.get(r.no)
        if e is None and r.action == "update":
            e = by_name.get(norm_ar(r.name))
            e.employee_no = r.no
            by_no[r.no] = e
        if e is None:
            e = Employee(employee_no=r.no, full_name=r.name, is_active=True)
            db.add(e)
            res.created += 1
            by_no[r.no] = e
        else:
            res.updated += 1
        e.full_name = r.name
        if r.dept:
            e.department = dept_for(r.dept)
        if r.title:
            e.job_title = r.title
        if r.email:
            e.email = r.email
        db.flush()
        touched.append((r, e))

    for r, e in touched:
        if r.manager:
            e.manager_id = by_no[r.manager].id

    users_by_emp = {u.employee_id: u for u in db.scalars(select(User)) if u.employee_id}
    for r, e in touched:
        u = users_by_emp.get(e.id)
        if u:
            if update_roles and r.role and u.role != "admin" and u.role != r.role:
                u.role = r.role
                res.roles_changed += 1
            continue
        if not create_accounts:
            continue
        uname = e.employee_no.lower()
        if db.scalar(select(User.id).where(func.lower(User.username) == uname)):
            continue
        role = r.role or "employee"
        assert role in ASSIGNABLE_ROLES
        pw = secrets.token_urlsafe(8)
        db.add(User(username=uname, password_hash=hash_password(pw), role=role, employee_id=e.id,
                    must_change_password=True))
        res.accounts.append((e.full_name, uname, pw, role))
    db.flush()
    return res


def template_workbook():
    import openpyxl
    from openpyxl.styles import Font, PatternFill
    from openpyxl.worksheet.datavalidation import DataValidation

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "الموظفون"
    ws.sheet_view.rightToLeft = True
    ws.append(["الاسم", "الرقم الوظيفي", "القسم", "المنصب", "رقم المدير المباشر", "المسمى الوظيفي", "البريد"])
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1B3A6B")
    help_ws = wb.create_sheet("تعليمات")
    help_ws.sheet_view.rightToLeft = True
    for line in (
        ["عبّئ ورقة «الموظفون» بدءاً من السطر الثاني، ولا تغيّر صف العناوين."],
        ["الاسم والرقم الوظيفي إلزاميان، وبقية الأعمدة اختيارية."],
        ["المنصب: موظف، مسؤول، مدير مباشر، متابع (الافتراضي: موظف)."],
        ["رقم المدير المباشر: الرقم الوظيفي لمن يعتمد طلبات الموظف."],
        ["يُنشأ لكل موظف حساب اسم المستخدم فيه رقمه الوظيفي، وكلمة مرور مؤقتة تُعرض بعد الاستيراد."],
        [""],
        ["مثال:"],
        ["الاسم", "الرقم الوظيفي", "القسم", "المنصب", "رقم المدير المباشر"],
        ["محمد أحمد العتيبي", "100500", "وحدة الشؤون الإدارية", "موظف", "100400"],
        ["سارة علي القحطاني", "100400", "وحدة الشؤون الإدارية", "مدير مباشر", ""],
    ):
        help_ws.append(line)
    help_ws.column_dimensions["A"].width = 60
    dv = DataValidation(type="list", formula1='"موظف,مسؤول,مدير مباشر,متابع"', allow_blank=True)
    ws.add_data_validation(dv)
    dv.add("D2:D2001")
    for col, w in zip("ABCDEFG", (32, 16, 30, 16, 20, 22, 26)):
        ws.column_dimensions[col].width = w
    for c in ws["B"][1:] + ws["E"][1:]:
        c.number_format = "@"
    return wb

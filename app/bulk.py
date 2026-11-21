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
    "manager": ("رقم مسؤول شؤون الموظفين", "مسؤول شؤون الموظفين", "شؤون الموظفين", "رقم مسؤول الشؤون الإدارية", "مسؤول الشؤون الإدارية", "الشؤون الإدارية", "رقم الإداري المسؤول", "رقم الإداري", "الإداري المسؤول", "الإداري", "رقم المدير المباشر", "المدير المباشر", "رقم المدير",
                "المدير", "manager", "officer"),
    "title": ("المسمى الوظيفي", "المسمى", "الوظيفه", "title", "job title"),
    "email": ("البريد", "البريد الالكتروني", "البريد الجامعي", "الايميل", "email"),
}
POSITIONAL = ("name", "no", "dept", "role", "manager", "title", "email")

ROLE_WORDS = {
    "موظف": "employee", "employee": "employee",
    "مسؤول": "officer", "مسئول": "officer", "مسؤول الادخال": "officer", "مسؤول ادخال": "officer",
    "مدخل بيانات": "officer", "officer": "officer",
    "إداري": "officer", "اداري": "officer", "الشؤون الإدارية": "officer", "شؤون إدارية": "officer",
    "مسؤول الشؤون الإدارية": "officer", "شؤون الموظفين": "officer", "مسؤول شؤون الموظفين": "officer",
    "مدير مباشر": "officer", "مدير": "officer", "رئيس مباشر": "officer", "manager": "officer",
    "متابع": "officer", "مراقب": "officer", "viewer": "officer",
}
ROLE_WORDS = {norm_ar(k).lower(): v for k, v in ROLE_WORDS.items()}
_HEADER_LOOKUP = {norm_ar(v).lower(): k for k, vals in HEADERS.items() for v in vals}


def parse_role(text: str) -> str | None:
    """None = غير محدد. يرفع ValueError لقيمة غير معروفة."""
    t = norm_ar(text).lower()
    if not t:
        return None
    if t in ROLE_WORDS:
        return ROLE_WORDS[t]
    raise ValueError(f"منصب غير معروف «{text}» (المسموح: موظف، شؤون الموظفين)")


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
    from .models import Department
    dnames = [d.name for d in db.scalars(select(Department))]
    depts_exact = {norm_ar(d) for d in dnames}
    depts_core = {_dept_core(d): d for d in dnames}
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
            r.errors.append(f"رقم مسؤول شؤون الموظفين {r.manager} غير موجود")
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
        # تنبيه: قسم جديد اسمه قريب من قسم موجود (تفادياً لتكرار الأقسام)
        if r.dept and norm_ar(r.dept) not in depts_exact:
            near = depts_core.get(_dept_core(r.dept))
            if near:
                tip = f"القسم «{r.dept}» قريب من القسم الموجود «{near}» — وحّد الاسم أو ادمجهما لاحقاً من الإعدادات"
                r.note = f"{r.note} · {tip}" if r.note else tip
    return rows


_DEPT_WORDS = ("قسم", "وحده", "وحدة", "اداره", "إدارة", "مكتب", "شعبه", "شعبة")


def _dept_core(name: str) -> str:
    """اسم القسم بعد حذف الكلمات العامة و«ال» التعريف، لمقارنة الأسماء المتقاربة."""
    words = [w for w in norm_ar(name).split() if w not in {norm_ar(x) for x in _DEPT_WORDS}]
    return " ".join(w[2:] if w.startswith("ال") and len(w) > 3 else w for w in words)


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


def template_workbook(db=None, filled: bool = False):
    """نموذج Excel قابل للتعبئة وإعادة الرفع. filled=True يملؤه بالموظفين الحاليين لتعديلهم ثم رفعه."""
    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.worksheet.datavalidation import DataValidation

    head_fill, head_font = PatternFill("solid", fgColor="00427A"), Font(bold=True, color="FFFFFF")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "الموظفون"
    ws.sheet_view.rightToLeft = True
    ws.append(["الاسم", "الرقم الوظيفي", "القسم", "المنصب", "رقم مسؤول شؤون الموظفين", "المسمى الوظيفي", "البريد"])
    for c in ws[1]:
        c.font, c.fill = head_font, head_fill
        c.alignment = Alignment(horizontal="center")
    ws.freeze_panes = "A2"
    depts, officers = [], []
    if db is not None:
        from sqlalchemy import select
        from .models import Department, Employee, User
        depts = [d.name for d in db.scalars(select(Department).where(Department.is_active.is_(True)).order_by(Department.name))]
        officers = [(e.employee_no, e.full_name) for e in db.scalars(
            select(Employee).join(User, User.employee_id == Employee.id).where(User.role == "officer")
            .order_by(Employee.full_name))]
        if filled:
            roles = {u.employee_id: u.role for u in db.scalars(select(User)) if u.employee_id}
            for e in db.scalars(select(Employee).where(Employee.is_active.is_(True)).order_by(Employee.full_name)):
                if e.is_temp_no:
                    continue
                ws.append([e.full_name, e.employee_no, e.department.name if e.department else "",
                           "شؤون الموظفين" if roles.get(e.id) == "officer" else "موظف",
                           e.manager.employee_no if e.manager else "", e.job_title, e.email])
    # ورقة القوائم: تُستخدم في القوائم المنسدلة (يمكن الكتابة بقيم أخرى أيضاً)
    lists = wb.create_sheet("القوائم")
    lists.sheet_view.rightToLeft = True
    lists.append(["الأقسام الحالية", "", "رقم مسؤول شؤون الموظفين", "اسم مسؤول شؤون الموظفين"])
    for c in lists[1]:
        c.font, c.fill = head_font, head_fill
    for i in range(max(len(depts), len(officers))):
        no, nm = officers[i] if i < len(officers) else ("", "")
        lists.append([depts[i] if i < len(depts) else "", "", no, nm])
    for col, w in zip("ABCD", (34, 4, 16, 32)):
        lists.column_dimensions[col].width = w
    help_ws = wb.create_sheet("تعليمات")
    help_ws.sheet_view.rightToLeft = True
    for line in (
        ["طريقة الاستخدام"],
        ["1) عبّئ ورقة «الموظفون» بدءاً من السطر الثاني، ولا تغيّر صف العناوين."],
        ["2) احفظ الملف بصيغة Excel ‏(‎.xlsx) ثم ارفعه من صفحة «استيراد الموظفين» واضغط «معاينة قبل الحفظ»."],
        ["3) راجع المعاينة: الصفوف السليمة تُستورد، والصفوف التي فيها أخطاء تظهر لتصحيحها وإعادة الرفع."],
        [""],
        ["الاسم والرقم الوظيفي إلزاميان، وبقية الأعمدة اختيارية."],
        ["المنصب: موظف أو شؤون الموظفين (قائمة منسدلة، والافتراضي: موظف)."],
        ["القسم: اختر من القائمة أو اكتب اسم قسم جديد فيُنشأ تلقائياً."],
        ["رقم مسؤول شؤون الموظفين: الرقم الوظيفي لمسؤول شؤون الموظفين الذي يرفع توصيات الموظف ويعتمد طلباته (انظر ورقة «القوائم»)، ويمكن أن يكون مسؤولاً جديداً في الملف نفسه."],
        ["البريد: يُستخدم لإرسال إشعارات المراسلات والقرارات."],
        ["الرقم الوظيفي مفتاح المطابقة: إن كان الموظف موجوداً تُحدَّث بياناته بدل تكراره، لذا يمكن تنزيل «الموظفين الحاليين» وتعديلهم ثم رفع الملف."],
        ["يُنشأ لكل موظف جديد حساب اسم المستخدم فيه رقمه الوظيفي، وكلمة مرور مؤقتة تُعرض بعد الاستيراد."],
    ):
        help_ws.append(line)
    help_ws["A1"].font = Font(bold=True, size=13, color="00427A")
    help_ws.column_dimensions["A"].width = 110
    dv = DataValidation(type="list", formula1='"موظف,شؤون الموظفين"', allow_blank=True)
    dv.error, dv.errorTitle = "اختر: موظف أو شؤون الموظفين", "قيمة غير صحيحة"
    ws.add_data_validation(dv)
    dv.add("D2:D3000")
    if depts:
        dvd = DataValidation(type="list", formula1=f"=القوائم!$A$2:$A${len(depts) + 1}", allow_blank=True,
                             showErrorMessage=False)
        ws.add_data_validation(dvd)
        dvd.add("C2:C3000")
    if officers:
        dvo = DataValidation(type="list", formula1=f"=القوائم!$C$2:$C${len(officers) + 1}", allow_blank=True,
                             showErrorMessage=False)
        ws.add_data_validation(dvo)
        dvo.add("E2:E3000")
    for col, w in zip("ABCDEFG", (32, 16, 30, 14, 22, 24, 28)):
        ws.column_dimensions[col].width = w
    for row in ws.iter_rows(min_row=2, max_row=3000, min_col=2, max_col=5):
        row[0].number_format = "@"
        row[3].number_format = "@"
    return wb

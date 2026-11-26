"""قواعد العمل: حساب الرصيد، التحقق، الصلاحيات، التدقيق."""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .models import (
    Attachment,
    AuditLog,
    Employee,
    FiscalYear,
    Holiday,
    LeaveRequest,
    Message,
    Recommendation,
    User,
)

WEEKDAYS_AR = ["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]


_DIAC = re.compile(r"[\u064B-\u065F\u0670\u0640]")


def norm_ar(s) -> str:
    """تطبيع النص العربي للمطابقة: الهمزات، التاء المربوطة، الألف المقصورة، التشكيل، المسافات."""
    if s is None:
        return ""
    s = _DIAC.sub("", str(s))
    s = re.sub("[أإآٱ]", "ا", s).replace("ة", "ه").replace("ى", "ي")
    return " ".join(s.split())


class RuleError(ValueError):
    """مخالفة قاعدة عمل — الرسالة تُعرض للمستخدم."""


_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")


def clean_email(v: str) -> str:
    v = (v or "").strip()
    if v and (len(v) > 160 or not _EMAIL_RE.match(v)):
        raise RuleError("البريد الإلكتروني غير صحيح.")
    return v.lower()


def clean_phone(v: str) -> str:
    """رقم جوال سعودي: يُقبل 05XXXXXXXX أو 5XXXXXXXX أو 9665XXXXXXXX (مع + أو 00)، ويُحفظ بصيغة 05XXXXXXXX."""
    v = re.sub(r"[\s\-()]", "", (v or "").translate(_DIGITS))
    if not v:
        return ""
    v = re.sub(r"^(\+|00)", "", v)
    if v.startswith("966"):
        v = v[3:]
    if v.startswith("5") and len(v) == 9:
        v = "0" + v
    if not re.fullmatch(r"05\d{8}", v):
        raise RuleError("رقم الجوال غير صحيح. اكتبه بصيغة 05XXXXXXXX.")
    return v


def clean_extension(v: str) -> str:
    v = re.sub(r"\s", "", (v or "").translate(_DIGITS))
    if v and not re.fullmatch(r"\d{2,6}", v):
        raise RuleError("رقم التحويلة يجب أن يكون من 2 إلى 6 أرقام.")
    return v


# ---------------------------------------------------------------- صياغة عربية
def days_ar(n: int | float) -> str:
    n = int(n)
    if n == 0:
        return "لا يوجد"
    if n == 1:
        return "يوم واحد"
    if n == 2:
        return "يومان"
    if 3 <= n <= 10:
        return f"{n} أيام"
    return f"{n} يوماً"


LATE_DAYS = 3  # معيار الخدمة: يُعدّ الطلب متأخراً إذا بقي بلا قرار 3 أيام فأكثر

COUNT_FORMS = {
    # (صفر، واحد، اثنان، 3–10، 11 فأكثر)
    "emp": ("لا يوجد موظفون", "موظف واحد", "موظفان", "موظفين", "موظفاً"),
    "req": ("لا توجد طلبات", "طلب واحد", "طلبان", "طلبات", "طلباً"),
    "rec": ("لا توجد توصيات", "توصية واحدة", "توصيتان", "توصيات", "توصية"),
    "msg": ("لا توجد رسائل", "رسالة واحدة", "رسالتان", "رسائل", "رسالة"),
    "acc": ("لا توجد حسابات", "حساب واحد", "حسابان", "حسابات", "حساباً"),
}


def count_ar(n: int | float, kind: str) -> str:
    """العدد مع المعدود بصيغة عربية صحيحة: «طلب واحد»، «طلبان»، «5 طلبات»، «12 طلباً»."""
    n = int(n or 0)
    z, one, two, few, many = COUNT_FORMS[kind]
    if n == 0:
        return z
    if n == 1:
        return one
    if n == 2:
        return two
    return f"{n} {few}" if 3 <= n <= 10 else f"{n} {many}"


def hours_ar(h: float) -> str:
    h = round(float(h), 2)
    txt = f"{h:g}"
    if h == 0:
        return "لا توجد ساعات"
    if h == 1:
        return "ساعة واحدة"
    if h == 2:
        return "ساعتان"
    if h.is_integer() and 3 <= h <= 10:
        return f"{txt} ساعات"
    return f"{txt} ساعة"


# ---------------------------------------------------------------- السنة
def active_year(db: Session) -> FiscalYear | None:
    return db.scalar(select(FiscalYear).where(FiscalYear.is_active.is_(True)))


def year_for_date(db: Session, d: date) -> FiscalYear | None:
    return db.scalar(
        select(FiscalYear).where(FiscalYear.start_date <= d, FiscalYear.end_date >= d)
    )


# ---------------------------------------------------------------- الرصيد
@dataclass
class BalanceInfo:
    """الرصيد السنوي: يُمنح بالتوصيات (أيام وساعات)، ويُستهلك بالطلبات المعتمدة."""

    hours_per_day: float
    cap_days: float
    granted_days: float
    granted_hours: float
    used_days: int
    used_hours: float
    pending_days: int
    pending_hours: float
    converted_days_used: int = 0      # أيام معتمدة غُطّيت من رصيد الساعات (كل N ساعات = يوم)
    converted_days_pending: int = 0   # أيام معلّقة ستُغطّى من رصيد الساعات
    taken_days: int = 0               # مجموع أيام الإجازة المعتمدة (من الأيام + المحوّلة من الساعات)

    @property
    def days_left(self) -> float:
        return self.granted_days - self.used_days

    @property
    def hours_left(self) -> float:
        return round(self.granted_hours - self.used_hours, 2)

    @property
    def days_available(self) -> float:
        return self.days_left - self.pending_days

    @property
    def hours_available(self) -> float:
        return round(self.hours_left - self.pending_hours, 2)

    # ما يعادله رصيد الساعات من أيام (كل N ساعات = يوم)
    @property
    def hours_as_days(self) -> int:
        return compute_earned(max(self.hours_left, 0), self.hours_per_day)[0]

    @property
    def hours_remainder(self) -> float:
        return compute_earned(max(self.hours_left, 0), self.hours_per_day)[1]

    @property
    def total_left_hours(self) -> float:
        return round(self.days_left * self.hours_per_day + self.hours_left, 2)

    @property
    def total_left_days(self) -> int:
        return compute_earned(max(self.total_left_hours, 0), self.hours_per_day)[0]

    @property
    def total_left_rem(self) -> float:
        return compute_earned(max(self.total_left_hours, 0), self.hours_per_day)[1]

    @property
    def bookable_days(self) -> int:
        """الأيام التي يمكن طلبها: رصيد الأيام المتاح + ما يعادله رصيد الساعات المتاح (تحويل الساعات إلى أيام)."""
        return int(max(self.days_available, 0)) + compute_earned(max(self.hours_available, 0), self.hours_per_day)[0]

    @property
    def hours_avail_rem(self) -> float:
        """ساعات متاحة لا تكفي ليوم كامل، فلا يمكن استخدامها حتى تكتمل بتوصيات لاحقة."""
        return compute_earned(max(self.hours_available, 0), self.hours_per_day)[1]

    @property
    def bookable_from_hours(self) -> int:
        return max(self.bookable_days - int(max(self.days_available, 0)), 0)

    @property
    def alerts(self) -> list[tuple[str, str]]:
        """تنبيهات الرصيد للموظف: (النوع، النص)."""
        out = []
        if self.cap_days > 0 and self.granted_equiv_days >= self.cap_days - 1e-9:
            out.append(("warn", f"بلغت الحد الأقصى السنوي ({self.cap_days:g} يوماً)، فلا تُقبل توصيات جديدة هذه السنة."))
        elif self.cap_days > 0 and self.cap_pct >= 80:
            out.append(("info", f"اقتربت من الحد الأقصى السنوي: مُنحت {self.granted_equiv_days:g} من {self.cap_days:g} يوماً."))
        granted = self.granted_days * self.hours_per_day + self.granted_hours
        bd, rem = self.bookable_days, self.hours_avail_rem
        tail = f" (تبقّت {hours_ar(rem)} لا تكفي ليوم كامل)" if rem else ""
        if granted > 0 and bd <= 0:
            out.append(("warn", "استنفدت رصيدك المتاح من بدل الراحة" + tail + "."))
        elif granted > 0 and bd <= 2:
            out.append(("warn", f"رصيدك المتاح قارب على النفاد: بقي {days_ar(bd)}{tail}."))
        return out

    @property
    def granted_equiv_days(self) -> float:
        return round(self.granted_days + self.granted_hours / self.hours_per_day, 2)

    @property
    def used_equiv_days(self) -> float:
        return round(self.used_days + self.used_hours / self.hours_per_day, 2)

    @property
    def cap_left_hours(self) -> float:
        return round(self.cap_days * self.hours_per_day - (self.granted_days * self.hours_per_day + self.granted_hours), 2)

    @property
    def cap_pct(self) -> int:
        if self.cap_days <= 0:
            return 0
        return min(100, int(round(self.granted_equiv_days / self.cap_days * 100)))

    @property
    def left_pct(self) -> int:
        """نسبة المتبقي إلى الممنوح (لمؤشر الموظف)."""
        granted = self.granted_days * self.hours_per_day + self.granted_hours
        if granted <= 0:
            return 0
        return max(0, min(100, int(round(self.total_left_hours / granted * 100))))


def compute_earned(hours: float, hours_per_day: float) -> tuple[int, float]:
    """الأيام = INT(الساعات ÷ ساعات اليوم)، والمتبقي = MOD."""
    if hours_per_day <= 0:
        return 0, 0.0
    q = round(hours / hours_per_day, 9)
    days = int(math.floor(q))
    rem = round(hours - days * hours_per_day, 2)
    return days, rem


def allocate(hpd: float, g_days: float, g_hours: float, a_days: float, a_hours: float,
             p_days: float = 0, p_hours: float = 0) -> dict:
    """توزيع الاستهلاك على الرصيدين: طلبات الأيام تُخصم من رصيد الأيام أولاً، وما زاد يُحوَّل
    من رصيد الساعات (كل hpd ساعات = يوم). المعتمد يُخصَّص قبل المعلّق."""
    from_days_a = min(a_days, g_days)
    conv_a = a_days - from_days_a
    from_days_p = min(p_days, g_days - from_days_a)
    conv_p = p_days - from_days_p
    return dict(used_days=int(from_days_a), used_hours=round(a_hours + conv_a * hpd, 2), conv_a=int(conv_a),
                pending_days=int(from_days_p), pending_hours=round(p_hours + conv_p * hpd, 2), conv_p=int(conv_p))


def compute_balance(db: Session, employee_id: int, year: FiscalYear, exclude_rec_id: int | None = None) -> BalanceInfo:
    def rec_sum(kind: str) -> float:
        q = select(func.coalesce(func.sum(Recommendation.amount), 0)).where(
            Recommendation.employee_id == employee_id, Recommendation.fiscal_year_id == year.id,
            Recommendation.kind == kind, Recommendation.status == "active")
        if exclude_rec_id:
            q = q.where(Recommendation.id != exclude_rec_id)
        return float(db.scalar(q) or 0)

    def req_sum(col, unit: str, status: str) -> float:
        return float(db.scalar(select(func.coalesce(func.sum(col), 0)).where(
            LeaveRequest.employee_id == employee_id, LeaveRequest.fiscal_year_id == year.id,
            LeaveRequest.unit == unit, LeaveRequest.status == status)) or 0)

    g_days, g_hours = rec_sum("days"), rec_sum("hours")
    a_days = req_sum(LeaveRequest.days, "days", "approved")
    al = allocate(year.hours_per_day, g_days, g_hours, a_days, req_sum(LeaveRequest.hours, "hours", "approved"),
                  req_sum(LeaveRequest.days, "days", "pending"), req_sum(LeaveRequest.hours, "hours", "pending"))
    return BalanceInfo(
        hours_per_day=year.hours_per_day, cap_days=year.base_days, granted_days=g_days, granted_hours=g_hours,
        used_days=al["used_days"], used_hours=al["used_hours"], pending_days=al["pending_days"],
        pending_hours=al["pending_hours"], converted_days_used=al["conv_a"], converted_days_pending=al["conv_p"],
        taken_days=int(a_days),
    )


def assign_ref(db: Session, obj, prefix: str) -> str:
    """رقم صادر دائم بصيغة موحدة PREFIX-السنة-تسلسل (مثل REC-2026-0007).
    العدّاد محفوظ في الإعدادات فلا يتكرر الرقم حتى بعد «حذف جميع البيانات»."""
    from .models import AppSetting
    yr = (getattr(obj, "created_at", None) or datetime.now()).year
    key = f"seq_{prefix}_{yr}"
    st = db.get(AppSetting, key)
    if st is None:
        st = AppSetting(key=key, value="0")
        db.add(st)
        db.flush()  # حتى يراه الاستدعاء التالي في نفس المعاملة
    n = int(st.value or 0) + 1
    st.value = str(n)
    obj.ref_code = f"{prefix}-{yr}-{n:04d}"
    return obj.ref_code


def notify_reassignment(db: Session, emp: Employee, new_officer_emp_id: int | None, sender: User | None = None) -> int:
    """عند نقل موظف لمسؤول شؤون موظفين آخر: إشعار مسؤول شؤون الموظفين الجديد بطلباته المعلّقة. يعيد عددها."""
    pend = db.scalar(select(func.count(LeaveRequest.id)).where(LeaveRequest.employee_id == emp.id,
                                                              LeaveRequest.status == "pending")) or 0
    if not new_officer_emp_id:
        return pend
    for u in db.scalars(select(User).where(User.employee_id == new_officer_emp_id, User.is_active.is_(True))):
        notify(db, u, f"أُسند إليك الموظف {emp.full_name}",
               f"أصبحت مسؤول شؤون الموظفين عن {emp.full_name} ({emp.employee_no})."
               + (f" لديه {pend} طلب بانتظار قرارك." if pend else ""), "/approvals" if pend else f"/employees/{emp.id}",
               sender=sender)
    return pend


def save_login_cards(db: Session, made: list[tuple], reason: str, by: User | None) -> str:
    """يحفظ بطاقات الدخول لحسابات أُنشئت أو أُعيدت كلمات مرورها. made: (الاسم، المستخدم، كلمة المرور، الدور).
    يعيد اسم الدفعة. إعادة التعيين تُبطل كلمات المرور القديمة في بطاقات الحساب نفسه."""
    from .models import LoginCard
    labels = {"import": "استيراد", "bulk": "إنشاء جماعي", "single": "حساب جديد", "reset": "إعادة تعيين"}
    batch = f"{labels.get(reason, reason)} — {datetime.now():%Y-%m-%d %H:%M}"
    db.flush()
    for name, uname, pw, role in made:
        u = db.scalar(select(User).where(func.lower(User.username) == uname.lower()))
        if u:
            for old in db.scalars(select(LoginCard).where(LoginCard.user_id == u.id, LoginCard.temp_password.is_not(None))):
                old.temp_password = None
        emp = u.employee if u else None
        db.add(LoginCard(user_id=u.id if u else None, username=uname, full_name=name or (emp.full_name if emp else uname),
                         employee_no=emp.employee_no if emp else "", role=role, temp_password=pw, batch=batch,
                         reason=reason, created_by=by.id if by else None, created_at=datetime.now()))
    return batch


def create_employee_account(db: Session, emp: Employee, by: User | None) -> tuple[str, str]:
    """ينشئ حساب دخول لموظف (اسم المستخدم = الرقم الوظيفي، كلمة مرور أولية) ويحفظ بطاقة دخوله.
    يعيد (اسم المستخدم، كلمة المرور). يرفع RuleError إن تعذّر."""
    import secrets
    from .security import hash_password
    if db.scalar(select(User).where(User.employee_id == emp.id)):
        raise RuleError("للموظف حساب دخول مسبقاً.")
    if emp.is_temp_no:
        raise RuleError("رقم الموظف مؤقت؛ صحّح الرقم الوظيفي أولاً ثم أنشئ الحساب.")
    if not emp.is_active:
        raise RuleError("الموظف غير نشط.")
    uname = emp.employee_no.lower()
    if db.scalar(select(User).where(func.lower(User.username) == uname)):
        raise RuleError(f"اسم المستخدم {uname} مستخدم لحساب آخر؛ أنشئ الحساب يدوياً من «المستخدمون والصلاحيات».")
    pw = secrets.token_urlsafe(8)
    role = "officer" if db.scalar(select(Employee.id).where(Employee.manager_id == emp.id)) else "employee"
    db.add(User(username=uname, password_hash=hash_password(pw), role=role, employee_id=emp.id,
                must_change_password=False))
    save_login_cards(db, [(emp.full_name, uname, pw, role)], "single", by)
    return uname, pw


def login_account_info(db: Session, emp: Employee) -> dict | None:
    """حساب الدخول المرتبط بالموظف وآخر بطاقة دخول بانتظار أول دخول (للعرض في صفحة الموظف للأدمن)."""
    from .models import LoginCard
    u = db.scalar(select(User).where(User.employee_id == emp.id))
    if not u:
        return None
    card = db.scalar(select(LoginCard).where(LoginCard.user_id == u.id, LoginCard.temp_password.is_not(None))
                     .order_by(LoginCard.id.desc()))
    return dict(user=u, card=card)


def activate_login_cards(db: Session, user: User) -> None:
    """بعد أن يغيّر المستخدم كلمة مروره: تُمسح المؤقتة من بطاقاته ويُسجّل تاريخ التفعيل."""
    from .models import LoginCard
    for c in db.scalars(select(LoginCard).where(LoginCard.user_id == user.id, LoginCard.temp_password.is_not(None))):
        c.temp_password, c.activated_at = None, datetime.now()


def alert_keys(b: "BalanceInfo") -> set[str]:
    return {t.split(":")[0].split("(")[0].strip()[:20] for _, t in b.alerts}


def notify_balance_alerts(db: Session, emp: Employee, year: FiscalYear, before: set[str],
                          sender: User | None = None) -> None:
    """يرسل للموظف تنبيهات الرصيد الجديدة فقط (عند الاقتراب من الحد السنوي أو نفاد الرصيد)."""
    b = compute_balance(db, emp.id, year)
    new = [t for _, t in b.alerts if t.split(":")[0].split("(")[0].strip()[:20] not in before]
    if new:
        notify(db, employee_user(db, emp), "تنبيه رصيد بدل الراحة", "\n".join(new), "/me", sender=sender)


# ---------------------------------------------------------------- الصلاحيات
def delegated_from(db: Session, user: User, on: date | None = None) -> list[int]:
    """سجلات مسؤولي شؤون الموظفين الذين فوّضوا هذا المسؤول تفويضاً سارياً اليوم."""
    if user.role != "officer" or not user.employee_id:
        return []
    from .models import Delegation
    d = on or date.today()
    return list(db.scalars(select(Delegation.from_emp_id).where(
        Delegation.to_emp_id == user.employee_id, Delegation.cancelled_at.is_(None),
        Delegation.start_date <= d, Delegation.end_date >= d)))


def delegates_of(db: Session, officer_emp_id: int, on: date | None = None) -> list[int]:
    """سجلات المسؤولين المفوَّضين اليوم بفريق هذا المسؤول."""
    from .models import Delegation
    d = on or date.today()
    return list(db.scalars(select(Delegation.to_emp_id).where(
        Delegation.from_emp_id == officer_emp_id, Delegation.cancelled_at.is_(None),
        Delegation.start_date <= d, Delegation.end_date >= d)))


def is_officer_of(user: User, emp: Employee) -> bool:
    """مسؤول شؤون الموظفين المسند له الموظف (Employee.manager_id يشير إلى سجل مسؤول شؤون الموظفين)،
    أو المفوَّض بفريقه تفويضاً سارياً."""
    if not (user.role == "officer" and user.employee_id and emp.manager_id):
        return False
    if emp.manager_id == user.employee_id:
        return True
    from sqlalchemy.orm import object_session
    db = object_session(user) or object_session(emp)
    return bool(db) and emp.manager_id in delegated_from(db, user)


def is_delegated(user: User, emp: Employee) -> bool:
    """يتابع المستخدمُ هذا الموظفَ بالتفويض لا بالإسناد."""
    return bool(user.role == "officer" and emp.manager_id and emp.manager_id != user.employee_id and is_officer_of(user, emp))


def can_view_employee(user: User, emp: Employee) -> bool:
    if user.role == "admin" or user.employee_id == emp.id:
        return True
    return is_officer_of(user, emp)


def can_manage(user: User, emp: Employee) -> bool:
    """رفع التوصيات واعتماد الطلبات: الأدمن أو مسؤول شؤون الموظفين المسند له — ولا أحد على سجله."""
    if user.employee_id == emp.id:
        return False
    return user.role == "admin" or is_officer_of(user, emp)


def team_ids(db: Session, user: User) -> list[int]:
    if user.role != "officer" or not user.employee_id:
        return []
    owners = [user.employee_id, *delegated_from(db, user)]
    return list(db.scalars(select(Employee.id).where(Employee.manager_id.in_(owners))))


def visible_employee_ids(db: Session, user: User) -> list[int] | None:
    """None = الكل."""
    if user.role == "admin":
        return None
    ids = set(team_ids(db, user))
    if user.employee_id:
        ids.add(user.employee_id)
    return list(ids)


def officer_users_for(db: Session, emp: Employee) -> list[User]:
    """المسؤول المسند له الموظف، ومن فُوِّض بفريقه تفويضاً سارياً اليوم."""
    if not emp.manager_id:
        return []
    owners = [emp.manager_id, *delegates_of(db, emp.manager_id)]
    return list(db.scalars(select(User).where(User.employee_id.in_(owners), User.is_active.is_(True),
                                              User.role.in_(("officer", "admin")))))


def employee_user(db: Session, emp: Employee) -> User | None:
    return db.scalar(select(User).where(User.employee_id == emp.id, User.is_active.is_(True)))


def message_recipients(db: Session, user: User) -> list[User]:
    """الأدمن ↔ الجميع، مسؤول شؤون الموظفين ↔ الأدمن وموظفيه، الموظف ↔ مسؤوله (أو الأدمن إن لم يُسند)."""
    active = select(User).where(User.is_active.is_(True), User.id != user.id)
    if user.role == "admin":
        return list(db.scalars(active.order_by(User.role, User.username)))
    admins = list(db.scalars(active.where(User.role == "admin")))
    if user.role == "officer":
        ids = team_ids(db, user)
        team = list(db.scalars(active.where(User.employee_id.in_(ids)))) if ids else []
        return admins + team
    emp = user.employee
    officers = [u for u in officer_users_for(db, emp) if u.id != user.id] if emp else []
    return officers or admins


def notify(db: Session, to: User | None, subject: str, body: str = "", link: str = "",
           sender: User | None = None) -> None:
    """رسالة داخل المنصة + بريد إلكتروني إن كان مفعّلاً."""
    if not to:
        return
    from . import mailer
    m = Message(sender_id=sender.id if sender else None, recipient_id=to.id, subject=subject[:200],
                body=body, link=link, created_at=datetime.now())
    email = to.contact_email
    if email:
        from .models import AppSetting
        org = {s.key: s.value for s in db.scalars(select(AppSetting))}
        m.emailed = mailer.send(email, subject, body, link, org)
    db.add(m)
    from . import push  # إشعار الأجهزة المشتركة (كالتطبيق) — في الخلفية
    push.notify_user(db, to.id, subject, body, link or "/messages")


# ---------------------------------------------------------------- التحقق
def ensure_year_open(year: FiscalYear | None) -> FiscalYear:
    if year is None:
        raise RuleError("التاريخ لا يقع ضمن أي سنة معرّفة في النظام.")
    if year.is_locked:
        raise RuleError(f"السنة {year.name} مقفلة ولا تقبل حركات جديدة.")
    return year


def working_days(db: Session, year: FiscalYear, start: date, end: date) -> list[date]:
    """أيام العمل بين تاريخين (تستبعد عطلة نهاية الأسبوع والعطل الرسمية)."""
    hol = set(db.scalars(select(Holiday.day).where(Holiday.day >= start, Holiday.day <= end)))
    out, d = [], start
    while d <= end:
        if not (year.block_weekends and d.weekday() in year.weekend_set) and d not in hol:
            out.append(d)
        d += timedelta(days=1)
    return out


def validate_recommendation(db: Session, emp: Employee, kind: str, amount: float, rec_date: date,
                            has_attachment: bool) -> FiscalYear:
    if not emp.is_active:
        raise RuleError("الموظف غير نشط.")
    if kind not in ("days", "hours"):
        raise RuleError("نوع التوصية غير صحيح.")
    year = ensure_year_open(year_for_date(db, rec_date))
    if amount is None or amount <= 0:
        raise RuleError("أدخل قيمة أكبر من صفر.")
    if kind == "days" and float(amount) != int(amount):
        raise RuleError("توصية الأيام تكون بأيام كاملة.")
    if year.require_task_attachment and not has_attachment:
        raise RuleError("إرفاق ملف التوصية (PDF) إلزامي.")
    b = compute_balance(db, emp.id, year)
    need = amount * year.hours_per_day if kind == "days" else amount
    if need > b.cap_left_hours + 1e-9:
        left = max(b.cap_left_hours, 0)
        d, r = compute_earned(left, year.hours_per_day)
        raise RuleError(f"تتجاوز التوصية الحد الأقصى السنوي ({year.base_days:g} يوماً). المتاح للمنح: "
                        f"{days_ar(d)}{' و' + hours_ar(r) if r else ''}.")
    return year


def check_can_cancel_recommendation(db: Session, rec: Recommendation) -> None:
    year = ensure_year_open(db.get(FiscalYear, rec.fiscal_year_id))
    if rec.status != "active":
        raise RuleError("التوصية ملغاة مسبقاً.")
    after = compute_balance(db, rec.employee_id, year, exclude_rec_id=rec.id)
    if after.hours_left < -1e-9 or after.days_left < 0:
        raise RuleError("لا يمكن الإلغاء: الرصيد الممنوح بهذه التوصية مستخدم في طلبات معتمدة.")


def validate_leave(db: Session, emp: Employee, kind: str, unit: str, start: date, end: date | None,
                   hours: float | None, has_attachment: bool, exclude_id: int | None = None) -> tuple[FiscalYear, int, float]:
    """يعيد (السنة، عدد الأيام، عدد الساعات)."""
    if not emp.is_active:
        raise RuleError("الموظف غير نشط.")
    if kind not in ("use", "compensation") or unit not in ("days", "hours"):
        raise RuleError("نوع الطلب غير صحيح.")
    if unit != "days":
        raise RuleError("تُعالج الطلبات بالأيام فقط؛ تُحوَّل ساعات التوصيات إلى أيام تلقائياً.")
    if start is None:
        raise RuleError("أدخل التاريخ.")
    year = ensure_year_open(year_for_date(db, start))
    if kind == "compensation" and start > date.today():
        raise RuleError("طلب التعويض يكون عن غياب حدث فعلاً (تاريخ اليوم أو قبله).")
    if year.require_request_attachment and not has_attachment:
        raise RuleError("إرفاق مستند مؤيد (PDF) إلزامي وفق إعدادات السنة.")
    b = compute_balance(db, emp.id, year)
    days, hrs = 0, 0.0
    if unit == "days":
        end = end or start
        if end < start:
            raise RuleError("تاريخ النهاية قبل تاريخ البداية.")
        if year_for_date(db, end) is not year:
            raise RuleError("يجب أن تقع مدة الطلب ضمن سنة واحدة.")
        wd = working_days(db, year, start, end)
        if not wd:
            raise RuleError("المدة المختارة لا تتضمن أيام عمل (عطلة نهاية أسبوع أو عطلة رسمية).")
        days = len(wd)
        overlap = db.scalar(select(LeaveRequest.id).where(
            LeaveRequest.employee_id == emp.id,  # يشمل طلبات الساعات في الأيام نفسها
            LeaveRequest.status.in_(("pending", "approved")),
            LeaveRequest.start_date <= end, LeaveRequest.end_date >= start,
            LeaveRequest.id != (exclude_id or 0)))
        if overlap:
            raise RuleError("يوجد طلب فعّال يتداخل مع هذه المدة.")
        if days > b.bookable_days:
            raise RuleError(f"الرصيد المتاح للحجز بالأيام ({days_ar(b.bookable_days)}، شاملاً تحويل الساعات: "
                            f"كل {b.hours_per_day:g} ساعات = يوم) لا يكفي لمدة {days_ar(days)}.")
    else:
        # طلب بالساعات: ليوم عمل واحد، لا يتجاوز ساعات اليوم، ويُخصم من رصيد الساعات (توصيات الساعات)
        end = start
        if hours is None or hours <= 0:
            raise RuleError("أدخل عدد ساعات أكبر من صفر.")
        hrs = round(float(hours), 2)
        if hrs > year.hours_per_day + 1e-9:
            raise RuleError(f"طلب الساعات ليوم واحد لا يتجاوز ساعات اليوم ({hours_ar(year.hours_per_day)})؛ للمدد الأطول اختر «بالأيام».")
        if not working_days(db, year, start, start):
            raise RuleError("التاريخ المختار ليس يوم عمل (عطلة نهاية أسبوع أو عطلة رسمية).")
        same_day = list(db.scalars(select(LeaveRequest).where(
            LeaveRequest.employee_id == emp.id, LeaveRequest.status.in_(("pending", "approved")),
            LeaveRequest.start_date <= start, LeaveRequest.end_date >= start, LeaveRequest.id != (exclude_id or 0))))
        if any(r.unit == "days" for r in same_day):
            raise RuleError("يوجد طلب فعّال بالأيام يشمل هذا التاريخ.")
        if sum(r.hours for r in same_day) + hrs > year.hours_per_day + 1e-9:
            raise RuleError(f"مجموع ساعات الطلبات في هذا اليوم يتجاوز ساعات اليوم ({hours_ar(year.hours_per_day)}).")
        if hrs > b.hours_available + 1e-9:
            raise RuleError(f"رصيد الساعات المتاح ({hours_ar(max(b.hours_available, 0))}) لا يكفي. "
                            "تُخصم طلبات الساعات من الساعات الممنوحة بتوصيات الساعات؛ للأيام الممنوحة اختر «بالأيام».")
    return year, days, hrs


def check_can_approve_leave(db: Session, req: LeaveRequest) -> None:
    year = ensure_year_open(db.get(FiscalYear, req.fiscal_year_id))
    b = compute_balance(db, req.employee_id, year)
    # المعلّق يتضمن هذا الطلب نفسه؛ نتحقق أن الرصيد (دون المعلّقات الأخرى) يكفيه
    # نتحقق بالاعتماد الافتراضي لهذا الطلب وحده (دون بقية المعلّقات)
    hpd = year.hours_per_day
    a_days = b.taken_days + (req.days if req.unit == "days" else 0)
    a_hours = (b.used_hours - b.converted_days_used * hpd) + (req.hours if req.unit == "hours" else 0)
    al = allocate(hpd, b.granted_days, b.granted_hours, a_days, a_hours)
    if b.granted_hours - al["used_hours"] < -1e-9:
        raise RuleError("اعتماد هذا الطلب يتجاوز الرصيد المتاح (الأيام والساعات المحوّلة).")


def check_can_cancel_leave(db: Session, req: LeaveRequest, user: User) -> None:
    year = ensure_year_open(db.get(FiscalYear, req.fiscal_year_id))
    if req.status not in ("pending", "approved"):
        raise RuleError("لا يمكن إلغاء هذا الطلب في حالته الحالية.")
    # الأدمن ومسؤول شؤون الموظفين يلغيان الطلب المعتمد في أي وقت (مثل خطأ في التاريخ) مع ذكر السبب


# ---------------------------------------------------------------- التدقيق
def audit(db: Session, user: User | None, action: str, entity: str = "", entity_id: int | None = None,
          ip: str = "", **details) -> None:
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            username=user.username if user else "",
            action=action,
            entity=entity,
            entity_id=entity_id,
            details=json.dumps(details, ensure_ascii=False, default=str) if details else "",
            ip=ip,
            created_at=datetime.now(),
        )
    )


def year_end_reminder(db: Session, user: User) -> bool:
    """تذكير سنوي واحد (من أول دخول في ديسمبر) بأن الرصيد المتاح يسقط بنهاية السنة. يعيد True إن أُرسل."""
    today = date.today()
    if today.month != 12 or not user.employee_id:
        return False
    year = year_for_date(db, today)
    if not year or year.end_date > date(today.year, 12, 31) or year.end_date < today:
        return False
    subject = f"تذكير: رصيدك من بدل الراحة يسقط بنهاية السنة {year.name}"
    if db.scalar(select(Message.id).where(Message.recipient_id == user.id, Message.subject == subject)):
        return False
    b = compute_balance(db, user.employee_id, year)
    if b.bookable_days <= 0:
        return False
    notify(db, user, subject,
           f"لديك {days_ar(b.bookable_days)} متاحة للطلب من رصيد بدل الراحة، وتسقط في {year.end_date:%Y-%m-%d} "
           "لأن الرصيد لا يُرحَّل إلى السنة التالية. قدّم طلب معالجة غياب قبل نهاية السنة إن رغبت في استخدامها.", "/requests/new")
    return True


def escalate_overdue(db: Session) -> int:
    """تصعيد الطلبات المتأخرة: كل طلب تجاوز معيار الخدمة دون قرار يُبلَّغ عنه مدير النظام مرة واحدة فقط
    (يُسجَّل «leave_escalated» في سجل التدقيق حتى لا يتكرر). يعيد عدد الطلبات المصعَّدة الآن."""
    from .models import AuditLog
    cutoff = datetime.now() - timedelta(days=LATE_DAYS)
    late = list(db.scalars(select(LeaveRequest).where(LeaveRequest.status == "pending", LeaveRequest.created_at < cutoff)))
    if not late:
        return 0
    done = set(db.scalars(select(AuditLog.entity_id).where(AuditLog.action == "leave_escalated",
                                                          AuditLog.entity_id.in_([r.id for r in late]))))
    fresh = [r for r in late if r.id not in done]
    if not fresh:
        return 0
    admins = list(db.scalars(select(User).where(User.role == "admin", User.is_active.is_(True))))
    lines = [f"• {r.employee.full_name} ({r.amount_label} بتاريخ {r.start_date:%Y-%m-%d}) — مسؤوله: "
             f"{r.employee.manager.full_name if r.employee.manager else 'غير مُسند'}، منذ {days_ar((datetime.now() - r.created_at).days)}"
             for r in fresh[:15]]
    for a in admins:
        notify(db, a, f"تصعيد: {count_ar(len(fresh), 'req')} تجاوزت مدة القرار المعتمدة",
               f"الطلبات الآتية تجاوزت مدة القرار المعتمدة ({days_ar(LATE_DAYS)}) دون قرار:\n" + "\n".join(lines)
               + ("\n…" if len(fresh) > 15 else "") + "\nيمكنك البت فيها بالنيابة أو متابعة المسؤول.", "/approvals")
    for r in fresh:
        audit(db, None, "leave_escalated", "leave_request", r.id, employee=r.employee.full_name)
    return len(fresh)


def employee_delete_blockers(db: Session, emp: Employee) -> list[str]:
    """أسباب منع حذف موظف (الحذف لمن أُدخل بالخطأ فقط؛ من له سجلات يُوقف بدلاً من حذفه حفاظاً على التاريخ)."""
    from .models import RestDayRequest, Task
    out = []
    n_rec = db.scalar(select(func.count(Recommendation.id)).where(Recommendation.employee_id == emp.id)) or 0
    n_req = db.scalar(select(func.count(LeaveRequest.id)).where(LeaveRequest.employee_id == emp.id)) or 0
    n_old = (db.scalar(select(func.count(Task.id)).where(Task.employee_id == emp.id)) or 0) + \
            (db.scalar(select(func.count(RestDayRequest.id)).where(RestDayRequest.employee_id == emp.id)) or 0)
    if n_rec:
        out.append(f"له {count_ar(n_rec, 'rec')}")
    if n_req:
        out.append(f"له {count_ar(n_req, 'req')}")
    if n_old:
        out.append("له سجلات من النظام السابق")
    team = db.scalar(select(func.count(Employee.id)).where(Employee.manager_id == emp.id)) or 0
    if team:
        out.append(f"مسند إليه {count_ar(team, 'emp')} بصفته مسؤول شؤون موظفين")
    for u in db.scalars(select(User).where(User.employee_id == emp.id)):
        if u.role == "admin":
            out.append("مرتبط بحساب مدير النظام")
        acted = db.scalar(select(func.count(Recommendation.id)).where(or_(Recommendation.entered_by == u.id, Recommendation.cancelled_by == u.id))) or 0
        acted += db.scalar(select(func.count(LeaveRequest.id)).where(or_(LeaveRequest.decided_by == u.id, LeaveRequest.cancelled_by == u.id,
                                                                         LeaveRequest.requested_by == u.id))) or 0
        if acted:
            out.append("حسابه اتخذ إجراءات مسجّلة على موظفين آخرين")
    return out


def delete_employee(db: Session, emp: Employee) -> None:
    """حذف موظف أُدخل بالخطأ مع حسابه ورسائله وبطاقات دخوله (بعد التحقق من خلوّه من السجلات)."""
    from .models import AuditLog, Balance, Delegation, LoginCard, PushSubscription
    from sqlalchemy import delete, update
    for u in list(db.scalars(select(User).where(User.employee_id == emp.id))):
        db.execute(delete(Message).where(or_(Message.recipient_id == u.id, Message.sender_id == u.id)))
        db.execute(delete(PushSubscription).where(PushSubscription.user_id == u.id))
        db.execute(update(LoginCard).where(LoginCard.user_id == u.id).values(user_id=None))
        db.execute(update(LoginCard).where(LoginCard.created_by == u.id).values(created_by=None))
        db.execute(update(AuditLog).where(AuditLog.user_id == u.id).values(user_id=None))
        db.execute(update(Attachment).where(Attachment.uploaded_by == u.id).values(uploaded_by=None))
        db.execute(update(Delegation).where(Delegation.created_by == u.id).values(created_by=None))
        db.execute(update(Delegation).where(Delegation.cancelled_by == u.id).values(cancelled_by=None))
        db.delete(u)
    db.execute(delete(Delegation).where(or_(Delegation.from_emp_id == emp.id, Delegation.to_emp_id == emp.id)))
    db.execute(delete(Balance).where(Balance.employee_id == emp.id))
    db.flush()
    db.delete(emp)

"""قواعد العمل: حساب الرصيد، التحقق، الصلاحيات، التدقيق."""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import (
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
    """عند نقل موظف لمسؤول شؤون إدارية آخر: إشعار مسؤول الشؤون الإدارية الجديد بطلباته المعلّقة. يعيد عددها."""
    pend = db.scalar(select(func.count(LeaveRequest.id)).where(LeaveRequest.employee_id == emp.id,
                                                              LeaveRequest.status == "pending")) or 0
    if not new_officer_emp_id:
        return pend
    for u in db.scalars(select(User).where(User.employee_id == new_officer_emp_id, User.is_active.is_(True))):
        notify(db, u, f"أُسند إليك الموظف {emp.full_name}",
               f"أصبحت مسؤول الشؤون الإدارية عن {emp.full_name} ({emp.employee_no})."
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
def is_officer_of(user: User, emp: Employee) -> bool:
    """مسؤول الشؤون الإدارية المسند له الموظف (Employee.manager_id يشير إلى سجل مسؤول الشؤون الإدارية)."""
    return bool(user.role == "officer" and user.employee_id and emp.manager_id == user.employee_id)


def can_view_employee(user: User, emp: Employee) -> bool:
    if user.role == "admin" or user.employee_id == emp.id:
        return True
    return is_officer_of(user, emp)


def can_manage(user: User, emp: Employee) -> bool:
    """رفع التوصيات واعتماد الطلبات: الأدمن أو مسؤول الشؤون الإدارية المسند له — ولا أحد على سجله."""
    if user.employee_id == emp.id:
        return False
    return user.role == "admin" or is_officer_of(user, emp)


def team_ids(db: Session, user: User) -> list[int]:
    if user.role != "officer" or not user.employee_id:
        return []
    return list(db.scalars(select(Employee.id).where(Employee.manager_id == user.employee_id)))


def visible_employee_ids(db: Session, user: User) -> list[int] | None:
    """None = الكل."""
    if user.role == "admin":
        return None
    ids = set(team_ids(db, user))
    if user.employee_id:
        ids.add(user.employee_id)
    return list(ids)


def officer_users_for(db: Session, emp: Employee) -> list[User]:
    if not emp.manager_id:
        return []
    return list(db.scalars(select(User).where(User.employee_id == emp.manager_id, User.is_active.is_(True),
                                              User.role.in_(("officer", "admin")))))


def employee_user(db: Session, emp: Employee) -> User | None:
    return db.scalar(select(User).where(User.employee_id == emp.id, User.is_active.is_(True)))


def message_recipients(db: Session, user: User) -> list[User]:
    """الأدمن ↔ الجميع، مسؤول الشؤون الإدارية ↔ الأدمن وموظفيه، الموظف ↔ مسؤوله (أو الأدمن إن لم يُسند)."""
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
    email = to.employee.email if to.employee else ""
    if email:
        org = "إتمام"
        m.emailed = mailer.send(email, f"[{org}] {subject}", f"{body}\n\n— نظام {org}")
    db.add(m)


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
            LeaveRequest.employee_id == emp.id, LeaveRequest.unit == "days",
            LeaveRequest.status.in_(("pending", "approved")),
            LeaveRequest.start_date <= end, LeaveRequest.end_date >= start,
            LeaveRequest.id != (exclude_id or 0)))
        if overlap:
            raise RuleError("يوجد طلب فعّال يتداخل مع هذه المدة.")
        if days > b.bookable_days:
            raise RuleError(f"الرصيد المتاح للحجز بالأيام ({days_ar(b.bookable_days)}، شاملاً تحويل الساعات: "
                            f"كل {b.hours_per_day:g} ساعات = يوم) لا يكفي لمدة {days_ar(days)}.")
    else:
        end = start
        if hours is None or hours <= 0:
            raise RuleError("أدخل عدد ساعات أكبر من صفر.")
        if hours > year.hours_per_day * 5:
            raise RuleError("عدد الساعات كبير جداً لطلب واحد.")
        hrs = round(float(hours), 2)
        if hrs > b.hours_available + 1e-9:
            raise RuleError(f"رصيد الساعات المتاح ({hours_ar(max(b.hours_available, 0))}) لا يكفي.")
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
    # الأدمن ومسؤول الشؤون الإدارية يلغيان الطلب المعتمد في أي وقت (مثل خطأ في التاريخ) مع ذكر السبب


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

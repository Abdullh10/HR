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


def compute_balance(db: Session, employee_id: int, year: FiscalYear) -> BalanceInfo:
    def rec_sum(kind: str) -> float:
        return float(db.scalar(select(func.coalesce(func.sum(Recommendation.amount), 0)).where(
            Recommendation.employee_id == employee_id, Recommendation.fiscal_year_id == year.id,
            Recommendation.kind == kind, Recommendation.status == "active")) or 0)

    def req_sum(col, unit: str, status: str) -> float:
        return float(db.scalar(select(func.coalesce(func.sum(col), 0)).where(
            LeaveRequest.employee_id == employee_id, LeaveRequest.fiscal_year_id == year.id,
            LeaveRequest.unit == unit, LeaveRequest.status == status)) or 0)

    return BalanceInfo(
        hours_per_day=year.hours_per_day,
        cap_days=year.base_days,
        granted_days=rec_sum("days"),
        granted_hours=rec_sum("hours"),
        used_days=int(req_sum(LeaveRequest.days, "days", "approved")),
        used_hours=req_sum(LeaveRequest.hours, "hours", "approved"),
        pending_days=int(req_sum(LeaveRequest.days, "days", "pending")),
        pending_hours=req_sum(LeaveRequest.hours, "hours", "pending"),
    )


# ---------------------------------------------------------------- الصلاحيات
def is_officer_of(user: User, emp: Employee) -> bool:
    """الإداري المسند له الموظف (Employee.manager_id يشير إلى سجل الإداري)."""
    return bool(user.role == "officer" and user.employee_id and emp.manager_id == user.employee_id)


def can_view_employee(user: User, emp: Employee) -> bool:
    if user.role == "admin" or user.employee_id == emp.id:
        return True
    return is_officer_of(user, emp)


def can_manage(user: User, emp: Employee) -> bool:
    """رفع التوصيات واعتماد الطلبات: الأدمن أو الإداري المسند له — ولا أحد على سجله."""
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
    """الأدمن ↔ الجميع، الإداري ↔ الأدمن وموظفيه، الموظف ↔ إداريه (أو الأدمن إن لم يُسند)."""
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
    b = compute_balance(db, rec.employee_id, year)
    if rec.kind == "days" and b.days_left - rec.amount < 0:
        raise RuleError("لا يمكن الإلغاء: الأيام الممنوحة بهذه التوصية مستخدمة في طلبات معتمدة.")
    if rec.kind == "hours" and b.hours_left - rec.amount < -1e-9:
        raise RuleError("لا يمكن الإلغاء: الساعات الممنوحة بهذه التوصية مستخدمة في طلبات معتمدة.")


def validate_leave(db: Session, emp: Employee, kind: str, unit: str, start: date, end: date | None,
                   hours: float | None, has_attachment: bool, exclude_id: int | None = None) -> tuple[FiscalYear, int, float]:
    """يعيد (السنة، عدد الأيام، عدد الساعات)."""
    if not emp.is_active:
        raise RuleError("الموظف غير نشط.")
    if kind not in ("use", "compensation") or unit not in ("days", "hours"):
        raise RuleError("نوع الطلب غير صحيح.")
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
        if days > b.days_available:
            raise RuleError(f"رصيد الأيام المتاح ({days_ar(max(b.days_available, 0))}) لا يكفي لمدة {days_ar(days)}.")
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
    if req.unit == "days" and req.days > b.days_left:
        raise RuleError("اعتماد هذا الطلب يتجاوز رصيد الأيام.")
    if req.unit == "hours" and req.hours > b.hours_left + 1e-9:
        raise RuleError("اعتماد هذا الطلب يتجاوز رصيد الساعات.")


def check_can_cancel_leave(db: Session, req: LeaveRequest, user: User) -> None:
    year = ensure_year_open(db.get(FiscalYear, req.fiscal_year_id))
    if req.status not in ("pending", "approved"):
        raise RuleError("لا يمكن إلغاء هذا الطلب في حالته الحالية.")
    if req.status == "approved" and req.start_date < date.today():
        if not year.allow_late_cancel and user.role != "admin":
            raise RuleError("لا يمكن إلغاء طلب معتمد بعد مرور تاريخه (يتطلب صلاحية الأدمن).")


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

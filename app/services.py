"""قواعد العمل: حساب الرصيد، التحقق، الصلاحيات، التدقيق."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import (
    AuditLog,
    Balance,
    Employee,
    FiscalYear,
    Holiday,
    RestDayRequest,
    Task,
    User,
)

WEEKDAYS_AR = ["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]


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
    base: int
    adjustment: int
    approved_hours: float
    pending_hours: float
    earned_days: int
    remainder_hours: float
    used_days: int
    taken_days: int
    pending_days: int
    total: int
    remaining: int
    available: int
    hours_per_day: float
    mode: str

    @property
    def hours_to_next_day(self) -> float:
        return round(self.hours_per_day - self.remainder_hours, 2)

    @property
    def progress_pct(self) -> int:
        if self.hours_per_day <= 0:
            return 0
        return int(round(self.remainder_hours / self.hours_per_day * 100))

    @property
    def state(self) -> str:
        if self.remaining < 0:
            return "⚠ تجاوز الرصيد"
        if self.remaining == 0:
            return "نفد الرصيد"
        return "متبقي رصيد"


def compute_earned(hours: float, hours_per_day: float) -> tuple[int, float]:
    """BR-01: الأيام = INT(الساعات ÷ ساعات اليوم)، والمتبقي = MOD."""
    if hours_per_day <= 0:
        return 0, 0.0
    # تقريب لتفادي أخطاء الفاصلة العائمة (مثل 6.9999999)
    q = round(hours / hours_per_day, 9)
    days = int(math.floor(q))
    rem = round(hours - days * hours_per_day, 2)
    return days, rem


def compute_balance(db: Session, employee_id: int, year: FiscalYear) -> BalanceInfo:
    bal = db.scalar(
        select(Balance).where(Balance.employee_id == employee_id, Balance.fiscal_year_id == year.id)
    )
    mode = year.balance_mode
    base = 0
    if mode in ("fixed", "mixed"):
        base = bal.base_override if bal and bal.base_override is not None else year.base_days
    adjustment = bal.adjustment_days if bal else 0

    def hours_sum(status: str) -> float:
        return float(
            db.scalar(
                select(func.coalesce(func.sum(Task.hours), 0)).where(
                    Task.employee_id == employee_id,
                    Task.fiscal_year_id == year.id,
                    Task.status == status,
                )
            )
            or 0
        )

    approved_hours = hours_sum("approved")
    pending_hours = hours_sum("pending")
    earned, rem = compute_earned(approved_hours, year.hours_per_day)
    if mode == "fixed":
        earned_counted = 0
    else:
        earned_counted = earned

    def count_req(*conds) -> int:
        return int(
            db.scalar(
                select(func.count(RestDayRequest.id)).where(
                    RestDayRequest.employee_id == employee_id,
                    RestDayRequest.fiscal_year_id == year.id,
                    *conds,
                )
            )
            or 0
        )

    used = count_req(RestDayRequest.status == "approved")
    taken = count_req(RestDayRequest.status == "approved", RestDayRequest.rest_date < date.today())
    pending = count_req(RestDayRequest.status == "pending")
    total = base + earned_counted + adjustment
    remaining = total - used
    return BalanceInfo(
        base=base,
        adjustment=adjustment,
        approved_hours=approved_hours,
        pending_hours=pending_hours,
        earned_days=earned if mode != "fixed" else 0,
        remainder_hours=rem if mode != "fixed" else 0.0,
        used_days=used,
        taken_days=taken,
        pending_days=pending,
        total=total,
        remaining=remaining,
        available=remaining - pending,
        hours_per_day=year.hours_per_day,
        mode=mode,
    )


# ---------------------------------------------------------------- الصلاحيات
def is_direct_manager(user: User, emp: Employee) -> bool:
    return bool(user.employee_id and emp.manager_id == user.employee_id)


def can_view_employee(user: User, emp: Employee) -> bool:
    if user.role in ("admin", "officer"):
        return True
    if user.employee_id == emp.id:
        return True
    if user.role == "manager" and is_direct_manager(user, emp):
        return True
    return False


def can_decide(user: User, emp: Employee, entered_by: int | None) -> bool:
    """الاعتماد للمدير المباشر (أو الأدمن). لا يعتمد أحد سجله أو ما أدخله بنفسه."""
    if user.employee_id == emp.id:
        return False
    if entered_by is not None and entered_by == user.id:
        return False
    if user.role == "admin":
        return True
    return user.role == "manager" and is_direct_manager(user, emp)


def team_ids(db: Session, user: User) -> list[int]:
    if not user.employee_id:
        return []
    return list(db.scalars(select(Employee.id).where(Employee.manager_id == user.employee_id)))


def visible_employee_ids(db: Session, user: User) -> list[int] | None:
    """None = الكل."""
    if user.role in ("admin", "officer"):
        return None
    ids = set()
    if user.employee_id:
        ids.add(user.employee_id)
    if user.role == "manager":
        ids.update(team_ids(db, user))
    return list(ids)


# ---------------------------------------------------------------- التحقق
def ensure_year_open(year: FiscalYear | None) -> FiscalYear:
    if year is None:
        raise RuleError("التاريخ لا يقع ضمن أي سنة معرّفة في النظام.")
    if year.is_locked:
        raise RuleError(f"السنة {year.name} مقفلة ولا تقبل حركات جديدة.")
    return year


def validate_task(db: Session, emp: Employee, task_date: date, hours: float, has_attachment: bool,
                  exclude_id: int | None = None) -> FiscalYear:
    if not emp.is_active:
        raise RuleError("الموظف غير نشط.")
    year = ensure_year_open(year_for_date(db, task_date))
    if hours is None or hours <= 0:
        raise RuleError("أدخل عدد ساعات أكبر من صفر.")
    if hours > year.max_hours_per_task:
        raise RuleError(f"الحد الأقصى لساعات المهمة الواحدة {year.max_hours_per_task:g} ساعة.")
    if not year.allow_future_tasks and task_date > date.today():
        raise RuleError("لا يمكن تسجيل مهمة بتاريخ مستقبلي.")
    if year.require_task_attachment and not has_attachment:
        raise RuleError("إرفاق ملف (PDF) إلزامي للمهام وفق إعدادات السنة.")
    return year


def validate_rest_day(db: Session, emp: Employee, rest_date: date, has_attachment: bool) -> FiscalYear:
    if not emp.is_active:
        raise RuleError("الموظف غير نشط.")
    year = ensure_year_open(year_for_date(db, rest_date))
    if year.block_weekends and rest_date.weekday() in year.weekend_set:
        raise RuleError(f"التاريخ يوافق {WEEKDAYS_AR[rest_date.weekday()]} (عطلة نهاية الأسبوع).")
    hol = db.scalar(select(Holiday).where(Holiday.day == rest_date))
    if hol:
        raise RuleError(f"التاريخ يوافق عطلة رسمية: {hol.name}.")
    dup = db.scalar(
        select(RestDayRequest.id).where(
            RestDayRequest.employee_id == emp.id,
            RestDayRequest.rest_date == rest_date,
            RestDayRequest.status.in_(("pending", "approved")),
        )
    )
    if dup:
        raise RuleError("يوجد طلب فعّال لنفس الموظف في نفس التاريخ (تاريخ مكرر).")
    if year.require_request_attachment and not has_attachment:
        raise RuleError("إرفاق ملف التوصية (PDF) إلزامي وفق إعدادات السنة.")
    info = compute_balance(db, emp.id, year)
    if info.available <= 0:
        raise RuleError(f"لا يوجد رصيد متاح (المتبقي {info.remaining}، والمعلّق {info.pending_days}).")
    return year


def check_can_approve_request(db: Session, req: RestDayRequest) -> None:
    year = db.get(FiscalYear, req.fiscal_year_id)
    ensure_year_open(year)
    info = compute_balance(db, req.employee_id, year)
    if info.remaining <= 0:
        raise RuleError("اعتماد هذا الطلب يتجاوز رصيد الموظف.")


def check_can_cancel(db: Session, req: RestDayRequest, user: User) -> None:
    year = db.get(FiscalYear, req.fiscal_year_id)
    ensure_year_open(year)
    if req.status not in ("pending", "approved"):
        raise RuleError("لا يمكن إلغاء هذا الطلب في حالته الحالية.")
    if req.status == "approved" and req.rest_date < date.today():
        if not year.allow_late_cancel and user.role != "admin":
            raise RuleError("لا يمكن إلغاء يوم بعد مرور تاريخه (يتطلب صلاحية الأدمن).")


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

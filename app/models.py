"""نموذج البيانات."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

ROLES = {
    "admin": "مدير النظام",
    "officer": "مسؤول الإدخال",
    "manager": "مدير مباشر",
    "viewer": "متابع",
    "employee": "موظف",
}

# المناصب التي يمكن إسنادها للموظفين عند الاستيراد (الأدمن يُسند يدوياً فقط)
ASSIGNABLE_ROLES = ("employee", "officer", "manager", "viewer")

BALANCE_MODES = {
    "fixed": "ثابت (رصيد سنوي محدد)",
    "earned": "مكتسب (من الساعات المعتمدة فقط)",
    "mixed": "مختلط (الرصيد السنوي + المكتسب من الساعات)",
}

TASK_STATUSES = {"pending": "بانتظار الاعتماد", "approved": "معتمد", "rejected": "مرفوض"}
REQUEST_STATUSES = {
    "pending": "بانتظار الاعتماد",
    "approved": "معتمد",
    "rejected": "مرفوض",
    "cancelled": "ملغى",
}


def now() -> datetime:
    return datetime.now()


class AppSetting(Base):
    """إعدادات عامة (اسم الجهة وغيرها)."""

    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


class FiscalYear(Base):
    """السنة: الرصيد سنوي، ولكل سنة إعداداتها التي يتحكم بها الأدمن."""

    __tablename__ = "fiscal_years"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(32), unique=True)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)

    # إعدادات الحساب (مرنة يتحكم بها الأدمن)
    balance_mode: Mapped[str] = mapped_column(String(16), default="mixed")
    base_days: Mapped[int] = mapped_column(Integer, default=20)
    hours_per_day: Mapped[float] = mapped_column(Float, default=7)
    max_hours_per_task: Mapped[float] = mapped_column(Float, default=12)
    # المرفقات مرنة
    require_task_attachment: Mapped[bool] = mapped_column(Boolean, default=False)
    require_request_attachment: Mapped[bool] = mapped_column(Boolean, default=False)
    # قواعد التواريخ
    weekend_days: Mapped[str] = mapped_column(String(16), default="4,5")  # الجمعة، السبت
    block_weekends: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_future_tasks: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_late_cancel: Mapped[bool] = mapped_column(Boolean, default=False)
    employee_can_request: Mapped[bool] = mapped_column(Boolean, default=True)

    __table_args__ = (
        CheckConstraint("hours_per_day > 0", name="ck_hpd_positive"),
        CheckConstraint("base_days >= 0", name="ck_base_nonneg"),
        CheckConstraint("end_date >= start_date", name="ck_year_range"),
    )

    @property
    def weekend_set(self) -> set[int]:
        return {int(x) for x in self.weekend_days.split(",") if x.strip().isdigit()}


class Department(Base):
    __tablename__ = "departments"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    employees: Mapped[list["Employee"]] = relationship(back_populates="department")


class Employee(Base):
    __tablename__ = "employees"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_no: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160), index=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"))
    job_title: Mapped[str] = mapped_column(String(160), default="")
    email: Mapped[str] = mapped_column(String(160), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str] = mapped_column(Text, default="")

    department: Mapped[Department | None] = relationship(back_populates="employees")
    manager: Mapped["Employee | None"] = relationship(remote_side="Employee.id")

    @property
    def is_temp_no(self) -> bool:
        return self.employee_no.startswith("TMP-")


class Balance(Base):
    """رصيد افتتاحي/تسوية لكل موظف في كل سنة (اختياري، يتجاوز الافتراضي)."""

    __tablename__ = "balances"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey("fiscal_years.id"))
    base_override: Mapped[int | None] = mapped_column(Integer, nullable=True)
    adjustment_days: Mapped[int] = mapped_column(Integer, default=0)
    adjustment_reason: Mapped[str] = mapped_column(Text, default="")
    __table_args__ = (UniqueConstraint("employee_id", "fiscal_year_id"),)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16))
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_login: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    employee: Mapped[Employee | None] = relationship()

    @property
    def role_label(self) -> str:
        return ROLES.get(self.role, self.role)

    @property
    def display_name(self) -> str:
        return self.employee.full_name if self.employee else self.username


class Attachment(Base):
    __tablename__ = "attachments"
    id: Mapped[int] = mapped_column(primary_key=True)
    stored_name: Mapped[str] = mapped_column(String(64), unique=True)
    original_name: Mapped[str] = mapped_column(String(255))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Task(Base):
    """مهمة/عمل إضافي بالساعات."""

    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), index=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey("fiscal_years.id"), index=True)
    task_date: Mapped[date] = mapped_column(Date)
    description: Mapped[str] = mapped_column(Text)
    hours: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    notes: Mapped[str] = mapped_column(Text, default="")
    attachment_id: Mapped[int | None] = mapped_column(ForeignKey("attachments.id"))
    entered_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    decision_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    employee: Mapped[Employee] = relationship()
    attachment: Mapped[Attachment | None] = relationship()
    __table_args__ = (CheckConstraint("hours > 0", name="ck_task_hours"),)

    @property
    def status_label(self) -> str:
        return TASK_STATUSES.get(self.status, self.status)


class RestDayRequest(Base):
    """طلب يوم بدل راحة (كل يوم في سجل مستقل)."""

    __tablename__ = "rest_day_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), index=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey("fiscal_years.id"), index=True)
    rest_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    notes: Mapped[str] = mapped_column(Text, default="")
    attachment_id: Mapped[int | None] = mapped_column(ForeignKey("attachments.id"))
    requested_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    decision_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    employee: Mapped[Employee] = relationship()
    attachment: Mapped[Attachment | None] = relationship()

    @property
    def status_label(self) -> str:
        if self.status == "approved" and self.rest_date < date.today():
            return "تم التمتع"
        return REQUEST_STATUSES.get(self.status, self.status)


class Holiday(Base):
    __tablename__ = "holidays"
    id: Mapped[int] = mapped_column(primary_key=True)
    day: Mapped[date] = mapped_column(Date, unique=True)
    name: Mapped[str] = mapped_column(String(160))


class AuditLog(Base):
    """سجل تدقيق للإضافة فقط."""

    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    username: Mapped[str] = mapped_column(String(80), default="")
    action: Mapped[str] = mapped_column(String(64))
    entity: Mapped[str] = mapped_column(String(64), default="")
    entity_id: Mapped[int | None] = mapped_column(Integer)
    details: Mapped[str] = mapped_column(Text, default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)

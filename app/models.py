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
    "officer": "شؤون الموظفين",
    "employee": "موظف",
}
# أدوار قديمة تُرحَّل تلقائياً إلى «شؤون الموظفين»
LEGACY_ROLES = ("manager", "viewer")

# المناصب التي يمكن إسنادها للموظفين عند الاستيراد (الأدمن يُسند يدوياً فقط)
ASSIGNABLE_ROLES = ("employee", "officer")

REC_KINDS = {"days": "بدل راحة بالأيام", "hours": "بدل راحة بالساعات"}
LEAVE_KINDS = {"use": "معالجة غياب", "compensation": "تعويض غياب"}  # الطلبات الجديدة كلها "use"؛ "compensation" للسجلات القديمة
LEAVE_UNITS = {"days": "أيام", "hours": "ساعات"}

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
    phone: Mapped[str] = mapped_column(String(32), default="")  # الجوال
    extension: Mapped[str] = mapped_column(String(16), default="")  # التحويلة
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
    # بيانات شخصية للحسابات غير المرتبطة بسجل موظف (مثل حساب الأدمن)
    full_name: Mapped[str] = mapped_column(String(160), default="")
    email: Mapped[str] = mapped_column(String(160), default="")
    phone: Mapped[str] = mapped_column(String(32), default="")
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)

    employee: Mapped[Employee | None] = relationship()
    department: Mapped[Department | None] = relationship()

    @property
    def role_label(self) -> str:
        return ROLES.get(self.role, self.role)

    @property
    def display_name(self) -> str:
        return self.employee.full_name if self.employee else (self.full_name or self.username)

    @property
    def contact_email(self) -> str:
        return (self.employee.email if self.employee else "") or self.email or ""


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


class Recommendation(Base):
    """التوصية بمنح بدل راحة (بالأيام أو بالساعات)، يرفعها مسؤول شؤون الموظفين في حساب الموظف."""

    __tablename__ = "recommendations"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), index=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey("fiscal_years.id"), index=True)
    kind: Mapped[str] = mapped_column(String(8))  # days | hours
    amount: Mapped[float] = mapped_column(Float)
    rec_date: Mapped[date] = mapped_column(Date)
    ref_no: Mapped[str] = mapped_column(String(64), default="")
    subject: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | cancelled
    attachment_id: Mapped[int | None] = mapped_column(ForeignKey("attachments.id"))
    entered_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    cancelled_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    cancel_note: Mapped[str] = mapped_column(Text, default="")
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ref_code: Mapped[str] = mapped_column(String(32), default="", index=True)  # الرقم الصادر الدائم
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    employee: Mapped[Employee] = relationship()
    attachment: Mapped[Attachment | None] = relationship()
    canceller: Mapped["User | None"] = relationship(foreign_keys="Recommendation.cancelled_by")
    enterer: Mapped["User | None"] = relationship(foreign_keys=[entered_by])
    __table_args__ = (CheckConstraint("amount > 0", name="ck_rec_amount"),)

    @property
    def kind_label(self) -> str:
        return REC_KINDS.get(self.kind, self.kind)

    @property
    def status_label(self) -> str:
        return "سارية" if self.status == "active" else "ملغاة"


class LeaveRequest(Base):
    """طلب الموظف: استبدال رصيد بإجازة، أو تعويض غياب من الرصيد — بالأيام أو بالساعات."""

    __tablename__ = "leave_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), index=True)
    fiscal_year_id: Mapped[int] = mapped_column(ForeignKey("fiscal_years.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # use | compensation
    unit: Mapped[str] = mapped_column(String(8))  # days | hours
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    days: Mapped[int] = mapped_column(Integer, default=0)
    hours: Mapped[float] = mapped_column(Float, default=0)
    reason: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    attachment_id: Mapped[int | None] = mapped_column(ForeignKey("attachments.id"))
    requested_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    decision_note: Mapped[str] = mapped_column(Text, default="")
    cancelled_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancel_note: Mapped[str] = mapped_column(Text, default="")
    ref_code: Mapped[str] = mapped_column(String(32), default="", index=True)  # الرقم الصادر الدائم
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    employee: Mapped[Employee] = relationship()
    attachment: Mapped[Attachment | None] = relationship()
    canceller: Mapped["User | None"] = relationship(foreign_keys="LeaveRequest.cancelled_by")
    requester: Mapped["User | None"] = relationship(foreign_keys=[requested_by])
    decider: Mapped["User | None"] = relationship(foreign_keys=[decided_by])

    @property
    def kind_label(self) -> str:
        return LEAVE_KINDS.get(self.kind, self.kind)

    @property
    def status_label(self) -> str:
        return REQUEST_STATUSES.get(self.status, self.status)

    @property
    def note_text(self) -> str:
        """ملاحظة القرار وسبب الإلغاء معاً (للعرض للموظف والأرشيف)."""
        parts = [self.decision_note] if self.decision_note else []
        if self.status == "cancelled" and self.cancel_note:
            parts.append(f"سبب الإلغاء: {self.cancel_note}")
        return " · ".join(parts)

    @property
    def amount_label(self) -> str:
        from .services import days_ar, hours_ar
        return days_ar(self.days) if self.unit == "days" else hours_ar(self.hours)


class Message(Base):
    """مراسلات داخل المنصة (وإشعارات النظام عندما يكون المرسل فارغاً)."""

    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    sender_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    subject: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime)
    emailed: Mapped[bool] = mapped_column(Boolean, default=False)

    sender: Mapped["User | None"] = relationship(foreign_keys=[sender_id])
    recipient: Mapped["User"] = relationship(foreign_keys=[recipient_id])


class LoginCard(Base):
    """بطاقة دخول تُنشأ مع كل حساب جديد أو إعادة تعيين كلمة مرور، وتبقى في حساب مدير النظام للحفظ والطباعة.
    كلمة المرور تُمسح تلقائياً من البطاقة حين يغيّرها صاحبها (فلا تبقى كلمة مرور فعّالة مخزّنة)."""

    __tablename__ = "login_cards"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    username: Mapped[str] = mapped_column(String(80))
    full_name: Mapped[str] = mapped_column(String(160), default="")
    employee_no: Mapped[str] = mapped_column(String(32), default="")
    role: Mapped[str] = mapped_column(String(16), default="employee")
    temp_password: Mapped[str | None] = mapped_column(String(64), nullable=True)
    batch: Mapped[str] = mapped_column(String(80), index=True)
    reason: Mapped[str] = mapped_column(String(40), default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    @property
    def role_label(self) -> str:
        return ROLES.get(self.role, self.role)

    @property
    def active(self) -> bool:
        return self.temp_password is None


class Delegation(Base):
    """تفويض مؤقت: مسؤول شؤون موظفين (from_emp) يفوّض مسؤولاً آخر (to_emp) بمتابعة فريقه خلال فترة محددة
    (اعتماد الطلبات ورفع التوصيات). يبقى للمسؤول الأصلي اطلاعه على فريقه طوال الفترة."""

    __tablename__ = "delegations"
    id: Mapped[int] = mapped_column(primary_key=True)
    from_emp_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), index=True)
    to_emp_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), index=True)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    note: Mapped[str] = mapped_column(String(300), default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    from_emp: Mapped["Employee"] = relationship(foreign_keys=[from_emp_id])
    to_emp: Mapped["Employee"] = relationship(foreign_keys=[to_emp_id])

    def is_active_on(self, d: date) -> bool:
        return self.cancelled_at is None and self.start_date <= d <= self.end_date

    @property
    def state(self) -> str:
        today = date.today()
        if self.cancelled_at:
            return "cancelled"
        if today < self.start_date:
            return "upcoming"
        return "active" if today <= self.end_date else "ended"

    @property
    def state_label(self) -> str:
        return {"cancelled": "ملغى", "upcoming": "قادم", "active": "ساري", "ended": "منتهٍ"}[self.state]

"""أدوات مشتركة للواجهة: القوالب، المستخدم الحالي، الرسائل، الصلاحيات."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates
from markupsafe import Markup
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import AppSetting, ROLES, User
from .security import SESSION_IDLE_MINUTES, csrf_token
from .services import LATE_DAYS, WEEKDAYS_AR, active_year, count_ar, days_ar, hours_ar

templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))


def fmt_date(d: date | datetime | None) -> str:
    if not d:
        return ""
    if isinstance(d, datetime):
        return d.strftime("%Y-%m-%d %H:%M")
    return d.strftime("%Y-%m-%d")


def fmt_num(v) -> str:
    if v is None:
        return ""
    v = float(v)
    return f"{v:g}"


templates.env.filters["d"] = fmt_date
templates.env.filters["n"] = fmt_num
templates.env.globals["days_ar"] = days_ar
templates.env.globals["hours_ar"] = hours_ar
templates.env.globals["count_ar"] = count_ar
templates.env.globals["LATE_DAYS"] = LATE_DAYS
templates.env.globals["WEEKDAYS_AR"] = WEEKDAYS_AR
templates.env.globals["ROLES"] = ROLES
from .welcome import welcome_info  # noqa: E402
templates.env.globals["welcome_info"] = welcome_info

# رقم إصدار الأصول الثابتة لإجبار المتصفحات (خاصة الجوال) على جلب النسخ الجديدة
ASSET_V = "60"
templates.env.globals["ASSET_V"] = ASSET_V

_STATIC = Path(__file__).parent / "static"


def _inline_sprite(name: str) -> Markup:
    """يضمّن ملف SVG في الصفحة مخفياً ليُشار إلى رموزه داخلياً (#id).
    مراجع <use> الخارجية لا تحلّ التدرجات اللونية في بعض المتصفحات (Safari/iOS)
    فتختفي رموز الأيقونات؛ التضمين الداخلي يعمل في كل المتصفحات."""
    svg = (_STATIC / name).read_text(encoding="utf-8")
    svg = svg.replace("<svg ", '<svg class="svg-sprite" aria-hidden="true" focusable="false" ', 1)
    return Markup(svg)


templates.env.globals["ICON_SPRITE"] = _inline_sprite("icons.svg")
templates.env.globals["HERO_SPRITE"] = _inline_sprite("hero.svg")


class LoginRequired(Exception):
    pass


class MustChangePassword(Exception):
    pass


def flash(request: Request, msg: str, kind: str = "ok") -> None:
    request.session.setdefault("flash", []).append([kind, msg])


def app_settings(db: Session) -> dict[str, str]:
    return {s.key: s.value for s in db.scalars(select(AppSetting))}


def nav_counts(db: Session, user: User | None) -> dict:
    """عدّادات القائمة: رسائل غير مقروءة وطلبات بانتظار الاعتماد."""
    if not user:
        return {}
    from sqlalchemy import func
    from .models import Employee, LeaveRequest, Message
    unread = db.scalar(select(func.count(Message.id)).where(Message.recipient_id == user.id,
                                                            Message.read_at.is_(None))) or 0
    pending = 0
    from .models import Recommendation
    if user.role == "admin":
        pending = db.scalar(select(func.count(LeaveRequest.id)).where(LeaveRequest.status == "pending")) or 0
        pending += db.scalar(select(func.count(Recommendation.id)).where(Recommendation.status == "pending")) or 0
    delegation_badge, delegated_teams = None, []
    if user.role == "officer" and user.employee_id:
        from .services import delegated_from
        owners = [user.employee_id, *delegated_from(db, user)]
        pending = db.scalar(select(func.count(LeaveRequest.id)).join(Employee, Employee.id == LeaveRequest.employee_id)
                            .where(LeaveRequest.status == "pending", Employee.manager_id.in_(owners),
                                   Employee.id != user.employee_id)) or 0
        pending += db.scalar(select(func.count(Recommendation.id)).join(Employee, Employee.id == Recommendation.employee_id)
                             .where(Recommendation.status == "pending", Employee.manager_id.in_(owners),
                                    Employee.id != user.employee_id)) or 0
        delegation_badge = "مفوَّض" if len(owners) > 1 else None
        if len(owners) > 1:
            from datetime import date as _d
            from .models import Delegation
            t = _d.today()
            delegated_teams = [(d.from_emp.full_name, d.end_date) for d in db.scalars(select(Delegation).where(
                Delegation.to_emp_id == user.employee_id, Delegation.cancelled_at.is_(None),
                Delegation.start_date <= t, Delegation.end_date >= t))]
    return dict(unread=unread, pending_approvals=pending, delegation_badge=delegation_badge, delegated_teams=delegated_teams)


def render(request: Request, db: Session, name: str, user: User | None = None, status_code: int = 200, **ctx):
    msgs = request.session.pop("flash", [])
    ctx.update(nav_counts(db, user))
    ctx.update(
        request=request,
        user=user,
        csrf=csrf_token(request),
        flashes=msgs,
        org=app_settings(db),
        year=active_year(db),
        today=date.today(),
        path=request.url.path,
    )
    return templates.TemplateResponse(request, name, ctx, status_code=status_code)


def redirect(url: str) -> RedirectResponse:
    return RedirectResponse(url, status_code=303)


def back(request: Request, fallback: str = "/") -> RedirectResponse:
    ref = request.headers.get("referer") or ""
    host = request.headers.get("host", "")
    if ref and host and f"//{host}/" in ref:
        return redirect(ref)
    return redirect(fallback)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


def session_fp(user: User) -> str:
    """بصمة الجلسة: تتغير إذا حُذف الحساب وأُنشئ غيره بنفس الرقم، أو تغيّرت كلمة المرور أو اسم المستخدم.
    تمنع أن تفتح جلسة قديمة حساباً آخر بعد «حذف جميع البيانات» أو الاستعادة."""
    import hashlib
    raw = f"{user.id}|{user.username}|{user.password_hash}|{user.created_at}"
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def start_session(request: Request, user: User) -> None:
    request.session["uid"] = user.id
    request.session["fp"] = session_fp(user)


def _load_user(request: Request, db: Session) -> User | None:
    uid = request.session.get("uid")
    if not uid:
        return None
    last = request.session.get("seen")
    if last and datetime.now() - datetime.fromisoformat(last) > timedelta(minutes=SESSION_IDLE_MINUTES):
        request.session.clear()
        return None
    user = db.get(User, uid)
    if not user or not user.is_active or request.session.get("fp") != session_fp(user):
        request.session.clear()
        return None
    request.session["seen"] = datetime.now().isoformat(timespec="seconds")
    return user


def current_user_any(request: Request, db: Session = Depends(get_db)) -> User:
    """مستخدم مسجل (حتى لو مطلوب منه تغيير كلمة المرور)."""
    user = _load_user(request, db)
    if not user:
        raise LoginRequired()
    return user


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = current_user_any(request, db)
    if user.must_change_password:
        raise MustChangePassword()
    return user


def require(*roles: str):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="ليست لديك صلاحية للوصول إلى هذه الصفحة.")
        return user

    return dep


def parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(s.strip())
    except ValueError:
        return None


def parse_float(s: str | None) -> float | None:
    if s is None or str(s).strip() == "":
        return None
    try:
        return float(str(s).strip().replace("٫", ".").translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")))
    except ValueError:
        return None


def opt_int(v) -> int | None:
    """رقم اختياري من نموذج: القائمة المنسدلة «— اختر —» ترسل قيمة فارغة فتُعامل كأنها غير محددة."""
    if v is None:
        return None
    v = str(v).strip()
    return int(v) if v.lstrip("-").isdigit() else None


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
from .services import WEEKDAYS_AR, active_year, days_ar, hours_ar

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
templates.env.globals["WEEKDAYS_AR"] = WEEKDAYS_AR
templates.env.globals["ROLES"] = ROLES

# رقم إصدار الأصول الثابتة لإجبار المتصفحات (خاصة الجوال) على جلب النسخ الجديدة
ASSET_V = "6"
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


def render(request: Request, db: Session, name: str, user: User | None = None, status_code: int = 200, **ctx):
    msgs = request.session.pop("flash", [])
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


def _load_user(request: Request, db: Session) -> User | None:
    uid = request.session.get("uid")
    if not uid:
        return None
    last = request.session.get("seen")
    if last and datetime.now() - datetime.fromisoformat(last) > timedelta(minutes=SESSION_IDLE_MINUTES):
        request.session.clear()
        return None
    user = db.get(User, uid)
    if not user or not user.is_active:
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

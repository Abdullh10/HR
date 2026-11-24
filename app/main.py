"""نقطة تشغيل التطبيق: نظام إدارة أيام بدل الراحة."""
from __future__ import annotations

import os
import secrets
from datetime import date
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from starlette.middleware.sessions import SessionMiddleware

from .db import DATA_DIR, Base, SessionLocal, engine
from .models import LEGACY_ROLES, AppSetting, FiscalYear, User
from .security import hash_password, secret_key, verify_csrf
from .web import LoginRequired, MustChangePassword, redirect, render

app = FastAPI(title="نظام بدل الراحة", docs_url=None, redoc_url=None, openapi_url=None,
              dependencies=[Depends(verify_csrf)])
app.add_middleware(
    SessionMiddleware,
    secret_key=secret_key(),
    session_cookie="hr_session",
    same_site="lax",
    https_only=os.environ.get("HR_HTTPS") == "1",  # فعّلها عند النشر خلف HTTPS
    max_age=8 * 3600,
)


class DropEmptyQuery:
    """يحذف معاملات الرابط الفارغة (مثل dept= عند اختيار «الكل») حتى لا تفشل قراءة الأرقام."""

    def __init__(self, app_):
        self.app = app_

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope.get("query_string"):
            from urllib.parse import parse_qsl, urlencode
            pairs = [(k, v) for k, v in parse_qsl(scope["query_string"].decode("latin-1"), keep_blank_values=True) if v != ""]
            scope = dict(scope, query_string=urlencode(pairs).encode("latin-1"))
        await self.app(scope, receive, send)


app.add_middleware(DropEmptyQuery)
app.mount("/static", StaticFiles(directory=str(Path(__file__).parent / "static")), name="static")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "same-origin"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; script-src 'self'; "
        "frame-ancestors 'none'; form-action 'self'"
    )
    if request.url.path.startswith(("/me", "/employees", "/requests", "/tasks", "/admin", "/files")):
        resp.headers["Cache-Control"] = "no-store"
    return resp


@app.exception_handler(LoginRequired)
async def _login_required(request: Request, exc: LoginRequired):
    return redirect("/login")


@app.exception_handler(MustChangePassword)
async def _must_change(request: Request, exc: MustChangePassword):
    return redirect("/change-password")


@app.exception_handler(HTTPException)
async def _http_error(request: Request, exc: HTTPException):
    db = SessionLocal()
    try:
        from .web import _load_user

        user = _load_user(request, db)
        return render(request, db, "error.html", user=user, status_code=exc.status_code,
                      code=exc.status_code, message=exc.detail)
    finally:
        db.close()


# أعمدة أُضيفت بعد الإصدار الأول: تُضاف تلقائياً لقواعد البيانات القائمة (بلا أداة ترحيل)
_NEW_COLUMNS = [
    ("recommendations", "cancelled_at", "TIMESTAMP"),
    ("recommendations", "ref_code", "VARCHAR(32) DEFAULT ''"),
    ("leave_requests", "cancelled_by", "INTEGER"),
    ("leave_requests", "cancelled_at", "TIMESTAMP"),
    ("leave_requests", "cancel_note", "TEXT DEFAULT ''"),
    ("leave_requests", "ref_code", "VARCHAR(32) DEFAULT ''"),
    ("employees", "phone", "VARCHAR(32) DEFAULT ''"),
    ("employees", "extension", "VARCHAR(16) DEFAULT ''"),
    ("users", "full_name", "VARCHAR(160) DEFAULT ''"),
    ("users", "email", "VARCHAR(160) DEFAULT ''"),
    ("users", "phone", "VARCHAR(32) DEFAULT ''"),
    ("users", "department_id", "INTEGER"),
]


def _migrate() -> None:
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, col, typ in _NEW_COLUMNS:
            if table in insp.get_table_names() and col not in {c["name"] for c in insp.get_columns(table)}:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {typ}"))


def init_db() -> None:
    Base.metadata.create_all(engine)
    _migrate()
    with SessionLocal() as db:
        defaults = {
            "university": "جامعة الملك سعود",
            "college": "كلية التمريض",
            "system_title": "إتمام",
            "tagline": "إدارة أيام بدل الراحة",
            "credit": "تصميم وتطوير: مريم حمدي",
        }
        for k, v in defaults.items():
            if not db.get(AppSetting, k):
                db.add(AppSetting(key=k, value=v))
        # الاسم القديم الافتراضي يُستبدل بهوية «إتمام» (لا يمس اسماً غيّره الأدمن)
        old = db.get(AppSetting, "system_title")
        if old and old.value == "إدارة أيام بدل الراحة للموظفين":
            old.value = "إتمام"
        tag = db.get(AppSetting, "tagline")
        if tag and tag.value == "إدارة أيام بدل الراحة بكفاءة واحتراف":
            tag.value = "إدارة أيام بدل الراحة"
        credit = db.get(AppSetting, "credit")
        if credit and credit.value in ("", "تطوير مريم حمدي"):
            credit.value = "تصميم وتطوير: مريم حمدي"
        if not db.scalar(select(FiscalYear)):
            y0 = date.today().year  # السنة الميلادية الحالية (كانت مثبتة على 2027)
            db.add(FiscalYear(name=str(y0), start_date=date(y0, 1, 1), end_date=date(y0, 12, 31),
                              is_active=True, balance_mode="mixed", base_days=20, hours_per_day=7,
                              require_task_attachment=True))
        # ترحيل الأدوار القديمة (مدير مباشر/متابع) إلى «شؤون الموظفين»
        from sqlalchemy import update
        db.execute(update(User).where(User.role.in_(LEGACY_ROLES)).values(role="officer"))
        if not db.scalar(select(User)):
            pw = os.environ.get("HR_ADMIN_PASSWORD") or secrets.token_urlsafe(10)
            db.add(User(username="admin", password_hash=hash_password(pw), role="admin",
                        must_change_password=True))
            p = DATA_DIR / "initial_admin_password.txt"
            p.write_text(f"username: admin\npassword: {pw}\n")
            os.chmod(p, 0o600)
            print(f"[HR] تم إنشاء حساب الأدمن: admin / {pw}  (محفوظ في {p})")
        # أرقام صادرة للسجلات القديمة التي لا تحملها
        from .models import LeaveRequest, Recommendation
        from .services import assign_ref
        for model, prefix in ((Recommendation, "REC"), (LeaveRequest, "REQ")):
            for obj in db.scalars(select(model).where((model.ref_code.is_(None)) | (model.ref_code == "")).order_by(model.id)):
                assign_ref(db, obj, prefix)
        db.commit()


init_db()

from . import routes_admin, routes_auth, routes_core  # noqa: E402

app.include_router(routes_auth.router)
app.include_router(routes_core.router)
app.include_router(routes_admin.router)


@app.get("/healthz", response_class=PlainTextResponse)
def healthz():
    return "ok"


@app.get("/policy", response_class=HTMLResponse)
def policy(request: Request):
    with SessionLocal() as db:
        from .web import _load_user

        return render(request, db, "policy.html", user=_load_user(request, db))


@app.get("/about", response_class=HTMLResponse)
def about(request: Request):
    with SessionLocal() as db:
        from .web import _load_user

        return render(request, db, "about.html", user=_load_user(request, db))

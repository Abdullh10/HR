"""المصادقة والجلسات وحماية CSRF."""
from __future__ import annotations

import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from .db import DATA_DIR, UPLOAD_DIR
from .models import Attachment, User

_ph = PasswordHasher()

MAX_FAILED = 5
LOCK_MINUTES = 15
SESSION_IDLE_MINUTES = 30
MAX_UPLOAD = 5 * 1024 * 1024
MIN_PASSWORD = 8


def secret_key() -> str:
    env = os.environ.get("HR_SECRET_KEY")
    if env:
        return env
    path = DATA_DIR / ".secret_key"
    if not path.exists():
        path.write_text(secrets.token_urlsafe(48))
        os.chmod(path, 0o600)
    return path.read_text().strip()


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, pw)
    except (VerifyMismatchError, InvalidHashError):
        return False


def password_problem(pw: str) -> str | None:
    if len(pw) < MIN_PASSWORD:
        return f"كلمة المرور يجب ألا تقل عن {MIN_PASSWORD} أحرف."
    if pw.isdigit() or pw.isalpha():
        return "كلمة المرور يجب أن تحتوي على أحرف وأرقام."
    return None


def is_locked(user: User) -> bool:
    return bool(user.locked_until and user.locked_until > datetime.now())


def register_failed_login(user: User) -> None:
    user.failed_logins = (user.failed_logins or 0) + 1
    if user.failed_logins >= MAX_FAILED:
        user.locked_until = datetime.now() + timedelta(minutes=LOCK_MINUTES)
        user.failed_logins = 0


# ---------------------------------------------------------------- CSRF
def csrf_token(request: Request) -> str:
    tok = request.session.get("csrf")
    if not tok:
        tok = secrets.token_urlsafe(32)
        request.session["csrf"] = tok
    return tok


async def verify_csrf(request: Request) -> None:
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        form = await request.form()
        sent = form.get("csrf_token") or request.headers.get("x-csrf-token")
        if not sent or not secrets.compare_digest(str(sent), request.session.get("csrf", "")):
            raise HTTPException(status_code=403, detail="رمز الحماية غير صالح، أعد تحميل الصفحة.")


# ---------------------------------------------------------------- المرفقات
async def save_pdf(db: Session, upload: UploadFile | None, user: User) -> Attachment | None:
    if upload is None or not upload.filename:
        return None
    data = await upload.read(MAX_UPLOAD + 1)
    if len(data) == 0:
        return None
    if len(data) > MAX_UPLOAD:
        from .services import RuleError

        raise RuleError("حجم الملف يتجاوز 5 ميجابايت.")
    if not data.startswith(b"%PDF"):
        from .services import RuleError

        raise RuleError("الملف المرفق يجب أن يكون بصيغة PDF.")
    stored = uuid.uuid4().hex
    (UPLOAD_DIR / stored).write_bytes(data)
    att = Attachment(
        stored_name=stored,
        original_name=os.path.basename(upload.filename)[:255],
        size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        uploaded_by=user.id,
    )
    db.add(att)
    db.flush()
    return att

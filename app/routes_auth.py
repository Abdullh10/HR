"""الدخول والخروج وتغيير كلمة المرور."""
from datetime import datetime

from fastapi import APIRouter, Depends, Form, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db import get_db
from .models import User
from .security import (
    hash_password,
    is_locked,
    password_problem,
    register_failed_login,
    verify_password,
)
from .services import audit
from .web import start_session, _load_user, client_ip, current_user, current_user_any, flash, redirect, render

router = APIRouter()


@router.get("/")
def home(user: User = Depends(current_user)):
    if user.role == "employee":
        return redirect("/me")
    return redirect("/dashboard")


@router.get("/login")
def login_form(request: Request, db: Session = Depends(get_db)):
    if _load_user(request, db):
        return redirect("/")
    return render(request, db, "login.html")


@router.post("/login")
def login(request: Request, username: str = Form(...), password: str = Form(...),
          db: Session = Depends(get_db)):
    uname = username.strip().lower()
    user = db.scalar(select(User).where(func.lower(User.username) == uname))
    error = "اسم المستخدم أو كلمة المرور غير صحيحة."
    if user and is_locked(user):
        error = "تم قفل الحساب مؤقتاً بسبب محاولات دخول متكررة. حاول بعد 15 دقيقة."
    elif user and user.is_active and verify_password(password, user.password_hash):
        user.failed_logins = 0
        user.locked_until = None
        user.last_login = datetime.now()
        csrf = request.session.get("csrf")
        request.session.clear()  # تدوير الجلسة
        if csrf:
            request.session["csrf"] = csrf
        start_session(request, user)
        request.session["seen"] = datetime.now().isoformat(timespec="seconds")
        audit(db, user, "login", "user", user.id, ip=client_ip(request))
        db.commit()
        return redirect("/")
    elif user:
        register_failed_login(user)
        audit(db, user, "login_failed", "user", user.id, ip=client_ip(request))
        db.commit()
    return render(request, db, "login.html", error=error, username=username, status_code=401)


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return redirect("/login")


@router.get("/change-password")
def change_form(request: Request, user: User = Depends(current_user_any), db: Session = Depends(get_db)):
    return render(request, db, "change_password.html", user=user)


@router.post("/change-password")
def change_password(request: Request, current: str = Form(...), new: str = Form(...), confirm: str = Form(...),
                    user: User = Depends(current_user_any), db: Session = Depends(get_db)):
    err = None
    if not verify_password(current, user.password_hash):
        err = "كلمة المرور الحالية غير صحيحة."
    elif new != confirm:
        err = "كلمتا المرور غير متطابقتين."
    elif new == current:
        err = "اختر كلمة مرور مختلفة عن الحالية."
    else:
        err = password_problem(new)
    if err:
        return render(request, db, "change_password.html", user=user, error=err, status_code=400)
    user.password_hash = hash_password(new)
    user.must_change_password = False
    start_session(request, user)  # كلمة المرور الجديدة تُغيّر البصمة فتُحدَّث الجلسة الحالية فقط
    audit(db, user, "password_changed", "user", user.id, ip=client_ip(request))
    db.commit()
    flash(request, "تم تغيير كلمة المرور بنجاح.")
    return redirect("/")

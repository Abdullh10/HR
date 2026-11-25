"""شاشات الأدمن: المستخدمون، السنوات والإعدادات، الأقسام، العطل، الهوية، سجل التدقيق."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .db import get_db
from .models import (
    ROLES,
    AppSetting,
    AuditLog,
    Department,
    Employee,
    FiscalYear,
    Holiday,
    LeaveRequest,
    Recommendation,
    User,
)
from .security import hash_password, password_problem, verify_password
from .services import audit
from .web import back, client_ip, flash, parse_date, parse_float, redirect, render, require

router = APIRouter(prefix="/admin")
admin_only = require("admin")


# ================================================================ المستخدمون
@router.get("/users")
def users(request: Request, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    rows = list(db.scalars(select(User).order_by(User.role, User.username)))
    linked = {u.employee_id for u in rows if u.employee_id}
    emps = list(db.scalars(select(Employee).where(Employee.is_active.is_(True)).order_by(Employee.full_name)))
    team_count = {}
    for e in emps:
        if e.manager_id:
            team_count[e.manager_id] = team_count.get(e.manager_id, 0) + 1
    no_account = [e for e in emps if e.id not in linked and not e.is_temp_no]
    return render(request, db, "admin_users.html", user=user, rows=rows, emps=emps, linked=linked,
                  team_count=team_count, no_account=no_account)


@router.post("/users/save")
def user_save(request: Request, user_id: int | None = Form(None), username: str = Form(...), role: str = Form(...),
              employee_id: int | None = Form(None), password: str = Form(""), is_active: str = Form(""),
              assign: list[int] = Form([]), assign_present: str = Form(""),
              user: User = Depends(admin_only), db: Session = Depends(get_db)):
    username = username.strip().lower()
    if role not in ROLES:
        flash(request, "دور غير معروف.", "error")
        return redirect("/admin/users")
    if role in ("employee", "officer") and not employee_id:
        flash(request, "يجب ربط حساب الموظف/مسؤول شؤون الموظفين بسجل موظف.", "error")
        return redirect("/admin/users")
    dup = db.scalar(select(User).where(func.lower(User.username) == username, User.id != (user_id or 0)))
    if dup or not username:
        flash(request, "اسم المستخدم فارغ أو مستخدم مسبقاً.", "error")
        return redirect("/admin/users")
    if employee_id:
        dupe = db.scalar(select(User).where(User.employee_id == employee_id, User.id != (user_id or 0)))
        if dupe:
            flash(request, f"هذا الموظف مرتبط مسبقاً بالحساب {dupe.username}.", "error")
            return redirect("/admin/users")
    u = db.get(User, user_id) if user_id else None
    generated = None
    if u is None:
        pw = password.strip() or secrets.token_urlsafe(8)
        if password.strip() and (p := password_problem(pw)):
            flash(request, p, "error")
            return redirect("/admin/users")
        generated = pw
        u = User(username=username, password_hash=hash_password(pw), must_change_password=False)
        db.add(u)
    if u.id == user.id and (role != "admin" or not is_active):
        flash(request, "لا يمكنك إزالة صلاحية مدير النظام أو تعطيل حسابك بنفسك.", "error")
        return redirect("/admin/users")
    prev_role, prev_emp = (u.role, u.employee_id) if user_id else (None, None)
    u.username, u.role, u.employee_id = username, role, employee_id or None
    u.is_active = bool(is_active) if user_id else True
    db.flush()
    # إسناد الموظفين لمسؤول شؤون الموظفين (اختيار متعدد)
    moved = 0
    if prev_role == "officer" and prev_emp and (role != "officer" or prev_emp != u.employee_id):
        moved = db.execute(update(Employee).where(Employee.manager_id == prev_emp).values(manager_id=None)).rowcount
    assigned = None
    if role == "officer" and u.employee_id and assign_present:
        wanted = {i for i in assign if i != u.employee_id}
        db.execute(update(Employee).where(Employee.manager_id == u.employee_id, Employee.id.not_in(wanted or {0}))
                   .values(manager_id=None))
        if wanted:
            from .services import notify_reassignment
            newly = list(db.scalars(select(Employee).where(Employee.id.in_(wanted),
                                    (Employee.manager_id.is_(None)) | (Employee.manager_id != u.employee_id))))
            db.execute(update(Employee).where(Employee.id.in_(wanted)).values(manager_id=u.employee_id))
            pend_total = sum(notify_reassignment(db, e, u.employee_id, sender=user) for e in newly)
            if pend_total:
                flash(request, f"نُقل مع الموظفين {pend_total} طلب معلّق، وأُشعر مسؤول شؤون الموظفين بها.", "info")
        assigned = len(wanted)
    audit(db, user, "user_saved", "user", u.id, ip=client_ip(request), username=username, role=role,
          employee_id=employee_id, active=u.is_active, assigned=assigned, unassigned=moved or None)
    db.commit()
    if assigned is not None:
        flash(request, f"عدد الموظفين المسندين إلى {username}: {assigned}.")
    elif role == "officer" and prev_role != "officer" and user_id:
        flash(request, "أصبح الحساب «شؤون الموظفين». افتح «الموظفون المسندون» تحت الحساب لاختيار موظفيه.", "info")
    if moved:
        flash(request, f"أُلغي إسناد {moved} موظف لأن الحساب لم يعد «شؤون الموظفين» لنفس السجل. أسندهم لمسؤول شؤون موظفين آخر.", "warn")
    if generated:
        from .services import save_login_cards
        emp = db.get(Employee, employee_id) if employee_id else None
        batch = save_login_cards(db, [(emp.full_name if emp else username, username, generated, role)], "single", user)
        db.commit()
        flash(request, f"تم إنشاء الحساب {username}. كلمة المرور: {generated} (يستطيع تغييرها متى شاء من «الملف الشخصي»). "
                       f"حُفظت بطاقة دخوله في «بطاقات الدخول».")
    else:
        flash(request, "تم حفظ الحساب.")
    return redirect("/admin/users")


@router.post("/users/{uid}/reset")
def user_reset(request: Request, uid: int, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "غير موجود")
    pw = secrets.token_urlsafe(8)
    u.password_hash = hash_password(pw)
    u.must_change_password = False  # التغيير اختياري: كلمة البطاقة تبقى سارية
    u.failed_logins, u.locked_until = 0, None
    audit(db, user, "password_reset", "user", u.id, ip=client_ip(request))
    from .services import save_login_cards
    save_login_cards(db, [(u.display_name, u.username, pw, u.role)], "reset", user)
    db.commit()
    flash(request, f"كلمة مرور الحساب {u.username}: {pw} — حُفظت بطاقة دخول جديدة في «بطاقات الدخول».")
    return redirect("/admin/users")


@router.post("/users/bulk-create")
def users_bulk(request: Request, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    """إنشاء حساب موظف لكل موظف نشط بلا حساب (اسم المستخدم = الرقم الوظيفي)."""
    linked = {u.employee_id for u in db.scalars(select(User)) if u.employee_id}
    made = []
    for e in db.scalars(select(Employee).where(Employee.is_active.is_(True))):
        if e.id in linked or e.is_temp_no:
            continue
        uname = e.employee_no.lower()
        if db.scalar(select(User).where(func.lower(User.username) == uname)):
            continue
        pw = secrets.token_urlsafe(8)
        role = "officer" if db.scalar(select(Employee.id).where(Employee.manager_id == e.id)) else "employee"
        db.add(User(username=uname, password_hash=hash_password(pw), role=role, employee_id=e.id))
        made.append((e.full_name, uname, pw, role))
    audit(db, user, "users_bulk_created", "user", None, ip=client_ip(request), count=len(made))
    from .services import save_login_cards
    batch = save_login_cards(db, made, "bulk", user) if made else None
    db.commit()
    return render(request, db, "admin_users_created.html", user=user, made=made, batch=batch)


# ================================================================ السنوات والإعدادات
@router.get("/years")
def years_page(request: Request, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    rows = list(db.scalars(select(FiscalYear).order_by(FiscalYear.start_date.desc())))
    moves = {y.id: (db.scalar(select(func.count(Recommendation.id)).where(Recommendation.fiscal_year_id == y.id)) or 0)
             + (db.scalar(select(func.count(LeaveRequest.id)).where(LeaveRequest.fiscal_year_id == y.id)) or 0) for y in rows}
    return render(request, db, "admin_years.html", user=user, rows=rows, moves=moves)


@router.post("/years/save")
async def year_save(request: Request, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    f = await request.form()
    yid = f.get("year_id")
    y = db.get(FiscalYear, int(yid)) if yid else FiscalYear()
    if yid and y is None:
        raise HTTPException(404, "غير موجود")
    sd, ed = parse_date(f.get("start_date")), parse_date(f.get("end_date"))
    name = str(f.get("name") or "").strip()
    hpd, base = parse_float(f.get("hours_per_day")), parse_float(f.get("base_days"))
    err = None
    if not name or not sd or not ed or ed < sd:
        err = "أدخل اسم السنة وتاريخي بداية ونهاية صحيحين."
    elif not hpd or hpd <= 0 or base is None or base < 0:
        err = "قيم الإعدادات الرقمية غير صحيحة."
    else:
        overlap = db.scalar(select(FiscalYear).where(FiscalYear.id != (y.id or 0), FiscalYear.start_date <= ed,
                                                     FiscalYear.end_date >= sd))
        if overlap:
            err = f"الفترة تتداخل مع السنة {overlap.name}."
        if not err and db.scalar(select(FiscalYear).where(FiscalYear.name == name, FiscalYear.id != (y.id or 0))):
            err = "اسم السنة مستخدم."
    if not err and y.id:
        outside = db.scalar(select(func.count(Recommendation.id)).where(Recommendation.fiscal_year_id == y.id,
                            (Recommendation.rec_date < sd) | (Recommendation.rec_date > ed))) or \
            db.scalar(select(func.count(LeaveRequest.id)).where(LeaveRequest.fiscal_year_id == y.id,
                      (LeaveRequest.start_date < sd) | (LeaveRequest.end_date > ed)))
        if outside:
            err = "توجد حركات خارج الفترة الجديدة، لا يمكن تضييق السنة."
    if err:
        flash(request, err, "error")
        return redirect("/admin/years")
    if y.id and y.is_locked:
        flash(request, "السنة مقفلة. افتح القفل أولاً لتعديل إعداداتها.", "error")
        return redirect("/admin/years")
    # تغيير ساعات اليوم أو الحد السنوي في سنة فيها حركات يغيّر الأرصدة بأثر رجعي: معاينة وتأكيد إلزامي
    if y.id and (float(hpd) != float(y.hours_per_day) or int(base) != int(y.base_days)):
        n_moves = (db.scalar(select(func.count(Recommendation.id)).where(Recommendation.fiscal_year_id == y.id)) or 0) + \
            (db.scalar(select(func.count(LeaveRequest.id)).where(LeaveRequest.fiscal_year_id == y.id)) or 0)
        if n_moves and not f.get("confirm_impact"):
            from .services import compute_balance
            emp_ids = set(db.scalars(select(Recommendation.employee_id).where(Recommendation.fiscal_year_id == y.id)))
            over = 0
            for eid in emp_ids:
                b = compute_balance(db, eid, y)
                if b.granted_days + b.granted_hours / hpd > base + 1e-9:
                    over += 1
            msg = (f"تنبيه: في السنة {y.name} {n_moves} حركة، وتغيير "
                   + ("ساعات اليوم " if float(hpd) != float(y.hours_per_day) else "")
                   + ("والحد السنوي " if int(base) != int(y.base_days) else "")
                   + f"سيعيد حساب أرصدة {len(emp_ids)} موظف بأثر رجعي"
                   + (f"، و{over} موظف سيتجاوزون الحد الجديد" if over else "")
                   + ". لم يُحفظ شيء: ضع علامة على «أؤكد تطبيق التغيير بأثر رجعي» ثم احفظ.")
            flash(request, msg, "error")
            return redirect("/admin/years")
    before = {k: getattr(y, k, None) for k in ("base_days", "hours_per_day")} if y.id else {}
    y.name, y.start_date, y.end_date = name, sd, ed
    y.base_days, y.hours_per_day = int(base), hpd
    for flag in ("require_task_attachment", "require_request_attachment", "block_weekends",
                 "allow_late_cancel", "employee_can_request"):
        setattr(y, flag, bool(f.get(flag)))
    y.weekend_days = ",".join(str(x) for x in f.getlist("weekend_days")) or "4,5"
    if not y.id:
        db.add(y)
    db.flush()
    audit(db, user, "year_saved", "fiscal_year", y.id, ip=client_ip(request), before=before,
          after=dict(base_days=int(base), hours_per_day=hpd))
    db.commit()
    flash(request, f"تم حفظ إعدادات السنة {name}.")
    return redirect("/admin/years")


@router.post("/years/{yid}/activate")
def year_activate(request: Request, yid: int, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    y = db.get(FiscalYear, yid)
    if not y:
        raise HTTPException(404, "غير موجود")
    db.execute(update(FiscalYear).values(is_active=False))
    y.is_active = True
    audit(db, user, "year_activated", "fiscal_year", y.id, ip=client_ip(request))
    db.commit()
    flash(request, f"السنة النشطة الآن: {y.name}.")
    return redirect("/admin/years")


@router.post("/years/{yid}/lock")
def year_lock(request: Request, yid: int, lock: int = Form(...), user: User = Depends(admin_only),
              db: Session = Depends(get_db)):
    y = db.get(FiscalYear, yid)
    if not y:
        raise HTTPException(404, "غير موجود")
    if lock:
        pend = db.scalar(select(func.count(LeaveRequest.id)).where(
            LeaveRequest.fiscal_year_id == yid, LeaveRequest.status == "pending")) or 0
        if pend:
            flash(request, f"لا يمكن الإقفال: توجد {pend} حركة بانتظار الاعتماد.", "error")
            return redirect("/admin/years")
    y.is_locked = bool(lock)
    audit(db, user, "year_locked" if lock else "year_unlocked", "fiscal_year", y.id, ip=client_ip(request))
    db.commit()
    flash(request, f"تم {'إقفال' if lock else 'فتح'} السنة {y.name}.")
    return redirect("/admin/years")


# ================================================================ الأقسام
@router.get("/departments")
def departments(request: Request, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Department, func.count(Employee.id)).outerjoin(Employee, Employee.department_id == Department.id)
        .group_by(Department.id).order_by(Department.name)
    ).all()
    return render(request, db, "admin_departments.html", user=user, rows=rows)


@router.post("/departments/save")
def dept_save(request: Request, dept_id: int | None = Form(None), name: str = Form(...), is_active: str = Form(""),
              user: User = Depends(admin_only), db: Session = Depends(get_db)):
    name = " ".join(name.split())
    if not name or db.scalar(select(Department).where(Department.name == name, Department.id != (dept_id or 0))):
        flash(request, "اسم القسم فارغ أو مكرر.", "error")
        return redirect("/admin/departments")
    d = db.get(Department, dept_id) if dept_id else Department()
    d.name = name
    d.is_active = bool(is_active) if dept_id else True
    if not dept_id:
        db.add(d)
    db.flush()
    audit(db, user, "department_saved", "department", d.id, ip=client_ip(request), name=name)
    db.commit()
    flash(request, "تم حفظ القسم.")
    return redirect("/admin/departments")


@router.post("/departments/merge")
def dept_merge(request: Request, source: int = Form(...), target: int = Form(...), user: User = Depends(admin_only),
               db: Session = Depends(get_db)):
    if source == target:
        flash(request, "اختر قسمين مختلفين.", "error")
        return redirect("/admin/departments")
    s, t = db.get(Department, source), db.get(Department, target)
    if not s or not t:
        raise HTTPException(404, "غير موجود")
    n = db.execute(update(Employee).where(Employee.department_id == source).values(department_id=target)).rowcount
    db.delete(s)
    audit(db, user, "department_merged", "department", target, ip=client_ip(request), source=s.name,
          target=t.name, moved=n)
    db.commit()
    flash(request, f"تم دمج «{s.name}» في «{t.name}» ونقل {n} موظف.")
    return redirect("/admin/departments")


# ================================================================ العطل الرسمية
@router.get("/holidays")
def holidays(request: Request, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    rows = list(db.scalars(select(Holiday).order_by(Holiday.day.desc())))
    return render(request, db, "admin_holidays.html", user=user, rows=rows)


@router.post("/holidays/add")
def holiday_add(request: Request, start: str = Form(...), end: str = Form(""), name: str = Form(...),
                user: User = Depends(admin_only), db: Session = Depends(get_db)):
    sd, ed = parse_date(start), parse_date(end) or parse_date(start)
    if not sd or not ed or ed < sd or (ed - sd).days > 60 or not name.strip():
        flash(request, "بيانات العطلة غير صحيحة.", "error")
        return redirect("/admin/holidays")

    n, d = 0, sd
    while d <= ed:
        if not db.scalar(select(Holiday).where(Holiday.day == d)):
            db.add(Holiday(day=d, name=name.strip()))
            n += 1
        d += timedelta(days=1)
    audit(db, user, "holiday_added", "holiday", None, ip=client_ip(request), name=name, start=sd, end=ed)
    db.commit()
    flash(request, f"تمت إضافة {n} يوم عطلة.")
    _warn_holiday_overlap(request, db, sd, ed, added=True)
    return redirect("/admin/holidays")


@router.post("/holidays/{hid}/delete")
def holiday_delete(request: Request, hid: int, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    h = db.get(Holiday, hid)
    if h:
        day = h.day
        audit(db, user, "holiday_deleted", "holiday", hid, ip=client_ip(request), day=h.day, name=h.name)
        db.delete(h)
        db.commit()
        _warn_holiday_overlap(request, db, day, day, added=False)
    return back(request, "/admin/holidays")


def _warn_holiday_overlap(request: Request, db: Session, sd, ed, added: bool) -> None:
    """تنبيه عند تعديل العطل بعد وجود طلبات تتقاطع معها: عدد أيامها حُسب وقت تقديمها ولا يُعاد احتسابه تلقائياً."""
    rows = list(db.scalars(select(LeaveRequest).where(LeaveRequest.status.in_(("approved", "pending")),
                LeaveRequest.start_date <= ed, LeaveRequest.end_date >= sd)))
    if rows:
        names = "، ".join(sorted({r.employee.full_name for r in rows})[:5]) + ("…" if len({r.employee_id for r in rows}) > 5 else "")
        flash(request, f"تنبيه: {len(rows)} طلب معتمد أو معلّق يتقاطع مع {'العطلة المضافة' if added else 'اليوم المحذوف'} ({names}). "
                       "مدة هذه الطلبات حُسبت وقت تقديمها ولا تتغير تلقائياً؛ راجعها وألغِ ما يلزم تصحيحه ليُقدَّم من جديد.", "warn")


# ================================================================ الهوية العامة
@router.get("/settings")
def settings(request: Request, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return render(request, db, "admin_settings.html", user=user)


@router.post("/settings")
def settings_save(request: Request, university: str = Form(""), college: str = Form(""), system_title: str = Form(""),
                  tagline: str = Form(""), credit: str = Form(""), user: User = Depends(admin_only), db: Session = Depends(get_db)):
    for k, v in dict(university=university, college=college, system_title=system_title, tagline=tagline, credit=credit).items():
        s = db.get(AppSetting, k) or AppSetting(key=k)
        s.value = v.strip()
        db.merge(s)
    audit(db, user, "settings_saved", "settings", None, ip=client_ip(request))
    db.commit()
    flash(request, "تم حفظ الإعدادات.")
    return redirect("/admin/settings")


# ================================================================ البريد الإلكتروني
@router.get("/mail")
def mail_page(request: Request, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    from . import mailer
    from .web import app_settings
    return render(request, db, "admin_mail.html", user=user, cfg=mailer.config(),
                  st=mailer.last_status(app_settings(db)), default_to=user.contact_email)


@router.post("/mail/test")
def mail_test(request: Request, to: str = Form(""), user: User = Depends(admin_only), db: Session = Depends(get_db)):
    from . import mailer
    from .web import app_settings
    to = to.strip()
    ok, err = mailer.send_now(to, "رسالة تجريبية", f"هذه رسالة تجريبية للتأكد من عمل إشعارات البريد في النظام.\n\n"
                              f"أُرسلت بطلب من: {user.display_name}.", "/", app_settings(db))
    audit(db, user, "mail_test", "settings", None, ip=client_ip(request), to=to, ok=ok, error=err[:200] or None)
    db.commit()
    if ok:
        flash(request, f"أُرسلت الرسالة التجريبية إلى {to}. تحقّق من صندوق الوارد (وصندوق البريد المزعج).")
    else:
        flash(request, f"تعذّر الإرسال: {err}", "error")
    return redirect("/admin/mail")


@router.get("/mail/preview")
def mail_preview(request: Request, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    from fastapi.responses import HTMLResponse
    from . import mailer
    from .web import app_settings
    _, htm = mailer.compose("اعتماد طلب معالجة غياب",
                            "اعتُمد طلبك رقم REQ-2026-0001 (يوم واحد، 2026-02-01).\n\nيمكنك متابعة رصيدك وطلباتك من النظام.",
                            "/requests", app_settings(db))
    return HTMLResponse(htm)


# ================================================================ سجل التدقيق
def _audit_stmt(q: str, who: str, action: str, date_from: str, date_to: str):
    from .audit_labels import ACTIONS
    stmt = select(AuditLog).order_by(AuditLog.id.desc())
    if q.strip():
        like = f"%{q.strip()}%"
        codes = [k for k, v in ACTIONS.items() if q.strip() in v]  # البحث بالوصف العربي أيضاً
        cond = (AuditLog.username.like(like)) | (AuditLog.action.like(like)) | (AuditLog.entity.like(like)) | (AuditLog.details.like(like))
        if codes:
            cond = cond | AuditLog.action.in_(codes)
        stmt = stmt.where(cond)
    if who:
        stmt = stmt.where(AuditLog.username == who)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    try:
        if date_from:
            stmt = stmt.where(AuditLog.created_at >= datetime.fromisoformat(date_from))
        if date_to:
            stmt = stmt.where(AuditLog.created_at < datetime.fromisoformat(date_to) + timedelta(days=1))
    except ValueError:
        pass
    return stmt


@router.get("/audit")
def audit_page(request: Request, q: str = "", who: str = "", action: str = "", date_from: str = "", date_to: str = "",
               page: int = 1, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    from .audit_labels import ACTIONS, action_label, details_text, entity_label
    per = 100
    stmt = _audit_stmt(q, who, action, date_from, date_to)
    rows = list(db.scalars(stmt.offset((max(page, 1) - 1) * per).limit(per + 1)))
    users = [u for u in db.scalars(select(AuditLog.username).distinct().order_by(AuditLog.username)) if u]
    used = set(db.scalars(select(AuditLog.action).distinct()))
    actions = sorted(((k, action_label(k)) for k in used), key=lambda kv: kv[1])
    from urllib.parse import urlencode
    qs = urlencode({k: v for k, v in dict(q=q, who=who, action=action, date_from=date_from, date_to=date_to).items() if v})
    total = db.scalar(select(func.count(AuditLog.id))) or 0
    oldest = db.scalar(select(func.min(AuditLog.created_at)))
    return render(request, db, "admin_audit.html", user=user, rows=rows[:per], total=total, oldest=oldest, wipe_word=WIPE_WORD, q=q, who=who, action=action,
                  date_from=date_from, date_to=date_to, users=users, actions=actions, page=page, qs=qs,
                  has_next=len(rows) > per, action_label=action_label, entity_label=entity_label, details_text=details_text)


@router.post("/audit/clear")
def audit_clear(request: Request, scope: str = Form("before"), before: str = Form(""), confirm: str = Form(""),
                password: str = Form(""), user: User = Depends(admin_only), db: Session = Depends(get_db)):
    """حذف سجل التدقيق (كله أو ما قبل تاريخ) بكلمة مرور مدير النظام وكلمة التأكيد، بعد نسخة احتياطية تلقائية.
    يبقى بعد الحذف قيد واحد يوثّق عملية الحذف نفسها."""
    from . import backup
    from sqlalchemy import delete
    if not verify_password(password, user.password_hash):
        audit(db, user, "audit_clear_denied", "system", None, ip=client_ip(request), reason="wrong_password")
        db.commit()
        flash(request, "لم يُحذف شيء: كلمة مرور مدير النظام غير صحيحة.", "error")
        return redirect("/admin/audit")
    if confirm.strip() != WIPE_WORD:
        flash(request, f"لم يُحذف شيء: للتأكيد اكتب كلمة «{WIPE_WORD}» كما هي.", "error")
        return redirect("/admin/audit")
    stmt = delete(AuditLog)
    label = "السجل كاملاً"
    if scope != "all":
        d = parse_date(before)
        if not d:
            flash(request, "لم يُحذف شيء: حدّد التاريخ الذي تُحذف القيود السابقة له.", "error")
            return redirect("/admin/audit")
        stmt = stmt.where(AuditLog.created_at < datetime.combine(d, datetime.min.time()))
        label = f"القيود قبل {d:%Y-%m-%d}"
    auto = backup.auto_backup(db, "before-audit-clear")
    n = db.execute(stmt).rowcount or 0
    audit(db, user, "audit_cleared", "system", None, ip=client_ip(request), scope=label, rows=n, auto_backup=auto)
    db.commit()
    flash(request, f"حُذف {n} قيد من سجل التدقيق ({label}). حُفظت نسخة احتياطية تلقائية قبل الحذف ({auto}).")
    return redirect("/admin/audit")


@router.get("/audit.xlsx")
def audit_export(request: Request, q: str = "", who: str = "", action: str = "", date_from: str = "", date_to: str = "",
                 user: User = Depends(admin_only), db: Session = Depends(get_db)):
    from openpyxl import Workbook

    from .audit_labels import action_label, details_text, entity_label
    from .routes_core import _sheet, _xlsx_response
    rows = list(db.scalars(_audit_stmt(q, who, action, date_from, date_to).limit(50000)))
    wb = Workbook(); wb.remove(wb.active)
    _sheet(wb, "سجل التدقيق", ["الوقت", "المستخدم", "العملية", "الكيان", "رقم الكيان", "التفاصيل", "IP", "رمز العملية"],
           [[a.created_at.strftime("%Y-%m-%d %H:%M:%S"), a.username or "النظام", action_label(a.action), entity_label(a.entity),
             a.entity_id or "", details_text(a.details), a.ip, a.action] for a in rows])
    audit(db, user, "audit_exported", "system", None, ip=client_ip(request), rows=len(rows),
          filters={k: v for k, v in dict(q=q, who=who, action=action, date_from=date_from, date_to=date_to).items() if v} or None)
    db.commit()
    return _xlsx_response(wb, f"سجل التدقيق {datetime.now():%Y-%m-%d}.xlsx")




# ================================================================ استيراد الموظفين دفعة واحدة
@router.get("/import")
def import_page(request: Request, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return render(request, db, "admin_import.html", user=user)


@router.get("/import/template.xlsx")
def import_template(filled: int = 0, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    from .bulk import template_workbook
    from .routes_core import _xlsx_response

    name = "الموظفون الحاليون (للتعديل وإعادة الرفع).xlsx" if filled else "نموذج استيراد الموظفين.xlsx"
    return _xlsx_response(template_workbook(db, bool(filled)), name)


@router.post("/import/preview")
async def import_preview(request: Request, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    import json

    from . import bulk

    form = await request.form()
    upload = form.get("file")
    data = await upload.read(bulk.MAX_FILE + 1) if getattr(upload, "filename", "") else None
    try:
        table = bulk.read_table(getattr(upload, "filename", ""), data, str(form.get("pasted") or ""))
        if not table:
            raise ValueError("لم يتم إدخال أي بيانات. ارفع ملفاً أو الصق الأسماء والأرقام.")
        mapping, body, start = bulk.map_columns(table)
        rows = bulk.validate(db, bulk.build_rows(mapping, body, start))
    except ValueError as e:
        flash(request, str(e), "error")
        return redirect("/admin/import")
    counts = {k: sum(1 for r in rows if r.action == k) for k in ("new", "update", "error")}
    payload = json.dumps([r.to_dict() for r in rows if r.action != "error"], ensure_ascii=False)
    return render(request, db, "admin_import.html", user=user, rows=rows, counts=counts, payload=payload,
                  detected=[bulk.HEADERS[k][0] for k in sorted(mapping, key=mapping.get)])


@router.post("/import/commit")
async def import_commit(request: Request, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    import json

    from . import bulk

    form = await request.form()
    try:
        items = json.loads(str(form.get("payload") or "[]"))
        if not isinstance(items, list) or not items:
            raise ValueError
    except ValueError:
        flash(request, "لا توجد صفوف صالحة للاستيراد.", "error")
        return redirect("/admin/import")
    rows = bulk.rows_from_dicts(items)
    res = bulk.apply(db, rows, create_accounts=bool(form.get("create_accounts")),
                     update_roles=bool(form.get("update_roles")))
    audit(db, user, "employees_imported", "employee", None, ip=client_ip(request), created=res.created,
          updated=res.updated, accounts=len(res.accounts), roles_changed=res.roles_changed, skipped=res.skipped)
    from .services import save_login_cards
    batch = save_login_cards(db, res.accounts, "import", user) if res.accounts else None
    db.commit()
    flash(request, f"تمت إضافة {res.created} موظف وتحديث {res.updated}، وإنشاء {len(res.accounts)} حساب"
                   + (f"، وتغيير منصب {res.roles_changed}" if res.roles_changed else "")
                   + (f". تُجووز {res.skipped} صف تغيّر وضعه." if res.skipped else "."))
    return render(request, db, "admin_users_created.html", user=user, made=res.accounts, batch=batch)


# ================================================================ النسخ الاحتياطي والحذف الكامل
WIPE_WORD = "حذف"
RESTORE_WORD = "استعادة"


@router.get("/data")
def data_page(request: Request, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    from .models import LeaveRequest as LR, Message as Msg, Recommendation as Rec
    counts = dict(employees=db.scalar(select(func.count(Employee.id))) or 0,
                  users=db.scalar(select(func.count(User.id))) or 0,
                  recs=db.scalar(select(func.count(Rec.id))) or 0,
                  reqs=db.scalar(select(func.count(LR.id))) or 0,
                  msgs=db.scalar(select(func.count(Msg.id))) or 0)
    last = db.scalar(select(AuditLog).where(AuditLog.action == "backup_downloaded").order_by(AuditLog.id.desc()))
    from . import backup
    return render(request, db, "admin_data.html", user=user, counts=counts, last_backup=last, autos=backup.list_auto(),
                  nightly=backup.nightly_status(), now_dt=datetime.now(), wipe_word=WIPE_WORD, restore_word=RESTORE_WORD)


@router.get("/backup.zip")
def backup_download(request: Request, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    from datetime import datetime
    from urllib.parse import quote

    from fastapi.responses import Response

    from . import backup
    blob = backup.dump(db)
    audit(db, user, "backup_downloaded", "system", None, ip=client_ip(request), size=len(blob))
    db.commit()
    name = f"نسخة احتياطية إتمام {datetime.now():%Y-%m-%d %H%M}.zip"
    return Response(blob, media_type="application/zip",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})


@router.post("/restore")
async def backup_restore(request: Request, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    from . import backup
    form = await request.form()
    up = form.get("file")
    if not verify_password(str(form.get("password") or ""), user.password_hash):
        audit(db, user, "restore_denied", "system", None, ip=client_ip(request), reason="wrong_password")
        db.commit()
        flash(request, "لم تتم الاستعادة: كلمة مرور مدير النظام غير صحيحة.", "error")
        return redirect("/admin/data")
    if str(form.get("confirm") or "").strip() != RESTORE_WORD:
        flash(request, f"للتأكيد اكتب كلمة «{RESTORE_WORD}» في الحقل المخصص.", "error")
        return redirect("/admin/data")
    if not getattr(up, "filename", ""):
        flash(request, "اختر ملف النسخة الاحتياطية (ZIP).", "error")
        return redirect("/admin/data")
    blob = await up.read(200 * 1024 * 1024 + 1)
    try:
        auto = backup.auto_backup(db, "before-restore")
        audit(db, user, "auto_backup", "system", None, ip=client_ip(request), file=auto, reason="before-restore")
        db.commit()
        counts, files = backup.restore(db, blob)
        audit(db, None, "backup_restored", "system", None, ip=client_ip(request), by=user.username,
              employees=counts.get("employees", 0), auto_backup=auto)
        db.commit()
        backup.write_uploads(files)
    except ValueError as e:
        db.rollback()
        flash(request, str(e), "error")
        return redirect("/admin/data")
    except Exception:  # أي خطأ غير متوقع (بنية تالفة…) لا يُظهر صفحة خطأ؛ البيانات لم تتغير
        db.rollback()
        flash(request, "تعذّرت الاستعادة: ملف النسخة غير متوافق أو تالف. لم يتغير شيء في البيانات.", "error")
        return redirect("/admin/data")
    request.session.clear()
    flash(request, f"تمت استعادة النسخة الاحتياطية ({counts.get('employees', 0)} موظف، {counts.get('users', 0)} حساب). سجّل الدخول من جديد.")
    return redirect("/login")


@router.post("/wipe")
def data_wipe(request: Request, confirm: str = Form(""), password: str = Form(""), user: User = Depends(admin_only),
              db: Session = Depends(get_db)):
    from . import backup
    if not verify_password(password, user.password_hash):
        audit(db, user, "wipe_denied", "system", None, ip=client_ip(request), reason="wrong_password")
        db.commit()
        flash(request, "لم يُحذف شيء: كلمة مرور مدير النظام غير صحيحة.", "error")
        return redirect("/admin/data")
    if confirm.strip() != WIPE_WORD:
        flash(request, f"لم يُحذف شيء: للتأكيد اكتب كلمة «{WIPE_WORD}» كما هي.", "error")
        return redirect("/admin/data")
    auto = backup.auto_backup(db, "before-wipe")
    backup.wipe(db, user.id)
    audit(db, user, "all_data_wiped", "system", None, ip=client_ip(request), auto_backup=auto)
    db.commit()
    flash(request, f"تم حذف جميع البيانات. بقيت السنوات وهوية الجهة وحسابك وسجل التدقيق. حُفظت نسخة تلقائية قبل الحذف ({auto}).")
    return redirect("/admin/data")


@router.get("/backups/{name}")
def auto_backup_download(request: Request, name: str, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    from fastapi.responses import FileResponse

    from . import backup
    if "/" in name or ".." in name or not name.startswith("auto-") or not name.endswith(".zip"):
        raise HTTPException(404, "غير موجود")
    p = backup.AUTO_DIR / name
    if not p.exists():
        raise HTTPException(404, "غير موجود")
    audit(db, user, "backup_downloaded", "system", None, ip=client_ip(request), file=name)
    db.commit()
    return FileResponse(p, media_type="application/zip", filename=name)



# ================================================================ بطاقات الدخول
def _cards_query(batch: str = "", q: str = "", state: str = ""):
    from .models import LoginCard
    st = select(LoginCard).order_by(LoginCard.created_at.desc(), LoginCard.id)
    if batch:
        st = st.where(LoginCard.batch == batch)
    if state == "pending":
        st = st.where(LoginCard.temp_password.is_not(None))
    elif state == "active":
        st = st.where(LoginCard.temp_password.is_(None))
    return st


@router.get("/cards")
def cards_page(request: Request, batch: str = "", q: str = "", state: str = "", user: User = Depends(admin_only),
               db: Session = Depends(get_db)):
    from .models import LoginCard
    from .services import norm_ar
    rows = list(db.scalars(_cards_query(batch, q, state)))
    if q.strip():
        k = norm_ar(q).lower()
        rows = [c for c in rows if k in norm_ar(f"{c.full_name} {c.username} {c.employee_no}").lower()]
    batches = list(db.execute(select(LoginCard.batch, func.count(LoginCard.id), func.max(LoginCard.created_at))
                              .group_by(LoginCard.batch).order_by(func.max(LoginCard.created_at).desc())))
    logins = dict(db.execute(select(User.id, User.last_login).where(User.id.in_([c.user_id for c in rows if c.user_id] or [0]))).all())
    return render(request, db, "admin_cards.html", user=user, rows=rows, batches=batches, batch=batch, q=q, state=state,
                  logins=logins)


@router.get("/cards.xlsx")
def cards_export(request: Request, batch: str = "", q: str = "", state: str = "", user: User = Depends(admin_only),
                 db: Session = Depends(get_db)):
    """تصدير بطاقات الدخول (تحتوي كلمات مرور) — يُسجَّل في سجل التدقيق."""
    from openpyxl import Workbook

    from .routes_core import _sheet, _xlsx_response
    from .services import norm_ar
    rows = list(db.scalars(_cards_query(batch, q, state)))
    if q.strip():
        k = norm_ar(q).lower()
        rows = [c for c in rows if k in norm_ar(f"{c.full_name} {c.username} {c.employee_no}").lower()]
    wb = Workbook(); wb.remove(wb.active)
    _sheet(wb, "بطاقات الدخول", ["الموظف", "الرقم الوظيفي", "اسم المستخدم", "كلمة المرور", "الدور", "الدفعة", "الحالة"],
           [[c.full_name, c.employee_no, c.username, c.temp_password or "غيّرها صاحبها", c.role_label, c.batch,
             "سارية" if c.temp_password else "غُيّرت"] for c in rows])
    audit(db, user, "data_exported", "login_card", None, ip=client_ip(request), kind="login_cards", rows=len(rows))
    db.commit()
    return _xlsx_response(wb, "بطاقات الدخول.xlsx")


@router.get("/cards/print")
def cards_print(request: Request, batch: str = "", ids: str = "", state: str = "", user: User = Depends(admin_only),
                db: Session = Depends(get_db)):
    from .models import LoginCard
    if ids:
        want = [int(x) for x in ids.split(",") if x.strip().isdigit()]
        rows = list(db.scalars(select(LoginCard).where(LoginCard.id.in_(want)).order_by(LoginCard.id)))
    else:
        rows = list(db.scalars(_cards_query(batch, "", state or "pending")))
    audit(db, user, "login_cards_printed", "login_card", None, ip=client_ip(request), count=len(rows), batch=batch)
    db.commit()
    login_url = str(request.base_url).rstrip("/") + "/login"
    return render(request, db, "cards_print.html", user=user, rows=rows, login_url=login_url, batch=batch)

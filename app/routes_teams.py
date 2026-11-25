"""الفرق والتفويض: نقل فريق كامل بين مسؤولي شؤون الموظفين، وتفويض مؤقت بمتابعة فريق خلال فترة محددة."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .db import get_db
from .models import Delegation, Employee, LeaveRequest, User
from .services import audit, notify
from .web import opt_int, client_ip, flash, parse_date, redirect, render, require

router = APIRouter()
MAX_DELEGATION_DAYS = 180


def _officer_users(db: Session) -> list[User]:
    return list(db.scalars(select(User).where(User.role == "officer", User.is_active.is_(True), User.employee_id.is_not(None))))


def _officer_emps(db: Session) -> list[Employee]:
    ids = [u.employee_id for u in _officer_users(db)]
    return list(db.scalars(select(Employee).where(Employee.id.in_(ids or [0])).order_by(Employee.full_name)))


def _users_of(db: Session, emp_id: int | None) -> list[User]:
    if not emp_id:
        return []
    return list(db.scalars(select(User).where(User.employee_id == emp_id, User.is_active.is_(True))))


def _delegations(db: Session, emp_id: int | None = None) -> list[Delegation]:
    st = select(Delegation).order_by(Delegation.cancelled_at.is_not(None), Delegation.end_date.desc(), Delegation.id.desc())
    if emp_id:
        st = st.where(or_(Delegation.from_emp_id == emp_id, Delegation.to_emp_id == emp_id))
    rows = list(db.scalars(st.limit(200)))
    order = {"active": 0, "upcoming": 1, "ended": 2, "cancelled": 3}
    return sorted(rows, key=lambda d: (order[d.state], -d.start_date.toordinal()))


def _team_stats(db: Session) -> tuple[list[dict], int]:
    offs = _officer_emps(db)
    counts = dict(db.execute(select(Employee.manager_id, func.count(Employee.id))
                             .where(Employee.is_active.is_(True), Employee.manager_id.is_not(None))
                             .group_by(Employee.manager_id)).all())
    pend = dict(db.execute(select(Employee.manager_id, func.count(LeaveRequest.id))
                           .join(Employee, Employee.id == LeaveRequest.employee_id)
                           .where(LeaveRequest.status == "pending").group_by(Employee.manager_id)).all())
    today = date.today()
    active = [d for d in db.scalars(select(Delegation).where(Delegation.cancelled_at.is_(None),
                                                             Delegation.start_date <= today, Delegation.end_date >= today))]
    out = []
    for o in offs:
        out.append(dict(emp=o, count=counts.get(o.id, 0), pending=pend.get(o.id, 0),
                        away=next((d for d in active if d.from_emp_id == o.id), None),
                        covering=[d for d in active if d.to_emp_id == o.id]))
    unassigned = db.scalar(select(func.count(Employee.id)).where(Employee.is_active.is_(True), Employee.manager_id.is_(None))) or 0
    return out, unassigned


# ================================================================ صفحة مدير النظام
@router.get("/admin/teams")
def teams_page(request: Request, user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    stats, unassigned = _team_stats(db)
    return render(request, db, "admin_teams.html", user=user, stats=stats, unassigned=unassigned,
                  officers=[s["emp"] for s in stats], delegations=_delegations(db), today=date.today(),
                  max_days=MAX_DELEGATION_DAYS)


@router.post("/admin/teams/transfer")
def team_transfer(request: Request, from_emp_id: int = Form(...), to_emp_id: int = Form(...),
                  notify_employees: str = Form(""), user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    offs = {o.id: o for o in _officer_emps(db)}
    src = db.get(Employee, from_emp_id)
    dst = offs.get(to_emp_id)
    if not src or not dst:
        flash(request, "اختر مسؤولَي شؤون الموظفين (المنقول منه والمنقول إليه).", "error")
        return redirect("/admin/teams")
    if src.id == dst.id:
        flash(request, "لا يمكن نقل الفريق إلى المسؤول نفسه.", "error")
        return redirect("/admin/teams")
    team = list(db.scalars(select(Employee).where(Employee.manager_id == src.id)))
    moved = [e for e in team if e.id != dst.id]  # لا يُسند المسؤول الجديد إلى نفسه
    if not moved:
        flash(request, f"لا يوجد موظفون مسندون إلى «{src.full_name}».", "warn")
        return redirect("/admin/teams")
    pend = db.scalar(select(func.count(LeaveRequest.id)).where(
        LeaveRequest.employee_id.in_([e.id for e in moved]), LeaveRequest.status == "pending")) or 0
    for e in moved:
        e.manager_id = dst.id
    db.flush()
    names = "، ".join(e.full_name for e in moved[:8]) + ("…" if len(moved) > 8 else "")
    for u in _users_of(db, dst.id):
        notify(db, u, f"أُسند إليك فريق {src.full_name}",
               f"نقل مدير النظام إليك {len(moved)} موظفاً كانوا مسندين إلى {src.full_name}: {names}."
               + (f" لديهم {pend} طلب بانتظار قرارك." if pend else ""), "/approvals" if pend else "/employees", sender=user)
    for u in _users_of(db, src.id):
        notify(db, u, "نُقل فريقك إلى مسؤول آخر",
               f"نقل مدير النظام {len(moved)} موظفاً من فريقك إلى {dst.full_name}.", "/employees", sender=user)
    if notify_employees:
        for e in moved:
            for u in _users_of(db, e.id):
                notify(db, u, "تغيّر مسؤول شؤون الموظفين",
                       f"أصبح {dst.full_name} مسؤول شؤون الموظفين المختص بطلباتك وتوصياتك.", "/messages/new", sender=user)
    audit(db, user, "team_transferred", "team", src.id, ip=client_ip(request), **{"from": src.full_name, "to": dst.full_name},
          moved=len(moved), pending_requests=pend, notify_employees=bool(notify_employees))
    db.commit()
    flash(request, f"نُقل {len(moved)} موظف من «{src.full_name}» إلى «{dst.full_name}»"
          + (f"، ومعهم {pend} طلب معلّق صار بانتظار قرار المسؤول الجديد" if pend else "") + ".")
    return redirect("/admin/teams")


# ================================================================ التفويض (مدير النظام لأي مسؤول، والمسؤول لنفسه)
@router.get("/delegation")
def delegation_page(request: Request, user: User = Depends(require("officer", "admin")), db: Session = Depends(get_db)):
    if user.role == "admin":
        return redirect("/admin/teams#delegation")
    offs = [o for o in _officer_emps(db) if o.id != user.employee_id]
    rows = _delegations(db, user.employee_id)
    team = db.scalar(select(func.count(Employee.id)).where(Employee.manager_id == user.employee_id, Employee.is_active.is_(True))) or 0
    return render(request, db, "delegation.html", user=user, officers=offs, delegations=rows, today=date.today(),
                  team=team, max_days=MAX_DELEGATION_DAYS)


@router.post("/delegations/new")
def delegation_create(request: Request, to_emp_id: int = Form(...), start_date: str = Form(...), end_date: str = Form(...),
                      note: str = Form(""), from_emp_id: str = Form(""),
                      user: User = Depends(require("officer", "admin")), db: Session = Depends(get_db)):
    from_emp_id = opt_int(from_emp_id)
    back_to = "/admin/teams#delegation" if user.role == "admin" else "/delegation"
    src_id = from_emp_id if user.role == "admin" else user.employee_id
    offs = {o.id: o for o in _officer_emps(db)}
    src, dst = offs.get(src_id or 0), offs.get(to_emp_id)
    sd, ed = parse_date(start_date), parse_date(end_date)

    def fail(msg):
        flash(request, msg, "error")
        return redirect(back_to)
    if not src or not dst:
        return fail("اختر مسؤول شؤون الموظفين المفوِّض والمفوَّض.")
    if src.id == dst.id:
        return fail("لا يمكن تفويض المسؤول نفسه.")
    if not sd or not ed or ed < sd:
        return fail("حدّد فترة صحيحة (تاريخ النهاية بعد تاريخ البداية أو يساويه).")
    if ed < date.today():
        return fail("فترة التفويض منتهية؛ اختر فترة حالية أو قادمة.")
    if (ed - sd).days + 1 > MAX_DELEGATION_DAYS:
        return fail(f"أقصى مدة للتفويض {MAX_DELEGATION_DAYS} يوماً؛ للنقل الدائم استخدم «نقل فريق».")
    clash = db.scalar(select(Delegation).where(Delegation.from_emp_id == src.id, Delegation.cancelled_at.is_(None),
                                               Delegation.start_date <= ed, Delegation.end_date >= sd))
    if clash:
        return fail(f"يوجد تفويض آخر لفريق «{src.full_name}» يتداخل مع هذه الفترة (إلى {clash.to_emp.full_name} "
                    f"من {clash.start_date:%Y-%m-%d} إلى {clash.end_date:%Y-%m-%d}). ألغه أولاً أو اختر فترة أخرى.")
    chain = db.scalar(select(Delegation).where(Delegation.from_emp_id == dst.id, Delegation.cancelled_at.is_(None),
                                               Delegation.start_date <= ed, Delegation.end_date >= sd))
    if chain:
        return fail(f"«{dst.full_name}» نفسه مفوِّض لفريقه خلال هذه الفترة، فلا يمكن تفويضه.")
    d = Delegation(from_emp_id=src.id, to_emp_id=dst.id, start_date=sd, end_date=ed, note=note.strip()[:300], created_by=user.id)
    db.add(d)
    db.flush()
    period = f"من {sd:%Y-%m-%d} إلى {ed:%Y-%m-%d}"
    for u in _users_of(db, dst.id):
        notify(db, u, f"فُوِّضت بمتابعة فريق {src.full_name}",
               f"أصبحت مفوَّضاً بمتابعة فريق {src.full_name} {period}: اعتماد الطلبات ورفع التوصيات."
               + (f" ملاحظة: {d.note}" if d.note else ""), "/approvals", sender=user)
    if user.role == "admin":
        for u in _users_of(db, src.id):
            notify(db, u, "تفويض فريقك", f"فوّض مدير النظام {dst.full_name} بمتابعة فريقك {period}.", "/delegation", sender=user)
    audit(db, user, "delegation_created", "delegation", d.id, ip=client_ip(request), **{"from": src.full_name, "to": dst.full_name},
          start=f"{sd:%Y-%m-%d}", end=f"{ed:%Y-%m-%d}", note=d.note)
    db.commit()
    flash(request, f"تم تفويض «{dst.full_name}» بمتابعة فريق «{src.full_name}» {period}.")
    return redirect(back_to)


@router.post("/delegations/{did}/cancel")
def delegation_cancel(request: Request, did: int, user: User = Depends(require("officer", "admin")), db: Session = Depends(get_db)):
    d = db.get(Delegation, did)
    if not d:
        raise HTTPException(404, "التفويض غير موجود.")
    if user.role != "admin" and user.employee_id not in (d.from_emp_id, d.to_emp_id):
        raise HTTPException(403, "لا يمكنك إلغاء هذا التفويض.")
    back_to = "/admin/teams#delegation" if user.role == "admin" else "/delegation"
    if d.state in ("cancelled", "ended"):
        flash(request, "التفويض غير ساري أصلاً.", "warn")
        return redirect(back_to)
    d.cancelled_at, d.cancelled_by = datetime.now(), user.id
    for emp_id in {d.from_emp_id, d.to_emp_id} - {user.employee_id}:
        for u in _users_of(db, emp_id):
            notify(db, u, "إلغاء تفويض",
                   f"أُلغي تفويض {d.to_emp.full_name} بمتابعة فريق {d.from_emp.full_name} "
                   f"({d.start_date:%Y-%m-%d} – {d.end_date:%Y-%m-%d}).", "/delegation", sender=user)
    audit(db, user, "delegation_cancelled", "delegation", d.id, ip=client_ip(request), **{"from": d.from_emp.full_name, "to": d.to_emp.full_name})
    db.commit()
    flash(request, "أُلغي التفويض.")
    return redirect(back_to)

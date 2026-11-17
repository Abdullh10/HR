"""الشاشات التشغيلية: اللوحة، الموظفون، الكشف، المهام، الطلبات، الاعتمادات، التقارير."""
from __future__ import annotations

import io
from collections import defaultdict
from datetime import date, datetime

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import false, or_, select
from sqlalchemy.orm import Session

from .db import UPLOAD_DIR, get_db
from .models import (
    Attachment,
    Balance,
    Department,
    Employee,
    FiscalYear,
    RestDayRequest,
    Task,
    User,
)
from .security import save_pdf
from .services import (
    RuleError,
    active_year,
    audit,
    can_decide,
    can_view_employee,
    check_can_approve_request,
    check_can_cancel,
    compute_balance,
    validate_rest_day,
    validate_task,
    visible_employee_ids,
)
from .web import (
    back,
    client_ip,
    current_user,
    flash,
    parse_date,
    parse_float,
    redirect,
    render,
    require,
)

router = APIRouter()
STAFF = ("admin", "officer", "manager", "viewer")
EDITORS = ("admin", "officer")


def pick_year(db: Session, year_id: int | None) -> FiscalYear:
    year = db.get(FiscalYear, year_id) if year_id else active_year(db)
    if not year:
        year = db.scalar(select(FiscalYear).order_by(FiscalYear.start_date.desc()))
    if not year:
        raise HTTPException(404, "لا توجد سنة معرّفة. أنشئ سنة من الإعدادات.")
    return year


def years(db: Session) -> list[FiscalYear]:
    return list(db.scalars(select(FiscalYear).order_by(FiscalYear.start_date.desc())))


def get_employee_or_404(db: Session, emp_id: int, user: User) -> Employee:
    emp = db.get(Employee, emp_id)
    if not emp:
        raise HTTPException(404, "الموظف غير موجود.")
    if not can_view_employee(user, emp):
        raise HTTPException(403, "ليست لديك صلاحية لعرض بيانات هذا الموظف.")
    return emp


def scoped_employees(db: Session, user: User, include_inactive: bool = False):
    q = select(Employee).order_by(Employee.full_name)
    ids = visible_employee_ids(db, user)
    if ids is not None:
        q = q.where(Employee.id.in_(ids))
    if not include_inactive:
        q = q.where(Employee.is_active.is_(True))
    return q


# ================================================================ اللوحة
@router.get("/dashboard")
def dashboard(request: Request, year_id: int | None = None, user: User = Depends(require(*STAFF)),
              db: Session = Depends(get_db)):
    year = pick_year(db, year_id)
    emps = list(db.scalars(scoped_employees(db, user)))
    totals = dict(employees=len(emps), total=0, used=0, remaining=0, pending=0, earned=0, hours=0.0,
                  exhausted=0, no_number=0)
    by_dept: dict[str, dict] = defaultdict(lambda: dict(count=0, total=0, used=0, remaining=0))
    alerts = []
    for e in emps:
        b = compute_balance(db, e.id, year)
        totals["total"] += b.total
        totals["used"] += b.used_days
        totals["remaining"] += b.remaining
        totals["pending"] += b.pending_days
        totals["earned"] += b.earned_days
        totals["hours"] += b.approved_hours
        if b.remaining <= 0:
            totals["exhausted"] += 1
        if e.is_temp_no:
            totals["no_number"] += 1
        if b.remaining < 0:
            alerts.append((e, "تجاوز الرصيد"))
        d = by_dept[e.department.name if e.department else "بدون قسم"]
        d["count"] += 1
        d["total"] += b.total
        d["used"] += b.used_days
        d["remaining"] += b.remaining
    ids = [e.id for e in emps]
    monthly = [0] * 12
    rows = db.execute(
        select(RestDayRequest.rest_date).where(
            RestDayRequest.fiscal_year_id == year.id,
            RestDayRequest.status == "approved",
            RestDayRequest.employee_id.in_(ids) if ids else false(),
        )
    ).all()
    for (d,) in rows:
        monthly[d.month - 1] += 1
    pending_tasks = pending_reqs = 0
    if user.role in ("admin", "manager"):
        pending_tasks = sum(1 for t in db.scalars(select(Task).where(Task.status == "pending",
                            Task.employee_id.in_(ids) if ids else false()))
                            if can_decide(user, t.employee, t.entered_by))
        pending_reqs = sum(1 for r in db.scalars(select(RestDayRequest).where(
                           RestDayRequest.status == "pending",
                           RestDayRequest.employee_id.in_(ids) if ids else false()))
                           if can_decide(user, r.employee, r.requested_by))
    dept_rows = sorted(by_dept.items(), key=lambda kv: -kv[1]["used"])
    return render(request, db, "dashboard.html", user=user, sel_year=year, years=years(db), totals=totals,
                  dept_rows=dept_rows, monthly=monthly, monthly_max=max(monthly) or 1,
                  pending_tasks=pending_tasks, pending_reqs=pending_reqs, alerts=alerts[:10])


# ================================================================ كشف الموظف
def statement_ctx(db: Session, emp: Employee, year: FiscalYear) -> dict:
    tasks = list(db.scalars(select(Task).where(Task.employee_id == emp.id, Task.fiscal_year_id == year.id)
                            .order_by(Task.task_date.desc())))
    reqs = list(db.scalars(select(RestDayRequest).where(RestDayRequest.employee_id == emp.id,
                           RestDayRequest.fiscal_year_id == year.id).order_by(RestDayRequest.rest_date.desc())))
    bal = db.scalar(select(Balance).where(Balance.employee_id == emp.id, Balance.fiscal_year_id == year.id))
    return dict(emp=emp, sel_year=year, info=compute_balance(db, emp.id, year), tasks=tasks, reqs=reqs, bal=bal)


@router.get("/me")
def me(request: Request, year_id: int | None = None, user: User = Depends(current_user),
       db: Session = Depends(get_db)):
    if not user.employee_id:
        if user.role == "employee":
            raise HTTPException(404, "حسابك غير مرتبط بسجل موظف. تواصل مع مدير النظام.")
        return redirect("/dashboard")
    year = pick_year(db, year_id)
    emp = db.get(Employee, user.employee_id)
    return render(request, db, "statement.html", user=user, years=years(db), self_view=True,
                  **statement_ctx(db, emp, year))


@router.get("/employees/{emp_id}")
def employee_statement(request: Request, emp_id: int, year_id: int | None = None,
                       user: User = Depends(current_user), db: Session = Depends(get_db)):
    emp = get_employee_or_404(db, emp_id, user)
    year = pick_year(db, year_id)
    tpl = "statement_print.html" if request.query_params.get("print") else "statement.html"
    return render(request, db, tpl, user=user, years=years(db), self_view=(emp.id == user.employee_id),
                  ref=f"BR-{year.name}-{emp.employee_no}-{datetime.now():%Y%m%d%H%M}",
                  **statement_ctx(db, emp, year))


# ================================================================ الموظفون
@router.get("/employees")
def employees(request: Request, q: str = "", dept: int | None = None, state: str = "", year_id: int | None = None,
              user: User = Depends(require(*STAFF)), db: Session = Depends(get_db)):
    year = pick_year(db, year_id)
    stmt = scoped_employees(db, user, include_inactive=(state == "inactive"))
    if state == "inactive":
        stmt = stmt.where(Employee.is_active.is_(False))
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Employee.full_name.like(like), Employee.employee_no.like(like)))
    if dept:
        stmt = stmt.where(Employee.department_id == dept)
    rows = []
    for e in db.scalars(stmt):
        b = compute_balance(db, e.id, year)
        if state == "exhausted" and b.remaining > 0:
            continue
        if state == "tmp" and not e.is_temp_no:
            continue
        rows.append((e, b))
    depts = list(db.scalars(select(Department).order_by(Department.name)))
    return render(request, db, "employees.html", user=user, rows=rows, depts=depts, q=q, dept=dept,
                  state=state, sel_year=year, years=years(db))


def employee_form_ctx(db: Session) -> dict:
    return dict(
        depts=list(db.scalars(select(Department).where(Department.is_active.is_(True)).order_by(Department.name))),
        managers=list(db.scalars(select(Employee).where(Employee.is_active.is_(True)).order_by(Employee.full_name))),
    )


@router.get("/employees/new/form")
def employee_new(request: Request, user: User = Depends(require(*EDITORS)), db: Session = Depends(get_db)):
    return render(request, db, "employee_form.html", user=user, emp=None, **employee_form_ctx(db))


@router.get("/employees/{emp_id}/edit")
def employee_edit(request: Request, emp_id: int, user: User = Depends(require(*EDITORS)),
                  db: Session = Depends(get_db)):
    emp = db.get(Employee, emp_id)
    if not emp:
        raise HTTPException(404, "الموظف غير موجود.")
    return render(request, db, "employee_form.html", user=user, emp=emp, **employee_form_ctx(db))


@router.post("/employees/save")
def employee_save(request: Request, emp_id: int | None = Form(None), employee_no: str = Form(...),
                  full_name: str = Form(...), department_id: int | None = Form(None),
                  manager_id: int | None = Form(None), job_title: str = Form(""), email: str = Form(""),
                  notes: str = Form(""), is_active: str = Form(""),
                  user: User = Depends(require(*EDITORS)), db: Session = Depends(get_db)):
    employee_no, full_name = employee_no.strip(), " ".join(full_name.split())
    emp = db.get(Employee, emp_id) if emp_id else Employee()
    err = None
    if not employee_no or not full_name:
        err = "الرقم الوظيفي والاسم حقلان إلزاميان."
    else:
        dup = db.scalar(select(Employee).where(Employee.employee_no == employee_no, Employee.id != (emp_id or 0)))
        if dup:
            err = f"الرقم الوظيفي مستخدم لموظف آخر: {dup.full_name}."
        dupn = db.scalar(select(Employee).where(Employee.full_name == full_name, Employee.id != (emp_id or 0)))
        if not err and dupn:
            err = "يوجد موظف مسجل بنفس الاسم. أضف ما يميّزه (مثل الاسم الرباعي)."
        if not err and emp_id and manager_id == emp_id:
            err = "لا يمكن أن يكون الموظف مديراً مباشراً لنفسه."
    if err:
        flash(request, err, "error")
        return back(request, "/employees")
    before = dict(no=emp.employee_no, name=emp.full_name, dept=emp.department_id, mgr=emp.manager_id) if emp_id else {}
    emp.employee_no, emp.full_name = employee_no, full_name
    emp.department_id, emp.manager_id = department_id or None, manager_id or None
    emp.job_title, emp.email, emp.notes = job_title.strip(), email.strip(), notes.strip()
    if emp_id:
        if user.role == "admin" or emp.is_active:
            emp.is_active = bool(is_active)
    else:
        emp.is_active = True
        db.add(emp)
    db.flush()
    audit(db, user, "employee_updated" if emp_id else "employee_created", "employee", emp.id,
          ip=client_ip(request), before=before,
          after=dict(no=employee_no, name=full_name, dept=department_id, mgr=manager_id, active=emp.is_active))
    db.commit()
    flash(request, "تم حفظ بيانات الموظف.")
    return redirect(f"/employees/{emp.id}")


@router.post("/employees/{emp_id}/balance")
def employee_balance(request: Request, emp_id: int, year_id: int = Form(...), base_override: str = Form(""),
                     adjustment_days: int = Form(0), adjustment_reason: str = Form(""),
                     user: User = Depends(require("admin")), db: Session = Depends(get_db)):
    year = db.get(FiscalYear, year_id)
    if not year or year.is_locked:
        flash(request, "السنة غير موجودة أو مقفلة.", "error")
        return back(request)
    if (adjustment_days or base_override.strip()) and not adjustment_reason.strip():
        flash(request, "اذكر سبب الرصيد الخاص أو التسوية.", "error")
        return back(request)
    bal = db.scalar(select(Balance).where(Balance.employee_id == emp_id, Balance.fiscal_year_id == year_id))
    if not bal:
        bal = Balance(employee_id=emp_id, fiscal_year_id=year_id)
        db.add(bal)
    before = dict(base=bal.base_override, adj=bal.adjustment_days)
    bal.base_override = int(base_override) if base_override.strip().lstrip("-").isdigit() else None
    bal.adjustment_days = adjustment_days
    bal.adjustment_reason = adjustment_reason.strip()
    db.flush()
    audit(db, user, "balance_adjusted", "employee", emp_id, ip=client_ip(request), year=year.name,
          before=before, after=dict(base=bal.base_override, adj=adjustment_days), reason=adjustment_reason)
    db.commit()
    flash(request, "تم تحديث الرصيد.")
    return redirect(f"/employees/{emp_id}?year_id={year_id}")


# ================================================================ المهام والساعات
@router.get("/tasks")
def tasks(request: Request, status: str = "", emp: int | None = None, year_id: int | None = None,
          user: User = Depends(current_user), db: Session = Depends(get_db)):
    year = pick_year(db, year_id)
    stmt = select(Task).where(Task.fiscal_year_id == year.id).order_by(Task.task_date.desc(), Task.id.desc())
    ids = visible_employee_ids(db, user)
    if ids is not None:
        stmt = stmt.where(Task.employee_id.in_(ids))
    if status:
        stmt = stmt.where(Task.status == status)
    if emp:
        stmt = stmt.where(Task.employee_id == emp)
    rows = list(db.scalars(stmt.limit(1000)))
    return render(request, db, "tasks.html", user=user, rows=rows, status=status, emp=emp, sel_year=year,
                  years=years(db), employees=list(db.scalars(scoped_employees(db, user))))


@router.get("/tasks/new")
def task_new(request: Request, emp: int | None = None, user: User = Depends(require(*EDITORS)),
             db: Session = Depends(get_db)):
    return render(request, db, "task_form.html", user=user, employees=list(db.scalars(scoped_employees(db, user))),
                  rows=[dict(emp=emp or "", date="", desc="", hours="", notes="", error="")] * 1, count=5)


@router.post("/tasks/new")
async def task_create(request: Request, user: User = Depends(require(*EDITORS)), db: Session = Depends(get_db)):
    form = await request.form()
    emps = form.getlist("emp")
    dates, descs, hours, notes = (form.getlist(k) for k in ("date", "desc", "hours", "notes"))
    rows, to_save, has_error = [], [], False
    for i, emp_id in enumerate(emps):
        r = dict(emp=emp_id, date=dates[i], desc=descs[i], hours=hours[i], notes=notes[i], error="")
        if not any([emp_id, r["date"], r["desc"].strip(), r["hours"]]):
            continue
        upload = form.get(f"file_{i}")
        has_file = bool(getattr(upload, "filename", ""))
        try:
            emp = db.get(Employee, int(emp_id)) if emp_id else None
            if not emp:
                raise RuleError("اختر اسم الموظف.")
            d = parse_date(r["date"])
            if not d:
                raise RuleError("أدخل التاريخ.")
            if not r["desc"].strip():
                raise RuleError("أدخل وصف المهمة.")
            h = parse_float(r["hours"])
            if h is None:
                raise RuleError("أدخل الساعات.")
            dup = db.scalar(select(Task.id).where(Task.employee_id == emp.id, Task.task_date == d,
                            Task.description == r["desc"].strip(), Task.status != "rejected"))
            if dup and not form.get("allow_dup"):
                raise RuleError("مهمة مطابقة مسجلة مسبقاً (نفس الموظف والتاريخ والوصف).")
            year = validate_task(db, emp, d, h, has_file)
            to_save.append((emp, d, h, r, upload if has_file else None, year))
        except RuleError as e:
            r["error"] = f"⚠ {e}"
            has_error = True
        rows.append(r)
    if not rows:
        flash(request, "لم يتم إدخال أي صف.", "error")
        return redirect("/tasks/new")
    if has_error:
        return render(request, db, "task_form.html", user=user, status_code=400, rows=rows, count=0,
                      employees=list(db.scalars(scoped_employees(db, user))),
                      error="بعض الصفوف تحتوي على أخطاء، صحّحها ثم أعد الحفظ. لم يُحفظ أي صف.")
    try:
        for emp, d, h, r, upload, year in to_save:
            att = await save_pdf(db, upload, user) if upload else None
            t = Task(employee_id=emp.id, fiscal_year_id=year.id, task_date=d, description=r["desc"].strip(),
                     hours=h, notes=r["notes"].strip(), attachment_id=att.id if att else None,
                     entered_by=user.id, status="pending")
            db.add(t)
            db.flush()
            audit(db, user, "task_created", "task", t.id, ip=client_ip(request), employee=emp.employee_no,
                  date=d, hours=h)
    except RuleError as e:
        db.rollback()
        flash(request, str(e), "error")
        return redirect("/tasks/new")
    db.commit()
    flash(request, f"تم تسجيل {len(to_save)} مهمة وإرسالها للاعتماد من المدير المباشر.")
    return redirect("/tasks?status=pending")


@router.post("/tasks/{task_id}/delete")
def task_delete(request: Request, task_id: int, user: User = Depends(require(*EDITORS)),
                db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t or t.status != "pending":
        flash(request, "يمكن سحب المهام التي بانتظار الاعتماد فقط.", "error")
        return back(request, "/tasks")
    t.status = "rejected"
    t.decision_note = "سُحبت من قبل المدخل"
    t.decided_by, t.decided_at = user.id, datetime.now()
    audit(db, user, "task_withdrawn", "task", t.id, ip=client_ip(request))
    db.commit()
    flash(request, "تم سحب المهمة.")
    return back(request, "/tasks")


@router.post("/tasks/{task_id}/decide")
def task_decide(request: Request, task_id: int, action: str = Form(...), note: str = Form(""),
                user: User = Depends(require("admin", "manager")), db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "غير موجود")
    try:
        _decide_task(db, user, t, action, note, client_ip(request))
        db.commit()
        flash(request, "تم اعتماد المهمة." if action == "approve" else "تم رفض المهمة.")
    except RuleError as e:
        db.rollback()
        flash(request, str(e), "error")
    return back(request, "/approvals")


def _decide_task(db: Session, user: User, t: Task, action: str, note: str, ip: str) -> None:
    if t.status != "pending":
        raise RuleError("تم البت في هذه المهمة مسبقاً.")
    if not can_decide(user, t.employee, t.entered_by):
        raise RuleError("الاعتماد من صلاحية المدير المباشر للموظف، ولا يعتمد أحد ما أدخله بنفسه.")
    year = db.get(FiscalYear, t.fiscal_year_id)
    if year.is_locked:
        raise RuleError("السنة مقفلة.")
    if action == "reject" and not note.strip():
        raise RuleError("اذكر سبب الرفض.")
    if action not in ("approve", "reject"):
        raise RuleError("إجراء غير معروف.")
    t.status = "approved" if action == "approve" else "rejected"
    t.decided_by, t.decided_at, t.decision_note = user.id, datetime.now(), note.strip()
    audit(db, user, f"task_{t.status}", "task", t.id, ip=ip, note=note)


# ================================================================ طلبات بدل الراحة
@router.get("/requests")
def requests_list(request: Request, status: str = "", emp: int | None = None, year_id: int | None = None,
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    year = pick_year(db, year_id)
    stmt = (select(RestDayRequest).where(RestDayRequest.fiscal_year_id == year.id)
            .order_by(RestDayRequest.rest_date.desc(), RestDayRequest.id.desc()))
    ids = visible_employee_ids(db, user)
    if ids is not None:
        stmt = stmt.where(RestDayRequest.employee_id.in_(ids))
    if status:
        stmt = stmt.where(RestDayRequest.status == status)
    if emp:
        stmt = stmt.where(RestDayRequest.employee_id == emp)
    rows = list(db.scalars(stmt.limit(1000)))
    return render(request, db, "requests.html", user=user, rows=rows, status=status, emp=emp, sel_year=year,
                  years=years(db), employees=list(db.scalars(scoped_employees(db, user))))


def _request_employees(db: Session, user: User) -> list[Employee]:
    if user.role in EDITORS:
        return list(db.scalars(scoped_employees(db, user)))
    return [db.get(Employee, user.employee_id)] if user.employee_id else []


@router.get("/requests/new")
def request_new(request: Request, emp: int | None = None, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    year = active_year(db)
    if user.role not in EDITORS and not (year and year.employee_can_request and user.employee_id):
        raise HTTPException(403, "تقديم الطلبات يتم عبر مسؤول الإدخال.")
    emps = _request_employees(db, user)
    sel = emp or (user.employee_id if user.role not in EDITORS else None)
    info = None
    if sel and year:
        info = compute_balance(db, sel, year)
    return render(request, db, "request_form.html", user=user, employees=emps, sel=sel, info=info)


@router.post("/requests/new")
async def request_create(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    form = await request.form()
    try:
        emp_id = int(form.get("emp") or 0)
    except ValueError:
        emp_id = 0
    if user.role not in EDITORS:
        emp_id = user.employee_id or 0
        year = active_year(db)
        if not (year and year.employee_can_request):
            raise HTTPException(403, "تقديم الطلبات يتم عبر مسؤول الإدخال.")
    emp = db.get(Employee, emp_id)
    upload = form.get("file")
    has_file = bool(getattr(upload, "filename", ""))
    dates_raw = [x for x in form.getlist("rest_date") if x]
    try:
        if not emp:
            raise RuleError("اختر الموظف.")
        if not dates_raw:
            raise RuleError("أدخل تاريخ يوم بدل الراحة.")
        dates = []
        for raw in dates_raw:
            d = parse_date(raw)
            if not d:
                raise RuleError("تاريخ غير صالح.")
            if d in dates:
                raise RuleError("تكرر التاريخ نفسه في الطلب.")
            dates.append(d)
        att = await save_pdf(db, upload, user) if has_file else None
        created = 0
        for d in sorted(dates):
            year = validate_rest_day(db, emp, d, has_file)
            r = RestDayRequest(employee_id=emp.id, fiscal_year_id=year.id, rest_date=d,
                               notes=str(form.get("notes") or "").strip(), status="pending",
                               attachment_id=att.id if att else None, requested_by=user.id)
            db.add(r)
            db.flush()
            created += 1
            audit(db, user, "request_created", "rest_day_request", r.id, ip=client_ip(request),
                  employee=emp.employee_no, date=d,
                  on_behalf=user.employee_id != emp.id)
        db.commit()
    except RuleError as e:
        db.rollback()
        flash(request, str(e), "error")
        return redirect(f"/requests/new?emp={emp_id}" if emp_id else "/requests/new")
    flash(request, f"تم تقديم {created} طلب، وهو الآن بانتظار اعتماد المدير المباشر.")
    return redirect("/requests?status=pending" if user.role in STAFF else "/me")


@router.post("/requests/{req_id}/decide")
def request_decide(request: Request, req_id: int, action: str = Form(...), note: str = Form(""),
                   user: User = Depends(require("admin", "manager")), db: Session = Depends(get_db)):
    r = db.get(RestDayRequest, req_id)
    if not r:
        raise HTTPException(404, "غير موجود")
    try:
        _decide_request(db, user, r, action, note, client_ip(request))
        db.commit()
        flash(request, "تم اعتماد الطلب." if action == "approve" else "تم رفض الطلب.")
    except RuleError as e:
        db.rollback()
        flash(request, str(e), "error")
    return back(request, "/approvals")


def _decide_request(db: Session, user: User, r: RestDayRequest, action: str, note: str, ip: str) -> None:
    if r.status != "pending":
        raise RuleError("تم البت في هذا الطلب مسبقاً.")
    if not can_decide(user, r.employee, r.requested_by):
        raise RuleError("الاعتماد من صلاحية المدير المباشر للموظف، ولا يعتمد أحد طلباً قدّمه بنفسه.")
    if action == "approve":
        check_can_approve_request(db, r)
    elif action == "reject":
        if not note.strip():
            raise RuleError("اذكر سبب الرفض.")
    else:
        raise RuleError("إجراء غير معروف.")
    r.status = "approved" if action == "approve" else "rejected"
    r.decided_by, r.decided_at, r.decision_note = user.id, datetime.now(), note.strip()
    audit(db, user, f"request_{r.status}", "rest_day_request", r.id, ip=ip, note=note)


@router.post("/requests/{req_id}/cancel")
def request_cancel(request: Request, req_id: int, note: str = Form(""), user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    r = db.get(RestDayRequest, req_id)
    if not r:
        raise HTTPException(404, "غير موجود")
    allowed = (
        user.role in EDITORS
        or (user.role == "manager" and can_decide(user, r.employee, None))
        or (user.employee_id == r.employee_id and r.status == "pending")
    )
    try:
        if not allowed:
            raise RuleError("ليست لديك صلاحية لإلغاء هذا الطلب.")
        check_can_cancel(db, r, user)
        if r.status == "approved" and not note.strip():
            raise RuleError("اذكر سبب إلغاء يوم معتمد.")
        prev = r.status
        r.status = "cancelled"
        r.decision_note = (note.strip() or "ألغي")
        r.decided_by, r.decided_at = user.id, datetime.now()
        audit(db, user, "request_cancelled", "rest_day_request", r.id, ip=client_ip(request), previous=prev,
              note=note)
        db.commit()
        flash(request, "تم إلغاء الطلب وإعادة اليوم إلى الرصيد." if prev == "approved" else "تم إلغاء الطلب.")
    except RuleError as e:
        db.rollback()
        flash(request, str(e), "error")
    return back(request, "/requests")


# ================================================================ الاعتمادات
@router.get("/approvals")
def approvals(request: Request, user: User = Depends(require("admin", "manager")), db: Session = Depends(get_db)):
    ids = visible_employee_ids(db, user)
    tq = select(Task).where(Task.status == "pending").order_by(Task.task_date)
    rq = select(RestDayRequest).where(RestDayRequest.status == "pending").order_by(RestDayRequest.rest_date)
    if ids is not None:
        tq, rq = tq.where(Task.employee_id.in_(ids)), rq.where(RestDayRequest.employee_id.in_(ids))
    tasks_ = [t for t in db.scalars(tq) if can_decide(user, t.employee, t.entered_by)]
    reqs = []
    for r in db.scalars(rq):
        if can_decide(user, r.employee, r.requested_by):
            y = db.get(FiscalYear, r.fiscal_year_id)
            reqs.append((r, compute_balance(db, r.employee_id, y)))
    return render(request, db, "approvals.html", user=user, tasks=tasks_, reqs=reqs)


@router.post("/approvals/bulk")
async def approvals_bulk(request: Request, user: User = Depends(require("admin", "manager")),
                         db: Session = Depends(get_db)):
    form = await request.form()
    action = form.get("action")
    note = str(form.get("note") or "")
    ok = fail = 0
    msgs = []
    for key, model, fn in (("task_ids", Task, _decide_task), ("req_ids", RestDayRequest, _decide_request)):
        for raw in form.getlist(key):
            obj = db.get(model, int(raw))
            if not obj:
                continue
            try:
                fn(db, user, obj, action, note, client_ip(request))
                db.commit()
                ok += 1
            except RuleError as e:
                db.rollback()
                fail += 1
                msgs.append(f"{obj.employee.full_name}: {e}")
    flash(request, f"تمت معالجة {ok} سجل." + (f" تعذّر {fail}." if fail else ""), "ok" if not fail else "error")
    for m in msgs[:5]:
        flash(request, m, "error")
    return redirect("/approvals")


# ================================================================ المرفقات
@router.get("/files/{att_id}")
def file_download(att_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    att = db.get(Attachment, att_id)
    if not att:
        raise HTTPException(404, "الملف غير موجود.")
    owners = [t.employee for t in db.scalars(select(Task).where(Task.attachment_id == att_id))]
    owners += [r.employee for r in db.scalars(select(RestDayRequest).where(RestDayRequest.attachment_id == att_id))]
    if not any(can_view_employee(user, e) for e in owners) and user.role != "admin":
        raise HTTPException(403, "ليست لديك صلاحية لهذا الملف.")
    path = UPLOAD_DIR / att.stored_name
    if not path.exists():
        raise HTTPException(404, "الملف غير موجود على الخادم.")
    return FileResponse(path, media_type="application/pdf", filename=att.original_name,
                        content_disposition_type="inline")


# ================================================================ التقارير والتصدير
@router.get("/reports")
def reports(request: Request, year_id: int | None = None, user: User = Depends(require(*STAFF)),
            db: Session = Depends(get_db)):
    year = pick_year(db, year_id)
    ids = visible_employee_ids(db, user)
    rq = select(RestDayRequest).where(RestDayRequest.fiscal_year_id == year.id)
    if ids is not None:
        rq = rq.where(RestDayRequest.employee_id.in_(ids))
    reqs = list(db.scalars(rq))
    by_status = defaultdict(int)
    lead = []
    for r in reqs:
        by_status[r.status] += 1
        if r.decided_at and r.status in ("approved", "rejected"):
            lead.append((r.decided_at - r.created_at).total_seconds() / 86400)
    no_att = sum(1 for r in reqs if r.status == "approved" and not r.attachment_id)
    tq = select(Task).where(Task.fiscal_year_id == year.id)
    if ids is not None:
        tq = tq.where(Task.employee_id.in_(ids))
    task_rows = list(db.scalars(tq))
    total = len(reqs) or 1
    stats = dict(
        requests=len(reqs), approved=by_status["approved"], pending=by_status["pending"],
        rejected=by_status["rejected"], cancelled=by_status["cancelled"],
        cancel_rate=round(by_status["cancelled"] / total * 100), no_attachment=no_att,
        avg_lead=round(sum(lead) / len(lead), 1) if lead else 0,
        tasks=len(task_rows), hours=sum(t.hours for t in task_rows if t.status == "approved"),
        pending_hours=sum(t.hours for t in task_rows if t.status == "pending"),
    )
    return render(request, db, "reports.html", user=user, sel_year=year, years=years(db), stats=stats)


def _xlsx_response(wb, filename: str) -> StreamingResponse:
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    from urllib.parse import quote

    return StreamingResponse(
        buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


def _sheet(wb, title: str, headers: list[str], rows: list[list]):
    from openpyxl.styles import Alignment, Font, PatternFill

    ws = wb.create_sheet(title)
    ws.sheet_view.rightToLeft = True
    ws.append(headers)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1B3A6B")
        c.alignment = Alignment(horizontal="center")
    for r in rows:
        ws.append(r)
    for i, h in enumerate(headers, 1):
        ws.column_dimensions[ws.cell(1, i).column_letter].width = max(12, len(h) + 6)
    ws.freeze_panes = "A2"
    return ws


@router.get("/export/{kind}.xlsx")
def export(kind: str, year_id: int | None = None, user: User = Depends(require(*STAFF)),
           db: Session = Depends(get_db)):
    from openpyxl import Workbook

    year = pick_year(db, year_id)
    wb = Workbook()
    wb.remove(wb.active)
    ids = visible_employee_ids(db, user)
    if kind == "balances":
        rows = []
        for i, e in enumerate(db.scalars(scoped_employees(db, user)), 1):
            b = compute_balance(db, e.id, year)
            rows.append([i, e.full_name, e.employee_no, e.department.name if e.department else "",
                         b.base, b.approved_hours, b.earned_days, b.remainder_hours, b.adjustment, b.total,
                         b.used_days, b.pending_days, b.remaining, b.state])
        _sheet(wb, "أرصدة الموظفين", ["م", "اسم الموظف", "الرقم الوظيفي", "القسم", "الرصيد الأساسي",
               "الساعات المعتمدة", "الأيام المكتسبة", "الساعات المتبقية", "تسوية", "إجمالي الرصيد",
               "الأيام التي تمتع بها", "طلبات معلقة", "الرصيد المتبقي", "حالة الرصيد"], rows)
        name = f"أرصدة بدل الراحة {year.name}.xlsx"
    elif kind == "requests":
        q = select(RestDayRequest).where(RestDayRequest.fiscal_year_id == year.id).order_by(RestDayRequest.rest_date)
        if ids is not None:
            q = q.where(RestDayRequest.employee_id.in_(ids))
        rows = [[i, r.employee.full_name, r.employee.employee_no, r.rest_date, r.status_label, r.notes,
                 r.decision_note, "نعم" if r.attachment_id else ""] for i, r in enumerate(db.scalars(q), 1)]
        _sheet(wb, "سجل أيام التمتع", ["م", "اسم الموظف", "الرقم الوظيفي", "تاريخ يوم بدل الراحة", "الحالة",
               "ملاحظات", "ملاحظة القرار", "ملف التوصية"], rows)
        name = f"سجل أيام التمتع {year.name}.xlsx"
    elif kind == "tasks":
        q = select(Task).where(Task.fiscal_year_id == year.id).order_by(Task.task_date)
        if ids is not None:
            q = q.where(Task.employee_id.in_(ids))
        rows = [[i, t.employee.full_name, t.employee.employee_no, t.task_date, t.description, t.hours,
                 t.status_label, t.notes] for i, t in enumerate(db.scalars(q), 1)]
        _sheet(wb, "سجل المهام والساعات", ["م", "اسم الموظف", "الرقم الوظيفي", "تاريخ المهمة", "وصف المهمة",
               "الساعات", "الحالة", "ملاحظات"], rows)
        name = f"سجل المهام والساعات {year.name}.xlsx"
    else:
        raise HTTPException(404, "نوع تصدير غير معروف.")
    for ws in wb.worksheets:
        for row in ws.iter_rows(min_row=2):
            for c in row:
                if isinstance(c.value, date):
                    c.number_format = "yyyy-mm-dd"
    return _xlsx_response(wb, name)

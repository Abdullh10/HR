from datetime import date, timedelta

from app.db import SessionLocal
from app.models import FiscalYear, Holiday, RestDayRequest, Task
from app.services import compute_balance

from .conftest import PW, TestClient, app, csrf, login, post

MON = date(2027, 3, 1)  # الإثنين
FRI = date(2027, 3, 5)


def balance(emp_id, year_id):
    with SessionLocal() as db:
        return compute_balance(db, emp_id, db.get(FiscalYear, year_id))


def set_year(year_id, **kw):
    with SessionLocal() as db:
        y = db.get(FiscalYear, year_id)
        for k, v in kw.items():
            setattr(y, k, v)
        db.commit()


def test_role_access(world):
    emp = login("emp")
    assert emp.get("/me").status_code == 200
    assert "كشف أيام بدل الراحة" in emp.get(f"/employees/{world['e']}?print=1").text
    assert emp.get("/dashboard").status_code == 403
    assert emp.get("/admin/users").status_code == 403
    assert emp.get(f"/employees/{world['o']}").status_code == 403
    assert emp.get("/export/balances.xlsx").status_code == 403
    mgr = login("mgr")
    assert mgr.get(f"/employees/{world['e']}").status_code == 200
    assert mgr.get(f"/employees/{world['o']}").status_code == 403
    assert mgr.get("/admin/years").status_code == 403
    off = login("officer")
    assert off.get(f"/employees/{world['o']}").status_code == 200
    assert off.get("/approvals").status_code == 403
    assert off.get("/admin/users").status_code == 403
    assert login("admin").get("/admin/audit").status_code == 200


def test_anonymous_redirect_and_csrf(world):
    c = TestClient(app)
    assert c.get("/dashboard", follow_redirects=False).headers["location"] == "/login"
    r = c.post("/login", data={"username": "admin", "password": PW})
    assert r.status_code == 403  # بدون رمز CSRF


def test_lockout(world):
    c = TestClient(app)
    tok = csrf(c)
    for _ in range(5):
        c.post("/login", data={"username": "emp", "password": "wrong", "csrf_token": tok})
    r = c.post("/login", data={"username": "emp", "password": PW, "csrf_token": tok})
    assert "قفل" in r.text


def test_hours_to_days_with_direct_manager_approval(world):
    off = login("officer")
    r = post(off, "/tasks/new", {"emp": [str(world["e"])] * 2, "date": [str(MON), str(MON + timedelta(1))],
                                 "desc": ["لجنة اختبارات", "فعالية"], "hours": ["4", "3.5"], "notes": ["", ""]})
    assert r.status_code == 303, r.text[:800]
    assert balance(world["e"], world["year"]).pending_hours == 7.5
    with SessionLocal() as db:
        ids = [t.id for t in db.query(Task).all()]
    # المسؤول لا يعتمد
    assert post(off, f"/tasks/{ids[0]}/decide", {"action": "approve"}).status_code == 403
    # مدير غير مباشر (الأدمن مسموح) — المدير المباشر يعتمد
    mgr = login("mgr")
    for i in ids:
        post(mgr, f"/tasks/{i}/decide", {"action": "approve"})
    b = balance(world["e"], world["year"])
    assert (b.approved_hours, b.earned_days, b.remainder_hours, b.base, b.total) == (7.5, 1, 0.5, 20, 21)
    # المدير لا يعتمد مهام موظف ليس من فريقه
    post(off, "/tasks/new", {"emp": [str(world["o"])], "date": [str(MON)], "desc": ["x"], "hours": ["7"], "notes": [""]})
    with SessionLocal() as db:
        t = db.query(Task).filter_by(employee_id=world["o"]).one()
    post(mgr, f"/tasks/{t.id}/decide", {"action": "approve"})
    with SessionLocal() as db:
        assert db.get(Task, t.id).status == "pending"


def test_task_validation(world):
    off = login("officer")
    r = post(off, "/tasks/new", {"emp": [str(world["e"])], "date": [str(MON)], "desc": ["x"], "hours": ["13"],
                                 "notes": [""]})
    assert r.status_code == 400 and "الحد الأقصى" in r.text
    r = post(off, "/tasks/new", {"emp": [str(world["e"])], "date": ["2030-01-01"], "desc": ["x"], "hours": ["2"],
                                 "notes": [""]})
    assert r.status_code == 400 and "سنة" in r.text
    set_year(world["year"], require_task_attachment=True)
    r = post(off, "/tasks/new", {"emp": [str(world["e"])], "date": [str(MON)], "desc": ["x"], "hours": ["2"],
                                 "notes": [""]})
    assert r.status_code == 400 and "إلزامي" in r.text


def test_admin_cannot_approve_own_entry(world):
    adm = login("admin")
    post(adm, "/tasks/new", {"emp": [str(world["e"])], "date": [str(MON)], "desc": ["x"], "hours": ["7"], "notes": [""]})
    with SessionLocal() as db:
        t = db.query(Task).one()
    post(adm, f"/tasks/{t.id}/decide", {"action": "approve"})
    with SessionLocal() as db:
        assert db.get(Task, t.id).status == "pending"


def test_rest_day_request_rules(world):
    with SessionLocal() as db:
        db.add(Holiday(day=MON + timedelta(2), name="عطلة"))
        db.commit()
    emp = login("emp")
    r = post(emp, "/requests/new", {"rest_date": str(MON)})
    assert r.status_code == 303
    with SessionLocal() as db:
        req = db.query(RestDayRequest).one()
        assert req.status == "pending" and req.employee_id == world["e"]
    post(emp, "/requests/new", {"rest_date": str(MON)})  # مكرر
    post(emp, "/requests/new", {"rest_date": str(FRI)})  # جمعة
    post(emp, "/requests/new", {"rest_date": str(MON + timedelta(2))})  # عطلة
    # الموظف لا يستطيع الطلب لغيره
    post(emp, "/requests/new", {"emp": str(world["o"]), "rest_date": str(MON + timedelta(1))})
    with SessionLocal() as db:
        rows = db.query(RestDayRequest).all()
        assert len(rows) == 2 and all(r.employee_id == world["e"] for r in rows)
    assert balance(world["e"], world["year"]).pending_days == 2
    # الموظف لا يعتمد
    assert post(emp, f"/requests/{req.id}/decide", {"action": "approve"}).status_code == 403
    mgr = login("mgr")
    post(mgr, f"/requests/{req.id}/decide", {"action": "approve"})
    # الرفض بلا سبب مرفوض
    other = rows[1].id
    post(mgr, f"/requests/{other}/decide", {"action": "reject"})
    with SessionLocal() as db:
        assert db.get(RestDayRequest, other).status == "pending"
    b = balance(world["e"], world["year"])
    assert (b.used_days, b.remaining, b.pending_days) == (1, 19, 1)
    # الموظف لا يلغي يوماً معتمداً، والمسؤول يلغيه بسبب
    post(emp, f"/requests/{req.id}/cancel")
    with SessionLocal() as db:
        assert db.get(RestDayRequest, req.id).status == "approved"
    off = login("officer")
    post(off, f"/requests/{req.id}/cancel", {"note": ""})
    with SessionLocal() as db:
        assert db.get(RestDayRequest, req.id).status == "approved"
    post(off, f"/requests/{req.id}/cancel", {"note": "تغيّر الموعد"})
    assert balance(world["e"], world["year"]).used_days == 0


def test_balance_limit_and_modes(world):
    set_year(world["year"], balance_mode="fixed", base_days=1)
    off = login("officer")
    post(off, "/requests/new", {"emp": str(world["e"]), "rest_date": str(MON)})
    r = post(off, "/requests/new", {"emp": str(world["e"]), "rest_date": str(MON + timedelta(1))})
    with SessionLocal() as db:
        assert db.query(RestDayRequest).count() == 1  # لا رصيد متاح للثاني
    set_year(world["year"], balance_mode="earned")
    b = balance(world["e"], world["year"])
    assert b.base == 0 and b.total == 0
    set_year(world["year"], balance_mode="mixed", base_days=20)
    assert balance(world["e"], world["year"]).total == 20
    assert r.status_code == 303


def test_locked_year_blocks_changes(world):
    adm = login("admin")
    post(adm, f"/admin/years/{world['year']}/lock", {"lock": "1"})
    off = login("officer")
    r = post(off, "/tasks/new", {"emp": [str(world["e"])], "date": [str(MON)], "desc": ["x"], "hours": ["2"],
                                 "notes": [""]})
    assert r.status_code == 400 and "مقفلة" in r.text


def test_pdf_upload_and_access(world):
    off = login("officer")
    bad = post(off, "/requests/new", {"emp": str(world["e"]), "rest_date": str(MON)},
               files={"file": ("x.pdf", b"not a pdf", "application/pdf")})
    assert bad.status_code == 303
    with SessionLocal() as db:
        assert db.query(RestDayRequest).count() == 0
    post(off, "/requests/new", {"emp": str(world["e"]), "rest_date": str(MON)},
         files={"file": ("توصية.pdf", b"%PDF-1.4 test", "application/pdf")})
    with SessionLocal() as db:
        att = db.query(RestDayRequest).one().attachment_id
    assert att
    assert login("emp").get(f"/files/{att}").status_code == 200
    assert login("mgr").get(f"/files/{att}").status_code == 200
    assert login("emp2").get(f"/files/{att}").status_code == 403


def test_admin_settings_and_exports(world):
    adm = login("admin")
    r = post(adm, "/admin/years/save", {
        "year_id": str(world["year"]), "name": "2027", "start_date": "2027-01-01", "end_date": "2027-12-31",
        "balance_mode": "earned", "base_days": "0", "hours_per_day": "8", "max_hours_per_task": "10",
        "employee_can_request": "1", "block_weekends": "1", "weekend_days": ["4", "5"]})
    assert r.status_code == 303
    with SessionLocal() as db:
        y = db.get(FiscalYear, world["year"])
        assert (y.balance_mode, y.hours_per_day, y.allow_future_tasks) == ("earned", 8, False)
    for k in ("balances", "requests", "tasks"):
        r = adm.get(f"/export/{k}.xlsx")
        assert r.status_code == 200 and r.content[:2] == b"PK"
    set_year(world["year"], employee_can_request=False)
    assert login("emp").get("/requests/new").status_code == 403

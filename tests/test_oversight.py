"""حساب «متابع إداري»: لوحة مؤشرات للقراءة فقط، بلا أسماء موظفين، وبلا أي صلاحية تنفيذية."""
from datetime import datetime, timedelta

from app.db import SessionLocal
from app.models import Department, Employee, LeaveRequest, Message, User
from app.security import hash_password

from .conftest import PW, login, post
from .test_flows import MON, leave, rec


def _sup(world, dept=None, name="sup"):
    with SessionLocal() as db:
        db.add(User(username=name, role="supervisor", password_hash=hash_password(PW),
                    must_change_password=False, full_name="متابع", department_id=dept))
        db.commit()
    return login(name)


def _seed(world):
    m = login("mgr")
    rec(m, world["e"], "days", 3)
    leave(m, world["e"], "use", "days", MON.isoformat())
    with SessionLocal() as db:  # طلب متأخر عن مدة الاعتماد
        r = db.query(LeaveRequest).filter_by(status="pending").one()
        r.created_at = datetime.now() - timedelta(days=6)
        r.ref_code = "REQ-2027-00001"
        db.commit()


def test_supervisor_lands_on_oversight_and_sees_no_names(world):
    _seed(world)
    c = _sup(world)
    r = c.get("/", follow_redirects=False)
    assert r.headers["location"] == "/oversight"
    assert c.get("/dashboard", follow_redirects=False).headers["location"] == "/oversight"
    r = c.get("/oversight")
    assert r.status_code == 200
    assert "لوحة المتابعة الإدارية" in r.text and "قراءة فقط" in r.text
    assert "REQ-2027-00001" in r.text  # المتأخرات مجهّلة بالرقم المرجعي
    for name in ("موظف أول", "موظف آخر", "1002", "1003"):
        assert name not in r.text
    assert "الإداري المسؤول" in r.text  # اسم الجهة المعتمِدة مسموح
    assert c.get("/oversight/export.xlsx").status_code == 200


def test_supervisor_visit_does_not_escalate(world):
    _seed(world)
    with SessionLocal() as db:
        before = db.query(Message).count()
    _sup(world).get("/oversight")
    with SessionLocal() as db:
        assert db.query(Message).count() == before


def test_supervisor_is_forbidden_everywhere_else(world):
    _seed(world)
    c = _sup(world)
    with SessionLocal() as db:
        req = db.query(LeaveRequest).one()
    for url in ("/approvals", "/employees", f"/employees/{world['e']}", f"/requests/{req.id}", "/reports",
                "/archive", "/export/balances.xlsx", "/export/summary.xlsx", "/admin/users", "/admin/audit",
                "/recommendations/new", "/delegation"):
        assert c.get(url, follow_redirects=False).status_code in (403, 404), url
    for url, data in ((f"/requests/{req.id}/decide", {"decision": "approve"}), ("/approvals/bulk", {"ids": req.id, "decision": "approve"}),
                      ("/recommendations/new", {"emps": world["e"], "kind": "days", "amount": 1, "rec_date": "2027-02-10"}),
                      ("/reminders/year-end", {})):
        assert post(c, url, data).status_code == 403, url
    with SessionLocal() as db:
        assert db.get(LeaveRequest, req.id).status == "pending"


def test_department_scope_and_small_groups(world):
    with SessionLocal() as db:
        d2 = Department(name="قسم صغير")
        db.add(d2)
        db.flush()
        db.add(Employee(employee_no="2001", full_name="موظف القسم الصغير", department_id=d2.id))
        db.commit()
        d2id = d2.id
    c = _sup(world)
    r = c.get("/oversight")
    assert "لا تُعرض (أقل من 3 موظفين)" in r.text  # أرصدة الأقسام الصغيرة مخفية
    scoped = _sup(world, dept=d2id, name="sup2")
    r = scoped.get(f"/oversight?dept={world['dept']}")  # نطاق الحساب يتقدم على الفلتر
    assert "قسم صغير" in r.text and "وحدة الشؤون الإدارية" not in r.text


def test_admin_creates_supervisor_without_employee(world):
    a = login("admin")
    r = post(a, "/admin/users/save", {"username": "watch", "role": "supervisor", "scope_present": "1",
                                       "scope_dept": str(world["dept"])})
    assert r.status_code == 303
    with SessionLocal() as db:
        u = db.query(User).filter_by(username="watch").one()
        assert u.role == "supervisor" and u.employee_id is None and u.department_id == world["dept"]
    assert a.get("/oversight").status_code == 200  # الأدمن يعاين اللوحة
    assert "متابع إداري" in a.get("/admin/users").text

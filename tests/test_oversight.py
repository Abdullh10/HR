"""حساب «متابع إداري»: لوحة مؤشرات واطلاع على الموظفين وسجلاتهم، بلا أي صلاحية تنفيذية."""
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


def test_supervisor_lands_on_oversight_with_names(world):
    _seed(world)
    c = _sup(world)
    r = c.get("/", follow_redirects=False)
    assert r.headers["location"] == "/oversight"
    assert c.get("/dashboard", follow_redirects=False).headers["location"] == "/oversight"
    r = c.get("/oversight")
    assert r.status_code == 200
    assert "لوحة المتابعة الإدارية" in r.text and "قراءة فقط" in r.text
    assert "REQ-2027-00001" in r.text and "موظف أول" in r.text  # المتأخر باسمه ورابطه
    assert "الإداري المسؤول" in r.text
    assert "أسماء الموظفين (3)" in r.text and "موظف آخر" in r.text  # أسماء موظفي كل قسم في ترتيب الأقسام
    assert c.get("/oversight/export.xlsx").status_code == 200


def test_supervisor_reads_employees_records_and_balances(world):
    _seed(world)
    c = _sup(world)
    with SessionLocal() as db:
        req = db.query(LeaveRequest).one()
        from app.models import Recommendation
        rid = db.query(Recommendation).one().id
    r = c.get("/employees")
    assert r.status_code == 200 and "موظف أول" in r.text and "موظف آخر" in r.text
    assert "/recommendations/new" not in r.text  # لا أزرار إجراء
    r = c.get(f"/employees/{world['e']}")
    assert r.status_code == 200 and "رفع توصية" not in r.text and "/decide" not in r.text
    for url in ("/recommendations", "/requests", f"/requests/{req.id}", f"/recommendations/{rid}/print",
                "/export/balances.xlsx"):
        assert c.get(url, follow_redirects=False).status_code == 200, url
    page = c.get(f"/requests/{req.id}").text
    assert "/decide" not in page and "/cancel" not in page
    assert "/decide" not in c.get("/requests").text


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
    for url in ("/reports", "/archive", "/archive/export.zip", "/approvals", "/admin/users", "/admin/audit", "/recommendations/new", "/requests/new",
                "/delegation", f"/employees/{world['e']}/edit", "/employees/new/form"):
        assert c.get(url, follow_redirects=False).status_code in (403, 404), url
    for url, data in ((f"/requests/{req.id}/decide", {"decision": "approve"}), ("/approvals/bulk", {"ids": req.id, "decision": "approve"}),
                      ("/recommendations/new", {"emps": world["e"], "kind": "days", "amount": 1, "rec_date": "2027-02-10"}),
                      ("/reminders/year-end", {}), (f"/requests/{req.id}/cancel", {"note": "x"}),
                      (f"/employees/{world['e']}/delete", {"confirm_no": "1002"})):
        assert post(c, url, data).status_code == 403, url
    with SessionLocal() as db:
        assert db.get(LeaveRequest, req.id).status == "pending"


def test_linked_supervisor_cannot_submit_recommendation(world):
    with SessionLocal() as db:
        db.add(User(username="sup3", role="supervisor", employee_id=world["o"], password_hash=hash_password(PW),
                    must_change_password=False))
        db.commit()
    c = login("sup3")
    assert "رفع توصية ممنوحة لي" not in c.get("/me").text
    assert c.get("/recommendations/submit").status_code == 404
    assert post(c, "/recommendations/submit", {"kind": "days"}).status_code == 404


def test_department_scope(world):
    with SessionLocal() as db:
        d2 = Department(name="قسم صغير")
        db.add(d2)
        db.flush()
        db.add(Employee(employee_no="2001", full_name="موظف القسم الصغير", department_id=d2.id))
        db.commit()
        d2id = d2.id
    scoped = _sup(world, dept=d2id, name="sup2")
    r = scoped.get(f"/oversight?dept={world['dept']}")  # نطاق الحساب يتقدم على الفلتر
    assert "قسم صغير" in r.text and "وحدة الشؤون الإدارية" not in r.text
    assert scoped.get(f"/employees/{world['e']}").status_code in (403, 404)  # خارج نطاقه
    emps = scoped.get("/employees").text
    assert "موظف القسم الصغير" in emps and "موظف أول" not in emps


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

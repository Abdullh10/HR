"""المرحلة 4: نقل فريق كامل بين المسؤولين، والتفويض المؤقت (الصلاحيات والإشعارات وانتهاء الفترة)."""
from datetime import date, timedelta

from app.db import SessionLocal
from app.models import AuditLog, Delegation, Employee, LeaveRequest, Message, User
from app.security import hash_password

from .conftest import PW, login, post
from .test_flows import MON, leave, rec


def _second_officer():
    with SessionLocal() as db:
        m2 = Employee(employee_no="1010", full_name="مسؤول ثان")
        db.add(m2); db.flush()
        db.add(User(username="mgr2", role="officer", employee_id=m2.id, password_hash=hash_password(PW), must_change_password=False))
        db.commit()
        return m2.id


def test_team_transfer_moves_team_and_pending(world):
    m2 = _second_officer()
    mgr, emp, adm = login("mgr"), login("emp"), login("admin")
    rec(mgr, world["e"], "days", 3)
    leave(emp, world["e"], "use", "days", MON, MON)
    page = adm.get("/admin/teams").text
    assert "الفرق والتفويض" in page and "مسؤول ثان" in page
    r = post(adm, "/admin/teams/transfer", {"from_emp_id": world["m"], "to_emp_id": m2, "notify_employees": "1"})
    assert "طلب معلّق" in adm.get(r.headers["location"]).text
    with SessionLocal() as db:
        assert db.get(Employee, world["e"]).manager_id == m2
        u2 = db.query(User).filter_by(username="mgr2").one()
        assert db.query(Message).filter(Message.recipient_id == u2.id, Message.subject.like("أُسند إليك فريق%")).count() == 1
        eu = db.query(User).filter_by(username="emp").one()
        assert db.query(Message).filter(Message.recipient_id == eu.id, Message.subject == "تغيّر مسؤول شؤون الموظفين").count() == 1
        assert db.query(AuditLog).filter_by(action="team_transferred").count() == 1
    assert "موظف أول" in login("mgr2").get("/approvals").text
    assert "موظف أول" not in login("mgr").get("/approvals").text


def test_delegation_grants_temporary_access(world):
    m2 = _second_officer()
    mgr, emp = login("mgr"), login("emp")
    rec(mgr, world["e"], "days", 3)
    leave(emp, world["e"], "use", "days", MON, MON)
    mgr2 = login("mgr2")
    assert "موظف أول" not in mgr2.get("/approvals").text
    today = date.today()
    r = post(mgr, "/delegations/new", {"to_emp_id": m2, "start_date": str(today), "end_date": str(today + timedelta(days=5)), "note": "إجازة"})
    assert r.status_code == 303 and "تم تفويض" in mgr.get("/delegation").text
    page = mgr2.get("/approvals").text
    assert "موظف أول" in page and "بالتفويض" in page
    assert "بالتفويض" in mgr2.get("/employees").text
    with SessionLocal() as db:
        rid = db.query(LeaveRequest).one().id
    post(mgr2, f"/requests/{rid}/decide", {"action": "approve"})
    with SessionLocal() as db:
        assert db.get(LeaveRequest, rid).status == "approved"
        assert "delegated" in db.query(AuditLog).filter_by(action="leave_approved").one().details
        mu = db.query(User).filter_by(username="mgr").one()
        assert db.query(Message).filter(Message.recipient_id == mu.id, Message.subject.like("قرار بالتفويض%")).count() == 1
        # انتهاء الفترة يسحب الصلاحية تلقائياً
        d = db.query(Delegation).one()
        d.start_date, d.end_date = today - timedelta(days=10), today - timedelta(days=1)
        db.commit()
    assert mgr2.get(f"/employees/{world['e']}").status_code in (403, 404)


def test_delegation_validation_and_cancel(world):
    m2 = _second_officer()
    mgr, adm = login("mgr"), login("admin")
    today = date.today()
    r = post(mgr, "/delegations/new", {"to_emp_id": world["m"], "start_date": str(today), "end_date": str(today)})
    assert "لا يمكن تفويض المسؤول نفسه" in mgr.get(r.headers["location"]).text
    r = post(mgr, "/delegations/new", {"to_emp_id": m2, "start_date": str(today), "end_date": str(today + timedelta(days=400))})
    assert "أقصى مدة" in mgr.get(r.headers["location"]).text
    post(mgr, "/delegations/new", {"to_emp_id": m2, "start_date": str(today), "end_date": str(today + timedelta(days=3))})
    r = post(adm, "/delegations/new", {"from_emp_id": world["m"], "to_emp_id": m2, "start_date": str(today + timedelta(days=1)), "end_date": str(today + timedelta(days=2))})
    assert "يتداخل" in adm.get(r.headers["location"]).text
    with SessionLocal() as db:
        did = db.query(Delegation).one().id
    assert post(login("emp"), f"/delegations/{did}/cancel").status_code == 403
    post(mgr, f"/delegations/{did}/cancel")
    with SessionLocal() as db:
        assert db.get(Delegation, did).cancelled_at is not None
        u2 = db.query(User).filter_by(username="mgr2").one()
        assert db.query(Message).filter(Message.recipient_id == u2.id, Message.subject == "إلغاء تفويض").count() == 1
    assert "موظف أول" not in login("mgr2").get("/employees").text


def test_menu_tabs(world):
    adm = login("admin")
    html = adm.get("/employees").text
    assert 'href="/admin/import"' in html and "استيراد من Excel" in html
    html = adm.get("/admin/cards").text
    assert "الفرق والتفويض" in html and "الحسابات والصلاحيات" in html
    assert ">استيراد الموظفين</span>" not in html  # لم يعد بنداً مستقلاً في القائمة
    assert "التفويض" in login("mgr").get("/dashboard").text


def test_reports_breakdowns_and_summary_export(world):
    mgr, emp, adm = login("mgr"), login("emp"), login("admin")
    rec(mgr, world["e"], "days", 3)
    leave(emp, world["e"], "use", "days", MON, MON)
    html = adm.get("/reports").text
    assert "حسب القسم" in html and "حسب مسؤول شؤون الموظفين" in html and "الممنوح والمستخدم شهرياً" in html
    assert "وحدة الشؤون الإدارية" in html and "أعلى الأرصدة المتاحة" in html
    filt = adm.get(f"/reports?officer=-1&dept={world['dept']}").text  # غير المُسندين فقط
    assert '<td data-label="مسؤول شؤون الموظفين">— غير مُسند —</td>' in filt
    assert '<td data-label="مسؤول شؤون الموظفين">الإداري المسؤول</td>' not in filt
    assert '<td data-label="مسؤول شؤون الموظفين">الإداري المسؤول</td>' in html
    r = adm.get("/export/summary.xlsx")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/vnd.openxmlformats")
    page = mgr.get("/reports").text
    assert "حسب القسم" in page and "حسب مسؤول شؤون الموظفين" not in page
    assert mgr.get("/export/summary.xlsx").status_code == 200


def test_officer_can_be_assigned_to_himself_and_admin_approves(world):
    """يضيف المدير المسؤولَ نفسه إلى قائمته؛ ولا يعتمد المسؤول طلبه بنفسه، بل يصل لمدير النظام."""
    a = login("admin")
    with SessionLocal() as db:
        uid = db.query(User).filter_by(username="mgr").one().id
    r = post(a, "/admin/users/save", {"user_id": uid, "username": "mgr", "role": "officer", "employee_id": world["m"],
                                       "is_active": "1", "assign_present": "1", "assign": [world["e"], world["m"]]})
    assert r.status_code == 303
    with SessionLocal() as db:
        assert db.get(Employee, world["m"]).manager_id == world["m"]
        admin_id = db.query(User).filter_by(username="admin").one().id
        before = db.query(Message).filter_by(recipient_id=admin_id).count()
    rec(a, world["m"], "days", 3)
    m = login("mgr")
    r = leave(m, world["m"], "use", "days", MON.isoformat())
    with SessionLocal() as db:
        req = db.query(LeaveRequest).filter_by(employee_id=world["m"]).one()
        assert db.query(Message).filter_by(recipient_id=admin_id).count() > before  # وصل الإشعار لمدير النظام
    assert post(m, f"/requests/{req.id}/decide", {"action": "approve"}).status_code in (403, 303)
    with SessionLocal() as db:
        assert db.get(LeaveRequest, req.id).status == "pending"
    post(a, f"/requests/{req.id}/decide", {"action": "approve"})
    with SessionLocal() as db:
        assert db.get(LeaveRequest, req.id).status == "approved"

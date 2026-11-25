"""لوحة مدير النظام: تنبيهات تحتاج إجراء، والاعتماد «بالنيابة» مع إشعار المسؤول الأصلي."""
from datetime import datetime, timedelta

from app.db import SessionLocal
from app.models import AuditLog, Employee, LeaveRequest, Message, User

from .conftest import login, post
from .test_flows import MON, leave, rec


def test_admin_dashboard_alerts_and_tiles(world):
    with SessionLocal() as db:
        db.add(Employee(employee_no="1009", full_name="بلا حساب ولا مسؤول"))
        db.commit()
    html = login("admin").get("/dashboard").text
    assert "تنبيهات تحتاج إجراء" in html
    assert "غير مُسند" in html and "/employees?officer=-1" in html
    assert "بلا حساب دخول" in html and "الحسابات الناقصة" in html
    assert "الممنوح شهرياً" not in html  # أُزيل الرسم الشهري


def test_admin_decision_on_behalf_notifies_officer(world):
    mgr, emp, adm = login("mgr"), login("emp"), login("admin")
    rec(mgr, world["e"], "days", 3)
    leave(emp, world["e"], "use", "days", MON, MON)
    with SessionLocal() as db:
        r = db.query(LeaveRequest).one()
        r.created_at = datetime.now() - timedelta(days=8)  # طلب متأخر
        db.commit(); rid = r.id
    page = adm.get("/approvals").text
    assert "بالنيابة" in page and "منذ 8 أيام" in page
    assert "متأخر" in adm.get("/dashboard").text
    post(adm, f"/requests/{rid}/decide", {"action": "approve"})
    with SessionLocal() as db:
        assert db.get(LeaveRequest, rid).status == "approved"
        log = db.query(AuditLog).filter_by(action="leave_approved").one()
        assert "on_behalf" in (log.details or "")
        mgr_user = db.query(User).filter_by(username="mgr").one()
        assert db.query(Message).filter(Message.recipient_id == mgr_user.id, Message.subject.like("قرار بالنيابة%")).count() == 1


def test_audit_labels_filters_and_export(world):
    adm = login("admin")
    adm.get("/export/balances.xlsx")
    page = adm.get("/admin/audit").text
    assert "تسجيل دخول" in page and "تصدير بيانات إلى Excel" in page
    filtered = adm.get("/admin/audit?action=data_exported").text
    assert "تصدير بيانات إلى Excel" in filtered and "تسجيل دخول</b>" not in filtered
    r = adm.get("/admin/audit.xlsx?action=login")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/vnd.openxmlformats")
    r = adm.get("/admin/cards.xlsx")
    assert r.status_code == 200
    with SessionLocal() as db:
        acts = [a.action for a in db.query(AuditLog)]
        assert "audit_exported" in acts and acts.count("data_exported") >= 2


def test_cannot_deactivate_officer_with_team(world):
    adm = login("admin")
    r = post(adm, "/employees/save", {"emp_id": str(world["m"]), "employee_no": "1001", "full_name": "الإداري المسؤول"})  # بلا is_active
    assert "انقل الفريق" in adm.get(r.headers["location"]).text
    with SessionLocal() as db:
        assert db.get(Employee, world["m"]).is_active


def test_holiday_overlap_warning(world):
    mgr, emp, adm = login("mgr"), login("emp"), login("admin")
    rec(mgr, world["e"], "days", 3)
    leave(emp, world["e"], "use", "days", MON, MON)
    r = post(adm, "/admin/holidays/add", {"start": str(MON), "end": str(MON), "name": "عطلة طارئة"})
    assert "يتقاطع مع العطلة المضافة" in adm.get(r.headers["location"]).text

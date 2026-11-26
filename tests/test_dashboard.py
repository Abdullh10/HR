"""لوحة مدير النظام: تنبيهات تحتاج إجراء، والاعتماد «بالنيابة» مع إشعار المسؤول الأصلي."""
from datetime import datetime, timedelta

from app.db import SessionLocal
from app.models import AuditLog, Employee, LeaveRequest, Message, User

from .conftest import PW, login, post
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


def test_audit_log_clear(world):
    adm = login("admin")
    adm.get("/export/balances.xlsx")
    with SessionLocal() as db:
        old = db.query(AuditLog).first()
        old.created_at = datetime.now() - timedelta(days=500)
        db.commit()
        total = db.query(AuditLog).count()
    page = adm.get("/admin/audit").text
    assert page.count('id="clear"') == 1  # القسم مرة واحدة فقط (لا في العنوان ولا في شريط المسار)
    assert "<title>سجل التدقيق — " in page
    r = post(adm, "/admin/audit/clear", {"scope": "all", "confirm": "حذف", "password": "wrong"})
    assert "غير صحيحة" in adm.get(r.headers["location"]).text
    with SessionLocal() as db:
        assert db.query(AuditLog).count() == total + 1  # بقي كل شيء + قيد الرفض
    cutoff = (datetime.now() - timedelta(days=365)).date()
    r = post(adm, "/admin/audit/clear", {"scope": "before", "before": str(cutoff), "confirm": "حذف", "password": PW})
    assert "حُذف 1 قيد" in adm.get(r.headers["location"]).text
    post(adm, "/admin/audit/clear", {"scope": "all", "confirm": "حذف", "password": PW})
    with SessionLocal() as db:
        rows = db.query(AuditLog).all()
        assert [a.action for a in rows if a.action != "login"] == ["audit_cleared"]


def test_holidays_year_table(world):
    from datetime import date
    from app.models import Holiday
    adm = login("admin")
    page = adm.get("/admin/holidays?year=2027").text
    for n in ("يوم التأسيس", "عيد الفطر", "عيد الأضحى", "اليوم الوطني"):
        assert n in page
    assert "مقترحة" in page and 'value="2027-03-09"' in page
    base = {"year": "2027", "count": "6",
            "name_0": "يوم التأسيس", "start_0": "2027-02-22", "end_0": "2027-02-22",
            "name_1": "عيد الفطر", "start_1": "2027-03-04", "end_1": "2027-03-14",
            "name_2": "عيد الأضحى", "start_2": "2027-05-15", "end_2": "2027-05-18",
            "name_3": "اليوم الوطني", "start_3": "2027-09-23", "end_3": "2027-09-23", "del_3": "1",
            "name_4": "إجازة منتصف الفصل", "start_4": "2027-10-10", "end_4": "2027-10-11"}
    r = post(adm, "/admin/holidays/save", base)
    assert "حُفظت عطل سنة 2027" in adm.get(r.headers["location"]).text
    with SessionLocal() as db:
        assert db.query(Holiday).filter_by(name="عيد الفطر").count() == 11
        assert db.query(Holiday).filter_by(day=date(2027, 9, 23)).count() == 0
        assert db.query(Holiday).filter_by(name="إجازة منتصف الفصل").count() == 2
    # الحفظ مرة أخرى لا يكرر شيئاً، وتعديل التاريخ مباشرة يستبدل الفترة
    post(adm, "/admin/holidays/save", {**base, "start_1": "2027-03-08", "end_1": "2027-03-13"})
    with SessionLocal() as db:
        assert db.query(Holiday).filter_by(name="عيد الفطر").count() == 6
        assert db.query(Holiday).count() == 1 + 6 + 4 + 2
    # اسم مكرر أو تداخل: يُرفض ولا يتغير شيء
    r = post(adm, "/admin/holidays/save", {**base, "name_4": "عيد الفطر", "start_4": "2027-03-20", "end_4": "2027-03-21"})
    assert "مكرر" in adm.get(r.headers["location"]).text
    r = post(adm, "/admin/holidays/save", {**base, "start_4": "2027-05-16", "end_4": "2027-05-17"})
    assert "تتداخلان" in adm.get(r.headers["location"]).text
    with SessionLocal() as db:
        assert db.query(Holiday).filter_by(name="عيد الفطر").count() == 6
    # فترة خارج السنة
    r = post(adm, "/admin/holidays/save", {**base, "start_4": "2028-01-01", "end_4": "2028-01-02"})
    assert "داخل سنة 2027" in adm.get(r.headers["location"]).text

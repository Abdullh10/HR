"""مراجعة حسابي شؤون الموظفين والموظف: تفاصيل الطلب ومساره، ومعاينة الأيام، والصياغة، ومعيار التأخير، وتذكير نهاية السنة."""
from datetime import date, datetime, timedelta

from app import services
from app.db import SessionLocal
from app.models import LeaveRequest, Message, User
from app.services import count_ar

from .conftest import login, post
from .test_flows import MON, leave, rec


def test_count_ar_forms():
    assert count_ar(0, "req") == "لا توجد طلبات"
    assert count_ar(1, "emp") == "موظف واحد"
    assert count_ar(2, "rec") == "توصيتان"
    assert count_ar(5, "req") == "5 طلبات"
    assert count_ar(12, "emp") == "12 موظفاً"


def test_request_detail_timeline_and_permissions(world):
    mgr, emp = login("mgr"), login("emp")
    rec(mgr, world["e"], "days", 3)
    leave(emp, world["e"], "use", "days", MON, MON)
    with SessionLocal() as db:
        rid = db.query(LeaveRequest).one().id
    page = emp.get(f"/requests/{rid}").text
    assert "مسار الطلب" in page and "قُدّم الطلب" in page and "بانتظار قرار مسؤول شؤون الموظفين" in page
    assert "يُتوقع القرار قبل" in page
    assert login("emp2").get(f"/requests/{rid}").status_code == 404  # لا يرى طلب غيره
    post(mgr, f"/requests/{rid}/decide", {"action": "approve"})
    page = emp.get(f"/requests/{rid}").text
    assert "اعتُمد الطلب" in page and "(مسؤول شؤون الموظفين)" in page
    post(mgr, f"/requests/{rid}/cancel", {"note": "تصحيح التاريخ"})
    page = emp.get(f"/requests/{rid}").text
    assert "أُلغي الطلب بعد اعتماده" in page and "تصحيح التاريخ" in page
    assert f'href="/requests/{rid}"' in emp.get("/requests").text and f'href="/requests/{rid}"' in emp.get("/me").text


def test_days_preview_endpoint(world):
    mgr, emp = login("mgr"), login("emp")
    rec(mgr, world["e"], "days", 1)
    d = emp.get(f"/requests/preview?start={MON}&end={MON + timedelta(days=1)}").json()
    assert d["ok"] and d["days"] == 2 and d["over"] is True and d["avail"] == 1
    d = emp.get(f"/requests/preview?start={MON}").json()
    assert d["days"] == 1 and d["over"] is False
    assert emp.get("/requests/preview?start=bad").json()["ok"] is False


def test_unified_late_standard_and_wording(world):
    mgr, emp = login("mgr"), login("emp")
    rec(mgr, world["e"], "days", 3)
    leave(emp, world["e"], "use", "days", MON, MON)
    with SessionLocal() as db:
        r = db.query(LeaveRequest).one()
        r.created_at = datetime.now() - timedelta(days=4)
        db.commit()
    page = mgr.get("/approvals").text
    assert "متأخر · منذ 4 أيام" in page and "طلب واحد بانتظار الاعتماد" in page
    assert "المتاح للطلب حالياً" in page
    dash = mgr.get("/dashboard").text
    assert "تجاوزت مدة القرار المعتمدة" in dash and "طلب واحد بانتظار قرارك" in dash
    reqs = emp.get("/requests").text
    assert "تعويض غياب" not in reqs  # النوع الملغى لا يظهر في التصفية
    me = emp.get("/me").text
    assert "أيام متاحة للطلب" in me or "يومان متاحان للطلب" in me or "يوم متاح للطلب" in me
    assert "طلب معالجة غياب لي" in mgr.get("/dashboard").text and "الأسئلة الشائعة" in me


def test_year_end_reminder_once_in_december(world, monkeypatch):
    mgr = login("mgr")
    rec(mgr, world["e"], "days", 3)

    class Dec(date):
        @classmethod
        def today(cls):
            return cls(2027, 12, 5)
    monkeypatch.setattr(services, "date", Dec)
    with SessionLocal() as db:
        u = db.query(User).filter_by(username="emp").one()
        assert services.year_end_reminder(db, u) is True
        db.commit()
        assert services.year_end_reminder(db, u) is False  # مرة واحدة فقط في السنة
        assert db.query(Message).filter(Message.recipient_id == u.id, Message.subject.like("تذكير: رصيدك%")).count() == 1



def test_leave_requests_are_days_only(world):
    """طلب معالجة الغياب بالأيام فقط (أُعيدت القاعدة)."""
    mgr, emp = login("mgr"), login("emp")
    rec(mgr, world["e"], "hours", 10)
    assert 'value="hours"' not in emp.get("/requests/new").text
    leave(emp, world["e"], "use", "hours", MON, hours=3)  # الخادم يتجاهل «بالساعات» ويعامل الطلب بالأيام
    with SessionLocal() as db:
        assert db.query(LeaveRequest).filter_by(unit="hours").count() == 0

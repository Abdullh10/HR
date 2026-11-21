from datetime import date, timedelta

from app.db import SessionLocal
from app.models import FiscalYear, Holiday, LeaveRequest, Message, Recommendation, User
from app.services import compute_balance

from .conftest import PW, TestClient, app, csrf, login, post

MON = date(2027, 3, 1)  # الإثنين
FRI = date(2027, 3, 5)
PDF = ("t.pdf", b"%PDF-1.4 test", "application/pdf")


def balance(emp_id, year_id):
    with SessionLocal() as db:
        return compute_balance(db, emp_id, db.get(FiscalYear, year_id))


def set_year(year_id, **kw):
    with SessionLocal() as db:
        y = db.get(FiscalYear, year_id)
        for k, v in kw.items():
            setattr(y, k, v)
        db.commit()


def rec(c, emp, kind, amount, d="2027-02-10", **extra):
    return post(c, "/recommendations/new", {"emp": str(emp), "kind": kind, "amount": str(amount),
                                            "rec_date": d, **extra})


def leave(c, emp, kind, unit, start, end=None, hours=None, reason="سبب"):
    data = {"emp": str(emp), "kind": kind, "unit": unit, "start_date": str(start), "reason": reason}
    if end:
        data["end_date"] = str(end)
    if hours is not None:
        data["hours"] = str(hours)
    return post(c, "/requests/new", data)


def test_role_access(world):
    emp = login("emp")
    assert emp.get("/me").status_code == 200
    assert emp.get("/dashboard", follow_redirects=False).headers["location"] == "/me"
    assert "كشف رصيد بدل الراحة" in emp.get(f"/employees/{world['e']}?print=1").text
    for url in ("/admin/users", "/employees", "/approvals", "/recommendations/new", "/export/balances.xlsx"):
        assert emp.get(url).status_code == 403, url
    assert emp.get(f"/employees/{world['o']}").status_code == 403
    mgr = login("mgr")
    assert mgr.get("/dashboard").status_code == 200
    assert mgr.get(f"/employees/{world['e']}").status_code == 200
    assert mgr.get(f"/employees/{world['o']}").status_code == 403  # غير مُسند له
    assert mgr.get("/admin/years").status_code == 403
    assert login("admin").get("/admin/audit").status_code == 200


def test_anonymous_redirect_and_csrf(world):
    c = TestClient(app)
    assert c.get("/dashboard", follow_redirects=False).headers["location"] == "/login"
    assert c.post("/login", data={"username": "admin", "password": PW}).status_code == 403


def test_lockout(world):
    c = TestClient(app)
    tok = csrf(c)
    for _ in range(5):
        c.post("/login", data={"username": "emp", "password": "wrong", "csrf_token": tok})
    r = c.post("/login", data={"username": "emp", "password": PW, "csrf_token": tok})
    assert "قفل" in r.text


def test_recommendations_and_cap(world):
    mgr = login("mgr")
    assert rec(mgr, world["e"], "days", 2).status_code == 303
    assert rec(mgr, world["e"], "hours", 10.5).status_code == 303
    b = balance(world["e"], world["year"])
    assert (b.days_left, b.hours_left, b.hours_as_days, b.hours_remainder) == (2, 10.5, 1, 3.5)
    assert (b.total_left_days, b.total_left_rem) == (3, 3.5)  # 2×7 + 10.5 = 24.5 ساعة
    # الحد الأقصى 20 يوماً للأيام والساعات معاً: المتاح 140 − 24.5 = 115.5 ساعة
    rec(mgr, world["e"], "days", 17)
    assert balance(world["e"], world["year"]).granted_days == 2
    rec(mgr, world["e"], "days", 16)  # 16×7=112 ≤ 115.5
    rec(mgr, world["e"], "hours", 4)  # 3.5 متاحة فقط
    b = balance(world["e"], world["year"])
    assert (b.granted_days, b.granted_hours, b.cap_left_hours) == (18, 10.5, 3.5)
    # لا يرفع الإداري لموظف غير مُسند له، ولا الموظف لنفسه
    rec(mgr, world["o"], "days", 1)
    assert balance(world["o"], world["year"]).granted_days == 0
    assert rec(login("emp"), world["e"], "days", 1).status_code == 403
    with SessionLocal() as db:
        u = db.query(User).filter_by(username="emp").one()
        subjects = [m.subject for m in db.query(Message).filter_by(recipient_id=u.id)]
        assert sum(x.startswith("منحك") for x in subjects) == 3  # إشعار لكل توصية ناجحة
        assert "تنبيه رصيد بدل الراحة" in subjects  # تجاوز 80% من الحد السنوي
    # الأدمن يرفع لأي موظف
    rec(login("admin"), world["o"], "hours", 7)
    assert balance(world["o"], world["year"]).total_left_days == 1


def test_attachment_required(world):
    set_year(world["year"], require_task_attachment=True)
    mgr = login("mgr")
    rec(mgr, world["e"], "days", 1)
    assert balance(world["e"], world["year"]).granted_days == 0
    r = post(mgr, "/recommendations/new", {"emp": str(world["e"]), "kind": "days", "amount": "1",
                                           "rec_date": "2027-02-10"}, files={"file": PDF})
    assert r.status_code == 303 and balance(world["e"], world["year"]).granted_days == 1
    with SessionLocal() as db:
        att = db.query(Recommendation).one().attachment_id
    assert login("emp").get(f"/files/{att}").status_code == 200
    assert login("emp2").get(f"/files/{att}").status_code == 403


def test_use_days_flow(world):
    mgr, emp = login("mgr"), login("emp")
    rec(mgr, world["e"], "days", 3)
    # الإثنين→الجمعة = 4 أيام عمل (الجمعة عطلة) > 3 → مرفوض
    leave(emp, world["e"], "use", "days", MON, FRI)
    assert balance(world["e"], world["year"]).pending_days == 0
    leave(emp, world["e"], "use", "days", MON, MON + timedelta(days=1))
    b = balance(world["e"], world["year"])
    assert (b.pending_days, b.days_available) == (2, 1)
    leave(emp, world["e"], "use", "days", MON + timedelta(days=1))  # تداخل
    assert balance(world["e"], world["year"]).pending_days == 2
    with SessionLocal() as db:
        rid = db.query(LeaveRequest).one().id
        mid = db.query(User).filter_by(username="mgr").one().id
        assert db.query(Message).filter_by(recipient_id=mid).count() == 1  # إشعار الإداري
    assert post(emp, f"/requests/{rid}/decide", {"action": "approve"}).status_code == 403
    post(mgr, f"/requests/{rid}/decide", {"action": "approve"})
    b = balance(world["e"], world["year"])
    assert (b.used_days, b.days_left, b.pending_days) == (2, 1, 0)
    assert "نموذج طلب معالجة غياب" in emp.get(f"/requests/{rid}/print").text
    # إلغاء طلب معتمد يتطلب سبباً ويعيد الرصيد
    post(mgr, f"/requests/{rid}/cancel", {})
    assert balance(world["e"], world["year"]).used_days == 2
    post(mgr, f"/requests/{rid}/cancel", {"note": "تغيير"})
    assert balance(world["e"], world["year"]).used_days == 0


def test_hours_and_compensation(world):
    """الطلبات بالأيام فقط: تُحوَّل كل 7 ساعات إلى يوم، والمتبقي دون ذلك لا يُستخدم."""
    mgr, emp = login("mgr"), login("emp")
    rec(mgr, world["e"], "hours", 8)
    b = balance(world["e"], world["year"])
    assert b.bookable_days == 1 and b.hours_avail_rem == 1
    leave(emp, world["e"], "use", "days", MON, MON + timedelta(days=1))  # يومان: لا يكفي
    assert balance(world["e"], world["year"]).pending_hours == 0
    future = date.today() + timedelta(days=30)
    leave(emp, world["e"], "compensation", "days", future, future)  # التعويض لا يكون لتاريخ مستقبلي
    leave(emp, world["e"], "use", "days", MON, MON)  # يوم من 7 ساعات محوّلة
    b = balance(world["e"], world["year"])
    assert b.pending_hours == 7 and b.bookable_days == 0 and b.hours_avail_rem == 1
    assert "لا تكفي ليوم كامل" in emp.get("/me").text
    with SessionLocal() as db:
        assert db.query(LeaveRequest).one().unit == "days"
        rid = db.query(LeaveRequest).one().id
    post(mgr, f"/requests/{rid}/decide", {"action": "reject"})  # بلا سبب
    assert balance(world["e"], world["year"]).pending_hours == 7
    post(mgr, f"/requests/{rid}/decide", {"action": "reject", "note": "ضغط عمل"})
    assert balance(world["e"], world["year"]).hours_available == 8
    rec(mgr, world["e"], "hours", 6)  # 14 ساعة = يومان
    assert balance(world["e"], world["year"]).bookable_days == 2


def test_holidays_and_weekends(world):
    with SessionLocal() as db:
        db.add(Holiday(day=MON, name="عطلة"))
        db.commit()
    mgr = login("mgr")
    rec(mgr, world["e"], "days", 5)
    leave(mgr, world["e"], "use", "days", MON, MON)  # عطلة رسمية فقط
    assert balance(world["e"], world["year"]).pending_days == 0
    leave(mgr, world["e"], "use", "days", MON, FRI)  # الثلاثاء-الخميس = 3
    assert balance(world["e"], world["year"]).pending_days == 3


def test_cancel_recommendation_guard(world):
    mgr = login("mgr")
    rec(mgr, world["e"], "days", 2)
    leave(mgr, world["e"], "use", "days", MON, MON + timedelta(days=1))
    with SessionLocal() as db:
        rid, rq = db.query(Recommendation).one().id, db.query(LeaveRequest).one().id
    post(mgr, f"/requests/{rq}/decide", {"action": "approve"})
    post(mgr, f"/recommendations/{rid}/cancel", {"note": "خطأ"})
    assert balance(world["e"], world["year"]).granted_days == 2  # مستخدمة فلا تُلغى
    assert "إشعار منح بدل راحة" in login("emp").get(f"/recommendations/{rid}/print").text


def test_messages_scope(world):
    emp, mgr, adm = login("emp"), login("mgr"), login("admin")
    with SessionLocal() as db:
        ids = {u.username: u.id for u in db.query(User)}
    # الموظف يراسل إداريه فقط
    post(emp, "/messages/new", {"to": [str(ids["admin"])], "subject": "x", "body": "y"})
    post(emp, "/messages/new", {"to": [str(ids["mgr"])], "subject": "استفسار", "body": "كم رصيدي؟"})
    with SessionLocal() as db:
        assert db.query(Message).filter_by(sender_id=ids["emp"]).count() == 1
        mid = db.query(Message).filter_by(sender_id=ids["emp"]).one().id
    r = mgr.get(f"/messages/{mid}")
    assert "كم رصيدي" in r.text and "/messages/new?re=" in r.text
    assert login("emp2").get(f"/messages/{mid}").status_code == 404
    # الإداري يراسل الأدمن وموظفيه، ولا يراسل موظفاً غير مُسند
    post(mgr, "/messages/new", {"to": [str(ids["emp2"]), str(ids["admin"])], "subject": "تعميم", "body": "نص"})
    with SessionLocal() as db:
        assert db.query(Message).filter_by(sender_id=ids["mgr"]).count() == 1
    assert adm.get("/messages").status_code == 200 and "تعميم" in adm.get("/messages").text
    assert "خطاب: تعميم" in adm.get(f"/messages/{mid + 1}?print=1").text


def test_locked_year_blocks(world):
    set_year(world["year"], is_locked=True)
    rec(login("mgr"), world["e"], "days", 1)
    assert balance(world["e"], world["year"]).granted_days == 0


def test_legacy_roles_migrate(world):
    from app.main import init_db
    with SessionLocal() as db:
        db.query(User).filter_by(username="mgr").one().role = "manager"
        db.commit()
    init_db()
    with SessionLocal() as db:
        assert db.query(User).filter_by(username="mgr").one().role == "officer"


def test_pages_render(world):
    mgr, emp, adm = login("mgr"), login("emp"), login("admin")
    rec(mgr, world["e"], "days", 2)
    for c, urls in ((adm, ["/dashboard", "/employees", "/recommendations", "/requests", "/approvals", "/reports",
                           "/messages", "/messages/new", "/recommendations/new?kind=hours", "/admin/years",
                           "/admin/users", f"/employees/{world['e']}", "/export/recommendations.xlsx",
                           "/export/requests.xlsx", "/export/balances.xlsx"]),
                    (mgr, ["/dashboard", "/employees", "/requests/new?kind=compensation", "/me"]),
                    (emp, ["/me", "/requests", "/requests/new?kind=use", "/messages/new"])):
        for u in urls:
            assert c.get(u).status_code == 200, u


def test_empty_filter_params(world):
    adm = login("admin")
    for u in ("/employees?q=&dept=&officer=&state=&year_id=", "/recommendations?kind=&emp=&year_id=",
              "/requests?status=&kind=&emp=", "/archive?q=&kind=&emp=&year_id="):
        assert adm.get(u).status_code == 200, u
    assert "موظف أول" in adm.get("/employees?q=%D9%85%D9%88%D8%B8%D9%81&dept=").text


def test_hours_convert_to_days(world):
    """تحويل الساعات إلى أيام: طلب الأيام يُخصم من الأيام أولاً ثم من الساعات (كل 7 ساعات = يوم)."""
    mgr, emp = login("mgr"), login("emp")
    rec(mgr, world["e"], "days", 1)
    rec(mgr, world["e"], "hours", 15)
    b = balance(world["e"], world["year"])
    assert b.bookable_days == 3 and b.bookable_from_hours == 2
    leave(emp, world["e"], "use", "days", MON, MON + timedelta(days=3))  # 4 أيام > 3
    assert balance(world["e"], world["year"]).pending_days == 0
    leave(emp, world["e"], "use", "days", MON, MON + timedelta(days=2))  # 3 أيام
    b = balance(world["e"], world["year"])
    assert (b.pending_days, b.pending_hours, b.converted_days_pending) == (1, 14, 2)
    assert b.hours_available == 1
    with SessionLocal() as db:
        rid = db.query(LeaveRequest).one().id
    post(mgr, f"/requests/{rid}/decide", {"action": "approve"})
    b = balance(world["e"], world["year"])
    assert (b.days_left, b.hours_left, b.taken_days, b.converted_days_used) == (0, 1, 3, 2)
    # لا يمكن إلغاء توصية الساعات لأنها مستخدمة
    with SessionLocal() as db:
        hid = db.query(Recommendation).filter_by(kind="hours").one().id
    post(mgr, f"/recommendations/{hid}/cancel", {"note": "خطأ"})
    assert balance(world["e"], world["year"]).granted_hours == 15
    # تنبيه نفاد الرصيد يظهر للموظف
    assert "استنفدت رصيدك" in emp.get("/me").text or "قارب على النفاد" in emp.get("/me").text


def test_officer_cancels_approved_past_request(world):
    """خطأ في التاريخ بعد الاعتماد: يلغي مسؤول الشؤون الإدارية الطلب حتى بعد مرور تاريخه، ويُشعَر الموظف."""
    past = date.today() - timedelta(days=1)
    while past.weekday() in (4, 5):
        past -= timedelta(days=1)
    with SessionLocal() as db:  # سنة الاختبار هي سنة التاريخ الماضي
        y = db.get(FiscalYear, world["year"])
        y.name, y.start_date, y.end_date = str(past.year), date(past.year, 1, 1), date(past.year, 12, 31)
        db.commit()
    mgr, emp = login("mgr"), login("emp")
    rec(mgr, world["e"], "days", 3, d=str(date(past.year, 1, 2)))
    leave(emp, world["e"], "use", "days", past, past)
    with SessionLocal() as db:
        rid = db.query(LeaveRequest).one().id
    post(mgr, f"/requests/{rid}/decide", {"action": "approve"})
    assert balance(world["e"], world["year"]).used_days == 1
    post(mgr, f"/requests/{rid}/cancel", {"note": ""})  # السبب إلزامي
    assert balance(world["e"], world["year"]).used_days == 1
    post(mgr, f"/requests/{rid}/cancel", {"note": "تاريخ خاطئ في الطلب"})
    b = balance(world["e"], world["year"])
    assert b.used_days == 0 and b.bookable_days == 3
    with SessionLocal() as db:
        r = db.get(LeaveRequest, rid)
        assert r.status == "cancelled" and r.cancel_note == "تاريخ خاطئ في الطلب"
        m = db.query(Message).filter(Message.subject.like("إلغاء اعتماد%")).one()
        assert "تاريخ خاطئ" in m.body and "أُعيد الرصيد" in m.body

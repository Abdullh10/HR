"""المرحلتان 3 و4 لحساب شؤون الموظفين: توصية لعدة موظفين، وحقول التكليف، وتكرار الخطاب، والتصعيد،
وطلبات الفريق في صفحة واحدة، والتذكير بنهاية السنة، وشريط التفويض."""
from datetime import date, datetime, timedelta

from app.db import SessionLocal
from app.models import Delegation, Employee, LeaveRequest, Message, Recommendation, User

from .conftest import login, post
from .test_flows import MON, leave, rec


def _assign_o_to_mgr(world):
    with SessionLocal() as db:
        db.get(Employee, world["o"]).manager_id = world["m"]
        db.commit()


def test_multi_employee_recommendation_with_task_fields(world):
    _assign_o_to_mgr(world)
    mgr = login("mgr")
    page = mgr.get("/recommendations/new").text
    assert 'name="emps"' in page and "جهة التكليف" in page and "فترة التكليف" in page
    r = post(mgr, "/recommendations/new", {"kind": "days", "emps": [str(world["e"]), str(world["o"])], "amount": "2",
                                           "rec_date": str(MON), "ref_no": "L-77", "subject": "مراقبة الاختبارات",
                                           "assigned_by": "وكالة الشؤون الأكاديمية", "task_from": str(MON - timedelta(days=5)),
                                           "task_to": str(MON - timedelta(days=1))})
    assert r.headers["location"] == "/recommendations"
    with SessionLocal() as db:
        recs = db.query(Recommendation).all()
        assert len(recs) == 2 and len({x.batch for x in recs}) == 1 and recs[0].batch
        assert recs[0].assigned_by == "وكالة الشؤون الأكاديمية" and recs[0].task_to == MON - timedelta(days=1)
        rid = recs[0].id
    html = mgr.get("/recommendations").text
    assert "خطاب جماعي" in html and "وكالة الشؤون الأكاديمية" in html
    assert "بتكليف من وكالة الشؤون الأكاديمية" in mgr.get(f"/recommendations/{rid}/print").text


def test_multi_recommendation_all_or_nothing_and_duplicates(world):
    _assign_o_to_mgr(world)
    mgr = login("mgr")
    # تجاوز الحد لأحدهما يُلغي العملية كلها
    r = post(mgr, "/recommendations/new", {"kind": "days", "emps": [str(world["e"]), str(world["o"])], "amount": "500", "rec_date": str(MON)})
    assert "لم تُرفع أي توصية" in mgr.get(r.headers["location"]).text
    with SessionLocal() as db:
        assert db.query(Recommendation).count() == 0
    base = {"kind": "days", "emps": [str(world["e"])], "amount": "1", "rec_date": str(MON), "ref_no": "X-1"}
    post(mgr, "/recommendations/new", base)
    r = post(mgr, "/recommendations/new", base)  # مطابقة تماماً: تُرفض
    assert "يبدو أنها مكررة" in mgr.get(r.headers["location"]).text
    r = post(mgr, "/recommendations/new", {**base, "amount": "2"})  # الخطاب نفسه بقيمة أخرى: تُقبل مع تنبيه
    assert "مستخدم سابقاً" in mgr.get(r.headers["location"]).text
    with SessionLocal() as db:
        assert db.query(Recommendation).count() == 2


def test_overdue_escalates_to_admin_once(world):
    mgr, emp, adm = login("mgr"), login("emp"), login("admin")
    rec(mgr, world["e"], "days", 3)
    leave(emp, world["e"], "use", "days", MON, MON)
    with SessionLocal() as db:
        r = db.query(LeaveRequest).one()
        r.created_at = datetime.now() - timedelta(days=5)
        db.commit()
    mgr.get("/approvals")
    adm.get("/dashboard")
    with SessionLocal() as db:
        a = db.query(User).filter_by(username="admin").one()
        assert db.query(Message).filter(Message.recipient_id == a.id, Message.subject.like("تصعيد:%")).count() == 1


def test_team_requests_page_tabs_and_own_requests_hidden(world):
    mgr, emp = login("mgr"), login("emp")
    rec(mgr, world["e"], "days", 3)
    leave(emp, world["e"], "use", "days", MON, MON)
    with SessionLocal() as db:
        y = db.query(LeaveRequest).one().fiscal_year_id
        db.add(LeaveRequest(employee_id=world["m"], fiscal_year_id=y, kind="use", unit="days", start_date=MON, end_date=MON,
                            days=1, reason="طلب المسؤول نفسه", status="pending", created_at=datetime.now()))
        db.commit()
    dash = mgr.get("/dashboard").text
    assert "توصية جديدة" in dash and ">طلبات الموظفين<" in dash and "توصية بالساعات</span>" not in dash
    ap = mgr.get("/approvals").text
    assert "بانتظار قراري" in ap and "كل الطلبات" in ap
    reqs = mgr.get("/requests").text
    assert "طلب المسؤول نفسه" not in reqs and "موظف أول" in reqs
    assert "badge warn" in mgr.get("/employees").text  # عمود الطلبات المعلّقة


def test_year_end_reminder_button(world):
    mgr = login("mgr")
    rec(mgr, world["e"], "days", 3)
    r = post(mgr, "/reminders/year-end", {"year_id": str(world["year"])})
    assert "أُرسل التذكير (عدد الموظفين: موظف واحد)" in mgr.get(r.headers["location"]).text
    r = post(mgr, "/reminders/year-end", {"year_id": str(world["year"])})
    assert "لم يُكرَّر لمن ذُكّروا خلال الأيام السبعة الماضية" in mgr.get(r.headers["location"]).text


def test_delegation_banner_for_delegate(world):
    from app.security import hash_password
    from .conftest import PW
    with SessionLocal() as db:
        m2 = Employee(employee_no="1020", full_name="مسؤول مفوَّض")
        db.add(m2); db.flush()
        db.add(User(username="mgr2", role="officer", employee_id=m2.id, password_hash=hash_password(PW), must_change_password=False))
        db.add(Delegation(from_emp_id=world["m"], to_emp_id=m2.id, start_date=date.today(), end_date=date.today() + timedelta(days=3)))
        db.commit()
    html = login("mgr2").get("/dashboard").text
    assert "تعمل بالتفويض عن" in html and "الإداري المسؤول" in html

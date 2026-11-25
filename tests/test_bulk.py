import io
import json

import openpyxl

from app import bulk
from app.db import SessionLocal
from app.models import Employee, User

from .conftest import login, post


def test_parse_paste_without_header():
    rows = bulk.read_table("", None, "أحمد علي\t2001\tالمعامل\tإداري\n\nسارة\t2002\t\tموظف\t2001\n")
    mapping, body, start = bulk.map_columns(rows)
    out = bulk.build_rows(mapping, body, start)
    assert [(r.name, r.no, r.role, r.manager) for r in out] == [
        ("أحمد علي", "2001", "officer", ""), ("سارة", "2002", "employee", "2001")]


def test_parse_header_any_order_and_number_first():
    rows = bulk.read_table("", None, "الرقم الوظيفي,الاسم,المنصب\n3001,خالد,مدير مباشر")
    m, body, start = bulk.map_columns(rows)
    r = bulk.build_rows(m, body, start)[0]
    assert (r.name, r.no, r.role, r.line) == ("خالد", "3001", "officer", 2)
    m, body, start = bulk.map_columns(bulk.read_table("", None, "3002\tنورة"))
    r = bulk.build_rows(m, body, start)[0]
    assert (r.name, r.no) == ("نورة", "3002")


def test_unknown_role_is_error():
    m, body, s = bulk.map_columns(bulk.read_table("", None, "فهد\t4001\t\tأدمن"))
    assert bulk.build_rows(m, body, s)[0].errors


def _xlsx(rows):
    wb = openpyxl.Workbook()
    for r in rows:
        wb.active.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_admin_import_flow_creates_accounts_and_roles(world):
    with SessionLocal() as db:
        db.add(Employee(employee_no="TMP-001", full_name="منيرة سعد"))
        db.commit()
    adm = login("admin")
    data = _xlsx([["الاسم", "الرقم الوظيفي", "القسم", "المنصب", "رقم المدير المباشر"],
                  ["رئيس المعامل", "5000", "وحدة المعامل", "مدير مباشر", ""],
                  ["فني أول", "5001", "وحدة المعامل", "", "5000"],
                  ["منيرة سعد", "5002", "", "متابع", ""],
                  ["مدخلة بيانات", "5003", "", "مسؤول", ""],
                  ["بلا رقم", "", "", "", ""],
                  ["مكرر", "5001", "", "", ""],
                  ["موظف أول", "1002", "", "مسؤول", ""]])  # موجود: تحديث المنصب
    r = post(adm, "/admin/import/preview", files={"file": ("m.xlsx", data, "application/octet-stream")})
    assert r.status_code == 200 and "جديد" in r.text
    payload = r.text.split('name="payload" hidden>')[1].split("</textarea>")[0]
    import html
    items = json.loads(html.unescape(payload))
    assert len(items) == 5  # صفّا الخطأ مستبعدان
    r = post(adm, "/admin/import/commit", {"payload": json.dumps(items, ensure_ascii=False),
                                          "create_accounts": "1", "update_roles": "1"})
    assert r.status_code == 200 and "5001" in r.text
    with SessionLocal() as db:
        roles = {u.username: u.role for u in db.query(User).all()}
        assert roles["5000"] == "officer" and roles["5001"] == "employee"
        assert roles["5002"] == "officer" and roles["5003"] == "officer"
        assert roles["emp"] == "officer"  # حساب موجود تحدّث منصبه
        tech = db.query(Employee).filter_by(employee_no="5001").one()
        assert tech.manager.employee_no == "5000" and tech.department.name == "وحدة المعامل"
        assert db.query(Employee).filter_by(full_name="منيرة سعد").one().employee_no == "5002"
        assert not db.query(User).filter_by(username="5001").one().must_change_password  # التغيير اختياري
    # الصلاحيات للأدمن فقط
    assert post(login("mgr"), "/admin/import/preview", {"pasted": "x\t1"}).status_code == 403


def test_paste_import(world):
    adm = login("admin")
    r = post(adm, "/admin/import/preview", {"pasted": "سلمان\t6001\nعهود\t6002"})
    payload = r.text.split('name="payload" hidden>')[1].split("</textarea>")[0]
    import html
    post(adm, "/admin/import/commit", {"payload": html.unescape(payload), "create_accounts": "1"})
    with SessionLocal() as db:
        assert db.query(User).filter_by(username="6002").one().role == "employee"


def test_template_and_officer_assignment(world):
    import io

    import openpyxl
    adm = login("admin")
    wb = openpyxl.load_workbook(io.BytesIO(adm.get("/admin/import/template.xlsx").content))
    assert wb.sheetnames[0] == "الموظفون" and "القوائم" in wb.sheetnames
    filled = openpyxl.load_workbook(io.BytesIO(adm.get("/admin/import/template.xlsx?filled=1").content))
    nos = [r[1].value for r in filled["الموظفون"].iter_rows(min_row=2)]
    assert "1002" in nos
    # إعادة رفع ملف «الموظفين الحاليين» دون تعديل = تحديث فقط بلا أخطاء
    buf = io.BytesIO()
    filled.save(buf)
    r = post(adm, "/admin/import/preview", files={"file": ("x.xlsx", buf.getvalue(),
             "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert "⚠" not in r.text.split("<tbody>")[1]
    # إسناد أكثر من موظف للإداري من شاشة المستخدمين
    with SessionLocal() as db:
        mgr = db.query(User).filter_by(username="mgr").one()
        mid, memp = mgr.id, mgr.employee_id
    post(adm, "/admin/users/save", {"user_id": str(mid), "username": "mgr", "role": "officer",
                                    "employee_id": str(memp), "is_active": "1", "assign_present": "1",
                                    "assign": [str(world["e"]), str(world["o"])]})
    with SessionLocal() as db:
        assert {e.id for e in db.query(Employee).filter_by(manager_id=memp)} == {world["e"], world["o"]}
    post(adm, "/admin/users/save", {"user_id": str(mid), "username": "mgr", "role": "officer",
                                    "employee_id": str(memp), "is_active": "1", "assign_present": "1",
                                    "assign": [str(world["o"])]})
    with SessionLocal() as db:
        assert {e.id for e in db.query(Employee).filter_by(manager_id=memp)} == {world["o"]}
    # تحويل الحساب إلى موظف يلغي الإسناد
    post(adm, "/admin/users/save", {"user_id": str(mid), "username": "mgr", "role": "employee",
                                    "employee_id": str(memp), "is_active": "1"})
    with SessionLocal() as db:
        assert db.query(Employee).filter_by(manager_id=memp).count() == 0


def test_dept_near_duplicate_note(world):
    from app import bulk as b
    with SessionLocal() as db:
        rows = b.validate(db, b.rows_from_dicts([{"name": "س", "no": "7001", "dept": "قسم الشؤون الإدارية"},
                                                 {"name": "ع", "no": "7002", "dept": "وحدة الشؤون الإدارية"}]))
    assert "قريب من القسم الموجود" in rows[0].note and not rows[1].note


def test_login_cards_saved_and_cleared(world):
    import html
    from app.models import LoginCard
    adm = login("admin")
    r = post(adm, "/admin/import/preview", {"pasted": "سلمان\t6001\nعهود\t6002"})
    payload = r.text.split('name="payload" hidden>')[1].split("</textarea>")[0]
    r = post(adm, "/admin/import/commit", {"payload": html.unescape(payload), "create_accounts": "1"})
    assert "طباعة بطاقات الدخول" in r.text
    with SessionLocal() as db:
        cards = db.query(LoginCard).all()
        assert len(cards) == 2 and all(c.temp_password for c in cards)
        pw = next(c.temp_password for c in cards if c.username == "6001")
    page = adm.get("/admin/cards").text
    assert "6001" in page and pw in page
    assert pw in adm.get("/admin/cards/print?state=pending").text
    # بعد تغيير كلمة المرور تُمسح المؤقتة من البطاقة
    from .conftest import TestClient, app, csrf
    c = TestClient(app)
    tok = csrf(c)
    c.post("/login", data={"username": "6001", "password": pw, "csrf_token": tok})
    tok = csrf(c, "/change-password")
    c.post("/change-password", data={"csrf_token": tok, "current": pw, "new": "NewPass123x", "confirm": "NewPass123x"})
    with SessionLocal() as db:
        card = db.query(LoginCard).filter_by(username="6001").one()
        assert card.temp_password is None and card.activated_at
    assert pw not in adm.get("/admin/cards").text
    assert login("mgr").get("/admin/cards").status_code == 403

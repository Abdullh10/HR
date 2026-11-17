import io
import json

import openpyxl

from app import bulk
from app.db import SessionLocal
from app.models import Employee, User

from .conftest import login, post


def test_parse_paste_without_header():
    rows = bulk.read_table("", None, "أحمد علي\t2001\tالمعامل\tمسؤول\n\nسارة\t2002\t\tمتابع\t2001\n")
    mapping, body, start = bulk.map_columns(rows)
    out = bulk.build_rows(mapping, body, start)
    assert [(r.name, r.no, r.role, r.manager) for r in out] == [
        ("أحمد علي", "2001", "officer", ""), ("سارة", "2002", "viewer", "2001")]


def test_parse_header_any_order_and_number_first():
    rows = bulk.read_table("", None, "الرقم الوظيفي,الاسم,المنصب\n3001,خالد,مدير مباشر")
    m, body, start = bulk.map_columns(rows)
    r = bulk.build_rows(m, body, start)[0]
    assert (r.name, r.no, r.role, r.line) == ("خالد", "3001", "manager", 2)
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
        assert roles["5000"] == "manager" and roles["5001"] == "employee"
        assert roles["5002"] == "viewer" and roles["5003"] == "officer"
        assert roles["emp"] == "officer"  # حساب موجود تحدّث منصبه
        tech = db.query(Employee).filter_by(employee_no="5001").one()
        assert tech.manager.employee_no == "5000" and tech.department.name == "وحدة المعامل"
        assert db.query(Employee).filter_by(full_name="منيرة سعد").one().employee_no == "5002"
        assert db.query(User).filter_by(username="5001").one().must_change_password
    # الصلاحيات للأدمن فقط
    assert post(login("officer"), "/admin/import/preview", {"pasted": "x\t1"}).status_code == 403


def test_paste_import(world):
    adm = login("admin")
    r = post(adm, "/admin/import/preview", {"pasted": "سلمان\t6001\nعهود\t6002"})
    payload = r.text.split('name="payload" hidden>')[1].split("</textarea>")[0]
    import html
    post(adm, "/admin/import/commit", {"payload": html.unescape(payload), "create_accounts": "1"})
    with SessionLocal() as db:
        assert db.query(User).filter_by(username="6002").one().role == "employee"


def test_viewer_is_read_only(world):
    with SessionLocal() as db:
        from app.security import hash_password
        from .conftest import PW
        db.add(User(username="viewer", role="viewer", password_hash=hash_password(PW), must_change_password=False))
        db.commit()
    v = login("viewer")
    for url in ("/dashboard", "/employees", f"/employees/{world['o']}", f"/employees/{world['e']}", "/reports",
                "/tasks", "/requests", "/export/balances.xlsx"):
        assert v.get(url).status_code == 200, url
    for url in ("/approvals", "/tasks/new", "/admin/users", "/admin/import", "/employees/new/form"):
        assert v.get(url).status_code == 403, url
    assert post(v, "/tasks/new", {"emp": [str(world["e"])]}).status_code == 403
    assert post(v, "/requests/new", {"emp": str(world["e"]), "rest_date": "2027-03-01"}).status_code in (303, 403)
    from app.models import RestDayRequest
    with SessionLocal() as db:
        assert db.query(RestDayRequest).count() == 0

"""إضافة موظف من «الموظفون والأرصدة» تنشئ له حساب دخول وبطاقة تلقائياً."""
from app.db import SessionLocal
from app.models import Employee, LoginCard, User

from .conftest import TestClient, app, csrf, login, post


def test_new_employee_gets_account_and_card(world):
    adm = login("admin")
    r = post(adm, "/employees/save", {"employee_no": "5005", "full_name": "سلمى خالد", "create_account": "1"})
    page = adm.get(r.headers["location"]).text
    assert "تم إنشاء حساب الدخول" in page and "طباعة بطاقة الدخول" in page
    with SessionLocal() as db:
        e = db.query(Employee).filter_by(employee_no="5005").one()
        u = db.query(User).filter_by(employee_id=e.id).one()
        assert u.username == "5005" and u.role == "employee" and not u.must_change_password  # التغيير اختياري
        card = db.query(LoginCard).filter_by(user_id=u.id).one()
        assert card.temp_password
        pw = card.temp_password
    # الموظف يدخل بكلمة المرور المؤقتة
    c = TestClient(app)
    t = csrf(c, "/login")
    r = c.post("/login", data={"username": "5005", "password": pw, "csrf_token": t}, follow_redirects=False)
    assert r.status_code in (302, 303)
    r2 = c.get("/", follow_redirects=False)
    assert "change-password" not in r2.headers.get("location", "")  # لا إلزام بالتغيير؛ كلمة البطاقة سارية
    with SessionLocal() as db:
        assert db.query(LoginCard).filter_by(username="5005").one().temp_password == pw  # البطاقة تبقى للطباعة


def test_create_account_for_existing_employee(world):
    adm = login("admin")
    post(adm, "/employees/save", {"employee_no": "5006", "full_name": "هند علي"})  # بلا حساب
    with SessionLocal() as db:
        e = db.query(Employee).filter_by(employee_no="5006").one(); eid = e.id
        assert not db.query(User).filter_by(employee_id=eid).first()
    assert "لا يوجد حساب دخول لهذا الموظف" in adm.get(f"/employees/{eid}").text
    assert "بلا حساب دخول" in adm.get("/admin/users").text
    post(adm, f"/employees/{eid}/account")
    with SessionLocal() as db:
        assert db.query(User).filter_by(employee_id=eid).one().username == "5006"
    post(adm, f"/employees/{eid}/account")  # مرة ثانية: لا يتكرر
    with SessionLocal() as db:
        assert db.query(User).filter_by(employee_id=eid).count() == 1


def test_employee_save_with_blank_optional_selects(world):
    """القوائم المنسدلة الفارغة (القسم ومسؤول شؤون الموظفين) لا تُسقط حفظ الموظف."""
    from .conftest import login, post
    adm = login("admin")
    r = post(adm, "/employees/save", {"employee_no": "5501", "full_name": "موظف بلا قسم", "department_id": "", "manager_id": "", "emp_id": ""})
    assert r.status_code == 303, r.text
    from app.db import SessionLocal
    from app.models import Employee
    with SessionLocal() as db:
        e = db.query(Employee).filter_by(employee_no="5501").one()
        assert e.department_id is None and e.manager_id is None
    r = post(adm, "/admin/departments/save", {"dept_id": "", "name": "قسم جديد", "is_active": "1"})
    assert r.status_code == 303

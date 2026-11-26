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


def test_delete_mistaken_employee(world):
    """حذف موظف أُدخل بالخطأ (مدير النظام فقط، وبلا سجلات)؛ من له سجلات يُرفض حذفه."""
    from app.db import SessionLocal
    from app.models import AuditLog, Employee, User
    from .conftest import login, post
    from .test_flows import rec
    adm = login("admin")
    post(adm, "/employees/save", {"employee_no": "7701", "full_name": "أُدخل بالخطأ", "create_account": "1"})
    with SessionLocal() as db:
        eid = db.query(Employee).filter_by(employee_no="7701").one().id
        assert db.query(User).filter_by(employee_id=eid).count() == 1
    assert "حذف الموظف" in adm.get(f"/employees/{eid}/edit").text
    assert post(login("mgr"), f"/employees/{eid}/delete", {"confirm_no": "7701"}).status_code == 403
    r = post(adm, f"/employees/{eid}/delete", {"confirm_no": "خطأ"})
    assert "اكتب رقمه الوظيفي" in adm.get(r.headers["location"]).text
    r = post(adm, f"/employees/{eid}/delete", {"confirm_no": "7701"})
    assert r.headers["location"] == "/employees"
    with SessionLocal() as db:
        assert db.get(Employee, eid) is None and db.query(User).filter_by(employee_id=eid).count() == 0
        assert db.query(AuditLog).filter_by(action="employee_deleted").count() == 1
    # موظف له توصية: يُرفض الحذف
    rec(login("mgr"), world["e"], "days", 1)
    r = post(adm, f"/employees/{world['e']}/delete", {"confirm_no": "1002"})
    assert "لا يمكن حذف" in adm.get(r.headers["location"]).text
    # مسؤول له فريق: يُرفض الحذف
    r = post(adm, f"/employees/{world['m']}/delete", {"confirm_no": "1001"})
    assert "بصفته مسؤول شؤون موظفين" in adm.get(r.headers["location"]).text


def test_all_pages_not_cached(world):
    """كل صفحات النظام تُجلب طازجة من الخادم (لا يعرض المتصفح نسخة قديمة بعد تحديث البيانات من جهاز آخر)."""
    from .conftest import login
    adm = login("admin")
    for url in ("/dashboard", "/employees", "/approvals", "/recommendations", "/reports", "/admin/users", "/messages", "/login"):
        assert adm.get(url).headers.get("cache-control") == "no-store", url
    assert "no-store" not in (adm.get("/static/app.css").headers.get("cache-control") or "")

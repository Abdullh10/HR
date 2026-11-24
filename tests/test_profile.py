"""الملف الشخصي: الموظف يحدّث بيانات التواصل، والأدمن يحدّث أيضاً الاسم والوحدة."""
from app.db import SessionLocal
from app.models import AuditLog, Department, Employee, User

from .conftest import login, post


def test_employee_updates_contact_only(world):
    emp = login("emp")
    assert "الملف الشخصي" in emp.get("/profile").text
    post(emp, "/profile", {"email": "Emp@Example.com", "phone": "+966 55 123 4567", "extension": "١٢٣٤",
                           "full_name": "اسم آخر", "department_id": str(world["dept"]), "job_title": "مدير"})
    with SessionLocal() as db:
        e = db.get(Employee, world["e"])
        assert (e.email, e.phone, e.extension) == ("emp@example.com", "0551234567", "1234")
        assert e.full_name != "اسم آخر" and e.job_title != "مدير"  # لا يعدّل الموظف الاسم ولا المسمى
        assert db.query(AuditLog).filter_by(action="profile_updated").count() == 1


def test_invalid_phone_rejected(world):
    emp = login("emp")
    r = post(emp, "/profile", {"email": "", "phone": "12345", "extension": ""})
    assert "رقم الجوال غير صحيح" in emp.get(r.headers.get("location", "/profile")).text
    with SessionLocal() as db:
        assert db.get(Employee, world["e"]).phone == ""


def test_admin_without_employee_updates_name_email_unit(world):
    adm = login("admin")
    with SessionLocal() as db:
        d2 = Department(name="وحدة الجودة"); db.add(d2); db.commit(); did = d2.id
    post(adm, "/profile", {"full_name": "مدير النظام الرئيسي", "email": "admin@example.com",
                           "phone": "0500000000", "department_id": str(did)})
    with SessionLocal() as db:
        u = db.query(User).filter_by(username="admin").one()
        assert (u.full_name, u.email, u.phone, u.department_id) == ("مدير النظام الرئيسي", "admin@example.com", "0500000000", did)
        assert u.display_name == "مدير النظام الرئيسي" and u.contact_email == "admin@example.com"
    assert "مدير النظام الرئيسي" in adm.get("/profile").text

import os
import re
import sys
import tempfile
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="hr-test-")
os.environ["HR_DATA_DIR"] = _TMP
os.environ["HR_ADMIN_PASSWORD"] = "Admin1234x"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app, init_db  # noqa: E402
from app.models import Department, Employee, FiscalYear, User  # noqa: E402
from app.security import hash_password  # noqa: E402

PW = "Passw0rd99"


@pytest.fixture()
def world():
    """مدير نظام، إداري (mgr) مسند له الموظف e، وموظف o غير مُسند."""
    Base.metadata.drop_all(engine)
    init_db()
    with SessionLocal() as db:
        y = db.query(FiscalYear).one()
        from datetime import date as _d
        y.name, y.start_date, y.end_date = "2027", _d(2027, 1, 1), _d(2027, 12, 31)
        y.require_task_attachment = False
        d = Department(name="وحدة الشؤون الإدارية")
        db.add(d)
        db.flush()
        m = Employee(employee_no="1001", full_name="الإداري المسؤول", department_id=d.id, email="mgr@example.com")
        db.add(m)
        db.flush()
        e = Employee(employee_no="1002", full_name="موظف أول", department_id=d.id, manager_id=m.id)
        o = Employee(employee_no="1003", full_name="موظف آخر", department_id=d.id)
        db.add_all([e, o])
        db.flush()
        admin = db.query(User).filter_by(username="admin").one()
        admin.password_hash, admin.must_change_password = hash_password(PW), False
        for uname, role, emp in (("mgr", "officer", m), ("emp", "employee", e), ("emp2", "employee", o)):
            db.add(User(username=uname, role=role, employee_id=emp.id,
                        password_hash=hash_password(PW), must_change_password=False))
        db.commit()
        ids = dict(year=y.id, m=m.id, e=e.id, o=o.id, dept=d.id)
    return ids


def csrf(client, url="/login"):
    r = client.get(url)
    m = re.search(r'name="csrf_token" value="([^"]+)"', r.text)
    return m.group(1)


def login(username):
    c = TestClient(app)
    tok = csrf(c)
    r = c.post("/login", data={"username": username, "password": PW, "csrf_token": tok}, follow_redirects=False)
    assert r.status_code == 303, r.text[:500]
    c.tok = csrf(c, "/change-password")
    return c


def post(c, url, data=None, files=None, **kw):
    data = dict(data or {})
    data["csrf_token"] = c.tok
    return c.post(url, data=data, files=files, follow_redirects=False, **kw)

import io
import zipfile

from app.db import SessionLocal, UPLOAD_DIR
from app.models import Employee, Message, Recommendation, User

from .conftest import login, post

PDF = ("t.pdf", b"%PDF-1.4 test", "application/pdf")


def _seed(world):
    mgr = login("mgr")
    post(mgr, "/recommendations/new", {"emp": str(world["e"]), "kind": "days", "amount": "3",
                                       "rec_date": "2027-02-10"}, files={"file": PDF})
    return mgr


def test_backup_restore_roundtrip(world):
    _seed(world)
    adm = login("admin")
    r = adm.get("/admin/backup.zip")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    blob = r.content
    z = zipfile.ZipFile(io.BytesIO(blob))
    assert "data.json" in z.namelist() and any(n.startswith("uploads/") for n in z.namelist())
    # الحذف يتطلب كلمة «حذف»
    post(adm, "/admin/wipe", {"confirm": "نعم"})
    with SessionLocal() as db:
        assert db.query(Employee).count() == 3
    post(adm, "/admin/wipe", {"confirm": "حذف"})
    with SessionLocal() as db:
        assert db.query(Employee).count() == 0 and db.query(Recommendation).count() == 0
        assert [u.username for u in db.query(User)] == ["admin"]
    assert not list(UPLOAD_DIR.glob("*"))
    # الاستعادة تتطلب كلمة «استعادة»
    post(adm, "/admin/restore", {"confirm": "x"}, files={"file": ("b.zip", blob, "application/zip")})
    with SessionLocal() as db:
        assert db.query(Employee).count() == 0
    r = post(adm, "/admin/restore", {"confirm": "استعادة"}, files={"file": ("b.zip", blob, "application/zip")})
    assert r.headers["location"] == "/login"
    with SessionLocal() as db:
        assert db.query(Employee).count() == 3 and db.query(Recommendation).count() == 1
        e = db.get(Employee, world["e"])
        assert e.manager_id == world["m"]
        assert db.query(Message).count() >= 1
    assert list(UPLOAD_DIR.glob("*"))
    # الحسابات المستعادة تعمل، والإضافة بعد الاستعادة لا تتعارض مع المعرّفات
    mgr = login("mgr")
    post(mgr, "/recommendations/new", {"emp": str(world["e"]), "kind": "hours", "amount": "2",
                                       "rec_date": "2027-02-11"})
    with SessionLocal() as db:
        assert db.query(Recommendation).count() == 2


def test_restore_rejects_bad_file(world):
    adm = login("admin")
    post(adm, "/admin/restore", {"confirm": "استعادة"}, files={"file": ("b.zip", b"not a zip", "application/zip")})
    with SessionLocal() as db:
        assert db.query(Employee).count() == 3


def test_data_admin_only(world):
    for u in ("mgr", "emp"):
        c = login(u)
        assert c.get("/admin/data").status_code == 403
        assert c.get("/admin/backup.zip").status_code == 403
        assert post(c, "/admin/wipe", {"confirm": "حذف"}).status_code == 403
    assert login("admin").get("/admin/data").status_code == 200


def test_archive(world):
    mgr = _seed(world)
    r = mgr.get("/archive")
    assert r.status_code == 200 and "REC-" in r.text
    z = zipfile.ZipFile(io.BytesIO(mgr.get("/archive/export.zip").content))
    names = z.namelist()
    assert any(n.endswith(".xlsx") for n in names) and any(n.startswith("pdf/REC-") for n in names)
    assert login("emp").get("/archive").status_code == 403
    assert "موظف أول" in login("admin").get("/archive").text


def test_old_session_cannot_open_new_account(world):
    """بعد الحذف الكامل وإنشاء حسابات جديدة بنفس الأرقام، لا تعمل الجلسة القديمة."""
    from app.security import hash_password
    emp = login("emp")
    assert emp.get("/me").status_code == 200
    adm = login("admin")
    post(adm, "/admin/wipe", {"confirm": "حذف"})
    with SessionLocal() as db:
        for i in range(4):
            db.add(User(username=f"new{i}", role="officer", password_hash=hash_password("Passw0rd99"),
                        must_change_password=False))
        db.commit()
    r = emp.get("/me", follow_redirects=False)
    assert r.status_code in (302, 303, 307) and "/login" in r.headers["location"]
    # تغيير كلمة المرور يُبقي الجلسة الحالية صالحة
    c = login("new0")
    tok = c.tok
    c.post("/change-password", data={"csrf_token": tok, "current": "Passw0rd99", "new": "NewPass123x",
                                     "confirm": "NewPass123x"}, follow_redirects=False)
    assert c.get("/messages").status_code == 200


def test_safety_refs_and_audit(world):
    import json
    from app import backup
    from app.models import AuditLog, LeaveRequest
    mgr = _seed(world)
    with SessionLocal() as db:
        r1 = db.query(Recommendation).one().ref_code
    assert r1.startswith("REC-") and r1.endswith("-0001")
    adm = login("admin")
    blob = adm.get("/admin/backup.zip").content
    # الحذف يحفظ نسخة تلقائية، والعدّاد لا يُعاد بعده
    post(adm, "/admin/wipe", {"confirm": "حذف"})
    assert any("before-wipe" in a["name"] for a in backup.list_auto())
    r = post(adm, "/admin/restore", {"confirm": "استعادة"}, files={"file": ("b.zip", blob, "application/zip")})
    assert any("before-restore" in a["name"] for a in backup.list_auto())
    with SessionLocal() as db:
        actions = [a.action for a in db.query(AuditLog)]
        assert "all_data_wiped" in actions and "backup_restored" in actions  # سجل التدقيق لا يُمحى
    mgr = login("mgr")
    post(mgr, "/recommendations/new", {"emp": str(world["e"]), "kind": "hours", "amount": "2", "rec_date": "2027-02-11"})
    with SessionLocal() as db:
        codes = sorted(x.ref_code for x in db.query(Recommendation))
    assert len(set(codes)) == 2 and codes[1].endswith("-0002")


def test_bad_restore_structure_no_500(world):
    import json
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as z:
        z.writestr("data.json", json.dumps({"format": "itmam-backup", "version": 1,
                                            "tables": {"users": [{"id": 1, "username": "x", "role": "admin"}]}}))
    adm = login("admin")
    r = post(adm, "/admin/restore", {"confirm": "استعادة"}, files={"file": ("b.zip", zbuf.getvalue(), "application/zip")})
    assert r.status_code == 303
    with SessionLocal() as db:
        assert db.query(Employee).count() == 3


def test_year_change_needs_confirmation_and_cancel_fields(world):
    from app.models import FiscalYear, LeaveRequest
    mgr = _seed(world)
    adm = login("admin")
    form = {"year_id": str(world["year"]), "name": "2027", "start_date": "2027-01-01", "end_date": "2027-12-31",
            "hours_per_day": "8", "base_days": "20", "block_weekends": "1", "employee_can_request": "1",
            "weekend_days": ["4", "5"]}
    post(adm, "/admin/years/save", form)
    with SessionLocal() as db:
        assert db.get(FiscalYear, world["year"]).hours_per_day == 7
    post(adm, "/admin/years/save", dict(form, confirm_impact="1"))
    with SessionLocal() as db:
        assert db.get(FiscalYear, world["year"]).hours_per_day == 8
    # إلغاء طلب معتمد يسجّل من ألغى ومتى، ويظهر في النموذج
    emp = login("emp")
    post(emp, "/requests/new", {"emp": str(world["e"]), "kind": "use", "unit": "days", "start_date": "2027-03-01",
                                "reason": "س"})
    with SessionLocal() as db:
        rid = db.query(LeaveRequest).one().id
    post(mgr, f"/requests/{rid}/decide", {"action": "approve"})
    post(mgr, f"/requests/{rid}/cancel", {"note": "تغيّر الموعد"})
    with SessionLocal() as db:
        q = db.get(LeaveRequest, rid)
        assert q.cancelled_by and q.cancelled_at and q.cancel_note == "تغيّر الموعد" and q.ref_code.startswith("REQ-")
    t = emp.get(f"/requests/{rid}/print").text
    assert "أُلغي بواسطة" in t and "تغيّر الموعد" in t
    assert "تغيّر الموعد" in emp.get("/me").text  # سبب الإلغاء ظاهر للموظف
    # البحث في الأرشيف يتجاهل الهمزات ويبحث في الأسباب
    assert "تغيّر الموعد" in mgr.get("/archive?q=" + "تغير").text or q.ref_code in mgr.get("/archive?q=الموعد").text


def test_deactivate_disables_account(world):
    adm = login("admin")
    post(adm, "/employees/save", {"emp_id": str(world["e"]), "employee_no": "1002", "full_name": "موظف أول",
                                  "manager_id": str(world["m"])})
    with SessionLocal() as db:
        assert not db.query(User).filter_by(username="emp").one().is_active

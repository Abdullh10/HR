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

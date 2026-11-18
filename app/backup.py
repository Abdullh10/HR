"""النسخ الاحتياطي والاستعادة والحذف الكامل للبيانات.

النسخة الاحتياطية ملف ZIP يحتوي:
- data.json: كل الجداول (صفاً صفاً) مع رقم إصدار الصيغة.
- uploads/: ملفات PDF المرفقة.
"""
from __future__ import annotations

import io
import json
import zipfile
from datetime import date, datetime

from sqlalchemy import Date, DateTime, delete, insert, select, text, update
from sqlalchemy.orm import Session

from .db import UPLOAD_DIR, Base, engine

FORMAT = "itmam-backup"
VERSION = 1


def _tables():
    return list(Base.metadata.sorted_tables)  # مرتبة حسب الاعتماديات (الآباء أولاً)


def _enc(v):
    if isinstance(v, datetime):
        return v.isoformat(timespec="seconds")
    if isinstance(v, date):
        return v.isoformat()
    return v


def dump(db: Session) -> bytes:
    data = {"format": FORMAT, "version": VERSION, "created_at": datetime.now().isoformat(timespec="seconds"),
            "tables": {}}
    stored = []
    for t in _tables():
        rows = [{k: _enc(v) for k, v in r._mapping.items()} for r in db.execute(select(t))]
        data["tables"][t.name] = rows
        if t.name == "attachments":
            stored = [r["stored_name"] for r in rows]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("data.json", json.dumps(data, ensure_ascii=False, indent=1))
        for name in stored:
            p = UPLOAD_DIR / name
            if p.exists():
                z.write(p, f"uploads/{name}")
    return buf.getvalue()


def _dec(col, v):
    if v is None:
        return None
    if isinstance(col.type, DateTime):
        return datetime.fromisoformat(v)
    if isinstance(col.type, Date):
        return date.fromisoformat(v)
    return v


def _clear_uploads() -> None:
    for p in UPLOAD_DIR.glob("*"):
        if p.is_file():
            p.unlink()


def _reset_sequences(db: Session) -> None:
    if engine.dialect.name != "postgresql":
        return
    for t in _tables():
        if "id" in t.c and t.c.id.autoincrement is not False and t.c.id.type.python_type is int:
            db.execute(text(f"SELECT setval(pg_get_serial_sequence('{t.name}', 'id'), "
                            f"COALESCE((SELECT MAX(id) FROM {t.name}), 0) + 1, false)"))


def restore(db: Session, blob: bytes) -> dict[str, int]:
    """يستبدل كل البيانات بمحتوى النسخة. يرفع ValueError عند ملف غير صالح."""
    try:
        z = zipfile.ZipFile(io.BytesIO(blob))
        data = json.loads(z.read("data.json"))
    except Exception as e:  # noqa: BLE001
        raise ValueError("الملف ليس نسخة احتياطية صالحة من النظام.") from e
    if data.get("format") != FORMAT or data.get("version") != VERSION:
        raise ValueError("صيغة النسخة الاحتياطية غير مدعومة.")
    tables = data.get("tables") or {}
    if not tables.get("users"):
        raise ValueError("النسخة لا تحتوي على أي حساب مستخدم.")
    counts = {}
    for t in reversed(_tables()):
        db.execute(delete(t))
    for t in _tables():
        rows = tables.get(t.name) or []
        rows = [{c.name: _dec(c, r.get(c.name)) for c in t.columns if c.name in r} for r in rows]
        deferred = []
        if t.name == "employees":  # مرجع ذاتي: يُضبط الإداري المسؤول بعد إدخال الجميع
            deferred = [(r["id"], r.get("manager_id")) for r in rows if r.get("manager_id")]
            for r in rows:
                r["manager_id"] = None
        if rows:
            db.execute(insert(t), rows)
        for rid, mid in deferred:
            db.execute(update(t).where(t.c.id == rid).values(manager_id=mid))
        counts[t.name] = len(rows)
    _clear_uploads()
    for name in z.namelist():
        if name.startswith("uploads/") and not name.endswith("/"):
            fn = name.split("/", 1)[1]
            if "/" in fn or ".." in fn or not fn:
                continue
            (UPLOAD_DIR / fn).write_bytes(z.read(name))
    _reset_sequences(db)
    return counts


def wipe(db: Session, keep_user_id: int) -> None:
    """يحذف كل البيانات التشغيلية: الموظفين والحسابات (عدا الأدمن المنفّذ) والتوصيات والطلبات
    والمراسلات والمرفقات والأقسام والعطل وسجل التدقيق. تبقى السنوات وهوية الجهة."""
    keep = {"app_settings", "fiscal_years", "users"}
    from .models import User

    db.execute(update(User).where(User.id == keep_user_id).values(employee_id=None))
    for t in reversed(_tables()):
        if t.name == "users":
            db.execute(delete(t).where(t.c.id != keep_user_id))
        elif t.name not in keep:
            if t.name == "employees":
                db.execute(update(t).values(manager_id=None))
            db.execute(delete(t))
    _clear_uploads()

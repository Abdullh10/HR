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

from .db import DATA_DIR, UPLOAD_DIR, Base, engine

AUTO_DIR = DATA_DIR / "backups"
AUTO_KEEP = 10

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


def auto_backup(db: Session, reason: str) -> str:
    """نسخة احتياطية تلقائية على الخادم قبل أي فعل هدّام (الحذف أو الاستعادة). يُحتفظ بآخر AUTO_KEEP نسخ."""
    AUTO_DIR.mkdir(parents=True, exist_ok=True)
    name = f"auto-{datetime.now():%Y%m%d-%H%M%S}-{reason}.zip"
    (AUTO_DIR / name).write_bytes(dump(db))
    for old in sorted(AUTO_DIR.glob("auto-*.zip"))[:-AUTO_KEEP]:
        old.unlink()
    return name


def list_auto() -> list[dict]:
    if not AUTO_DIR.exists():
        return []
    out = []
    for p in sorted(AUTO_DIR.glob("auto-*.zip"), reverse=True):
        out.append(dict(name=p.name, size=p.stat().st_size, at=datetime.fromtimestamp(p.stat().st_mtime)))
    return out


def restore(db: Session, blob: bytes) -> tuple[dict[str, int], list[tuple[str, bytes]]]:
    """يستبدل كل البيانات بمحتوى النسخة، ويُبقي سجل التدقيق الحالي (يُدمج بعد المستعاد) حتى لا تُمحى آثار
    العمليات الهدّامة. يعيد (الأعداد، ملفات المرفقات لكتابتها بعد تثبيت المعاملة). يرفع ValueError لملف غير صالح."""
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
    # فحص البنية قبل البدء: الأعمدة الإلزامية لكل جدول موجودة
    for t in _tables():
        required = {c.name for c in t.columns if not c.nullable and c.default is None and c.server_default is None
                    and not c.primary_key}
        for r in tables.get(t.name) or []:
            missing = required - set(r)
            if missing:
                raise ValueError(f"النسخة الاحتياطية ناقصة (الجدول {t.name} بلا {', '.join(sorted(missing))}).")
            break
    audit_t = Base.metadata.tables["audit_log"]
    current_audit = [dict(r._mapping) for r in db.execute(select(audit_t).order_by(audit_t.c.id))]
    counts = {}
    for t in reversed(_tables()):
        db.execute(delete(t))
    for t in _tables():
        rows = tables.get(t.name) or []
        rows = [{c.name: _dec(c, r.get(c.name)) for c in t.columns if c.name in r} for r in rows]
        deferred = []
        if t.name == "employees":  # مرجع ذاتي: يُضبط مسؤول شؤون الموظفين بعد إدخال الجميع
            deferred = [(r["id"], r.get("manager_id")) for r in rows if r.get("manager_id")]
            for r in rows:
                r["manager_id"] = None
        if rows:
            db.execute(insert(t), rows)
        for rid, mid in deferred:
            db.execute(update(t).where(t.c.id == rid).values(manager_id=mid))
        counts[t.name] = len(rows)
    # دمج سجل التدقيق الحالي بعد المستعاد (بأرقام جديدة) دون ربطه بحسابات قد لا توجد
    if current_audit:
        restored_ids = {r["id"] for r in (tables.get("audit_log") or [])}
        start = max(restored_ids or {0}) + 1
        for i, r in enumerate(current_audit):
            r = dict(r, id=start + i, user_id=None)
            db.execute(insert(audit_t), [r])
    files = []
    for name in z.namelist():
        if name.startswith("uploads/") and not name.endswith("/"):
            fn = name.split("/", 1)[1]
            if "/" in fn or ".." in fn or not fn:
                continue
            files.append((fn, z.read(name)))
    _reset_sequences(db)
    return counts, files


def write_uploads(files: list[tuple[str, bytes]]) -> None:
    """تُستدعى بعد تثبيت الاستعادة: تستبدل مجلد المرفقات بمحتوى النسخة."""
    _clear_uploads()
    for fn, data in files:
        (UPLOAD_DIR / fn).write_bytes(data)


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

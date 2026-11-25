"""إشعارات الأجهزة (Web Push) كتطبيق: تصل إلى الجوال أو الحاسب حتى مع إغلاق الموقع.
مفاتيح VAPID تُولَّد تلقائياً عند أول استخدام وتُحفظ في إعدادات النظام."""
from __future__ import annotations

import base64
import json
import logging
import os
import threading
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import AppSetting, Message, PushSubscription

log = logging.getLogger("hr.push")
_lock = threading.Lock()


def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def vapid_keys(db: Session) -> tuple[str, str]:
    """(المفتاح الخاص PEM، المفتاح العام base64url للمتصفح)؛ يولّدهما مرة واحدة."""
    with _lock:
        priv = db.get(AppSetting, "vapid_private")
        pub = db.get(AppSetting, "vapid_public")
        if priv and pub and priv.value and pub.value:
            return priv.value, pub.value
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        key = ec.generate_private_key(ec.SECP256R1())
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption()).decode()
        raw = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        for k, v in (("vapid_private", pem), ("vapid_public", _b64u(raw))):
            row = db.get(AppSetting, k)
            if row:
                row.value = v
            else:
                db.add(AppSetting(key=k, value=v))
        db.commit()
        return pem, _b64u(raw)


def _contact() -> str:
    """جهة الاتصال في ترويسة VAPID (يشترطها مزوّدو الإشعارات): عنوان المرسِل الرسمي أو رابط الموقع."""
    sender = os.environ.get("HR_SMTP_FROM", "").strip()
    if "@" in sender:
        return "mailto:" + sender.split("<")[-1].strip(" >")
    from . import mailer
    return mailer.BASE_URL or "https://localhost"


def subscribe(db: Session, user_id: int, sub: dict, device: str = "") -> PushSubscription:
    endpoint = str(sub.get("endpoint") or "")
    keys = sub.get("keys") or {}
    if not endpoint.startswith("https://") or not keys.get("p256dh") or not keys.get("auth"):
        raise ValueError("اشتراك غير صالح.")
    row = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
    if row:
        row.user_id, row.p256dh, row.auth, row.device = user_id, keys["p256dh"], keys["auth"], device[:120]
    else:
        row = PushSubscription(user_id=user_id, endpoint=endpoint, p256dh=keys["p256dh"], auth=keys["auth"], device=device[:120])
        db.add(row)
    return row


def unsubscribe(db: Session, user_id: int, endpoint: str) -> None:
    row = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint, PushSubscription.user_id == user_id))
    if row:
        db.delete(row)


def _send_all(targets: list[dict], payload: str, private_pem: str) -> list[tuple[int, str]]:
    """يرسل ويعيد [(id, الحالة)] حيث الحالة ok أو gone (انتهى الاشتراك) أو error."""
    from pywebpush import WebPushException, webpush
    from py_vapid import Vapid
    vapid = Vapid.from_pem(private_pem.encode())
    out = []
    for t in targets:
        try:
            webpush({"endpoint": t["endpoint"], "keys": {"p256dh": t["p256dh"], "auth": t["auth"]}}, payload,
                    vapid_private_key=vapid, vapid_claims={"sub": _contact()}, ttl=86400, timeout=10)
            out.append((t["id"], "ok"))
        except WebPushException as e:
            code = getattr(e.response, "status_code", None)
            out.append((t["id"], "gone" if code in (404, 410) else "error"))
            if code not in (404, 410):
                log.warning("push failed (%s): %s", code, str(e)[:200])
        except Exception as e:  # noqa: BLE001 - لا يُفشل الإشعار عملية المستخدم
            out.append((t["id"], "error"))
            log.warning("push error: %s", str(e)[:200])
    return out


def _finish(results: list[tuple[int, str]]) -> None:
    """يحذف الاشتراكات المنتهية ويسجّل آخر إرسال ناجح؛ فشل هذا التحديث لا يؤثر على الإشعار نفسه."""
    try:
        with SessionLocal() as db:
            for sid, st in results:
                row = db.get(PushSubscription, sid)
                if not row:
                    continue
                if st == "gone":
                    db.delete(row)
                elif st == "ok":
                    row.last_ok = datetime.now()
            db.commit()
    except Exception as e:  # noqa: BLE001
        log.warning("push bookkeeping skipped: %s", e)


def notify_user(db: Session, user_id: int, title: str, body: str = "", link: str = "", background: bool = True) -> int:
    """يرسل إشعاراً لكل أجهزة المستخدم المشتركة. يعيد عدد الأجهزة. لا يرمي استثناءات."""
    try:
        subs = list(db.scalars(select(PushSubscription).where(PushSubscription.user_id == user_id)))
        if not subs:
            return 0
        pem, _ = vapid_keys(db)
        unread = db.scalar(select(func.count(Message.id)).where(Message.recipient_id == user_id, Message.read_at.is_(None))) or 0
        payload = json.dumps({"title": title[:120], "body": (body or "")[:300], "url": link or "/messages",
                              "badge": int(unread), "tag": f"msg-{user_id}-{datetime.now():%H%M%S}"}, ensure_ascii=False)
        targets = [dict(id=s.id, endpoint=s.endpoint, p256dh=s.p256dh, auth=s.auth) for s in subs]
    except Exception as e:  # noqa: BLE001
        log.warning("push prepare error: %s", e)
        return 0

    def run():
        _finish(_send_all(targets, payload, pem))
    if background:
        threading.Thread(target=run, daemon=True).start()
    else:
        run()
    return len(targets)

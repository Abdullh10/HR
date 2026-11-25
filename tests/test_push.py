"""تطبيق الويب وإشعارات الأجهزة: ملف التعريف، وعامل الخدمة، والاشتراك، والإرسال المشفّر الفعلي إلى خدمة إشعارات وهمية."""
import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app import push
from app.db import SessionLocal
from app.models import PushSubscription, User

from .conftest import login, post
from .test_flows import MON, leave, rec


def _b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _client_keys():
    """مفاتيح متصفح وهمي (كما يولّدها المتصفح عند الاشتراك)."""
    priv = ec.generate_private_key(ec.SECP256R1())
    pub = priv.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    auth = b"0123456789abcdef"
    return priv, _b64u(pub), _b64u(auth), auth


def test_manifest_and_service_worker(world):
    c = login("emp")
    m = c.get("/manifest.webmanifest")
    assert m.status_code == 200 and m.headers["content-type"].startswith("application/manifest+json")
    data = m.json()
    assert data["display"] == "standalone" and data["dir"] == "rtl" and len(data["icons"]) == 3
    sw = c.get("/sw.js")
    assert sw.status_code == 200 and "showNotification" in sw.text and sw.headers.get("service-worker-allowed") == "/"
    html = c.get("/me").text
    assert 'rel="manifest"' in html and "apple-touch-icon" in html and 'name="csrf-token"' in html
    assert "data-push-prompt" in html
    assert "data-push-panel" in c.get("/profile").text
    for f in ("icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "badge-96.png", "offline.html"):
        assert c.get(f"/static/{f}").status_code == 200


def test_subscribe_unsubscribe_and_notify_hook(world, monkeypatch):
    c = login("emp")
    key = c.get("/push/key").json()["key"]
    assert len(base64.urlsafe_b64decode(key + "==")) == 65  # مفتاح عام غير مضغوط (P-256)
    _, p256, auth, _ = _client_keys()
    sub = {"endpoint": "https://push.example.com/abc", "keys": {"p256dh": p256, "auth": auth}}
    assert post(c, "/push/subscribe", {"subscription": json.dumps(sub), "device": "iPhone Safari"}).status_code == 200
    assert post(c, "/push/subscribe", {"subscription": json.dumps({"endpoint": "http://x"})}).status_code == 400
    with SessionLocal() as db:
        assert db.query(PushSubscription).count() == 1
    sent = []
    monkeypatch.setattr(push, "_send_all", lambda targets, payload, pem: sent.append((targets, json.loads(payload))) or [(t["id"], "ok") for t in targets])
    monkeypatch.setattr(push.threading, "Thread", lambda target, daemon: type("T", (), {"start": lambda self: target()})())
    mgr = login("mgr")
    rec(mgr, world["e"], "days", 2)  # توصية جديدة ← إشعار للموظف
    assert sent, "لم يُرسل إشعار للجهاز عند رفع التوصية"
    assert sent[-1][1]["badge"] >= 1 and sent[-1][1]["url"].startswith("/")
    assert post(c, "/push/test").json()["ok"] is True
    post(c, "/push/unsubscribe", {"endpoint": sub["endpoint"]})
    with SessionLocal() as db:
        assert db.query(PushSubscription).count() == 0


def test_real_encrypted_delivery_and_gone_cleanup(world, monkeypatch):
    """إرسال حقيقي (توقيع VAPID + تشفير aes128gcm) إلى خدمة إشعارات محلية، وفك التشفير بمفتاح المتصفح."""
    import http_ece
    got = {}

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            n = int(self.headers.get("Content-Length", 0))
            got["body"], got["headers"] = self.rfile.read(n), {k.lower(): v for k, v in self.headers.items()}
            self.send_response(410 if self.path == "/gone" else 201)
            self.end_headers()

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    priv, p256, auth_b64, auth = _client_keys()
    jobs = []  # يُشغَّل الإرسال بعد إغلاق الجلسة كما يحدث في الخلفية على الخادم
    monkeypatch.setattr(push.threading, "Thread", lambda target, daemon: type("T", (), {"start": lambda self: jobs.append(target)})())
    with SessionLocal() as db:
        uid = db.query(User).filter_by(username="emp").one().id
        db.add(PushSubscription(user_id=uid, endpoint=f"http://127.0.0.1:{port}/ok", p256dh=p256, auth=auth_b64))
        db.commit()
        n = push.notify_user(db, uid, "اعتماد طلب", "تم اعتماد طلبك.", "/requests")
    jobs.pop()()
    assert n == 1
    assert got["headers"].get("content-encoding") == "aes128gcm" and got["headers"]["authorization"].startswith("vapid t=")
    data = json.loads(http_ece.decrypt(got["body"], private_key=priv, auth_secret=auth, version="aes128gcm"))
    assert data["title"] == "اعتماد طلب" and data["url"] == "/requests"
    with SessionLocal() as db:
        assert db.query(PushSubscription).one().last_ok is not None
        db.query(PushSubscription).delete()
        db.add(PushSubscription(user_id=uid, endpoint=f"http://127.0.0.1:{port}/gone", p256dh=p256, auth=auth_b64))
        db.commit()
        push.notify_user(db, uid, "x", "y", "/")
    jobs.pop()()
    with SessionLocal() as db:
        assert db.query(PushSubscription).count() == 0  # الاشتراك المنتهي (410) يُحذف تلقائياً
    srv.shutdown()

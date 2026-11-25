"""تطبيق الويب (PWA): ملف التعريف، وعامل الخدمة، والاشتراك في إشعارات الأجهزة."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import push
from .db import get_db
from .models import AppSetting, PushSubscription, User
from .web import ASSET_V, current_user

router = APIRouter()
STATIC = Path(__file__).parent / "static"


@router.get("/manifest.webmanifest")
def manifest(db: Session = Depends(get_db)):
    org = {s.key: s.value for s in db.scalars(select(AppSetting))}
    name = org.get("system_title") or "إتمام"
    data = {
        "name": f"{name} — {org.get('tagline') or 'إدارة أيام بدل الراحة'}",
        "short_name": name,
        "description": "نظام إدارة أيام بدل الراحة: الرصيد والتوصيات وطلبات معالجة الغياب والاعتمادات.",
        "lang": "ar", "dir": "rtl", "start_url": "/?source=app", "scope": "/", "id": "/",
        "display": "standalone", "background_color": "#f4f7fb", "theme_color": "#006bb6",
        "icons": [
            {"src": f"/static/icon-192.png?v={ASSET_V}", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": f"/static/icon-512.png?v={ASSET_V}", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": f"/static/icon-maskable-512.png?v={ASSET_V}", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }
    return Response(json.dumps(data, ensure_ascii=False), media_type="application/manifest+json")


@router.get("/sw.js")
def service_worker():
    # يُقدَّم من الجذر ليشمل نطاقه الموقع كله، ودون تخزين مؤقت حتى تصل تحديثاته فوراً
    return FileResponse(STATIC / "sw.js", media_type="text/javascript",
                        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})


@router.get("/push/key")
def push_key(user: User = Depends(current_user), db: Session = Depends(get_db)):
    _, pub = push.vapid_keys(db)
    count = len(list(db.scalars(select(PushSubscription.id).where(PushSubscription.user_id == user.id))))
    return JSONResponse({"key": pub, "devices": count})


@router.post("/push/subscribe")
def push_subscribe(request: Request, subscription: str = Form(...), device: str = Form(""),
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        push.subscribe(db, user.id, json.loads(subscription), device)
    except (ValueError, TypeError) as e:
        return JSONResponse({"ok": False, "error": str(e) or "اشتراك غير صالح."}, status_code=400)
    db.commit()
    return JSONResponse({"ok": True})


@router.post("/push/unsubscribe")
def push_unsubscribe(endpoint: str = Form(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    push.unsubscribe(db, user.id, endpoint)
    db.commit()
    return JSONResponse({"ok": True})


@router.post("/push/test")
def push_test(user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = push.notify_user(db, user.id, "إشعار تجريبي — إتمام", "تم تفعيل الإشعارات على هذا الجهاز بنجاح، وستصلك التنبيهات هنا.", "/profile")
    return JSONResponse({"ok": bool(n), "devices": n})

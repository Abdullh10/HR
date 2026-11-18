"""إرسال إشعارات البريد الإلكتروني (اختياري).

يعمل فقط إذا ضُبط خادم البريد عبر متغيرات البيئة:
HR_SMTP_HOST, HR_SMTP_PORT (587), HR_SMTP_USER, HR_SMTP_PASSWORD, HR_SMTP_FROM, HR_SMTP_TLS (1)
وبدونها تبقى الإشعارات داخل المنصة فقط.
"""
from __future__ import annotations

import logging
import os
import smtplib
import threading
from email.message import EmailMessage

log = logging.getLogger("hr.mail")


def enabled() -> bool:
    return bool(os.environ.get("HR_SMTP_HOST"))


def _send(to: str, subject: str, body: str) -> None:
    host = os.environ["HR_SMTP_HOST"]
    port = int(os.environ.get("HR_SMTP_PORT", "587"))
    user = os.environ.get("HR_SMTP_USER", "")
    pw = os.environ.get("HR_SMTP_PASSWORD", "")
    sender = os.environ.get("HR_SMTP_FROM") or user
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, to, subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(host, port, timeout=10) as s:
            if os.environ.get("HR_SMTP_TLS", "1") == "1":
                s.starttls()
            if user:
                s.login(user, pw)
            s.send_message(msg)
    except Exception:  # لا يتعطل النظام بسبب البريد
        log.exception("تعذّر إرسال البريد إلى %s", to)


def send(to: str, subject: str, body: str) -> bool:
    """يرسل في الخلفية؛ يعيد True إن كان البريد مفعّلاً والعنوان موجوداً."""
    if not enabled() or not to or "@" not in to:
        return False
    threading.Thread(target=_send, args=(to, subject, body), daemon=True).start()
    return True

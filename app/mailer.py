"""إرسال إشعارات البريد الإلكتروني (اختياري).

يعمل فقط إذا ضُبط خادم البريد عبر متغيرات البيئة:
  HR_SMTP_HOST, HR_SMTP_PORT (587), HR_SMTP_USER, HR_SMTP_PASSWORD,
  HR_SMTP_FROM (العنوان المرسِل، مثل no-reply@example.com),
  HR_SMTP_TLS: 1 = STARTTLS (الافتراضي، منفذ 587)، ssl = اتصال مشفّر مباشر (منفذ 465)، 0 = بلا تشفير.
  HR_BASE_URL (اختياري): رابط النظام في الرسائل، مثل https://example.com — وإلا يُؤخذ تلقائياً من أول زيارة.
وبدونها تبقى الإشعارات داخل المنصة فقط.

الرسالة متعددة الأجزاء: نص عادي + HTML بقالب رسمي (من اليمين لليسار) مع زر يفتح الصفحة المعنية في النظام.
"""
from __future__ import annotations

import html
import logging
import os
import smtplib
import threading
from datetime import datetime
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

log = logging.getLogger("hr.mail")

BASE_URL = ""  # يُضبط من أول طلب حقيقي يصل للنظام (انظر main.py)


def enabled() -> bool:
    return bool(os.environ.get("HR_SMTP_HOST"))


def base_url() -> str:
    return (os.environ.get("HR_BASE_URL") or BASE_URL or "").rstrip("/")


def remember_base_url(url: str) -> None:
    global BASE_URL
    if not os.environ.get("HR_BASE_URL"):
        BASE_URL = url.rstrip("/")


def config() -> dict:
    """ملخص الإعداد للعرض (بلا كلمة المرور)."""
    port = int(os.environ.get("HR_SMTP_PORT", "587") or 587)
    tls = os.environ.get("HR_SMTP_TLS", "1")
    mode = "ssl" if tls == "ssl" or port == 465 else ("starttls" if tls == "1" else "none")
    return dict(enabled=enabled(), host=os.environ.get("HR_SMTP_HOST", ""), port=port, mode=mode,
                user=os.environ.get("HR_SMTP_USER", ""),
                sender=os.environ.get("HR_SMTP_FROM") or os.environ.get("HR_SMTP_USER", ""),
                base_url=base_url(), base_url_fixed=bool(os.environ.get("HR_BASE_URL")))


def full_link(link: str) -> str:
    if not link:
        return ""
    if link.startswith(("http://", "https://")):
        return link
    b = base_url()
    return f"{b}{link if link.startswith('/') else '/' + link}" if b else ""


def compose(subject: str, body: str, link: str = "", org: dict | None = None) -> tuple[str, str]:
    """يعيد (النص العادي، HTML) للرسالة."""
    org = org or {}
    title = org.get("system_title") or "إتمام"
    entity = " · ".join(x for x in (org.get("college", ""), org.get("university", "")) if x)
    url = full_link(link)
    text = f"{subject}\n\n{body}\n"
    if url:
        text += f"\nلعرض التفاصيل في النظام: {url}\n"
    text += f"\n— نظام «{title}»{(' — ' + entity) if entity else ''}\nهذه رسالة آلية، يُرجى عدم الرد عليها."
    e = html.escape
    paras = "".join(f'<p style="margin:0 0 12px">{e(p).replace(chr(10), "<br>")}</p>'
                    for p in body.split("\n\n") if p.strip())
    button = (f'<p style="margin:22px 0 4px"><a href="{e(url)}" style="display:inline-block;background:#006BB6;'
              f'color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:bold">'
              f'عرض في النظام</a></p>') if url else ""
    home = base_url()
    htm = f"""<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#F5F7FA">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FA;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dde5ee;font-family:Tahoma,Arial,sans-serif;direction:rtl;text-align:right">
<tr><td style="background:#00427A;padding:18px 24px;border-bottom:4px solid #009FE3">
  <div style="color:#ffffff;font-size:22px;font-weight:bold">{e(title)}</div>
  <div style="color:#E6F2FB;font-size:13px;margin-top:4px">{e(entity)}</div>
</td></tr>
<tr><td style="padding:24px;color:#1b2733;font-size:15px;line-height:1.9">
  <h2 style="margin:0 0 14px;font-size:18px;color:#00427A">{e(subject)}</h2>
  {paras}{button}
</td></tr>
<tr><td style="padding:14px 24px;background:#F5F7FA;color:#5b6b7c;font-size:12px;line-height:1.8;border-top:1px solid #dde5ee">
  هذه رسالة آلية من نظام «{e(title)}»، يُرجى عدم الرد عليها.{(' للدخول إلى النظام: <a href="' + e(home) + '" style="color:#006BB6">' + e(home) + '</a>') if home else ''}
</td></tr>
</table></td></tr></table></body></html>"""
    return text, htm


def _message(to: str, subject: str, body: str, link: str, org: dict | None) -> EmailMessage:
    cfg = config()
    name, addr = parseaddr(cfg["sender"])
    sender = formataddr((name or (org or {}).get("system_title") or "إتمام", addr or cfg["sender"]))
    text, htm = compose(subject, body, link, org)
    title = (org or {}).get("system_title") or "إتمام"
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, to, f"[{title}] {subject}"
    msg.set_content(text)
    msg.add_alternative(htm, subtype="html")
    return msg


def _deliver(msg: EmailMessage) -> None:
    cfg = config()
    pw = os.environ.get("HR_SMTP_PASSWORD", "")
    if cfg["mode"] == "ssl":
        s = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=15)
    else:
        s = smtplib.SMTP(cfg["host"], cfg["port"], timeout=15)
    with s:
        if cfg["mode"] == "starttls":
            s.starttls()
        if cfg["user"]:
            s.login(cfg["user"], pw)
        s.send_message(msg)


def _record(ok: bool, to: str, err: str = "") -> None:
    """يحفظ آخر نتيجة إرسال ليراها الأدمن في صفحة إعدادات البريد."""
    try:
        from .db import SessionLocal
        from .models import AppSetting
        now = datetime.now().isoformat(timespec="seconds")
        with SessionLocal() as db:
            vals = {"mail_last_ok": f"{now}|{to}"} if ok else {"mail_last_error": f"{now}|{to}|{err[:300]}"}
            for k, v in vals.items():
                s = db.get(AppSetting, k) or AppSetting(key=k)
                s.value = v
                db.merge(s)
            db.commit()
    except Exception:  # noqa: BLE001
        log.exception("تعذّر حفظ حالة البريد")


def _send(to: str, subject: str, body: str, link: str, org: dict | None) -> None:
    try:
        _deliver(_message(to, subject, body, link, org))
        _record(True, to)
    except Exception as e:  # لا يتعطل النظام بسبب البريد
        log.exception("تعذّر إرسال البريد إلى %s", to)
        _record(False, to, f"{type(e).__name__}: {e}")


def send(to: str, subject: str, body: str, link: str = "", org: dict | None = None) -> bool:
    """يرسل في الخلفية؛ يعيد True إن كان البريد مفعّلاً والعنوان موجوداً."""
    if not enabled() or not to or "@" not in to:
        return False
    threading.Thread(target=_send, args=(to, subject, body, link, org), daemon=True).start()
    return True


def send_now(to: str, subject: str, body: str, link: str = "", org: dict | None = None) -> tuple[bool, str]:
    """إرسال فوري (لزر «إرسال بريد تجريبي»): يعيد (نجح؟، رسالة الخطأ)."""
    if not enabled():
        return False, "البريد غير مفعّل: لم يُضبط خادم البريد (HR_SMTP_HOST) في إعدادات الخادم."
    if not to or "@" not in to:
        return False, "عنوان البريد غير صحيح."
    try:
        _deliver(_message(to, subject, body, link, org))
    except Exception as e:  # noqa: BLE001
        _record(False, to, f"{type(e).__name__}: {e}")
        return False, f"{type(e).__name__}: {e}"
    _record(True, to)
    return True, ""


def last_status(settings: dict) -> dict:
    def split(v, n):
        parts = (v or "").split("|", n - 1)
        return parts + [""] * (n - len(parts)) if v else None
    ok, err = split(settings.get("mail_last_ok"), 2), split(settings.get("mail_last_error"), 3)
    return dict(ok=dict(at=ok[0].replace("T", " "), to=ok[1]) if ok else None,
                error=dict(at=err[0].replace("T", " "), to=err[1], msg=err[2]) if err else None,
                error_is_latest=bool(err and (not ok or err[0] > ok[0])))

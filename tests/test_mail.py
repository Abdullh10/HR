"""إشعارات البريد: القالب الرسمي والرابط المباشر، والإرسال الفعلي عبر خادم SMTP محلي، وصفحة الإعدادات."""
import email
import email.policy
import time

import pytest

from app import mailer
from app.db import SessionLocal
from app.models import Employee, LeaveRequest

from .conftest import login, post

ORG = {"system_title": "إتمام", "college": "كلية التمريض", "university": "جامعة الملك سعود"}


def test_compose_has_link_and_official_template(monkeypatch):
    monkeypatch.setattr(mailer, "BASE_URL", "https://itmam.example")
    text, htm = mailer.compose("اعتماد طلب", "اعتُمد طلبك.\n\nسطر ثانٍ <b>", "/requests", ORG)
    assert "https://itmam.example/requests" in text and "https://itmam.example/requests" in htm
    assert 'dir="rtl"' in htm and "عرض في النظام" in htm and "كلية التمريض" in htm
    assert "&lt;b&gt;" in htm  # النص يُهرَّب


@pytest.fixture()
def smtp_sink(monkeypatch):
    aiosmtpd = pytest.importorskip("aiosmtpd.controller")

    class Box:
        msgs = []

        async def handle_DATA(self, server, session, envelope):  # noqa: N802
            Box.msgs.append(email.message_from_bytes(envelope.content, policy=email.policy.default))
            return "250 OK"

    ctl = aiosmtpd.Controller(Box(), hostname="127.0.0.1", port=8026)
    ctl.start()
    monkeypatch.setenv("HR_SMTP_HOST", "127.0.0.1")
    monkeypatch.setenv("HR_SMTP_PORT", "8026")
    monkeypatch.setenv("HR_SMTP_TLS", "0")
    monkeypatch.setenv("HR_SMTP_FROM", "no-reply@itmam.example")
    monkeypatch.setenv("HR_BASE_URL", "https://itmam.example")
    yield Box.msgs
    ctl.stop()


def _wait(msgs, n, timeout=5):
    end = time.time() + timeout
    while len(msgs) < n and time.time() < end:
        time.sleep(0.05)
    return msgs


def test_admin_test_mail_and_status(world, smtp_sink):
    adm = login("admin")
    page = adm.get("/admin/mail").text
    assert "مفعّل" in page and "127.0.0.1:8026" in page
    post(adm, "/admin/mail/test", {"to": "admin@example.com"})
    assert len(smtp_sink) == 1
    m = smtp_sink[0]
    assert "رسالة تجريبية" in str(m["Subject"])
    assert "no-reply@itmam.example" in m["From"]
    assert {p.get_content_type() for p in m.walk()} >= {"text/plain", "text/html"}
    page = adm.get("/admin/mail").text
    assert "admin@example.com" in page  # آخر إرسال ناجح ظاهر
    assert "عرض في النظام" in adm.get("/admin/mail/preview").text


def test_failure_is_shown(world, monkeypatch):
    monkeypatch.setenv("HR_SMTP_HOST", "127.0.0.1")
    monkeypatch.setenv("HR_SMTP_PORT", "9")  # لا يوجد خادم
    monkeypatch.setenv("HR_SMTP_TLS", "0")
    adm = login("admin")
    r = post(adm, "/admin/mail/test", {"to": "admin@example.com"})
    page = adm.get(r.headers["location"]).text
    assert "تعذّر الإرسال" in page and "آخر محاولة فشلت" in page


def test_decision_notification_email_has_direct_link(world, smtp_sink):
    with SessionLocal() as db:
        db.get(Employee, world["e"]).email = "emp@example.com"
        db.commit()
    mgr, emp = login("mgr"), login("emp")
    post(mgr, "/recommendations/new", {"emp": str(world["e"]), "kind": "days", "amount": "3", "rec_date": "2027-02-10"})
    from datetime import date
    post(emp, "/requests/new", {"emp": str(world["e"]), "kind": "use", "unit": "days", "start_date": str(date(2027, 3, 1)),
                                "end_date": str(date(2027, 3, 1)), "reason": "سبب"})
    with SessionLocal() as db:
        rid = db.query(LeaveRequest).one().id
    before = len(smtp_sink)
    post(mgr, f"/requests/{rid}/decide", {"action": "approve"})
    msgs = _wait(smtp_sink, before + 1)
    to_emp = [m for m in msgs if m["To"] == "emp@example.com"]
    assert to_emp, [m["To"] for m in msgs]
    htm = next(p for p in to_emp[-1].walk() if p.get_content_type() == "text/html").get_content()
    assert "https://itmam.example/" in htm and "عرض في النظام" in htm

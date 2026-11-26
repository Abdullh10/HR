"""تسميات عربية لسجل التدقيق: العمليات والكيانات وحقول التفاصيل (للعرض والتصدير فقط؛ المخزّن يبقى رموزاً)."""
from __future__ import annotations

import json

ACTIONS = {
    "login": "تسجيل دخول",
    "login_failed": "محاولة دخول فاشلة",
    "logout": "تسجيل خروج",
    "password_changed": "تغيير كلمة المرور",
    "password_reset": "إعادة تعيين كلمة المرور",
    "profile_updated": "تحديث الملف الشخصي",
    "user_saved": "إنشاء/تعديل حساب",
    "users_bulk_created": "إنشاء حسابات دفعة واحدة",
    "login_cards_printed": "طباعة بطاقات الدخول",
    "employee_created": "إضافة موظف",
    "employee_updated": "تعديل بيانات موظف",
    "employee_deleted": "حذف موظف أُدخل بالخطأ",
    "employees_imported": "استيراد موظفين",
    "recommendation_added": "رفع توصية",
    "recommendation_cancelled": "إلغاء توصية",
    "leave_requested": "تقديم طلب معالجة غياب",
    "leave_approved": "اعتماد طلب",
    "leave_rejected": "رفض طلب",
    "leave_cancelled": "إلغاء طلب",
    "message_sent": "إرسال رسالة",
    "department_saved": "حفظ قسم",
    "department_merged": "دمج أقسام",
    "holiday_added": "إضافة عطلة رسمية",
    "holiday_deleted": "حذف عطلة رسمية",
    "year_saved": "حفظ إعدادات السنة",
    "year_activated": "تفعيل سنة",
    "year_locked": "إقفال سنة",
    "year_unlocked": "فتح سنة",
    "settings_saved": "حفظ هوية الجهة",
    "mail_test": "إرسال بريد تجريبي",
    "backup_downloaded": "تنزيل نسخة احتياطية",
    "auto_backup": "نسخة احتياطية تلقائية",
    "backup_restored": "استعادة نسخة احتياطية",
    "restore_denied": "رفض استعادة (كلمة مرور خاطئة)",
    "all_data_wiped": "حذف جميع البيانات",
    "wipe_denied": "رفض حذف البيانات (كلمة مرور خاطئة)",
    "archive_exported": "تصدير أرشيف السنة",
    "data_exported": "تصدير بيانات إلى Excel",
    "audit_exported": "تصدير سجل التدقيق",
    "leave_escalated": "تصعيد طلب متأخر لمدير النظام",
    "reminder_sent": "إرسال تذكير بالرصيد",
    "audit_cleared": "حذف من سجل التدقيق",
    "audit_clear_denied": "رفض حذف سجل التدقيق (كلمة مرور خاطئة)",
    "team_transferred": "نقل فريق بين المسؤولين",
    "delegation_created": "إنشاء تفويض",
    "delegation_cancelled": "إلغاء تفويض",
}

ENTITIES = {
    "user": "حساب", "employee": "موظف", "recommendation": "توصية", "leave_request": "طلب",
    "message": "رسالة", "department": "قسم", "holiday": "عطلة", "fiscal_year": "سنة",
    "settings": "الإعدادات", "system": "النظام", "archive": "الأرشيف", "login_card": "بطاقة دخول",
    "export": "تصدير",
    "delegation": "تفويض", "team": "فريق",
}

FIELDS = {
    "employee": "الموظف", "employee_id": "رقم سجل الموظف", "kind": "النوع", "unit": "الوحدة", "days": "أيام",
    "hours": "ساعات", "amount": "المقدار", "note": "الملاحظة", "reason": "السبب", "username": "اسم المستخدم",
    "role": "الدور", "count": "العدد", "file": "الملف", "batch": "الدفعة", "prev": "الحالة السابقة",
    "previous": "الحالة السابقة", "on_behalf": "بالنيابة", "to": "إلى", "ok": "النتيجة", "error": "الخطأ",
    "fields": "الحقول", "active": "نشط", "assigned": "عدد المسندين", "unassigned": "أُلغي إسنادهم",
    "by": "بواسطة", "auto_backup": "النسخة التلقائية", "year": "السنة", "rows": "عدد الصفوف",
    "created": "أُنشئ", "updated": "حُدّث", "before": "قبل", "after": "بعد", "auto": "تلقائي",
    "name": "الاسم", "subject": "الموضوع", "filters": "عوامل التصفية",
    "delegated": "بالتفويض", "from": "من", "start": "من تاريخ", "end": "إلى تاريخ", "moved": "عدد المنقولين",
    "pending_requests": "طلبات معلّقة انتقلت", "scope": "النطاق", "notify_employees": "إشعار الموظفين",
}

VALUES = {True: "نعم", False: "لا", "approved": "معتمد", "pending": "بانتظار الاعتماد", "rejected": "مرفوض",
          "cancelled": "ملغى", "days": "أيام", "hours": "ساعات", "use": "معالجة غياب", "employee": "موظف",
          "officer": "شؤون الموظفين", "admin": "مدير النظام", "wrong_password": "كلمة مرور خاطئة"}


def action_label(code: str) -> str:
    return ACTIONS.get(code, code)


def entity_label(code: str) -> str:
    return ENTITIES.get(code, code)


def _val(v) -> str:
    if isinstance(v, (list, tuple)):
        return "، ".join(_val(x) for x in v)
    if isinstance(v, dict):
        return "، ".join(f"{FIELDS.get(k, k)}: {_val(x)}" for k, x in v.items() if x not in (None, "", [], {}))
    try:
        return VALUES.get(v, str(v))
    except TypeError:
        return str(v)


def details_text(raw: str) -> str:
    if not raw:
        return ""
    try:
        d = json.loads(raw)
    except (ValueError, TypeError):
        return raw
    if not isinstance(d, dict):
        return str(d)
    return " · ".join(f"{FIELDS.get(k, k)}: {_val(v)}" for k, v in d.items() if v not in (None, "", [], {}))

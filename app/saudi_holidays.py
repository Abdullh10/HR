"""العطل الرسمية في المملكة العربية السعودية: تواريخ مقترحة يراجعها مدير النظام ويعدّلها قبل الحفظ.

- يوم التأسيس (22 فبراير) واليوم الوطني (23 سبتمبر): تاريخان ميلاديان ثابتان.
- عيدا الفطر والأضحى: بحسب تقويم أم القرى (تقديري؛ قد يتغير بيوم وفق الرؤية الشرعية)، ومدة عطلة القطاع
  الحكومي يحددها تعميم وزارة الموارد البشرية كل عام، فتُعرض المدة المقترحة قابلة للتعديل.
"""
from __future__ import annotations

from datetime import date, timedelta

# 1 شوال ويوم عرفة (9 ذو الحجة) وفق تقويم أم القرى
HIJRI_ANCHORS = {
    2026: {"fitr": date(2026, 3, 20), "arafah": date(2026, 5, 26)},   # 1447هـ
    2027: {"fitr": date(2027, 3, 9), "arafah": date(2027, 5, 15)},    # 1448هـ
    2028: {"fitr": date(2028, 2, 26), "arafah": date(2028, 5, 4)},    # 1449هـ
}
# فترات أعلنتها وزارة الموارد البشرية لمنسوبي سلالم الخدمة المدنية (تُستخدم بدل المقترح الافتراضي)
ANNOUNCED = {
    (2026, "fitr"): (date(2026, 3, 13), date(2026, 3, 24)),  # من نهاية دوام الخميس 23 رمضان إلى نهاية الثلاثاء 5 شوال 1447هـ
}
NAMES = {"founding": "يوم التأسيس", "fitr": "عيد الفطر", "adha": "عيد الأضحى", "national": "اليوم الوطني"}


def presets(year: int) -> list[dict]:
    """قائمة العطل المقترحة لسنة ميلادية: (المفتاح، الاسم، من، إلى، ملاحظة)."""
    out = [dict(key="founding", name=NAMES["founding"], start=date(year, 2, 22), end=date(year, 2, 22),
                note="22 فبراير من كل عام.")]
    a = HIJRI_ANCHORS.get(year)
    if a:
        f = ANNOUNCED.get((year, "fitr"))
        out.append(dict(key="fitr", name=NAMES["fitr"], start=f[0] if f else a["fitr"], end=f[1] if f else a["fitr"] + timedelta(days=3),
                        note=("وفق إعلان وزارة الموارد البشرية للقطاع الحكومي." if f else
                              f"1 شوال المتوقع {a['fitr']:%Y-%m-%d} (أم القرى). المقترح 4 أيام؛ عدّلها حسب تعميم الوزارة للقطاع الحكومي.")))
        out.append(dict(key="adha", name=NAMES["adha"], start=a["arafah"], end=a["arafah"] + timedelta(days=3),
                        note=f"يوم عرفة المتوقع {a['arafah']:%Y-%m-%d} (أم القرى). المقترح من عرفة إلى 12 ذو الحجة؛ عدّلها حسب تعميم الوزارة."))
    out.append(dict(key="national", name=NAMES["national"], start=date(year, 9, 23), end=date(year, 9, 23),
                    note="23 سبتمبر من كل عام."))
    return out


def supported_years() -> list[int]:
    return sorted(HIJRI_ANCHORS)

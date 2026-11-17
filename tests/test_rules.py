from app.services import compute_earned, days_ar, hours_ar


def test_earned_days_boundaries():
    assert compute_earned(6.99, 7) == (0, 6.99)
    assert compute_earned(7, 7) == (1, 0)
    assert compute_earned(14.5, 7) == (2, 0.5)
    assert compute_earned(0.1 + 0.2 + 6.7, 7) == (1, 0)  # تفادي أخطاء الفاصلة العائمة
    assert compute_earned(10, 0) == (0, 0)


def test_arabic_plurals():
    assert days_ar(1) == "يوم واحد"
    assert days_ar(2) == "يومان"
    assert days_ar(3) == "3 أيام"
    assert days_ar(10) == "10 أيام"
    assert days_ar(11) == "11 يوماً"
    assert days_ar(0) == "لا يوجد"
    assert hours_ar(2) == "ساعتان"
    assert hours_ar(7) == "7 ساعات"
    assert hours_ar(6.5) == "6.5 ساعة"

"""هندسة رسوم لوحة المتابعة الإدارية: الحلقة (دائرة محيطها 100 وحدة) والأعمدة الشهرية — كل الحساب هنا لا في Jinja."""

import math

R = 15.9155          # 2πr = 100 ⇒ وحدة المحيط = 1٪
CX = CY = 24         # viewBox 0 0 48 48
GAP = 0.8            # فاصل بلون السطح بين الشرائح (≈ 3px عند عرض 200px)
LABEL_R = 21.6       # نصف قطر أرقام الشرائح خارج الحلقة
MAX_SLOTS = 8        # ثمانية ألوان فئوية + «أخرى»


def pct_largest_remainder(values: list[float]) -> list[int]:
    """نسب صحيحة مجموعها 100 بالضبط (طريقة الباقي الأكبر)."""
    total = sum(values)
    if not total:
        return [0] * len(values)
    raw = [v * 100 / total for v in values]
    out = [math.floor(x) for x in raw]
    for i in sorted(range(len(raw)), key=lambda i: raw[i] - out[i], reverse=True)[: 100 - sum(out)]:
        out[i] += 1
    return out


def dept_slots(dept_ids_by_size: list[int]) -> dict[int, str]:
    """يُسند لون كل قسم مرة واحدة لكل سنة (أكبر 8 أقسام على مستوى الجهة، بترتيب ثابت) — اللون يتبع القسم لا رتبته
    ولا يتغيّر بتغيير فلتر القسم. ما زاد عن 8 يُجمع في «أخرى»."""
    return {d: f"sv-c{i + 1}" for i, d in enumerate(dept_ids_by_size[:MAX_SLOTS])}


def donut_parts(rows: list[dict], other_label: str = "أخرى") -> dict:
    """rows: [{key, label, value, cls?}] بالترتيب الثابت للرسم. يُرجع d.parts و d.total لماكرو donut().
    cls مفقود ⇒ الصف يُطوى في «أخرى». الشريحة «أخرى» دائماً الأخيرة، رمادية ومخطّطة (تمييز بغير اللون)."""
    own = [r for r in rows if r.get("cls")]
    rest = [r for r in rows if not r.get("cls")]
    if rest:
        own.append({"key": "other", "label": other_label, "value": sum(r["value"] for r in rest),
                    "cls": "sv-c-other", "hatch": True, "members": [r["label"] for r in rest]})
    total = sum(r["value"] for r in own)
    pcts = pct_largest_remainder([r["value"] for r in own])
    nz = sum(1 for r in own if r["value"] > 0)
    gap = GAP if nz > 1 else 0
    parts, cum = [], 0.0
    for i, (r, p) in enumerate(zip(own, pcts)):
        length = r["value"] / total * 100 if total else 0
        dash = max(length - gap, 0.01)
        mid = (cum + length / 2) / 100 * 2 * math.pi   # زاوية منتصف الشريحة من الساعة 12 باتجاه اليسار
        parts.append({
            **r, "pct": p, "n": i + 1, "hatch": r.get("hatch", False),
            "dash": round(dash, 3), "gap_rest": round(100 - dash, 3), "off": round(25 - cum, 3),
            "lx": round(CX - LABEL_R * math.sin(mid), 2), "ly": round(CY - LABEL_R * math.cos(mid), 2),
            "show_n": length >= 5,   # الأرقام للشرائح ≥ 5٪ فقط (لا ازدحام)
        })
        cum += length
    return {"parts": parts, "total": total}


def month_series(months: list[dict], keys: list[str]) -> list[dict]:
    """يضيف pct لكل سلسلة على مقياس واحد مشترك (أعلى قيمة بين كل السلاسل = 100٪) — محور واحد دائماً."""
    top = max([m["vals"][k] for m in months for k in keys] + [1])
    for m in months:
        m["pct"] = {k: round(m["vals"][k] / top * 100, 1) for k in keys}
    return months

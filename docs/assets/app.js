/* «إتمام» — نسخة العرض (تعمل في المتصفح فقط، والبيانات في localStorage) */
(function () {
  "use strict";

  // ============================================================ أدوات
  const KEY = "hr_demo_v5";
  const CREDIT = "تصميم وتطوير: مريم حمدي";
  const TAGLINE = "إدارة أيام بدل الراحة";
  const $app = document.getElementById("app");
  const ROLES = { admin: "مدير النظام", officer: "شؤون الموظفين", employee: "موظف" };
  const ASSIGNABLE = ["employee", "officer"];
  const WD = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const REQ_ST = { pending: "بانتظار الاعتماد", approved: "معتمد", rejected: "مرفوض", cancelled: "ملغى" };
  const REC_KINDS = { days: "بدل راحة بالأيام", hours: "بدل راحة بالساعات" };
  const LEAVE_KINDS = { use: "معالجة غياب", compensation: "تعويض غياب" };
  const STAFF = ["admin", "officer"];
  const DEMO_PW = "Demo12345";

  const h = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const n = (v) => (v == null || v === "" ? "" : String(Math.round(Number(v) * 100) / 100));
  const todayISO = () => { const d = new Date(); return iso(d); };
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const parseISO = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return null; const [y, m, d] = s.split("-").map(Number); const dt = new Date(y, m - 1, d); return dt.getMonth() === m - 1 ? dt : null; };
  const weekday = (s) => parseISO(s).getDay();
  const nowStr = () => { const d = new Date(); return iso(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  const norm = (s) => String(s || "").replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
  const toNum = (s) => { if (s == null || String(s).trim() === "") return null; const v = Number(String(s).trim().replace("٫", ".").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))); return isNaN(v) ? null : v; };
  const rand = () => Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6).toUpperCase() + Math.floor(Math.random() * 90 + 10);
  const round2 = (v) => Math.round(v * 100) / 100;
  async function sha(s) {
    try { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("hr-demo:" + s)); return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join(""); }
    catch (e) { let x = 0; for (const c of "hr-demo:" + s) x = (x * 31 + c.charCodeAt(0)) | 0; return "w" + x; }
  }
  function daysAr(v) { v = Math.trunc(v); if (v === 0) return "لا يوجد"; if (v === 1) return "يوم واحد"; if (v === 2) return "يومان"; if (v >= 3 && v <= 10) return v + " أيام"; return v + " يوماً"; }
  function hoursAr(v) { v = Math.round(v * 100) / 100; if (v === 0) return "لا توجد ساعات"; if (v === 1) return "ساعة واحدة"; if (v === 2) return "ساعتان"; if (Number.isInteger(v) && v >= 3 && v <= 10) return v + " ساعات"; return v + " ساعة"; }
  class RuleError extends Error {}

  // ============================================================ التخزين
  let DB = null;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { toast("تعذّر الحفظ في المتصفح (قد تكون المساحة ممتلئة أو التصفح خاصاً).", "error"); } }
  function load() { try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch (e) {} return null; }
  const nid = () => (DB.seq = (DB.seq || 0) + 1);
  // رقم صادر دائم بصيغة موحدة PREFIX-السنة-تسلسل؛ العدّاد في DB.counters ولا يُمسح عند «حذف جميع البيانات»
  function assignRef(obj, prefix) { const yr = String(obj.created || nowStr()).slice(0, 4), k = prefix + "_" + yr; DB.counters = DB.counters || {}; DB.counters[k] = (DB.counters[k] || 0) + 1; obj.ref = prefix + "-" + yr + "-" + String(DB.counters[k]).padStart(4, "0"); return obj.ref; }
  const byId = (arr, id) => DB[arr].find((x) => x.id === Number(id));
  function audit(action, entity, entityId, details) {
    const u = me();
    DB.audit.unshift({ id: nid(), at: nowStr(), user: u ? u.username : "", action, entity, entityId: entityId || null, details: details ? JSON.stringify(details) : "" });
    if (DB.audit.length > 3000) DB.audit.length = 3000;
  }

  async function seed() {
    const Y = new Date().getFullYear(); // بيانات العرض على السنة الميلادية الحالية
    const pw = await sha(DEMO_PW);
    const db = { seq: 0, settings: { university: "جامعة الملك سعود", college: "كلية التمريض", system_title: "إتمام", tagline: TAGLINE, credit: CREDIT },
      years: [], depts: [], emps: [], users: [], recs: [], leaves: [], msgs: [], holidays: [], audit: [] };
    DB = db;
    db.years.push({ id: nid(), name: String(Y), start: Y + "-01-01", end: Y + "-12-31", active: true, locked: false, cap: 20, hpd: 7,
      reqRecAtt: false, reqReqAtt: false, weekend: [5, 6], blockWeekends: true, allowLateCancel: false, empCanRequest: true, empCanSubmitRec: true });
    const depts = ["وحدة الشؤون الإدارية", "وحدة المعامل", "العلاقات العامة", "وكالة الشؤون الأكاديمية"];
    depts.forEach((name) => db.depts.push({ id: nid(), name, active: true }));
    const D = (i) => db.depts[i].id;
    // [الرقم، الاسم، القسم، رقم مسؤول شؤون الموظفين، المسمى، البريد]
    const people = [
      ["100100", "سارة عبدالله المطيري", 0, null, "إدارية — شؤون الموظفين", "sara@example.com"],
      ["100200", "عبدالرحمن علي الزهراني", 1, null, "مسؤول شؤون الموظفين — وحدة المعامل", "abdulrahman@example.com"],
      ["100101", "نوف محمد القحطاني", 0, "100100", "أخصائية إدارية", "nouf@example.com"],
      ["100102", "خالد سعد الدوسري", 0, "100100", "منسق إداري", ""],
      ["100103", "ريم فهد الشمري", 0, "100100", "سكرتيرة", ""],
      ["100301", "فيصل تركي العتيبي", 2, "100100", "منسق فعاليات", ""],
      ["100401", "بندر عبدالعزيز الشهري", 3, "100100", "منسق أكاديمي", ""],
      ["100201", "منيرة ناصر العنزي", 1, "100200", "فنية مختبر", ""],
      ["100202", "ماجد حمد الحربي", 1, "100200", "فني مختبر", ""],
      ["100400", "لمى سلطان الغامدي", 3, null, "منسقة أكاديمية", ""],
    ];
    const byNo = {};
    people.forEach(([no, name, di, , title, email]) => { const e = { id: nid(), no, name, dept: D(di), mgr: null, title, email, active: true }; db.emps.push(e); byNo[no] = e; });
    people.forEach(([no, , , mgr]) => { if (mgr) byNo[no].mgr = byNo[mgr].id; });
    const addU = (username, role, emp) => { const u = { id: nid(), username, pw, role, emp: emp ? emp.id : null, active: true, mustChange: false, last: null }; db.users.push(u); return u; };
    const admin = addU("admin", "admin", null);
    const off = addU("officer", "officer", byNo["100100"]);
    const off2 = addU("officer2", "officer", byNo["100200"]);
    const emp = addU("emp", "employee", byNo["100101"]);
    addU("100102", "employee", byNo["100102"]);
    const y = db.years[0].id;
    const REC = (no, kind, amount, date, subject, ref, by) => db.recs.push({ id: nid(), emp: byNo[no].id, year: y, kind, amount, date, ref: ref || "", subject, status: "active", att: "توصية.pdf", by: by.id, cancelNote: "", created: date + " 10:00" });
    REC("100101", "days", 2, Y + "-01-17", "المراقبة في الاختبارات النهائية للفصل الأول", "ت/112", off);
    REC("100101", "hours", 17.5, Y + "-02-08", "تنظيم ملتقى التمريض السنوي", "ت/140", off);
    REC("100101", "days", 3, Y + "-03-03", "لجنة الاعتماد الأكاديمي", "ت/171", off);
    REC("100102", "days", 4, Y + "-01-20", "جرد العهد السنوي", "ت/118", off);
    REC("100103", "hours", 10, Y + "-02-14", "حفل الخريجات", "ت/151", off);
    REC("100301", "days", 18, Y + "-02-02", "تنظيم مؤتمر الكلية", "ت/133", off);
    REC("100201", "hours", 21, Y + "-01-25", "تجهيز المعامل للاختبارات العملية", "ت/126", off2);
    REC("100202", "days", 2, Y + "-02-22", "مناوبة المعامل", "ت/160", off2);
    const LV = (no, kind, unit, start, end, days, hours, reason, status, by, dec) => db.leaves.push({ id: nid(), emp: byNo[no].id, year: y, kind, unit, start, end: end || start, days, hours, reason, status, att: "", by: by.id,
      decidedBy: status === "pending" ? null : dec.id, decidedAt: status === "pending" ? null : start + " 12:00", note: status === "rejected" ? "ضغط عمل في الوحدة" : "", created: start + " 08:30" });
    LV("100101", "use", "days", Y + "-02-01", Y + "-02-01", 1, 0, "ظرف عائلي", "approved", emp, off);
    LV("100101", "use", "days", Y + "-03-10", Y + "-03-10", 1, 0, "موعد طبي", "approved", emp, off);
    LV("100101", "compensation", "days", Y + "-03-16", Y + "-03-16", 1, 0, "غياب اضطراري", "pending", emp, null);
    LV("100102", "use", "days", Y + "-03-21", Y + "-03-22", 2, 0, "سفر", "pending", byNo["100102"] && db.users[4], null);
    LV("100201", "compensation", "days", Y + "-02-10", null, 1, 0, "غياب طارئ", "approved", off2, off2);
    const MSG = (from, to, subject, body, at, read) => db.msgs.push({ id: nid(), from: from ? from.id : null, to: to.id, subject, body, at, read: !!read, link: "" });
    MSG(admin, off, "تعميم: رفع توصيات الفصل الأول", "نأمل رفع توصيات بدل الراحة الخاصة بأعمال الاختبارات النهائية للفصل الأول قبل نهاية الشهر، مع إرفاق خطاب التوصية بصيغة PDF.\n\nمع الشكر.", Y + "-01-10 09:00", true);
    MSG(off, emp, "تمت إضافة توصية جديدة", "أُضيفت إلى رصيدك توصية بمنحك ثلاثة أيام بدل راحة (لجنة الاعتماد الأكاديمي). يمكنك الاطلاع على الإشعار وطباعته من صفحة رصيدك.", Y + "-03-03 10:05", false);
    MSG(emp, off, "استفسار عن رصيد الساعات", "السلام عليكم، هل يمكن استخدام رصيد الساعات لساعتين نهاية الدوام يوم الخميس؟", Y + "-03-05 13:20", false);
    db.holidays.push({ id: nid(), day: Y + "-02-22", name: "يوم التأسيس" });
    DB = db;
    db.recs.forEach((x) => { x.refNo = x.ref; x.ref = ""; assignRef(x, "REC"); });
    db.leaves.forEach((x) => assignRef(x, "REQ"));
    save();
  }

  // ============================================================ الجلسة
  const me = () => { const id = Number(sessionStorage.getItem("hr_uid") || 0); const u = DB && DB.users.find((x) => x.id === id && x.active); return u || null; };
  const empOf = (u) => (u && u.emp ? byId("emps", u.emp) : null);
  const displayName = (u) => { if (!u) return "إشعار النظام"; const e = empOf(u); return e ? e.name : (u.name || u.username); };
  // التحقق من بيانات التواصل (مطابق للخادم)
  const DIG = (s) => String(s || "").replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c));
  function cleanEmail(v) { v = String(v || "").trim(); if (v && (v.length > 160 || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v))) throw new RuleError("البريد الإلكتروني غير صحيح."); return v.toLowerCase(); }
  function cleanPhone(v) { v = DIG(v).replace(/[\s\-()]/g, ""); if (!v) return ""; v = v.replace(/^(\+|00)/, ""); if (v.startsWith("966")) v = v.slice(3); if (v.startsWith("5") && v.length === 9) v = "0" + v; if (!/^05\d{8}$/.test(v)) throw new RuleError("رقم الجوال غير صحيح. اكتبه بصيغة 05XXXXXXXX."); return v; }
  function cleanExt(v) { v = DIG(v).replace(/\s/g, ""); if (v && !/^\d{2,6}$/.test(v)) throw new RuleError("رقم التحويلة يجب أن يكون من 2 إلى 6 أرقام."); return v; }
  const activeYear = () => DB.years.find((y) => y.active) || DB.years[0];
  const yearFor = (d) => DB.years.find((y) => y.start <= d && d <= y.end) || null;
  const deptName = (e) => { const d = e && e.dept ? byId("depts", e.dept) : null; return d ? d.name : ""; };
  const mgrName = (e) => { const m = e && e.mgr ? byId("emps", e.mgr) : null; return m ? m.name : ""; };
  const isTmp = (e) => String(e.no).startsWith("TMP-");
  const userOfEmp = (e) => DB.users.find((u) => u.emp === e.id && u.active) || null;

  // ============================================================ قواعد العمل
  function earned(hours, hpd) { if (hpd <= 0) return [0, 0]; const q = Math.round((hours / hpd) * 1e9) / 1e9; const d = Math.floor(q); return [d, Math.round((hours - d * hpd) * 100) / 100]; }
  // الرصيد: يُمنح بالتوصيات (أيام وساعات) ويُستهلك بالطلبات المعتمدة؛ الحد الأقصى السنوي للأيام والساعات معاً
  // توزيع الاستهلاك: طلبات الأيام تُخصم من رصيد الأيام أولاً، وما زاد يُحوَّل من الساعات (كل hpd ساعات = يوم)
  function allocate(hpd, gD, gH, aD, aH, pD, pH) {
    const fa = Math.min(aD, gD), ca = aD - fa, fp = Math.min(pD || 0, gD - fa), cp = (pD || 0) - fp;
    return { uDays: fa, uHours: round2(aH + ca * hpd), convA: ca, pDays: fp, pHours: round2((pH || 0) + cp * hpd), convP: cp };
  }
  function balance(empId, year, excludeRec) {
    const hpd = year.hpd;
    const recs = DB.recs.filter((r) => r.emp === empId && r.year === year.id && r.status === "active" && r.id !== excludeRec);
    const lv = DB.leaves.filter((r) => r.emp === empId && r.year === year.id);
    const sum = (arr, f) => arr.reduce((s, x) => s + Number(f(x) || 0), 0);
    const gDays = sum(recs.filter((r) => r.kind === "days"), (r) => r.amount), gHours = round2(sum(recs.filter((r) => r.kind === "hours"), (r) => r.amount));
    const aD = sum(lv.filter((r) => r.unit === "days" && r.status === "approved"), (r) => r.days), aH = sum(lv.filter((r) => r.unit === "hours" && r.status === "approved"), (r) => r.hours);
    const pD = sum(lv.filter((r) => r.unit === "days" && r.status === "pending"), (r) => r.days), pH = sum(lv.filter((r) => r.unit === "hours" && r.status === "pending"), (r) => r.hours);
    const al = allocate(hpd, gDays, gHours, aD, aH, pD, pH);
    const b = { hpd, cap: year.cap, gDays, gHours, uDays: al.uDays, uHours: al.uHours, pDays: al.pDays, pHours: al.pHours, convA: al.convA, convP: al.convP, taken: aD, rawAH: aH };
    b.daysLeft = b.gDays - b.uDays; b.hoursLeft = round2(b.gHours - b.uHours);
    b.daysAvail = b.daysLeft - b.pDays; b.hoursAvail = round2(b.hoursLeft - b.pHours);
    [b.hAsDays, b.hRem] = earned(Math.max(b.hoursLeft, 0), hpd);
    b.bookable = Math.max(b.daysAvail, 0) + earned(Math.max(b.hoursAvail, 0), hpd)[0];
    b.bookableFromHours = Math.max(b.bookable - Math.max(b.daysAvail, 0), 0);
    b.hAvailRem = earned(Math.max(b.hoursAvail, 0), hpd)[1];
    b.totalHours = round2(b.daysLeft * hpd + b.hoursLeft);
    [b.totalDays, b.totalRem] = earned(Math.max(b.totalHours, 0), hpd);
    b.grantedEq = round2(b.gDays + b.gHours / hpd);
    b.usedEq = round2(b.taken + b.rawAH / hpd);
    b.capLeftHours = round2(b.cap * hpd - (b.gDays * hpd + b.gHours));
    b.capPct = b.cap > 0 ? Math.min(100, Math.round((b.grantedEq / b.cap) * 100)) : 0;
    const granted = b.gDays * hpd + b.gHours;
    b.leftPct = granted > 0 ? Math.max(0, Math.min(100, Math.round((b.totalHours / granted) * 100))) : 0;
    // تنبيهات الرصيد
    b.alerts = [];
    if (b.cap > 0 && b.grantedEq >= b.cap - 1e-9) b.alerts.push(["warn", "بلغت الحد الأقصى السنوي (" + b.cap + " يوماً)، فلا تُقبل توصيات جديدة هذه السنة."]);
    else if (b.cap > 0 && b.capPct >= 80) b.alerts.push(["info", "اقتربت من الحد الأقصى السنوي: مُنحت " + n(b.grantedEq) + " من " + b.cap + " يوماً."]);
    const tail = b.hAvailRem ? " (تبقّت " + hoursAr(b.hAvailRem) + " لا تكفي ليوم كامل)" : "";
    if (granted > 0 && b.bookable <= 0) b.alerts.push(["warn", "استنفدت رصيدك المتاح من بدل الراحة" + tail + "."]);
    else if (granted > 0 && b.bookable <= 2) b.alerts.push(["warn", "رصيدك المتاح قارب على النفاد: بقي " + daysAr(b.bookable) + tail + "."]);
    return b;
  }
  const alertKeys = (b) => new Set(b.alerts.map(([, t]) => t.split(":")[0].split("(")[0].trim().slice(0, 20)));
  function notifyAlerts(e, y, before, from) {
    const b = balance(e.id, y), fresh = b.alerts.filter(([, t]) => !before.has(t.split(":")[0].split("(")[0].trim().slice(0, 20))).map(([, t]) => t);
    if (fresh.length) notify(userOfEmp(e), "تنبيه رصيد بدل الراحة", fresh.join("\n"), "#/me", from);
  }
  // التفويض المؤقت: مسؤول يتابع فريق زميله خلال فترة محددة (اعتماد الطلبات ورفع التوصيات)
  const activeDelegs = () => { const d0 = todayISO(); return (DB.delegations || []).filter((d) => !d.cancelled && d.start <= d0 && d.end >= d0); };
  const delegState = (d) => { const t = todayISO(); return d.cancelled ? "cancelled" : t < d.start ? "upcoming" : t <= d.end ? "active" : "ended"; };
  const DELEG_ST = { active: "ساري", upcoming: "قادم", ended: "منتهٍ", cancelled: "ملغى" };
  const delegatedFrom = (u) => (u.role === "officer" && u.emp ? activeDelegs().filter((d) => d.to === u.emp).map((d) => d.from) : []);
  const delegatesOf = (empId) => activeDelegs().filter((d) => d.from === empId).map((d) => d.to);
  const isOfficerOf = (u, e) => !!(u.role === "officer" && u.emp && e.mgr && (e.mgr === u.emp || delegatedFrom(u).includes(e.mgr)));
  const isDelegated = (u, e) => !!(u.role === "officer" && e.mgr && e.mgr !== u.emp && isOfficerOf(u, e));
  function canView(u, e) { return u.role === "admin" || u.emp === e.id || isOfficerOf(u, e); }
  function canManage(u, e) { if (u.emp === e.id) return false; return u.role === "admin" || isOfficerOf(u, e); }
  function visibleEmps(u, inactive) {
    let list = DB.emps.filter((e) => canView(u, e));
    if (!inactive) list = list.filter((e) => e.active);
    return list.sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }
  const managedEmps = (u, inactive) => visibleEmps(u, inactive).filter((e) => e.id !== u.emp);
  const officers = () => DB.emps.filter((e) => DB.users.some((u) => u.emp === e.id && u.role === "officer" && u.active)).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const officerUsersFor = (e) => (e.mgr ? DB.users.filter((u) => [e.mgr, ...delegatesOf(e.mgr)].includes(u.emp) && u.active && STAFF.includes(u.role)) : []);
  function recipients(u) {
    const act = DB.users.filter((x) => x.active && x.id !== u.id);
    if (u.role === "admin") return act;
    const admins = act.filter((x) => x.role === "admin");
    if (u.role === "officer") return admins.concat(act.filter((x) => { const e = empOf(x); return e && isOfficerOf(u, e); }));
    const e = empOf(u), offs = e ? officerUsersFor(e).filter((x) => x.id !== u.id) : [];
    return offs.length ? offs : admins;
  }
  function notify(to, subject, body, link, from) { if (!to) return; DB.msgs.push({ id: nid(), from: from ? from.id : null, to: to.id, subject, body: body || "", at: nowStr(), read: false, link: link || "" }); }
  function openYear(y) { if (!y) throw new RuleError("التاريخ لا يقع ضمن أي سنة معرّفة في النظام."); if (y.locked) throw new RuleError("السنة " + y.name + " مقفلة ولا تقبل حركات جديدة."); return y; }
  function workingDays(y, start, end) {
    const out = []; const s = parseISO(start), e = parseISO(end);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) { const k = iso(d); if (y.blockWeekends && y.weekend.includes(d.getDay())) continue; if (DB.holidays.some((x) => x.day === k)) continue; out.push(k); }
    return out;
  }
  function validateRec(e, kind, amount, date, hasAtt) {
    if (!e.active) throw new RuleError("الموظف غير نشط.");
    if (!REC_KINDS[kind]) throw new RuleError("نوع التوصية غير صحيح.");
    const y = openYear(yearFor(date));
    if (amount == null || amount <= 0) throw new RuleError("أدخل قيمة أكبر من صفر.");
    if (kind === "days" && !Number.isInteger(amount)) throw new RuleError("توصية الأيام تكون بأيام كاملة.");
    if (y.reqRecAtt && !hasAtt) throw new RuleError("إرفاق ملف التوصية (PDF) إلزامي.");
    const b = balance(e.id, y), need = kind === "days" ? amount * y.hpd : amount;
    if (need > b.capLeftHours + 1e-9) { const [d, r] = earned(Math.max(b.capLeftHours, 0), y.hpd); throw new RuleError("تتجاوز التوصية الحد الأقصى السنوي (" + y.cap + " يوماً). المتاح للمنح: " + daysAr(d) + (r ? " و" + hoursAr(r) : "") + "."); }
    return y;
  }
  function validateLeave(e, kind, unit, start, end, hours, hasAtt) {
    if (!e.active) throw new RuleError("الموظف غير نشط.");
    if (!LEAVE_KINDS[kind] || !["days", "hours"].includes(unit)) throw new RuleError("نوع الطلب غير صحيح.");
    if (unit !== "days") throw new RuleError("تُعالج الطلبات بالأيام فقط؛ تُحوَّل ساعات التوصيات إلى أيام تلقائياً.");
    if (!parseISO(start)) throw new RuleError("أدخل التاريخ.");
    const y = openYear(yearFor(start));
    if (kind === "compensation" && start > todayISO()) throw new RuleError("طلب التعويض يكون عن غياب حدث فعلاً (تاريخ اليوم أو قبله).");
    if (y.reqReqAtt && !hasAtt) throw new RuleError("إرفاق مستند مؤيد (PDF) إلزامي وفق إعدادات السنة.");
    const b = balance(e.id, y);
    if (unit === "days") {
      end = end || start; if (!parseISO(end)) throw new RuleError("تاريخ النهاية غير صالح."); if (end < start) throw new RuleError("تاريخ النهاية قبل تاريخ البداية.");
      if (yearFor(end) !== y) throw new RuleError("يجب أن تقع مدة الطلب ضمن سنة واحدة.");
      const wd = workingDays(y, start, end); if (!wd.length) throw new RuleError("المدة المختارة لا تتضمن أيام عمل (عطلة نهاية أسبوع أو عطلة رسمية).");
      if (DB.leaves.some((r) => r.emp === e.id && ["pending", "approved"].includes(r.status) && r.start <= end && r.end >= start)) throw new RuleError("يوجد طلب فعّال يتداخل مع هذه المدة.");
      if (wd.length > b.bookable) throw new RuleError("الرصيد المتاح للحجز بالأيام (" + daysAr(b.bookable) + "، شاملاً تحويل الساعات: كل " + n(y.hpd) + " ساعات = يوم) لا يكفي لمدة " + daysAr(wd.length) + ".");
      return { y, days: wd.length, hours: 0, end };
    }
    // طلب بالساعات: ليوم عمل واحد، لا يتجاوز ساعات اليوم، ويُخصم من رصيد الساعات (توصيات الساعات)
    if (hours == null || hours <= 0) throw new RuleError("أدخل عدد ساعات أكبر من صفر.");
    if (hours > y.hpd + 1e-9) throw new RuleError("طلب الساعات ليوم واحد لا يتجاوز ساعات اليوم (" + hoursAr(y.hpd) + ")؛ للمدد الأطول اختر «بالأيام».");
    if (!workingDays(y, start, start).length) throw new RuleError("التاريخ المختار ليس يوم عمل (عطلة نهاية أسبوع أو عطلة رسمية).");
    const sameDay = DB.leaves.filter((r) => r.emp === e.id && ["pending", "approved"].includes(r.status) && r.start <= start && r.end >= start);
    if (sameDay.some((r) => r.unit === "days")) throw new RuleError("يوجد طلب فعّال بالأيام يشمل هذا التاريخ.");
    if (sameDay.reduce((t, r) => t + (r.hours || 0), 0) + hours > y.hpd + 1e-9) throw new RuleError("مجموع ساعات الطلبات في هذا اليوم يتجاوز ساعات اليوم (" + hoursAr(y.hpd) + ").");
    if (hours > b.hoursAvail + 1e-9) throw new RuleError("رصيد الساعات المتاح (" + hoursAr(Math.max(b.hoursAvail, 0)) + ") لا يكفي. تُخصم طلبات الساعات من الساعات الممنوحة بتوصيات الساعات؛ للأيام الممنوحة اختر «بالأيام».");
    return { y, days: 0, hours: round2(hours), end: start };
  }
  const noteText = (r) => [r.note, r.status === "cancelled" && r.cancelNote ? "سبب الإلغاء: " + r.cancelNote : ""].filter(Boolean).join(" · ");
  const leaveAmount = (r) => (r.unit === "days" ? daysAr(r.days) : hoursAr(r.hours));
  const recAmount = (r) => (r.kind === "days" ? daysAr(r.amount) : hoursAr(r.amount));
  function decideLeave(u, r, action, note) {
    const e = byId("emps", r.emp);
    if (r.status !== "pending") throw new RuleError("الطلب ليس بانتظار الاعتماد.");
    if (!canManage(u, e)) throw new RuleError("لا يمكنك البت في هذا الطلب: الاعتماد لمسؤول شؤون الموظفين عن الموظف.");
    const y = openYear(byId("years", r.year)), b = balance(e.id, y);
    const before = alertKeys(b);
    if (action === "approve") { const al = allocate(y.hpd, b.gDays, b.gHours, b.taken + (r.unit === "days" ? r.days : 0), b.rawAH + (r.unit === "hours" ? r.hours : 0)); if (b.gHours - al.uHours < -1e-9) throw new RuleError("اعتماد هذا الطلب يتجاوز الرصيد المتاح (الأيام والساعات المحوّلة)."); r.status = "approved"; }
    else { if (!note) throw new RuleError("اذكر سبب الرفض."); r.status = "rejected"; }
    r.decidedBy = u.id; r.decidedAt = nowStr(); r.note = note || "";
    const behalf = onBehalf(u, e), deleg = isDelegated(u, e);
    audit("leave_" + r.status, "leave_request", r.id, { note, on_behalf: behalf || undefined, delegated: deleg || undefined });
    if (behalf || deleg) { const ou = userOfEmp(byId("emps", e.mgr)); if (ou && ou.id !== u.id) notify(ou, "قرار " + (behalf ? "بالنيابة" : "بالتفويض") + " في طلب " + e.name, "بتّ " + (behalf ? "مدير النظام" : displayName(u) + " (بالتفويض)") + " في طلب " + e.name + " (" + leaveAmount(r) + " بتاريخ " + r.start + ") بالنيابة عنك: " + REQ_ST[r.status] + ".", "#/requests", u); }
    notify(userOfEmp(e), "تم " + (r.status === "approved" ? "اعتماد" : "رفض") + " طلب " + LEAVE_KINDS[r.kind], "طلبك (" + leaveAmount(r) + " بتاريخ " + r.start + "): " + REQ_ST[r.status] + "." + (note ? " الملاحظة: " + note : ""), "#/requests", u);
    if (r.status === "approved") notifyAlerts(e, y, before, u);
  }
  function cancelLeave(u, r, note) {
    const e = byId("emps", r.emp), own = r.emp === u.emp;
    if (!(canManage(u, e) || (own && r.status === "pending"))) throw new RuleError("ليست لديك صلاحية لإلغاء هذا الطلب.");
    const y = openYear(byId("years", r.year));
    if (!["pending", "approved"].includes(r.status)) throw new RuleError("لا يمكن إلغاء هذا الطلب في حالته الحالية.");
    if (r.status === "approved" && !note) throw new RuleError("اذكر سبب إلغاء طلب معتمد.");
    const prev = r.status; r.status = "cancelled"; r.cancelledBy = u.id; r.cancelledAt = nowStr(); r.cancelNote = note || "إلغاء";
    audit("leave_cancelled", "leave_request", r.id, { previous: prev, note });
    const when = r.start + (r.end && r.end !== r.start ? " إلى " + r.end : "");
    if (!own) notify(userOfEmp(e), (prev === "approved" ? "إلغاء اعتماد طلب " : "إلغاء طلب ") + LEAVE_KINDS[r.kind], prev === "approved"
      ? "أُلغي اعتماد طلبك رقم " + (r.ref || r.id) + " (" + leaveAmount(r) + "، " + when + ") وأُعيد الرصيد إليك.\nالسبب: " + note + "\nإن كان الإلغاء لتصحيح التاريخ فقدّم طلباً جديداً بالتاريخ الصحيح."
      : "أُلغي طلبك (" + leaveAmount(r) + "، " + when + "). " + (note || ""), "#/requests", u);
    return prev;
  }
  function cancelRec(u, r, note) {
    const e = byId("emps", r.emp);
    if (!canManage(u, e)) throw new RuleError("ليست لديك صلاحية على هذه التوصية.");
    if (!note) throw new RuleError("اذكر سبب إلغاء التوصية.");
    const y = openYear(byId("years", r.year)); if (r.status !== "active") throw new RuleError("التوصية ملغاة مسبقاً.");
    const after = balance(e.id, y, r.id);
    if (after.hoursLeft < -1e-9 || after.daysLeft < 0) throw new RuleError("لا يمكن الإلغاء: الرصيد الممنوح بهذه التوصية مستخدم في طلبات معتمدة.");
    r.status = "cancelled"; r.cancelNote = note; r.cancelledBy = u.id; r.cancelledAt = nowStr(); audit("recommendation_cancelled", "recommendation", r.id, { note });
    notify(userOfEmp(e), "إلغاء توصية بدل راحة", "أُلغيت التوصية (" + REC_KINDS[r.kind] + "). السبب: " + note, "#/me", u);
  }


  // ============================================================ التوجيه والعرض
  let flashQ = [];
  function flash(msg, kind) { flashQ.push([kind || "ok", msg]); }
  function toast(msg, kind) { const d = document.createElement("div"); d.className = "alert toast " + (kind || "ok"); d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 4000); }
  const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
  const parts = () => { const raw = location.hash.replace(/^#\/?/, ""); const [p, q] = raw.split("?"); return { seg: p.split("/").filter(Boolean), q: new URLSearchParams(q || "") }; };
  class Forbidden extends Error {}
  const need = (u, roles) => { if (!roles.includes(u.role)) throw new Forbidden("ليست لديك صلاحية للوصول إلى هذه الصفحة."); };

  // الأيقونات تُضمَّن في الصفحة (inline sprite): مراجع <use> لملف خارجي لا تحلّ التدرجات في Safari/iOS فتختفي الرموز.
  const ASSET_V = "9";
  let SPRITE_INLINE = false, HERO_INLINE = false;
  const ico = (n, c = "") => `<svg class="i3d ${c}" aria-hidden="true" focusable="false"><use href="${SPRITE_INLINE ? "" : "assets/icons.svg?v=" + ASSET_V}#i-${n}"/></svg>`;
  async function inlineSprite(file) {
    try {
      const r = await fetch("assets/" + file + "?v=" + ASSET_V, { cache: "no-cache" });
      if (!r.ok) return false;
      const doc = new DOMParser().parseFromString(await r.text(), "image/svg+xml");
      const svg = doc.documentElement;
      if (!svg || svg.nodeName !== "svg" || doc.getElementsByTagName("parsererror").length) return false;
      svg.setAttribute("class", "svg-sprite"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
      document.body.insertBefore(document.importNode(svg, true), document.body.firstChild);
      return true;
    } catch (e) { return false; }
  }
  function layout(u, title, body) {
    const y = activeYear();
    const sg = parts().seg, qs = location.hash.split("?")[1] || "";
    const here = "#/" + (!sg.length || sg[0] === "login" ? (u.role === "employee" ? "me" : "dashboard") : sg.join("/")) + (qs ? "?" + qs : "");
    const unread = DB.msgs.filter((m) => m.to === u.id && !m.read).length;
    const pend = DB.leaves.filter((r) => r.status === "pending" && canManage(u, byId("emps", r.emp))).length + DB.recs.filter((r) => r.status === "pending" && canManage(u, byId("emps", r.emp))).length;
    const item = (href, label, icon, badge, seg0) => `<li><a href="${href}" title="${label}" ${here === href || (seg0 && sg[0] === seg0) || (href === "#/employees" && sg[0] === "employee") ? 'aria-current="page"' : ""}>${ico(icon)}<span class="lbl">${label}</span>${badge ? `<span class="badge count">${badge}</span>` : ""}</a></li>`;
    // مدير النظام: قائمة مختصرة دون تكرار؛ أزرار الإضافة داخل كل صفحة
    // مدير النظام: «المتابعة» ثابتة، و«السجلات» و«الإدارة» قابلتان للطيّ (تُحفظ الحالة، وتُفتح مجموعة الصفحة الحالية)
    const inRecords = ["recs", "requests", "messages"].includes(sg[0]), inAdmin = sg[0] === "admin";
    const inSettings = inAdmin && ["years", "depts", "holidays", "settings", "mail"].includes(sg[1] || "years");
    const group = (key, label, def, active, inner, badge) => `<li class="nav-group" data-group="${key}" data-default="${def}" ${active ? 'data-active="1"' : ""}><button type="button" class="nav-toggle" aria-expanded="true" aria-controls="g-${key}">${label}${badge ? ` <span class="badge count">${badge}</span>` : ""}<span class="chev" aria-hidden="true"></span></button><ul class="nav-sub" id="g-${key}">${inner}</ul></li>`;
    const adminNav = `<li class="sep">المتابعة</li>${item("#/dashboard", "لوحة المؤشرات", "dashboard")}<li><a href="#/employees" title="الموظفون والأرصدة" ${["employees", "employee"].includes(sg[0]) || (inAdmin && sg[1] === "import") ? 'aria-current="page"' : ""}>${ico("users")}<span class="lbl">الموظفون والأرصدة</span></a></li>${item("#/approvals", "الاعتمادات", "stamp", pend)}
      ${group("records", "السجلات", "open", inRecords, item("#/recs", "سجل التوصيات", "cal-check", 0, "recs") + item("#/requests", "طلبات معالجة الغياب", "inbox", 0, "requests") + item("#/messages", "المراسلات", "mail", unread, "messages"), unread)}
      ${group("admin", "الإدارة", "open", inAdmin, `<li><a href="#/admin/users" title="المستخدمون والصلاحيات" ${inAdmin && ["users", "cards", "teams"].includes(sg[1]) ? 'aria-current="page"' : ""}>${ico("userkey")}<span class="lbl">المستخدمون والصلاحيات</span></a></li>`
        + `<li><a href="#/admin/years" title="الإعدادات" ${inSettings ? 'aria-current="page"' : ""}>${ico("gear")}<span class="lbl">الإعدادات</span></a></li>` + item("#/admin/data", "النسخ الاحتياطي والبيانات", "backup") + item("#/admin/audit", "سجل التدقيق", "audit"))}
      <li class="sep">التقارير والأرشيف</li>${item("#/reports", "التقارير", "reports")}${item("#/archive", "الأرشيف", "archive")}
      <li class="sep">حسابي</li>${item("#/profile", "الملف الشخصي", "idcard")}`;
    const nav = u.role === "admin" ? adminNav : [
      STAFF.includes(u.role) ? `<li class="sep">المتابعة</li>${item("#/dashboard", "لوحة المؤشرات", "dashboard")}${item("#/employees", u.role === "admin" ? "الموظفون" : "قائمة الموظفين", "users")}<li><a href="#/approvals" title="طلبات الموظفين" ${sg[0] === "approvals" || (sg[0] === "requests" && sg[1] !== "new") ? 'aria-current="page"' : ""}>${ico("stamp")}<span class="lbl">طلبات الموظفين</span>${pend ? `<span class="badge count">${pend}</span>` : ""}</a></li>${u.role === "officer" ? item("#/delegation", "التفويض", "swap", delegatedFrom(u).length ? "مفوَّض" : 0) : ""}
        <li class="sep">التوصيات</li><li><a href="#/recs/new" title="توصية جديدة" ${sg[0] === "recs" && sg[1] === "new" ? 'aria-current="page"' : ""}>${ico("calendar-plus")}<span class="lbl">توصية جديدة</span></a></li><li><a href="#/recs" title="سجل التوصيات" ${sg[0] === "recs" && sg[1] !== "new" ? 'aria-current="page"' : ""}>${ico("cal-check")}<span class="lbl">سجل التوصيات</span></a></li>` : "",
      u.emp ? `<li class="sep">${u.role === "employee" ? "رصيدي وطلباتي" : "حسابي"}</li>${item("#/me", "رصيدي", "pie")}${u.role === "employee" ? item("#/requests", "طلباتي", "inbox") : ""}${y.empCanSubmitRec !== false ? `<li><a href="#/recs/submit" title="رفع توصية ممنوحة لي" ${sg[0] === "recs" && sg[1] === "submit" ? 'aria-current="page"' : ""}>${ico("upload")}<span class="lbl">رفع توصية ممنوحة لي</span></a></li>` : ""}${y.empCanRequest ? `<li><a href="#/requests/new" title="طلب معالجة غياب" ${sg[0] === "requests" && sg[1] === "new" ? 'aria-current="page"' : ""}>${ico("request")}<span class="lbl">${u.role === "employee" ? "طلب معالجة غياب" : "طلب معالجة غياب لي"}</span></a></li>` : ""}${item("#/profile", "الملف الشخصي", "idcard")}` : "",
      `<li class="sep">التواصل</li>${item("#/messages", "المراسلات", "mail", unread)}${item("#/messages/new", "رسالة جديدة", "send")}${u.role === "employee" ? item("#/faq", "الأسئلة الشائعة", "shield") : ""}`,
      u.role === "officer" ? `<li class="sep">التقارير والأرشيف</li>${item("#/reports", "التقارير", "reports")}${item("#/archive", "الأرشيف", "archive")}${item("#/faq", "الأسئلة الشائعة", "shield")}` : "",
    ].join("");
    const fl = flashQ.map(([k, m]) => `<div class="alert ${k}" role="${k === "error" ? "alert" : "status"}">${h(m)}</div>`).join("");
    flashQ = [];
    const s = DB.settings;
    return `<a class="skip" href="#main">تخطَّ إلى المحتوى</a>
<div class="layout">
  <aside class="sidebar" id="sidebar" aria-label="القائمة الرئيسية">
    <a class="brand" href="#/" title="الصفحة الرئيسية"><div class="mark" aria-hidden="true"><img class="logo-img" src="assets/logo.svg?v=${ASSET_V}" alt="" width="40" height="40"></div><div><b class="wordmark">${h(s.system_title)}</b><small>${h(s.university)} · ${h(s.college)}</small></div></a>
    <ul class="nav">${nav}</ul>
  </aside>
  <div class="main">
    ${bannerHidden() ? "" : `<div class="demo-banner" role="note"><span>نسخة عرض: البيانات محفوظة في متصفحك فقط ولا تُشارك مع أحد. لا تُدخل بيانات حقيقية.</span> <button class="btn sm" data-act="reset" type="button">استعادة بيانات العرض</button><button class="banner-x" data-act="hideBanner" type="button" aria-label="إخفاء الشريط" title="إخفاء الشريط">×</button></div>`}
    <header class="topbar">
      <button class="btn ghost menu-btn icon-btn" type="button" data-menu aria-controls="sidebar" aria-expanded="false">☰ <span class="sr-only">القائمة</span></button>
      <a class="t-logo" href="#/" title="الصفحة الرئيسية" aria-label="الصفحة الرئيسية"><img src="assets/logo.svg?v=${ASSET_V}" alt="" width="30" height="30"><b>${h(s.system_title)}</b></a>
      ${(() => { const sec = { admin: "الإدارة", recs: u.role === "admin" ? "السجلات" : "التوصيات", requests: u.role === "admin" ? "السجلات" : "الطلبات", messages: "التواصل", reports: "التقارير والأرشيف", archive: "التقارير والأرشيف", profile: "حسابي", me: "حسابي", password: "حسابي", dashboard: "المتابعة", employees: "المتابعة", delegation: "المتابعة", employee: "المتابعة", approvals: "المتابعة", faq: "المساعدة" }[sg[0]] || "";
        return `<nav class="title crumbs" aria-label="مسار التنقل">${sec ? `<span class="crumb">${sec}</span><span class="crumb-sep" aria-hidden="true">‹</span>` : ""}<span aria-current="page">${h(title)}</span></nav>`; })()}<span class="spacer"></span>
      <span class="badge muted">السنة ${h(y.name)}${y.locked ? " · مقفلة" : ""}</span>
      <button class="btn ghost icon-btn theme-top" type="button" data-theme-toggle aria-label="تبديل الوضع الداكن" title="الوضع الداكن/الفاتح">${ico("moon", "theme-moon")}${ico("sun", "theme-sun")}<span class="sr-only">الوضع</span></button>
      <details class="acct">
        <summary class="btn ghost" aria-label="حساب ${h(displayName(u))}"><span class="avatar" aria-hidden="true">${h(displayName(u).slice(0, 1))}</span><span class="acct-name">${h(displayName(u))}</span></summary>
        <div class="acct-menu">
          <div class="who-full"><b>${h(displayName(u))}</b><small>${ROLES[u.role]}</small></div>
          <button class="btn" type="button" data-theme-toggle>${ico("moon", "theme-moon")}${ico("sun", "theme-sun")}الوضع الداكن/الفاتح</button>
          <a class="btn" href="#/profile">${ico("user")}الملف الشخصي</a>
          ${u.role === "admin" ? `<a class="btn" href="#/admin/years">${ico("gear")}الإعدادات</a>` : ""}
          <a class="btn" href="#/password">${ico("key")}كلمة المرور</a>
          ${bannerHidden() ? `<button class="btn" type="button" data-act="showBanner">${ico("palette")}إظهار شريط نسخة العرض</button>` : ""}
          <button class="btn" type="button" data-act="reset">${ico("adjust")}استعادة بيانات العرض</button>
          <button class="btn logout" type="button" data-act="logout">${ico("logout")}خروج</button>
        </div>
      </details>
    </header>
    <main id="main" class="content" tabindex="-1">${(() => { const dl = u.role === "officer" ? activeDelegs().filter((d) => d.to === u.emp) : []; return dl.length && ["dashboard", "approvals", "requests", "employees"].includes(sg[0] || "dashboard") ? `<div class="alert info deleg-banner" role="note">${ico("swap", "sm-ico")}<span>تعمل بالتفويض عن ${dl.map((d) => "فريق <b>" + h(byId("emps", d.from).name) + "</b> حتى <bdi class=\"d\">" + d.end + "</bdi>").join("، ")}؛ تظهر طلباتهم وموظفوهم معك مع علامة «بالتفويض». <a href="#/delegation">التفاصيل</a></span></div>` : ""; })()}${fl}${body}</main>
    <footer class="footer">© ${new Date().getFullYear()} ${h(s.university)} – ${h(s.college)} · ${h(s.system_title)}${s.credit ? " · " + h(s.credit) : ""}</footer>
  </div>
</div>`;
  }
  const statusBadge = (s, label) => `<span class="badge ${{ approved: "ok", pending: "warn", rejected: "err", cancelled: "muted" }[s] || ""}">${h(label)}</span>`;
  const kindBadge = (k) => ({ days: '<span class="badge info">بالأيام</span>', hours: '<span class="badge accent">بالساعات</span>', use: '<span class="badge info">معالجة غياب</span>', compensation: '<span class="badge accent">تعويض غياب</span>' }[k] || "");
  const yearSelect = (sel, name) => `<div class="field"><label for="ysel">السنة</label><select id="ysel" name="${name || "year"}" data-yearnav>${DB.years.slice().sort((a, b) => b.start.localeCompare(a.start)).map((y) => `<option value="${y.id}" ${y.id === sel.id ? "selected" : ""}>${h(y.name)}${y.active ? " (النشطة)" : ""}${y.locked ? " – مقفلة" : ""}</option>`).join("")}</select></div>`;
  const pickYear = (q) => (q.get("year") && byId("years", q.get("year"))) || activeYear();
  const empOptions = (list, sel, ph) => `<option value="">${ph || "— اختر الموظف —"}</option>` + list.map((e) => `<option value="${e.id}" ${String(sel) === String(e.id) ? "selected" : ""}>${h(e.name)} (${h(e.no)})</option>`).join("");
  const dateRange = (r) => `<span class="d-range"><bdi class="d">${r.start}</bdi>${r.end && r.end !== r.start ? `<span aria-hidden="true">←</span><span class="sr-only">إلى</span><bdi class="d">${r.end}</bdi>` : ""}</span>`;
  const LATE_DAYS = 3; // معيار الخدمة: يُعدّ الطلب متأخراً إذا بقي بلا قرار 3 أيام فأكثر
  const COUNT_FORMS = { emp: ["لا يوجد موظفون", "موظف واحد", "موظفان", "موظفين", "موظفاً"], req: ["لا توجد طلبات", "طلب واحد", "طلبان", "طلبات", "طلباً"], rec: ["لا توجد توصيات", "توصية واحدة", "توصيتان", "توصيات", "توصية"], msg: ["لا توجد رسائل", "رسالة واحدة", "رسالتان", "رسائل", "رسالة"], acc: ["لا توجد حسابات", "حساب واحد", "حسابان", "حسابات", "حساباً"] };
  const cnt = (v, k) => { const x = Math.trunc(Number(v) || 0), f = COUNT_FORMS[k]; return x === 0 ? f[0] : x === 1 ? f[1] : x === 2 ? f[2] : x <= 10 ? x + " " + f[3] : x + " " + f[4]; };
  const balanceLine = (b) => `<div class="bal-line" role="status">${ico("pie", "sm-ico")}<span>المتاح للطلب: <b class="big">${daysAr(b.bookable)}</b></span>${b.pDays ? `<span class="muted">معلّق بانتظار الاعتماد: ${daysAr(b.pDays)}</span>` : ""}${b.hAvailRem ? `<span class="muted">${hoursAr(b.hAvailRem)} لا تكفي ليوم فلا تُستخدم</span>` : ""}</div>`;
  const pdfChip = (name) => (name ? `<span class="badge muted" title="نسخة العرض لا تحفظ محتوى الملفات">📎 ${h(name)}</span>` : "");
  const months = ["ينا", "فبر", "مار", "أبر", "ماي", "يون", "يول", "أغس", "سبت", "أكت", "نوف", "ديس"];

  function board(b, big) {
    return `${(b.alerts || []).map(([k, t]) => `<div class="alert ${k} balance-alert" role="status">⚠ ${h(t)}</div>`).join("")}<section class="board${big ? " big" : ""}">
  <div class="gauge" style="--p: ${b.leftPct}" role="img" aria-label="المتاح للطلب ${daysAr(b.bookable)}">
    <div class="gauge-in"><b class="num">${b.bookable}</b><span>${b.bookable === 1 ? "يوم متاح للطلب" : b.bookable === 2 ? "يومان متاحان للطلب" : b.bookable > 10 ? "يوماً متاحاً للطلب" : "أيام متاحة للطلب"}</span>${b.pDays || b.pHours ? `<small>معلّق: ${[b.pDays ? daysAr(b.pDays) : "", b.pHours ? hoursAr(b.pHours) : ""].filter(Boolean).join(" و")}</small>` : ""}${b.hAvailRem ? `<small title="ساعات لا تكفي ليوم كامل">+ ${hoursAr(b.hAvailRem)}</small>` : ""}</div></div>
  <div class="board-cards">
    <div class="bcard days">${ico("calendar")}<div><span class="l">رصيد الأيام</span><b class="v num">${n(b.daysLeft)}</b><span class="s">ممنوح ${n(b.gDays)} · مستخدم ${b.uDays}${b.pDays ? " · معلّق " + b.pDays : ""}</span><span class="s book">${b.bookable ? `يمكن طلب <b>${daysAr(b.bookable)}</b>${b.bookableFromHours ? " (منها " + b.bookableFromHours + " بتحويل الساعات)" : ""}` : "لا توجد أيام قابلة للطلب حالياً"}</span></div></div>
    <div class="bcard hours">${ico("clock")}<div><span class="l">رصيد الساعات</span><b class="v num">${n(b.hoursLeft)}</b><span class="s">كل ${n(b.hpd)} ساعات = يوم${b.pHours ? " · معلّق " + n(b.pHours) : ""}${b.hAvailRem ? ` · <b>${hoursAr(b.hAvailRem)} لا تكفي ليوم فلا تُستخدم</b>` : ""}</span></div></div>
    <div class="bcard cap">${ico("pie")}<div><span class="l">من الحد الأقصى السنوي</span><b class="v num">${n(b.grantedEq)} <small class="of">من ${n(b.cap)} يوماً</small></b>
      <div class="progress" role="progressbar" aria-label="الممنوح من الحد الأقصى السنوي" aria-valuenow="${b.capPct}" aria-valuemin="0" aria-valuemax="100"><span style="width: ${b.capPct}%"></span></div></div></div>
  </div></section>`;
  }
  // رسم دائري (حلقة): أجزاء من كل واحد، فجوة بين الأجزاء، والقيم ظاهرة في المفتاح
  function donut(parts, total, unit, title, cap) {
    const C = 100, gap = parts.filter((p) => p.value > 0).length > 1 ? 0.8 : 0; let off = 25;
    const segs = parts.filter((p) => total && p.value > 0).map((p) => { const len = (p.value / total) * C, d = Math.max(len - gap, 0.01); const html = `<circle class="seg seg-${p.key}" cx="21" cy="21" r="15.9155" fill="none" stroke-width="5.2" stroke-dasharray="${d} ${C - d}" stroke-dashoffset="${off}"><title>${h(p.label)}: ${n(p.value)} ${unit} (${p.pct}%)</title></circle>`; off -= len; return html; }).join("");
    return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 42 42" role="img" aria-label="${h(title)}: ${parts.map((p) => h(p.label) + " " + n(p.value) + " " + unit + " (" + p.pct + "%)").join("، ")}">
      <circle class="donut-track" cx="21" cy="21" r="15.9155" fill="none" stroke-width="5.2"></circle>${segs}
      <text x="21" y="20.2" class="donut-num">${n(Math.round(total * 10) / 10)}</text><text x="21" y="25.6" class="donut-cap">${cap != null ? cap : unit + " ممنوحة"}</text></svg>
      <ul class="donut-legend">${parts.map((p) => `<li><span class="sw sw-${p.key}" aria-hidden="true"></span><span class="lbl">${h(p.label)}</span><b class="num">${n(Math.round(p.value * 10) / 10)}</b><span class="pct num">${p.pct}%</span></li>`).join("")}</ul></div>`;
  }
  const tiles = (arr) => `<nav class="action-tiles" aria-label="إجراءات">${arr.map(([cls, href, icon, title, sub, badge]) => `<a class="tile ${cls}" href="${href}">${ico(icon)}<span><b>${title}</b><small>${sub}</small></span>${badge ? `<span class="badge warn">${badge}</span>` : ""}</a>`).join("")}</nav>`;

  // ---------------------------------------------------------- الشاشات
  const V = {};

  V.login = () => {
    const s = DB.settings;
    const accts = [["admin", "مدير النظام"], ["officer", "شؤون الموظفين"], ["emp", "موظف"]];
    const SV = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
    return `<div class="gate">
  <div class="gate-strip" aria-hidden="true"></div>
  <main class="gate-main"><div class="gate-grid">
    <section class="gate-card" aria-labelledby="login-title">
      <button class="btn ghost icon-btn card-theme" type="button" data-theme-toggle aria-label="تبديل الوضع الداكن" title="الوضع الداكن/الفاتح">${ico("moon", "theme-moon")}${ico("sun", "theme-sun")}<span class="sr-only">الوضع</span></button>
      <span class="demo-tag" role="note">نسخة عرض — ليست النظام الفعلي</span>
      <div class="card-brand"><img class="logo-img" src="assets/logo.svg?v=${ASSET_V}" alt="" width="64" height="64"><div><b class="wordmark">${h(s.system_title)}</b><small>${h(s.tagline)}</small></div></div>
      <h1 id="login-title" class="login-h">تسجيل الدخول</h1>
      <p class="sub">يُرجى إدخال اسم المستخدم وكلمة المرور للدخول إلى النظام.</p>
      ${flashQ.splice(0).map(([k, m]) => `<div class="alert ${k}" role="alert">${h(m)}</div>`).join("")}
      <form data-form="login" novalidate>
        <div class="field"><label for="u">اسم المستخدم</label><div class="input-icon">${SV('<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5"/>')}<input id="u" name="username" type="text" autocomplete="username" required autofocus></div></div>
        <div class="field"><label for="p">كلمة المرور</label><div class="input-icon">${SV('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>')}<input id="p" name="password" type="password" autocomplete="current-password" required><button type="button" class="pw-toggle" data-pw-toggle aria-label="إظهار كلمة المرور" aria-pressed="false" title="إظهار كلمة المرور"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path class="eye-open" d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle class="eye-open" cx="12" cy="12" r="3"/><path class="eye-off" d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg></button></div></div>
        <button class="btn primary block lg" type="submit">دخول</button>
      </form>
      <p class="gate-notice"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg><span>هذا النظام مخصّص للاستخدام الرسمي المصرّح به لمنسوبي ${h(s.college)}، وجميع العمليات فيه مسجّلة وتخضع للمراجعة. ويُعدّ الدخول إليه موافقةً على <button type="button" class="inline-link" data-open-dialog="policy-dlg" aria-haspopup="dialog">سياسة الاستخدام</button>.</span></p>
      <div class="demo-accounts" role="group" aria-labelledby="demo-title">
        <div class="head"><b id="demo-title">حسابات تجريبية</b><span class="muted">كلمة المرور <code>${DEMO_PW}</code></span></div>
        <div class="list">${accts.map(([u, l]) => `<button class="btn sm" type="button" data-demo-login="${u}">${l}</button>`).join("")}</div>
        <p class="hint">البيانات وهمية ومحفوظة في هذا المتصفح فقط.</p>
      </div>
      <div class="card-foot">
        <div class="foot-links"><button class="about-link" type="button" data-open-dialog="about-dlg" aria-haspopup="dialog">${SV('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>')}عن النظام</button><button class="about-link" type="button" data-open-dialog="faq-dlg" aria-haspopup="dialog"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6M12 17h.01"/></svg>الأسئلة الشائعة</button></div>
        <p class="card-credit"><span>جميع الحقوق محفوظة © ${new Date().getFullYear()}</span>${s.credit ? `<span>${h(s.credit)}</span>` : ""}</p>
      </div>
    </section>
    <section class="gate-intro" aria-labelledby="intro-title">
      <span class="eyebrow">نظام داخلي · ${h(s.college)}</span>
      <h2 id="intro-title">${h(s.tagline)}</h2>
      <svg class="gate-hero" role="img" aria-label="رسم توضيحي: تقويم وساعة وبطاقة اعتماد"><use href="${HERO_INLINE ? "" : "assets/hero.svg?v=" + ASSET_V}#hero"/></svg>
      <p class="lead">منصة إلكترونية داخلية لمنسوبي ${h(s.college)} في ${h(s.university)}، توحّد إجراءات بدل الراحة: من توثيق التوصيات واحتساب الأرصدة آلياً، إلى معالجة الغياب واعتمادها وإصدار الخطابات الرسمية.</p>
      <ul class="gate-features">
        <li><span class="ico" aria-hidden="true">${ico("calendar-plus")}</span><div><b>التوصيات والأرصدة</b><span>توصيات موثّقة بالأيام أو بالساعات، ورصيد يُحتسب آلياً ضمن حد سنوي معتمد.</span></div></li>
        <li><span class="ico" aria-hidden="true">${ico("approvals")}</span><div><b>معالجة الغياب</b><span>طلبات بالأيام من الرصيد، يعتمدها مسؤول شؤون الموظفين إلكترونياً مع سجل تدقيق.</span></div></li>
        <li><span class="ico" aria-hidden="true">${ico("idcard")}</span><div><b>خطابات وتقارير رسمية</b><span>إشعارات ونماذج وتقارير برقم مرجعي، جاهزة للطباعة والحفظ بصيغة PDF.</span></div></li>
      </ul>
    </section>
  </div></main>
</div>
<dialog id="about-dlg" class="about-dlg" aria-labelledby="about-title">
  <form method="dialog" class="about-head"><h2 id="about-title">عن نظام «${h(s.system_title)}»</h2><button class="btn ghost icon-btn" value="close" aria-label="إغلاق">×</button></form>
  ${aboutHTML(s)}
</dialog>
<dialog id="policy-dlg" class="about-dlg" aria-labelledby="policy-title">
  <form method="dialog" class="about-head"><h2 id="policy-title">سياسة استخدام نظام «${h(s.system_title)}»</h2><button class="btn ghost icon-btn" value="close" aria-label="إغلاق">×</button></form>
  ${policyHTML(s)}
</dialog>
<dialog id="faq-dlg" class="about-dlg" aria-labelledby="faq-title">
  <form method="dialog" class="about-head"><h2 id="faq-title">الأسئلة الشائعة</h2><button class="btn ghost icon-btn" value="close" aria-label="إغلاق">×</button></form>
  ${faqHTML(s)}
</dialog>`;
  };

  V.password = (u) => layout(u, "تغيير كلمة المرور", `<div class="page-head"><div><h1>${ico("key", "h-ico")} تغيير كلمة المرور</h1></div></div><div class="card" style="max-width:480px">
    ${u.mustChange ? '<div class="alert info">يجب تعيين كلمة مرور جديدة قبل المتابعة.</div>' : ""}
    <form data-form="password">
      <div class="field"><label for="c">كلمة المرور الحالية</label><input id="c" type="password" name="current" required></div>
      <div class="field"><label for="nw">كلمة المرور الجديدة <span class="hint">(8 أحرف على الأقل، أحرف وأرقام)</span></label><input id="nw" type="password" name="new" required></div>
      <div class="field"><label for="cf">تأكيد كلمة المرور</label><input id="cf" type="password" name="confirm" required></div>
      <button class="btn primary">حفظ</button></form></div>`);

  V.profile = (u) => {
    const e = empOf(u), adm = u.role === "admin", ro = (v) => `value="${h(v || "—")}" readonly`, cur = e ? e.dept : u.dept;
    return layout(u, "الملف الشخصي", `<div class="page-head"><div><h1>${ico("idcard", "h-ico")} الملف الشخصي</h1>
      <p>${adm ? "حدّث بياناتك ووحدتك وبيانات التواصل." : "حدّث بيانات التواصل الخاصة بك. لتعديل الاسم أو القسم أو المسمى الوظيفي تواصل مع مدير النظام."}</p></div></div>
      <div class="grid two profile-grid"><form class="card" data-form="profile"><h2>البيانات الشخصية</h2><div class="form-grid">
        <div class="field"><label for="pn">الاسم</label>${adm ? `<input id="pn" name="name" value="${h(e ? e.name : u.name || "")}" placeholder="الاسم الذي يظهر في النظام والخطابات">` : `<input id="pn" ${ro(displayName(u))}>`}</div>
        ${e ? `<div class="field"><label for="pno">الرقم الوظيفي</label><input id="pno" ${ro(e.no)}></div>` : ""}
        <div class="field"><label for="pd">الوحدة / القسم</label>${adm ? `<select id="pd" name="dept"><option value="">—</option>${DB.depts.slice().sort((a, b) => a.name.localeCompare(b.name, "ar")).map((d) => `<option value="${d.id}" ${cur === d.id ? "selected" : ""}>${h(d.name)}</option>`).join("")}</select>` : `<input id="pd" ${ro(deptName(e))}>`}</div>
        ${e ? `<div class="field"><label for="pt">المسمى الوظيفي</label>${adm ? `<input id="pt" name="title" value="${h(e.title || "")}">` : `<input id="pt" ${ro(e.title)}>`}</div>` : ""}
        ${e && !adm ? `<div class="field"><label for="pm">مسؤول شؤون الموظفين</label><input id="pm" ${ro(mgrName(e))}></div>` : ""}</div>
        <h2 class="mt">بيانات التواصل</h2><div class="form-grid">
        <div class="field"><label for="pe">البريد الإلكتروني <span class="hint">(تصلك عليه الإشعارات)</span></label><input id="pe" name="email" type="email" dir="ltr" value="${h((e ? e.email : u.email) || "")}" placeholder="name@example.com"></div>
        <div class="field"><label for="pp">رقم الجوال</label><input id="pp" name="phone" type="tel" dir="ltr" inputmode="tel" value="${h((e ? e.phone : u.phone) || "")}" placeholder="05XXXXXXXX"></div>
        ${e ? `<div class="field"><label for="px">التحويلة <span class="hint">(اختياري)</span></label><input id="px" name="ext" dir="ltr" inputmode="numeric" value="${h(e.ext || "")}" placeholder="1234"></div>` : ""}</div>
        <div class="actions"><button class="btn primary">حفظ البيانات</button></div></form>
      <div><section class="card"><h2>الحساب</h2><dl class="kv"><div><dt>اسم المستخدم</dt><dd class="num">${h(u.username)}</dd></div><div><dt>الدور</dt><dd>${ROLES[u.role]}</dd></div><div><dt>آخر دخول</dt><dd class="num">${h(u.last || "—")}</dd></div></dl></section>
        <section class="card"><h2>كلمة المرور</h2><p class="hint">يمكنك تغيير كلمة المرور الأولية الواردة في بطاقة الدخول متى شئت، ويُستحسن تغييرها دورياً وعدم مشاركتها مع أحد.</p><a class="btn" href="#/password">${ico("shield")} تغيير كلمة المرور</a></section></div></div>`);
  };

  const ageDays = (stamp) => Math.max(0, Math.floor((Date.now() - new Date(String(stamp).replace(" ", "T")).getTime()) / 864e5));
  const ageBadge = (d) => d >= LATE_DAYS ? `<span class="badge err late" title="تجاوز مدة القرار المعتمدة (${daysAr(LATE_DAYS)})">متأخر · منذ ${daysAr(d)}</span>` : d >= 1 ? `<span class="badge muted">منذ ${daysAr(d)}</span>` : '<span class="badge muted">اليوم</span>';
  const onBehalf = (u, e) => u.role === "admin" && !!e.mgr && e.mgr !== u.emp;
  // شريط الترحيب: تحية حسب الوقت (توقيت الرياض)، وعبارة يومية، ومسار أيام العمل، والتاريخ الميلادي والهجري
  const W_PHRASES = ["الراحة المنظّمة جزء من الإنجاز، لا استراحة منه.", "خطوة صغيرة كل يوم تصنع فرقاً كبيراً مع الوقت.", "العمل المتقن يبدأ بذهنٍ مرتاح وخطةٍ واضحة.", "التوازن بين الجهد والراحة سرّ الاستمرار.", "كل مهمة تُنجَز اليوم تخفّف عبء الغد.", "الفريق المتعاون يصل أبعد مما يصل إليه الفرد.", "النظام في التفاصيل الصغيرة يصنع جودة النتائج الكبيرة.", "ابدأ يومك بأهم مهمة، وسيتبعها الباقي بسهولة.", "الدقة في العمل احترامٌ للوقت وللآخرين.", "حقّك في الراحة يعيد إليك طاقتك للعطاء.", "التقدّم المستمر أهم من الكمال المؤجَّل.", "الوضوح في التواصل يختصر نصف الطريق.", "يوم منظّم يبدأ بقائمة قصيرة وأولويات واضحة.", "الإنجاز الحقيقي ما يبقى أثره بعد انتهاء المهمة.", "استثمر وقتك فيما يضيف قيمة، ودع ما سواه.", "التعاون يحوّل المهام الصعبة إلى إنجازات مشتركة.", "خذ استراحة قصيرة، ثم عُد بتركيز أعلى.", "الالتزام اليومي يبني الثقة قبل أن يبني النتائج.", "كل جهد تبذله اليوم محسوبٌ لك في رصيد الغد.", "الهدوء في التعامل يصنع بيئة عمل أفضل للجميع.", "التخطيط الجيد يوفّر عليك ساعات من التصحيح.", "النجاح سلسلة من الأيام الجيدة المتتالية.", "اجعل جودة عملك توقيعك الذي يعرفك به الآخرون.", "التعلّم المستمر يفتح أبواباً لم تكن تتوقعها.", "التقدير الصادق لزملائك يضاعف حماس الفريق.", "أنجِز ما بين يديك بإتقان، فهو أفضل استعداد لما بعده.", "الراحة في وقتها تحمي جودة العمل من الإرهاق.", "المبادرة بحلّ صغير خيرٌ من انتظار حلّ كامل.", "بيئة العمل الإيجابية يصنعها كل فرد فيها.", "اختم يومك بمراجعة ما أنجزت، وابدأ غدك بما تبقّى.", "الثبات على العادات الجيدة يصنع الفارق الحقيقي."];
  const W_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  function welcomeBanner(u) {
    let now; try { now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Riyadh" })); } catch (e) { now = new Date(); }
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), hr = now.getHours(), wd = today.getDay();
    const first = (displayName(u) || "").split(" ")[0], ord = Math.floor(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 864e5) + 719163;
    const sunday = new Date(today); sunday.setDate(today.getDate() - wd);
    const days = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"].map((label, i) => { const d = new Date(sunday); d.setDate(sunday.getDate() + i); return [label, d.getTime() === today.getTime() ? "today" : d < today ? "past" : "next"]; });
    let hij = ""; try { const t = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long", year: "numeric" }).format(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)); if (/\d/.test(t)) hij = t.replace(/\s*هـ$/, "") + " هـ"; } catch (e) {}
    const weekend = wd === 5 || wd === 6;
    return `<section class="welcome" aria-label="ترحيب"><div class="w-top"><div><p class="w-hi">${4 <= hr && hr < 12 ? "صباح الخير" : "مساء الخير"}${first ? "، " + h(first) : ""}</p><p class="w-quote">${W_PHRASES[ord % W_PHRASES.length]}</p></div>
      <p class="w-date"><span>${today.getDate()} ${W_MONTHS[today.getMonth()]} ${today.getFullYear()}</span>${hij ? `<span class="w-hijri">${hij}</span>` : ""}</p></div>
      <ol class="w-week" aria-label="أيام أسبوع العمل${weekend ? " — عطلة نهاية الأسبوع" : ""}">${days.map(([l, st]) => `<li class="${st}"${st === "today" ? ' aria-current="date"' : ""}><span>${l}</span><i aria-hidden="true"></i></li>`).join("")}</ol>
      ${weekend ? '<p class="w-off">عطلة نهاية الأسبوع — نتمنى لك راحة طيبة.</p>' : ""}</section>`;
  }
  V.dashboard = (u, q) => {
    if (u.role === "employee") { go("#/me"); return ""; }
    escalateOverdue();
    const y = pickYear(q), emps = managedEmps(u), ids = new Set(emps.map((e) => e.id)), adm = u.role === "admin";
    const t = { gd: 0, gh: 0, cap: 0, none: 0, geq: 0, ueq: 0, peq: 0 }; const near = [], byOff = {}, bals = new Map();
    emps.forEach((e) => { const b = balance(e.id, y); bals.set(e.id, b); t.gd += b.gDays; t.gh += b.gHours; t.geq += b.grantedEq; t.ueq += b.usedEq; t.peq += b.pDays + b.pHours / y.hpd;
      if (b.capLeftHours <= 0) t.cap++; else if (b.capPct >= 80) near.push([e, b]); if (!b.gDays && !b.gHours) t.none++;
      const k = mgrName(e) || "— غير مُسند —"; const o = byOff[k] || (byOff[k] = { c: 0, g: 0, u: 0, l: 0, p: 0, old: 0 }); o.c++; o.g += b.grantedEq; o.u += b.usedEq; o.l += Math.max(b.totalHours - (b.pDays * y.hpd + b.pHours), 0) / y.hpd; });
    const G = round2(t.geq), avail = round2(Math.max(t.geq - t.ueq - t.peq, 0));
    const pie = [["used", "مستخدم", round2(t.ueq)], ["pending", "معلّق بانتظار الاعتماد", round2(t.peq)], ["avail", "متاح", avail]].map(([key, label, value]) => ({ key, label, value, pct: G ? Math.round((value / G) * 100) : 0 }));
    const pending = DB.leaves.filter((r) => r.status === "pending" && ids.has(r.emp) && canManage(u, byId("emps", r.emp))).sort((a, b) => a.created.localeCompare(b.created));
    pending.forEach((r) => { r._age = ageDays(r.created); const o = byOff[mgrName(byId("emps", r.emp)) || "— غير مُسند —"]; if (o) { o.p++; o.old = Math.max(o.old, r._age); } });
    const oldest = Math.max(0, ...pending.map((r) => r._age)), unread = DB.msgs.filter((m) => m.to === u.id && !m.read).length;
    // تنبيهات تحتاج إجراء
    const alerts = [], A = (level, icon, text, href, cta) => alerts.push({ level, icon, text, href, cta });
    const late = pending.filter((r) => r._age >= LATE_DAYS).length; let lapseList = [];
    if (late) A("err", "hourglass", `طلبات تجاوزت مدة القرار المعتمدة (${daysAr(LATE_DAYS)}): ${cnt(late, "req")}، أقدمها منذ ${daysAr(oldest)}.`, "#/approvals", "مراجعة الاعتمادات");
    if (u.role === "officer") { const t0 = todayISO(); if (Number(t0.slice(5, 7)) >= 10 && y.start <= t0 && t0 <= y.end) { const lapse = emps.filter((e) => e.active && bals.get(e.id) && bals.get(e.id).bookable > 0); if (lapse.length) { lapseList = lapse.sort((a, b) => bals.get(b.id).bookable - bals.get(a.id).bookable); A("warn", "calendar", `${cnt(lapse.length, "emp")} في فريقك لديهم رصيد متاح (${daysAr(lapse.reduce((s2, e) => s2 + bals.get(e.id).bookable, 0))} إجمالاً) يسقط في ${y.end} لأن الرصيد لا يُرحَّل؛ ذكّرهم باستخدامه.`, "#lapse", "عرض وتذكير"); } } }
    let noAcc = 0, pendCards = 0;
    if (adm) {
      const backlog = Object.entries(byOff).filter(([k, o]) => o.old >= LATE_DAYS && k !== "— غير مُسند —").map(([k]) => k);
      if (backlog.length) A("warn", "userkey", "مسؤولون لديهم طلبات متأخرة: " + backlog.slice(0, 4).join("، ") + (backlog.length > 4 ? "…" : "") + ".", "#/approvals", "عرض الطلبات");
      const un = emps.filter((e) => e.active && !e.mgr).length;
      if (un) A("warn", "users", `${un} موظف غير مُسند لمسؤول شؤون موظفين، فلا يعتمد طلباتهم إلا مدير النظام.`, "#/employees?officer=-1", "إسنادهم");
      const linked = new Set(DB.users.filter((x) => x.emp).map((x) => x.emp)); noAcc = emps.filter((e) => e.active && !linked.has(e.id) && !isTmp(e)).length;
      if (noAcc) A("warn", "badge", `${noAcc} موظف نشط بلا حساب دخول، فلا يستطيعون استخدام النظام.`, "#/admin/users", "إنشاء الحسابات");
      const noMail = emps.filter((e) => e.active && !String(e.email || "").trim()).length;
      if (noMail) A("info", "mail", `${noMail} موظف بلا بريد إلكتروني، فتصلهم الإشعارات داخل النظام فقط.`, "#/admin/import", "تحديث البريد دفعة واحدة");
      const cards = DB.cards || []; pendCards = cards.filter((c) => c.pw).length; const stale = cards.filter((c) => { const cu = c.user && byId("users", c.user); return c.pw && cu && cu.active && !cu.last && ageDays(c.at) > 7; }).length;
      if (stale) A("info", "badge", `${stale} حساب لم يسجّل صاحبه الدخول بعد رغم مرور أكثر من أسبوع على إنشائه؛ تأكد من تسليم بطاقات الدخول.`, "#/admin/cards?state=pending", "عرض البطاقات");
      const now = new Date(), today = todayISO();
      if (now.getMonth() >= 9 && y.start <= today && today <= y.end) { const lapse = emps.filter((e) => bals.get(e.id).bookable > 0); if (lapse.length) A("info", "calendar", `${lapse.length} موظف لديهم رصيد متاح (${daysAr(lapse.reduce((s, e) => s + bals.get(e.id).bookable, 0))} إجمالاً) يسقط بنهاية السنة ${h(y.name)} لأن الرصيد لا يُرحَّل.`, "#/employees", "عرض الأرصدة"); }
      if (now.getMonth() >= 10 && !yearFor((now.getFullYear() + 1) + "-01-01")) A("err", "calendar-plus", `لم تُنشأ سنة ${now.getFullYear() + 1} بعد؛ لن تُقبل توصيات أو طلبات بتواريخها حتى تُنشأ.`, "#/admin/years", "إنشاء السنة");
      const lastB = DB.audit.find((a) => a.action === "backup_downloaded"), dd = lastB ? ageDays(lastB.at) : -1;
      if (dd < 0 || dd >= 7) A("info", "backup", (dd < 0 ? "لم تُنزَّل أي نسخة احتياطية من الواجهة بعد." : "مضى " + daysAr(dd) + " على آخر نسخة احتياطية منزّلة من الواجهة.") + " (النسخ الليلية على الخادم مستمرة.)", "#/admin/data", "تنزيل نسخة");
    }
    alerts.sort((a, b) => ({ err: 0, warn: 1, info: 2 }[a.level] - { err: 0, warn: 1, info: 2 }[b.level]));
    const empty = adm && !emps.length ? `<section class="card empty-start">${ico("upload", "lg")}<div><h2>ابدأ بإعداد النظام</h2><ol>
        <li>راجع <a href="#/admin/years">السنة وقواعد الرصيد</a> و<a href="#/admin/settings">هوية الجهة</a>.</li><li><a href="#/admin/import">استورد الموظفين</a> من ملف Excel، فتُنشأ حساباتهم وبطاقات دخولهم تلقائياً.</li>
        <li>حدّد حسابات <a href="#/admin/users">شؤون الموظفين</a> وأسند لكل منهم موظفيه، ثم اطبع <a href="#/admin/cards">بطاقات الدخول</a>.</li></ol><a class="btn primary" href="#/admin/import">${ico("upload", "sm-ico")}استيراد الموظفين</a></div></section>` : "";
    const quick = adm ? tiles([["appr", "#/approvals", "stamp", "الاعتمادات", cnt(pending.length, "req") + " بانتظار الاعتماد", pending.length], ["days", "#/admin/import", "upload", "استيراد الموظفين", "ملف Excel للإضافة أو التحديث"],
        ["hours", "#/admin/users", "userkey", "الحسابات الناقصة", cnt(noAcc, "emp") + " بلا حساب", noAcc], ["msg", "#/admin/cards?state=pending", "badge", "بطاقات الدخول", pendCards + " بطاقة سارية"]])
      : tiles([["days", "#/recs/new?kind=days", "calendar-plus", "توصية بدل راحة بالأيام", "رفع التوصية بأيام ممنوحة"], ["hours", "#/recs/new?kind=hours", "clock-plus", "توصية بدل راحة بالساعات", "كل " + n(y.hpd) + " ساعات = يوم"],
        ["appr", "#/approvals", "stamp", "طلبات الموظفين", cnt(pending.length, "req") + " بانتظار قرارك", pending.length], ["msg", "#/messages", "mail", "المراسلات", cnt(unread, "msg") + " غير مقروءة", unread]]);
    const lvlBadge = alerts.length ? (alerts[0].level === "err" ? "err" : alerts[0].level === "warn" ? "warn" : "muted") : "";
    return layout(u, "لوحة المؤشرات", `${welcomeBanner(u)}<div class="page-head"><div><h1>${ico("dashboard", "h-ico")} لوحة المؤشرات</h1><p>${adm ? "جميع الموظفين" : "الموظفون المسندون إليك"} · السنة ${h(y.name)} · الحد الأقصى ${daysAr(y.cap)} لكل موظف</p></div>${yearSelect(y)}</div>
      ${empty}${quick}${lapseList.length ? `<section class="card flush" id="lapse"><h2>${ico("calendar", "sm-ico")} رصيد يسقط بنهاية السنة <span class="badge warn">${cnt(lapseList.length, "emp")}</span></h2>
        <p class="hint pad">أرصدة متاحة لم تُستخدم وتسقط في <bdi class="d">${y.end}</bdi>. أرسل تذكيراً لأصحابها ليقدّموا طلباتهم في الوقت المناسب للعمل.</p>
        <div class="table-wrap"><table class="responsive"><caption class="sr-only">الموظفون الذين لديهم رصيد يسقط بنهاية السنة</caption><thead><tr><th>الموظف</th><th class="n">المتاح للطلب</th></tr></thead><tbody>
        ${lapseList.slice(0, 10).map((e) => `<tr><td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a></td><td class="n" data-label="المتاح للطلب">${daysAr(bals.get(e.id).bookable)}</td></tr>`).join("")}</tbody></table></div>
        <div class="pad"><button class="btn primary" type="button" data-act="remind-yearend" data-year="${y.id}">${ico("send", "sm-ico")}تذكير الجميع (${cnt(lapseList.length, "emp")})</button></div></section>` : ""}
      ${alerts.length ? `<section class="card alerts-panel" aria-labelledby="alerts-h"><h2 id="alerts-h">تنبيهات تحتاج إجراء <span class="badge ${lvlBadge}">${alerts.length}</span></h2><ul class="alert-list">
        ${alerts.map((a) => `<li class="lvl-${a.level}">${ico(a.icon)}<span class="txt">${a.text}</span><a class="btn sm" href="${a.href}">${a.cta}</a></li>`).join("")}</ul></section>` : ""}
      <div class="grid kpis">
        <div class="kpi brand">${ico("users")}<div class="l">الموظفون</div><div class="v">${emps.length}</div>${t.none ? `<div class="s">${t.none} بلا توصيات بعد</div>` : ""}</div>
        <div class="kpi accent">${ico("cal-check")}<div class="l">الممنوح بالتوصيات (معادل)</div><div class="v">${n(round2(t.geq))}</div><div class="s">يوماً · أيام ${n(t.gd)} · ساعات ${n(t.gh)}</div></div>
        <div class="kpi">${ico("calendar")}<div class="l">المستخدم (معادل)</div><div class="v">${n(round2(t.ueq))}</div><div class="s">يوماً من طلبات معتمدة</div></div>
        <div class="kpi ok">${ico("pie")}<div class="l">المتاح (معادل)</div><div class="v">${n(avail)}</div><div class="s">يوماً بعد خصم المعلّق${t.peq ? " (" + n(round2(t.peq)) + ")" : ""}</div></div>
        <div class="kpi warn">${ico("hourglass")}<div class="l">بلغوا الحد الأقصى</div><div class="v">${t.cap}</div><div class="s">${daysAr(y.cap)} في السنة</div></div></div>
      <div class="grid two">
        <section class="card"><h2>توزيع الرصيد الممنوح</h2><p class="hint chart-sub">بالأيام المعادلة (كل ${n(y.hpd)} ساعات = يوم) — السنة ${h(y.name)}</p>${G ? donut(pie, G, "يوم", "توزيع الرصيد الممنوح") : '<p class="empty">لم تُرفع توصيات في هذه السنة بعد.</p>'}</section>
        <section class="card flush"><h2>طلبات بانتظار الاعتماد${pending.length ? ` <span class="badge muted">${pending.length}</span>` : ""}</h2><div class="table-wrap"><table class="responsive"><thead><tr><th>الموظف</th><th>المدة</th><th>التاريخ</th><th>منذ</th></tr></thead><tbody>
          ${pending.slice(0, 8).map((r) => { const e = byId("emps", r.emp); return `<tr><td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a>${adm ? `<br><small class="muted">${h(mgrName(e) || "غير مُسند")}</small>` : ""}</td><td data-label="المدة">${leaveAmount(r)}</td><td data-label="التاريخ" class="num">${r.start}</td><td data-label="منذ">${ageBadge(r._age)}</td></tr>`; }).join("") || '<tr><td colspan="4" class="empty">لا توجد طلبات معلّقة.</td></tr>'}
        </tbody></table></div>${pending.length ? `<p class="pad"><a href="#/approvals">فتح الاعتمادات${pending.length > 8 ? " (" + pending.length + ")" : ""}</a></p>` : ""}</section></div>
      <div>
        ${adm ? `<section class="card flush"><h2>حسب مسؤول شؤون الموظفين</h2><div class="table-wrap"><table class="responsive"><thead><tr><th>مسؤول شؤون الموظفين</th><th class="n">موظفون</th><th class="n">ممنوح (يوم)</th><th class="n">مستخدم</th><th class="n">متاح</th><th class="n">معلّقة</th></tr></thead><tbody>
          ${Object.entries(byOff).sort((a, b) => b[1].c - a[1].c).map(([k, o]) => `<tr><td data-label="مسؤول شؤون الموظفين">${k === "— غير مُسند —" ? `<a href="#/employees?officer=-1">${k}</a>` : h(k)}</td><td class="n" data-label="موظفون">${o.c}</td><td class="n" data-label="ممنوح">${n(round2(o.g))}</td><td class="n" data-label="مستخدم">${n(round2(o.u))}</td><td class="n" data-label="متاح">${n(round2(o.l))}</td><td class="n" data-label="معلّقة">${o.p ? o.p + (o.old >= LATE_DAYS ? ` <span class="badge err late">أقدمها ${daysAr(o.old)}</span>` : "") : "—"}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">لا توجد بيانات.</td></tr>'}
          </tbody></table></div></section>` : ""}
        <section class="card"><h2>قاربوا الحد الأقصى (80% فأكثر)</h2>${near.length ? `<ul class="plain">${near.slice(0, 8).map(([e, b]) => `<li><a href="#/employee/${e.id}">${h(e.name)}</a> — ${n(b.grantedEq)} من ${n(b.cap)} يوماً</li>`).join("")}</ul>` : '<p class="empty">لا يوجد موظفون قاربوا الحد الأقصى.</p>'}</section>
      </div>`);
  };

  const REC_ST = { active: "سارية", pending: "بانتظار الاعتماد", rejected: "مرفوضة", cancelled: "ملغاة" };
  function recRows(u, rows, withEmp, manage) {
    return rows.map((r) => { const e = byId("emps", r.emp); return `<tr class="${r.status !== "active" ? "muted-row" : ""}"><td data-label="التاريخ" class="num">${r.date}</td>${withEmp ? `<td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a></td>` : ""}<td data-label="النوع">${kindBadge(r.kind)}</td><td data-label="القيمة"><b>${recAmount(r)}</b></td><td data-label="رقم خطاب التوصية">${h(r.refNo || "")}</td><td data-label="الموضوع">${h(r.subject)}${r.assignedBy || r.taskFrom ? `<small class="muted d-block">${h(r.assignedBy || "")}${r.taskFrom ? (r.assignedBy ? " · " : "") + `<bdi class="d">${r.taskFrom}</bdi>` + (r.taskTo && r.taskTo !== r.taskFrom ? ` ← <bdi class="d">${r.taskTo}</bdi>` : "") : ""}</small>` : ""}${r.batch ? ' <span class="badge muted" title="رُفعت بخطاب واحد لعدة موظفين">خطاب جماعي</span>' : ""}</td>
      <td data-label="الحالة">${statusBadge({ active: "approved", pending: "pending", rejected: "rejected" }[r.status] || "cancelled", REC_ST[r.status] || "ملغاة")}${r.cancelNote ? `<small class="muted d-block">${r.status === "rejected" ? "السبب: " : ""}${h(r.cancelNote)}</small>` : ""}</td>
      <td class="actions-cell">${r.status === "active" ? `<a class="btn sm" href="#/print/rec/${r.id}">خطاب المنح</a>` : ""}${r.status === "pending" && r.emp === u.emp ? `<button class="btn sm" type="button" data-act="rec-withdraw" data-id="${r.id}">سحب</button>` : ""} ${pdfChip(r.att)}${manage && r.status === "active" && canManage(u, e) ? ` <button class="btn sm danger" type="button" data-act="cancel-rec" data-id="${r.id}">إلغاء</button>` : ""}</td></tr>`; }).join("");
  }
  function leaveRows(u, rows, withEmp) {
    return rows.map((r) => { const e = byId("emps", r.emp), mg = canManage(u, e); return `<tr><td data-label="الرقم الصادر"><a class="num" href="#/requests/${r.id}" title="تفاصيل الطلب ومساره">${h(r.ref || r.id)}</a></td>${withEmp ? `<td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a></td>` : ""}<td data-label="المدة"><b>${leaveAmount(r)}</b>${r.kind !== "use" ? " " + kindBadge(r.kind) : ""}</td><td data-label="التاريخ">${dateRange(r)}</td><td data-label="السبب">${h(r.reason)}</td>
      <td data-label="الحالة">${statusBadge(r.status, REQ_ST[r.status])}${noteText(r) ? `<small class="muted d-block">${h(noteText(r))}</small>` : ""}</td>
      <td class="actions-cell"><a class="btn sm" href="#/requests/${r.id}" aria-label="تفاصيل طلب ${h(r.ref || r.id)}">التفاصيل</a><a class="btn sm" href="#/print/req/${r.id}">طباعة</a>
        ${mg && r.status === "pending" ? `<button class="btn sm ok" type="button" data-act="decide" data-a="approve" data-id="${r.id}">اعتماد</button><button class="btn sm danger" type="button" data-act="decide" data-a="reject" data-id="${r.id}">رفض</button>` : ""}
        ${(r.status === "pending" && r.emp === u.emp) || (mg && ["pending", "approved"].includes(r.status)) ? `${r.status === "approved" ? `<button class="btn sm danger" type="button" data-act="cancel-leave" data-id="${r.id}" data-need-note="1" title="لتصحيح خطأ (مثل التاريخ) أو لأي سبب آخر">إلغاء الاعتماد</button>` : `<button class="btn sm" type="button" data-act="cancel-leave" data-id="${r.id}">إلغاء</button>`}` : ""}</td></tr>`; }).join("");
  }
  const recHead = (withEmp) => `<thead><tr><th>التاريخ</th>${withEmp ? "<th>الموظف</th>" : ""}<th>النوع</th><th>القيمة</th><th>رقم خطاب التوصية</th><th>الموضوع</th><th>الحالة</th><th></th></tr></thead>`;
  const leaveHead = (withEmp) => `<caption class="sr-only">طلبات معالجة الغياب</caption><thead><tr><th>الرقم الصادر</th>${withEmp ? "<th>الموظف</th>" : ""}<th>المدة</th><th>التاريخ</th><th>السبب</th><th>الحالة</th><th></th></tr></thead>`;

  V.me = (u, q) => {
    const e = empOf(u); if (!e) { if (u.role === "employee") throw new Forbidden("حسابك غير مرتبط بسجل موظف."); go("#/dashboard"); return ""; }
    const y = pickYear(q), b = balance(e.id, y);
    const recs = DB.recs.filter((r) => r.emp === e.id && r.year === y.id).sort((a, c) => c.date.localeCompare(a.date));
    const reqs = DB.leaves.filter((r) => r.emp === e.id && r.year === y.id).sort((a, c) => c.created.localeCompare(a.created));
    const yEnd = (() => { const t = todayISO(); return Number(t.slice(5, 7)) >= 10 && y.start <= t && t <= y.end && b.bookable > 0 ? `<div class="alert warn" role="status">${ico("calendar", "sm-ico")}<span>لديك <b>${daysAr(b.bookable)}</b> متاحة للطلب تسقط في <bdi class="d">${y.end}</bdi>، لأن رصيد بدل الراحة لا يُرحَّل إلى السنة التالية.${y.empCanRequest ? ' <a href="#/requests/new">قدّم طلباً الآن</a>.' : ""}</span></div>` : ""; })();
    return layout(u, "رصيدي", `${u.role === "employee" ? welcomeBanner(u) : ""}<div class="page-head"><div><h1>${ico("pie", "h-ico")} رصيدي</h1><p>رصيد بدل الراحة للسنة ${h(y.name)}${e.mgr ? " · مسؤول شؤون الموظفين: " + h(mgrName(e)) : ""}</p></div>
      <div class="actions no-print">${yearSelect(y)}<a class="btn" href="#/print/stmt/${e.id}?year=${y.id}">طباعة تقرير</a></div></div>
      ${yEnd}${board(b, true)}
      ${tiles([...(y.empCanRequest ? [["days", "#/requests/new", "request", "طلب معالجة غياب", "استخدام رصيد بدل الراحة في تاريخ تختاره"]] : []), ...(y.empCanSubmitRec !== false ? [["hours", "#/recs/submit", "upload", "رفع توصية ممنوحة لي", "بالأيام أو بالساعات مع خطابها، للاعتماد"]] : []), ["msg", "#/messages/new", "send", "مراسلة شؤون الموظفين", "استفسار أو متابعة"]])}
      <section class="card flush"><div class="ledger-head"><span class="ledger-sign plus" aria-hidden="true">+</span><div><h2>ما أُضيف إلى رصيدك (التوصيات)</h2><p class="hint">بدل راحة مُنح لك بتوصية عن تكليف أنجزته، فزاد رصيدك.</p></div></div><div class="table-wrap"><table class="responsive">${recHead(false)}<tbody>${recRows(u, recs, false, false) || '<tr><td colspan="7" class="empty">لا توجد توصيات بعد.</td></tr>'}</tbody></table></div></section>
        <section class="card flush"><div class="ledger-head"><span class="ledger-sign minus" aria-hidden="true">−</span><div><h2>ما استخدمته من رصيدك (طلباتي)</h2><p class="hint">طلبات معالجة الغياب التي قدّمتها؛ يُخصم المعتمد منها من رصيدك.</p></div></div><div class="table-wrap"><table class="responsive">${leaveHead(false)}<tbody>${leaveRows(u, reqs.slice(0, 5), false) || '<tr><td colspan="6" class="empty">لا توجد طلبات.</td></tr>'}</tbody></table></div>${reqs.length > 5 ? `<p class="pad"><a href="#/requests?year=${y.id}">عرض كل طلباتي (${cnt(reqs.length, "req")})</a></p>` : ""}</section>`);
  };

  V.employee = (u, q, seg) => {
    if (seg[1] === "new") { need(u, ["admin"]); return empForm(u, null); }
    const e = byId("emps", seg[1]); if (!e) throw new Forbidden("الموظف غير موجود.");
    if (seg[2] === "edit") { need(u, ["admin"]); return empForm(u, e); }
    if (!canView(u, e)) throw new Forbidden("ليست لديك صلاحية لعرض بيانات هذا الموظف.");
    if (e.id === u.emp) { go("#/me"); return ""; }
    const y = pickYear(q), b = balance(e.id, y), mg = canManage(u, e);
    const recs = DB.recs.filter((r) => r.emp === e.id && r.year === y.id).sort((a, c) => c.date.localeCompare(a.date));
    const reqs = DB.leaves.filter((r) => r.emp === e.id && r.year === y.id).sort((a, c) => c.created.localeCompare(a.created));
    return layout(u, "كشف موظف", `<div class="page-head"><div><h1>${ico("user", "h-ico")} ${h(e.name)}</h1><p>${h(e.no)}${deptName(e) ? " · " + h(deptName(e)) : ""}${e.title ? " · " + h(e.title) : ""} · مسؤول شؤون الموظفين: ${h(mgrName(e) || "— غير مُسند —")}${e.email || e.phone || e.ext ? `<br><span class="contact-line">${[e.phone ? `الجوال: <a href="tel:${h(e.phone)}" dir="ltr">${h(e.phone)}</a>` : "", e.ext ? `التحويلة: <span dir="ltr">${h(e.ext)}</span>` : "", e.email ? `البريد: <a href="mailto:${h(e.email)}" dir="ltr">${h(e.email)}</a>` : ""].filter(Boolean).join(" · ")}</span>` : ""}</p></div>
      <div class="actions no-print">${yearSelect(y)}<a class="btn" href="#/print/stmt/${e.id}?year=${y.id}">طباعة تقرير</a>${u.role === "admin" ? `<a class="btn" href="#/employee/${e.id}/edit">تعديل البيانات</a>` : ""}</div></div>
      ${e.active ? "" : '<div class="alert warn">الموظف غير نشط.</div>'}
      ${u.role === "admin" ? (() => { const acc = DB.users.find((x) => x.emp === e.id), card = acc && (DB.cards || []).filter((c) => c.user === acc.id && c.pw).pop();
        return `<section class="card account-strip no-print">${ico("idcard")}${acc
          ? `<div><b>حساب الدخول:</b> <span class="num">${h(acc.username)}</span> · ${ROLES[acc.role]} · ${!acc.active ? '<span class="badge muted">معطّل</span>' : card ? '<span class="badge ok">البطاقة سارية</span>' : '<span class="badge ok">مفعّل</span>'}</div><div class="actions">${card ? `<a class="btn sm primary" href="#/print/cards?ids=${card.id}">طباعة بطاقة الدخول</a>` : ""}<a class="btn sm" href="#/admin/users">إدارة الحساب</a></div>`
          : `<div><b>لا يوجد حساب دخول لهذا الموظف</b><br><small class="hint">لن يستطيع الدخول إلى النظام حتى يُنشأ له حساب (اسم المستخدم = الرقم الوظيفي).</small></div>${e.active ? `<button class="btn sm primary" type="button" data-act="emp-account" data-id="${e.id}">إنشاء حساب دخول</button>` : ""}`}</section>`; })() : ""}
      ${board(b)}
      ${mg ? tiles([["days", "#/recs/new?kind=days&emp=" + e.id, "calendar-plus", "رفع توصية بالأيام", "المتاح للمنح: " + n(b.capLeftHours / b.hpd) + " يوم"], ["hours", "#/recs/new?kind=hours&emp=" + e.id, "clock-plus", "رفع توصية بالساعات", "المتاح للمنح: " + n(b.capLeftHours) + " ساعة"], ["appr", "#/requests/new?emp=" + e.id, "calendar", "تسجيل طلب نيابةً عنه", "طلب معالجة غياب"]]) : ""}
      <section class="card flush"><div class="ledger-head"><span class="ledger-sign plus" aria-hidden="true">+</span><div><h2>ما أُضيف إلى رصيده (التوصيات)</h2><p class="hint">بدل راحة مُنح بتوصية، فزاد الرصيد.</p></div></div><div class="table-wrap"><table class="responsive">${recHead(false)}<tbody>${recRows(u, recs, false, true) || '<tr><td colspan="7" class="empty">لا توجد توصيات في هذه السنة.</td></tr>'}</tbody></table></div></section>
      <section class="card flush"><div class="ledger-head"><span class="ledger-sign minus" aria-hidden="true">−</span><div><h2>ما استخدمه من رصيده (الطلبات)</h2><p class="hint">طلبات معالجة الغياب؛ يُخصم المعتمد منها من الرصيد.</p></div></div><div class="table-wrap"><table class="responsive">${leaveHead(false)}<tbody>${leaveRows(u, reqs, false) || '<tr><td colspan="7" class="empty">لا توجد طلبات.</td></tr>'}</tbody></table></div></section>`);
  };

  function letter(title, ref, extra, body, back) {
    const s = DB.settings; document.body.className = "print-page";
    return `<div class="actions no-print" style="justify-content:center;padding:1rem"><button class="btn primary" type="button" data-print>طباعة / حفظ PDF</button><a class="btn" href="${back}">رجوع</a></div>
    <article class="official"><header><div><h1>${h(s.university)}</h1><div>${h(s.college)}</div><div>نظام ${h(s.system_title)} — ${h(s.tagline)}</div></div>
      <div class="meta">الرقم المرجعي: ${h(ref)}<br>تاريخ الإصدار: ${todayISO()}${extra ? "<br>" + extra : ""}</div></header>
      <h2 class="letter-title">${title}</h2>${body}
      <footer class="letter-foot">صدر هذا المستند إلكترونياً من نظام «${h(s.system_title)}» — ${h(s.university)} · ${h(s.college)} (نسخة عرض)</footer></article>`;
  }
  const refNo = (p, id, d) => p + "-" + String(d).slice(0, 4) + "-" + String(id).padStart(5, "0");
  V.print = (u, q, seg) => {
    const kind = seg[1], id = seg[2];
    if (kind === "stmt") {
      const e = byId("emps", id); if (!e || !canView(u, e)) throw new Forbidden("ليست لديك صلاحية.");
      const y = pickYear(q), b = balance(e.id, y);
      const recs = DB.recs.filter((r) => r.emp === e.id && r.year === y.id && r.status === "active").sort((a, c) => a.date.localeCompare(c.date));
      const reqs = DB.leaves.filter((r) => r.emp === e.id && r.year === y.id && r.status === "approved").sort((a, c) => a.start.localeCompare(c.start));
      return letter("كشف رصيد بدل الراحة", "ST-" + y.name + "-" + e.no, "السنة: " + h(y.name), `
        <table><tbody><tr><th>اسم الموظف</th><td>${h(e.name)}</td><th>الرقم الوظيفي</th><td>${h(e.no)}</td></tr><tr><th>القسم</th><td>${h(deptName(e))}</td><th>مسؤول شؤون الموظفين</th><td>${h(mgrName(e))}</td></tr></tbody></table>
        <table class="mt"><thead><tr><th></th><th>ممنوح</th><th>مستخدم</th><th>معلّق</th><th>المتبقي</th></tr></thead><tbody>
          <tr><th>الأيام</th><td>${n(b.gDays)}</td><td>${b.uDays}</td><td>${b.pDays}</td><td><b>${n(b.daysLeft)}</b></td></tr>
          <tr><th>الساعات</th><td>${n(b.gHours)}</td><td>${n(b.uHours)}</td><td>${n(b.pHours)}</td><td><b>${n(b.hoursLeft)}</b></td></tr></tbody></table>
        <p>إجمالي الرصيد المتاح: <b>${daysAr(b.totalDays)}${b.totalRem ? " و" + hoursAr(b.totalRem) : ""}</b> (كل ${n(b.hpd)} ساعات تعادل يوماً). الممنوح خلال السنة ${n(b.grantedEq)} يوماً من حد أقصى ${n(b.cap)} يوماً.</p>
        <h3>التوصيات</h3><table><thead><tr><th>م</th><th>التاريخ</th><th>النوع</th><th>القيمة</th><th>رقم خطاب التوصية</th><th>الموضوع</th></tr></thead><tbody>
        ${recs.map((r, i) => `<tr><td>${i + 1}</td><td>${r.date}</td><td>${REC_KINDS[r.kind]}</td><td>${recAmount(r)}</td><td>${h(r.refNo || "")}</td><td>${h(r.subject)}</td></tr>`).join("") || '<tr><td colspan="6" style="text-align:center">لا توجد توصيات.</td></tr>'}</tbody></table>
        <h3>الطلبات المعتمدة</h3><table><thead><tr><th>م</th><th>النوع</th><th>من</th><th>إلى</th><th>المدة</th><th>السبب</th></tr></thead><tbody>
        ${reqs.map((r, i) => `<tr><td>${i + 1}</td><td>${LEAVE_KINDS[r.kind]}</td><td>${r.start}</td><td>${r.end}</td><td>${leaveAmount(r)}</td><td>${h(r.reason)}</td></tr>`).join("") || '<tr><td colspan="6" style="text-align:center">لا توجد طلبات معتمدة.</td></tr>'}</tbody></table>
        <div class="sign"><div>الموظف<br><b class="sign-name">${h(e.name)}</b></div><div>مسؤول شؤون الموظفين<br><b class="sign-name">${h(mgrName(e))}</b></div><div>مدير النظام</div></div>`, e.id === u.emp ? "#/me" : "#/employee/" + e.id);
    }
    if (kind === "rec" && byId("recs", id) && ["pending", "rejected"].includes(byId("recs", id).status)) throw new Forbidden("لا يصدر خطاب منح لتوصية لم تُعتمد.");
    if (kind === "rec") {
      const r = byId("recs", id), e = r && byId("emps", r.emp); if (!r || !canView(u, e)) throw new Forbidden("التوصية غير موجودة.");
      const y = byId("years", r.year), b = balance(e.id, y), by = byId("users", r.by), s = DB.settings;
      return letter("إشعار منح بدل راحة " + (r.kind === "days" ? "بالأيام" : "بالساعات"), (r.ref || refNo("REC", r.id, r.created)), "السنة: " + h(y.name), `
        ${r.status !== "active" ? `<p class="stamp-void">ملغى — ${h(r.cancelNote)}${r.cancelledAt ? " (" + r.cancelledAt + (r.cancelledBy ? " · " + h(displayName(byId("users", r.cancelledBy))) : "") + ")" : ""}</p>` : ""}
        <p>المكرم/ <b>${h(e.name)}</b> &nbsp; الرقم الوظيفي: ${h(e.no)}${deptName(e) ? " &nbsp; القسم: " + h(deptName(e)) : ""}</p><p>السلام عليكم ورحمة الله وبركاته،</p>
        <p>بناءً على التوصية${r.refNo ? " رقم (" + h(r.refNo) + ")" : ""} المؤرخة في ${r.date}${r.subject ? " بشأن: <b>" + h(r.subject) + "</b>" : ""}${r.assignedBy ? " بتكليف من " + h(r.assignedBy) : ""}${r.taskFrom ? "، عن الفترة " + (r.taskTo && r.taskTo !== r.taskFrom ? "من " + r.taskFrom + " إلى " + r.taskTo : r.taskFrom) : ""}، نفيدكم بأنه قد مُنح لكم <b>${REC_KINDS[r.kind]}</b> مقداره <b>${recAmount(r)}</b>${r.kind === "hours" ? " (تعادل " + n(r.amount / y.hpd) + " يوماً، كل " + n(y.hpd) + " ساعات = يوم)" : ""}، وأُضيف إلى رصيدكم في نظام «${h(s.system_title)}».</p>
        <table class="mt"><tbody><tr><th>رصيد الأيام الحالي</th><td>${n(b.daysLeft)}</td><th>رصيد الساعات الحالي</th><td>${n(b.hoursLeft)}</td></tr>
          <tr><th>إجمالي المتاح</th><td colspan="3">${daysAr(b.totalDays)}${b.totalRem ? " و" + hoursAr(b.totalRem) : ""} — الممنوح خلال السنة ${n(b.grantedEq)} من ${n(b.cap)} يوماً</td></tr></tbody></table>
        <p>وتقبلوا خالص التحية والتقدير،</p><div class="sign"><div>مسؤول شؤون الموظفين<br><b class="sign-name">${h(displayName(by))}</b></div><div>الموظف<br><b class="sign-name">${h(e.name)}</b></div></div>`, e.id === u.emp ? "#/me" : "#/employee/" + e.id);
    }
    if (kind === "req") {
      const r = byId("leaves", id), e = r && byId("emps", r.emp); if (!r || !canView(u, e)) throw new Forbidden("الطلب غير موجود.");
      const y = byId("years", r.year), b = balance(e.id, y), dec = r.decidedBy ? byId("users", r.decidedBy) : null;
      const by = r.by ? byId("users", r.by) : null, cby = r.cancelledBy ? byId("users", r.cancelledBy) : null;
      const F = (dt, dd, cls) => `<div${cls ? ` class="${cls}"` : ""}><dt>${dt}</dt><dd>${dd}</dd></div>`;
      return letter("نموذج طلب " + LEAVE_KINDS[r.kind], (r.ref || refNo("REQ", r.id, r.created)), "تاريخ الطلب: " + r.created.slice(0, 10), `
        <p class="f-status st-${r.status}">حالة الطلب: <b>${REQ_ST[r.status]}</b></p>
        <section class="f-sec"><h3>بيانات الموظف</h3><dl class="f-grid">${F("اسم الموظف", h(e.name))}${F("الرقم الوظيفي", `<span class="num">${h(e.no)}</span>`)}${F("القسم", h(deptName(e)) || "—")}${F("مسؤول شؤون الموظفين", h(mgrName(e)) || "—")}</dl></section>
        <section class="f-sec"><h3>تفاصيل الطلب</h3><dl class="f-grid three">${F("من تاريخ", `<span class="num">${r.start}</span>`)}${F("إلى تاريخ", `<span class="num">${r.end || r.start}</span>`)}${F("المدة", `<b>${leaveAmount(r)}</b>${r.unit === "hours" ? " <small>(من رصيد الساعات)</small>" : ""}`)}${F("سبب الغياب / ملاحظات", h(r.reason) || "—", "wide")}</dl></section>
        <section class="f-sec"><h3>قرار مسؤول شؤون الموظفين</h3><dl class="f-grid three">${F("القرار", `<b>${r.status !== "cancelled" ? REQ_ST[r.status] : r.decidedAt ? "معتمد ثم أُلغي" : "ملغى"}</b>`)}${F("صاحب القرار", dec ? h(displayName(dec)) : "—")}${F("تاريخ القرار", `<span class="num">${r.decidedAt || "—"}</span>`)}${r.note ? F("ملاحظة القرار", h(r.note), "wide") : ""}</dl></section>
        ${r.status === "cancelled" ? `<section class="f-sec void"><h3>إلغاء الطلب</h3><dl class="f-grid three">${F("أُلغي بواسطة", cby ? h(displayName(cby)) : "—")}${F("تاريخ الإلغاء", `<span class="num">${r.cancelledAt || "—"}</span>`)}${F("أُعيد الرصيد", "نعم")}${F("سبب الإلغاء", h(r.cancelNote) || "—", "wide")}</dl></section>` : ""}
        <section class="f-sec"><h3>الرصيد الحالي</h3><dl class="f-grid three">${F("رصيد الأيام", `<span class="num">${n(b.daysLeft)}</span>`)}${F("رصيد الساعات", `<span class="num">${n(b.hoursLeft)}</span>`)}${F("المتاح للطلب", `<b>${daysAr(b.bookable)}</b>`)}</dl></section>
        <div class="sign"><div>مقدم الطلب<br><b class="sign-name">${h(by ? displayName(by) : e.name)}</b></div><div>مسؤول شؤون الموظفين<br><b class="sign-name">${h(dec ? displayName(dec) : mgrName(e))}</b></div></div>`, e.id === u.emp ? "#/me" : "#/employee/" + e.id);
    }
    if (kind === "cards") {
      need(u, ["admin"]); const s0 = DB.settings, all = DB.cards || [], ids = (q.get("ids") || "").split(",").filter(Boolean).map(Number), batch = q.get("batch") || "", st = q.get("state") || "pending";
      const rows = ids.length ? all.filter((c) => ids.includes(c.id)) : all.filter((c) => (!batch || c.batch === batch) && (st !== "pending" || !!c.pw));
      const loginUrl = location.href.split("#")[0];
      document.body.className = "print-page";
      return `<div class="actions no-print" style="justify-content:center;padding:1rem"><button class="btn primary" type="button" data-print>طباعة / حفظ PDF</button><a class="btn" href="#/admin/cards">رجوع</a></div>
        ${rows.length ? "" : '<p class="empty no-print" style="text-align:center">لا توجد بطاقات سارية.</p>'}
        <div class="login-cards">${rows.map((c) => `<article class="login-card"><header><img src="assets/logo.svg?v=${ASSET_V}" alt="" width="34" height="34"><div><b>${h(s0.system_title)}</b><small>${h(s0.college)} · ${h(s0.university)}</small></div><span class="lc-tag">بطاقة دخول</span></header>
          <h3>${h(c.name)}</h3><p class="lc-meta">${c.no ? "الرقم الوظيفي: " + h(c.no) + " · " : ""}${ROLES[c.role] || c.role}</p>
          <dl><dt>اسم المستخدم</dt><dd class="num">${h(c.username)}</dd><dt>كلمة المرور</dt><dd class="num">${c.pw ? h(c.pw) : "— غُيّرت —"}</dd></dl>
          <p class="lc-url">رابط الدخول: <span class="num">${h(loginUrl)}</span></p><p class="lc-note">يمكنك تغيير كلمة المرور متى شئت من «الملف الشخصي». احتفظ بالبطاقة بسرّية ولا تشاركها.</p><footer>أُصدرت: ${h(c.at)} · نسخة عرض</footer></article>`).join("")}</div>`;
    }
    if (kind === "msg") {
      const m = byId("msgs", id); if (!m || ![m.to, m.from].includes(u.id)) throw new Forbidden("الرسالة غير موجودة.");
      const fr = m.from ? byId("users", m.from) : null, to = byId("users", m.to);
      return letter("خطاب: " + h(m.subject), refNo("MSG", m.id, m.at), "", `<table><tbody><tr><th>من</th><td>${fr ? h(displayName(fr)) + " (" + ROLES[fr.role] + ")" : "نظام " + h(DB.settings.system_title)}</td><th>إلى</th><td>${h(displayName(to))} (${ROLES[to.role]})</td></tr><tr><th>التاريخ</th><td colspan="3">${m.at}</td></tr></tbody></table>
        <div class="letter-body">${h(m.body)}</div><div class="sign"><div>المرسل<br><b class="sign-name">${fr ? h(displayName(fr)) : "نظام " + h(DB.settings.system_title)}</b></div></div>`, "#/messages/" + m.id);
    }
    throw new Forbidden("الصفحة غير موجودة.");
  };

  V.employees = (u, q) => {
    need(u, STAFF);
    const y = pickYear(q), qs = (q.get("q") || "").trim(), dept = Number(q.get("dept") || 0), off = Number(q.get("officer") || 0), st = q.get("state") || "";
    let list = managedEmps(u, st === "inactive"); if (st === "inactive") list = list.filter((e) => !e.active);
    if (qs) list = list.filter((e) => norm(e.name).includes(norm(qs)) || e.no.includes(qs));
    if (dept) list = list.filter((e) => e.dept === dept);
    if (off === -1) list = list.filter((e) => !e.mgr); else if (off) list = list.filter((e) => e.mgr === off);
    let rows = list.map((e) => [e, balance(e.id, y)]);
    if (st === "cap") rows = rows.filter(([, b]) => b.capLeftHours <= 0); if (st === "none") rows = rows.filter(([, b]) => !b.gDays && !b.gHours);
    const admin = u.role === "admin";
    return layout(u, admin ? "الموظفون والأرصدة" : "قائمة الموظفين", `${admin ? peopleTabs("list") : ""}<div class="page-head"><div><h1>${ico("users", "h-ico")} ${admin ? "الموظفون والأرصدة" : "الموظفون المسندون إليّ"}</h1><p>السنة ${h(y.name)} · ${cnt(rows.length, "emp")} · الحد الأقصى ${daysAr(y.cap)}</p></div>
      <div class="actions"><button class="btn" type="button" data-act="export" data-kind="balances" data-year="${y.id}">${ico("download", "sm-ico")}تصدير Excel</button>${admin ? '<a class="btn primary" href="#/employee/new">+ إضافة موظف</a>' : ""}</div></div>
      <form class="card filters" data-form="filter" data-route="employees" role="search">
        <div class="field grow"><label for="q">بحث بالاسم أو الرقم الوظيفي</label><input id="q" type="search" name="q" value="${h(qs)}"></div>
        <div class="field"><label for="dept">القسم${u.role === "admin" ? ' <a class="hint" href="#/admin/depts">إدارة الأقسام</a>' : ""}</label><select id="dept" name="dept"><option value="">الكل</option>${DB.depts.map((d) => `<option value="${d.id}" ${dept === d.id ? "selected" : ""}>${h(d.name)}</option>`).join("")}</select></div>
        ${admin ? `<div class="field"><label for="of">مسؤول شؤون الموظفين</label><select id="of" name="officer"><option value="">الكل</option><option value="-1" ${off === -1 ? "selected" : ""}>— غير مُسند —</option>${officers().map((o) => `<option value="${o.id}" ${off === o.id ? "selected" : ""}>${h(o.name)}</option>`).join("")}</select></div>` : ""}
        <div class="field"><label for="st">تصفية</label><select id="st" name="state"><option value="">النشطون</option><option value="cap" ${st === "cap" ? "selected" : ""}>بلغوا الحد الأقصى</option><option value="none" ${st === "none" ? "selected" : ""}>بلا توصيات</option><option value="inactive" ${st === "inactive" ? "selected" : ""}>غير النشطين</option></select></div>
        ${yearSelect(y)}<button class="btn primary">عرض</button></form>
      <div class="card flush"><div class="table-wrap"><table class="responsive"><thead><tr><th>م</th><th>اسم الموظف</th><th>الرقم الوظيفي</th>${admin ? "<th>مسؤول شؤون الموظفين</th>" : ""}<th class="n">رصيد الأيام</th><th class="n">رصيد الساعات</th><th class="n">المتاح للطلب</th><th class="n">معلّقة</th><th>من الحد الأقصى</th><th></th></tr></thead><tbody>
      ${rows.map(([e, b], i) => `<tr><td data-label="م">${i + 1}</td><td data-label="الاسم"><a href="#/employee/${e.id}?year=${y.id}">${h(e.name)}</a>${isDelegated(u, e) ? ` <span class="badge muted" title="فريق ${h(mgrName(e))}">بالتفويض</span>` : ""}${deptName(e) ? `<small class="muted d-block">${h(deptName(e))}</small>` : ""}</td><td data-label="الرقم" class="num">${h(e.no)}</td>
        ${admin ? `<td data-label="مسؤول شؤون الموظفين">${h(mgrName(e) || "—")}</td>` : ""}<td class="n" data-label="رصيد الأيام">${n(b.daysLeft)}</td><td class="n" data-label="رصيد الساعات">${n(b.hoursLeft)}</td>
        <td class="n" data-label="المتاح للطلب"><b>${daysAr(b.bookable)}</b>${b.hAvailRem ? `<small class="muted d-block">و${hoursAr(b.hAvailRem)} لا تكفي ليوم</small>` : ""}</td>
        <td class="n" data-label="طلبات معلّقة">${(() => { const c = DB.leaves.filter((r) => r.emp === e.id && r.status === "pending").length; return c ? `<a class="badge warn" href="#/requests?emp=${e.id}&status=pending">${c}</a>` : "—"; })()}</td>
        <td data-label="من الحد"><div class="meter"><div class="progress"><span style="width:${b.capPct}%"></span></div><span class="num">${n(b.grantedEq)}/${n(b.cap)}</span></div></td>
        <td class="actions-cell"><a class="btn sm" href="#/recs/new?kind=days&emp=${e.id}" aria-label="توصية بالأيام لـ${h(e.name)}">+ أيام</a> <a class="btn sm" href="#/recs/new?kind=hours&emp=${e.id}" aria-label="توصية بالساعات لـ${h(e.name)}">+ ساعات</a></td></tr>`).join("") || `<tr><td colspan="10" class="empty">لا توجد نتيجة.${u.role === "officer" ? " لم يُسند إليك موظفون بعد — تواصل مع مدير النظام." : ""}</td></tr>`}
      </tbody></table></div></div>`);
  };

  function empForm(u, e) {
    const offs = officers().filter((o) => !e || o.id !== e.id);
    return layout(u, e ? "تعديل بيانات موظف" : "إضافة موظف", `<div class="page-head"><h1>${e ? h(e.name) : "إضافة موظف جديد"}</h1></div>
      <form class="card" data-form="employee" data-id="${e ? e.id : ""}"><div class="form-grid">
        <div class="field"><label for="no">الرقم الوظيفي *</label><input id="no" name="no" required value="${e ? h(e.no) : ""}"></div>
        <div class="field"><label for="nm">الاسم *</label><input id="nm" name="name" required value="${e ? h(e.name) : ""}"></div>
        <div class="field"><label for="dp">القسم</label><select id="dp" name="dept"><option value="">—</option>${DB.depts.filter((d) => d.active).map((d) => `<option value="${d.id}" ${e && e.dept === d.id ? "selected" : ""}>${h(d.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="mg">مسؤول شؤون الموظفين <span class="hint">(يرفع توصياته ويعتمد طلباته)</span></label><select id="mg" name="mgr"><option value="">— غير مُسند —</option>${offs.map((o) => `<option value="${o.id}" ${e && e.mgr === o.id ? "selected" : ""}>${h(o.name)} (${h(o.no)})</option>`).join("")}</select></div>
        <div class="field"><label for="tt">المسمى الوظيفي</label><input id="tt" name="title" value="${e ? h(e.title) : ""}"></div>
        <div class="field"><label for="em">البريد الإلكتروني <span class="hint">(للإشعارات)</span></label><input id="em" type="email" name="email" dir="ltr" value="${e ? h(e.email) : ""}"></div>
        <div class="field"><label for="ph">رقم الجوال</label><input id="ph" type="tel" name="phone" dir="ltr" inputmode="tel" placeholder="05XXXXXXXX" value="${e ? h(e.phone || "") : ""}"></div>
        <div class="field"><label for="ex">التحويلة</label><input id="ex" name="ext" dir="ltr" inputmode="numeric" value="${e ? h(e.ext || "") : ""}"></div></div>
        ${e ? `<label class="check"><input type="checkbox" name="active" value="1" ${e.active ? "checked" : ""}> على رأس العمل (نشط)</label>` : `<label class="check"><input type="checkbox" name="create_account" value="1" checked> إنشاء حساب دخول للموظف تلقائياً <span class="hint">(اسم المستخدم = الرقم الوظيفي، وكلمة مرور أولية تُحفظ في «بطاقات الدخول»)</span></label>`}
        <div class="actions"><button class="btn primary">حفظ</button><a class="btn" href="${e ? "#/employee/" + e.id : "#/employees"}">إلغاء</a></div></form>
      ${e && u.emp !== e.id ? (() => { const bl = empDeleteBlockers(e); return `<details class="card danger-zone form-narrow" id="delete"><summary><b>${ico("audit", "sm-ico")} حذف الموظف</b> <span class="hint">لمن أُدخل بالخطأ فقط</span></summary>
        ${bl.length ? `<div class="alert warn" role="note">لا يمكن حذف هذا الموظف: ${h(bl.join("، و"))}. للحفاظ على السجلات والمراجعة أوقفه بإلغاء «على رأس العمل (نشط)» أعلاه بدلاً من حذفه.</div>`
          : `<p class="hint">يُحذف سجل الموظف نهائياً مع حسابه وبطاقة دخوله ورسائله، ويُسجَّل الحذف في سجل التدقيق.</p><form class="filters" data-form="del-emp" data-id="${e.id}"><div class="field"><label for="cn">اكتب الرقم الوظيفي «${h(e.no)}» للتأكيد</label><input id="cn" name="confirm_no" autocomplete="off" required dir="ltr"></div><button class="btn danger">حذف الموظف</button></form>`}</details>`; })() : ""}`);
  }

  V.recs = (u, q, seg) => {
    if (seg[1] === "new") return recForm(u, q);
    if (seg[1] === "submit") return recSubmitForm(u, q);
    const y = pickYear(q), kind = q.get("kind") || "", emp = Number(q.get("emp") || 0), ids = new Set(visibleEmps(u, true).map((e) => e.id));
    const rows = DB.recs.filter((r) => r.year === y.id && ids.has(r.emp) && (!kind || r.kind === kind) && (!emp || r.emp === emp)).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    return layout(u, "سجل التوصيات", `<div class="page-head"><div><h1>${ico("cal-check", "h-ico")} سجل التوصيات</h1><p>السنة ${h(y.name)} · ${cnt(rows.length, "rec")}</p></div>
      <div class="actions">${STAFF.includes(u.role) ? `<button class="btn" type="button" data-act="export" data-kind="recs" data-year="${y.id}">${ico("download", "sm-ico")}تصدير Excel</button><a class="btn primary" href="#/recs/new?kind=days">+ توصية بالأيام</a><a class="btn primary" href="#/recs/new?kind=hours">+ توصية بالساعات</a>` : ""}</div></div>
      <form class="card filters" data-form="filter" data-route="recs"><div class="field"><label for="k">النوع</label><select id="k" name="kind"><option value="">الكل</option><option value="days" ${kind === "days" ? "selected" : ""}>بالأيام</option><option value="hours" ${kind === "hours" ? "selected" : ""}>بالساعات</option></select></div>
        <div class="field grow"><label for="e">الموظف</label><select id="e" name="emp">${empOptions(managedEmps(u, true), emp, "الكل")}</select></div>${yearSelect(y)}<button class="btn primary">عرض</button></form>
      <div class="card flush"><div class="table-wrap"><table class="responsive">${recHead(true)}<tbody>${recRows(u, rows, true, true) || '<tr><td colspan="8" class="empty">لا توجد توصيات.</td></tr>'}</tbody></table></div></div>`);
  };
  function recForm(u, q) {
    need(u, STAFF);
    const kind = q.get("kind") === "hours" ? "hours" : "days", isD = kind === "days", emp = Number(q.get("emp") || 0) || "", y = activeYear(), emps = managedEmps(u), eq = emp ? "&emp=" + emp : "";
    return layout(u, "توصية جديدة", `<div class="page-head"><div><h1>${ico(isD ? "calendar-plus" : "clock-plus", "h-ico")} توصية بدل راحة ${isD ? "بالأيام" : "بالساعات"}</h1>
      <p>ترفع التوصية (PDF) في حساب الموظف أو عدة موظفين، وتُضاف القيمة إلى رصيده فوراً. الحد الأقصى السنوي ${daysAr(y.cap)} (الأيام والساعات معاً)${isD ? "" : "، وكل " + n(y.hpd) + " ساعات تعادل يوماً"}.</p></div>
      <div class="seg" role="tablist" aria-label="نوع التوصية"><a href="#/recs/new?kind=days${eq}" class="${isD ? "on" : ""}">بالأيام</a><a href="#/recs/new?kind=hours${eq}" class="${isD ? "" : "on"}">بالساعات</a></div></div>
      ${!emps.length ? '<div class="alert warn">لا يوجد موظفون مسندون إليك. يُسند مدير النظام الموظفين إلى مسؤول شؤون الموظفين من بطاقة الموظف.</div>' : `
      <form class="card form-narrow" data-form="rec" data-kind="${kind}">
        <fieldset class="field assign-box pick-box" data-pick-box><legend class="assign-head"><b>الموظفون *</b><span class="hint" data-pick-count></span></legend>
          <p class="hint">اختر موظفاً واحداً، أو عدة موظفين شاركوا في التكليف نفسه (كاللجان والمراقبة) فتُرفع لهم التوصية بخطاب واحد وملف PDF واحد، وتُضاف القيمة نفسها إلى رصيد كل منهم.</p>
          ${emps.length > 6 ? '<input type="search" class="assign-filter" placeholder="بحث بالاسم أو الرقم أو القسم" data-assign-filter aria-label="بحث في الموظفين"><div class="assign-actions"><button type="button" class="btn sm" data-assign-all="1">تحديد الظاهر</button><button type="button" class="btn sm" data-assign-all="0">إلغاء التحديد</button></div>' : ""}
          <div class="check-list">${emps.map((e) => { const b = balance(e.id, y), full = b.capLeftHours <= 0; return `<label class="check${full ? " is-off" : ""}" data-text="${h(e.name)} ${h(e.no)} ${h(deptName(e))}"><input type="checkbox" name="emps" value="${e.id}" ${String(emp) === String(e.id) ? "checked" : ""} ${full ? "disabled" : ""}><span>${h(e.name)} <small class="muted">(${h(e.no)}) · ${full ? "بلغ الحد الأقصى" : "المتاح للمنح: " + (isD ? n(b.capLeftHours / b.hpd) + " يوم" : n(b.capLeftHours) + " ساعة")}</small></span></label>`; }).join("")}</div></fieldset>
        <div class="form-grid">
          <div class="field"><label for="am">${isD ? "عدد الأيام الممنوحة" : "عدد الساعات الممنوحة"} *</label><input id="am" name="amount" type="number" required min="${isD ? 1 : 0.25}" step="${isD ? 1 : 0.25}" inputmode="decimal"></div>
          <div class="field"><label for="dt">تاريخ التوصية *</label><input id="dt" name="date" type="date" required value="${yearFor(todayISO()) ? todayISO() : y.start}"></div>
          <div class="field"><label for="rf">رقم التوصية / الخطاب</label><input id="rf" name="ref" maxlength="64"></div></div>
        <div class="field"><label for="sb">موضوع التكليف</label><input id="sb" name="subject" placeholder="مثال: المراقبة في الاختبارات النهائية"></div>
        <div class="form-grid"><div class="field"><label for="ab">جهة التكليف</label><input id="ab" name="assigned_by" maxlength="160" placeholder="مثال: وكالة الكلية للشؤون الأكاديمية"></div>
          <div class="field"><label for="tf">فترة التكليف: من</label><input id="tf" name="task_from" type="date"></div>
          <div class="field"><label for="tt">إلى</label><input id="tt" name="task_to" type="date"><span class="hint">اختياري؛ متى أُنجز العمل الإضافي.</span></div></div>
        <div class="field"><label for="fl">ملف التوصية (PDF)${y.reqRecAtt ? " *" : ""}</label><input id="fl" name="file" type="file" accept="application/pdf,.pdf" ${y.reqRecAtt ? "required" : ""}><span class="hint">نسخة العرض تتحقق من الملف ولا تحفظ محتواه.</span></div>
        <div class="actions"><button class="btn primary" data-pick-submit>رفع التوصية وإضافة الرصيد</button><a class="btn" href="#/recs">إلغاء</a></div></form>`}`);
  }

  V.requests = (u, q, seg) => {
    if (seg[1] === "new") return reqForm(u, q);
    if (seg[1] && /^\d+$/.test(seg[1])) return reqView(u, Number(seg[1]));
    const y = pickYear(q), kind = q.get("kind") || "", st = q.get("status") || "", emp = Number(q.get("emp") || 0), ids = new Set(visibleEmps(u, true).map((e) => e.id)), isE = u.role === "employee";
    const rows = DB.leaves.filter((r) => r.year === y.id && ids.has(r.emp) && !(u.role === "officer" && r.emp === u.emp) && (!kind || r.kind === kind) && (!st || r.status === st) && (!emp || r.emp === emp)).sort((a, b) => b.created.localeCompare(a.created));
    const pendN = isE ? 0 : DB.leaves.filter((r) => r.status === "pending" && canManage(u, byId("emps", r.emp))).length;
    return layout(u, isE ? "طلباتي" : "طلبات الموظفين", `${isE ? "" : requestTabs("all", pendN, u.role === "admin")}<div class="page-head"><div><h1>${ico("inbox", "h-ico")} ${isE ? "طلباتي" : "طلبات معالجة الغياب"}</h1><p>السنة ${h(y.name)} · ${cnt(rows.length, "req")}</p></div>
      <div class="actions">${STAFF.includes(u.role) ? `<button class="btn" type="button" data-act="export" data-kind="requests" data-year="${y.id}">${ico("download", "sm-ico")}تصدير Excel</button>` : ""}<a class="btn primary" href="#/requests/new">+ طلب معالجة غياب</a></div></div>
      <form class="card filters" data-form="filter" data-route="requests"><div class="field"><label for="s">الحالة</label><select id="s" name="status"><option value="">الكل</option>${Object.entries(REQ_ST).map(([k, v]) => `<option value="${k}" ${st === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        ${isE ? "" : `<div class="field grow"><label for="e">الموظف</label><select id="e" name="emp">${empOptions(u.role === "officer" ? managedEmps(u, true) : visibleEmps(u, true), emp, "الكل")}</select></div>`}${yearSelect(y)}<button class="btn primary">عرض</button></form>
      <div class="card flush"><div class="table-wrap"><table class="responsive">${leaveHead(!isE)}<tbody>${leaveRows(u, rows, !isE) || `<tr><td colspan="${isE ? 6 : 7}" class="empty">لا توجد طلبات.</td></tr>`}</tbody></table></div></div>`);
  };
  function reqForm(u, q) {
    const kind = "use", y = activeYear();
    const managed = STAFF.includes(u.role) ? managedEmps(u) : [], self = empOf(u);
    if (!managed.length && !self) throw new Forbidden("حسابك غير مرتبط بسجل موظف.");
    if (self && !managed.length && !y.empCanRequest) throw new Forbidden("تقديم الطلبات من الموظفين غير مفعّل حالياً. تواصل مع مسؤول شؤون الموظفين.");
    const emp = Number(q.get("emp") || 0) || (self && !managed.length ? self.id : 0), b = emp ? balance(emp, y) : null, eq = emp ? "&emp=" + emp : "";
    return layout(u, "طلب معالجة غياب", `<div class="page-head"><div><h1>${ico("request", "h-ico")} طلب معالجة غياب</h1>
      <p>حدّد مدة الغياب المراد معالجتها، ويُخصم من رصيدك بالأيام بعد اعتماد مسؤول شؤون الموظفين.</p></div></div>
      ${b ? balanceLine(b) : ""}
      <form class="card form-narrow" data-form="leave" data-kind="${kind}" data-leave-form data-days-preview>
        ${managed.length ? `<div class="field"><label for="emp">الموظف *</label><select id="emp" name="emp" required data-reqemp="${kind}"><option value="">— اختر —</option>${self ? `<option value="${self.id}" ${emp === self.id ? "selected" : ""}>${h(self.name)} (أنا)</option>` : ""}${managed.map((e) => `<option value="${e.id}" ${emp === e.id ? "selected" : ""}>${h(e.name)} — ${h(e.no)}</option>`).join("")}</select></div>` : `<input type="hidden" name="emp" value="${emp}">`}
        <div class="alert info days-only">${ico("calendar")}<div><b>تُعالج الطلبات بالأيام فقط.</b> تُحوَّل ساعات التوصيات إلى أيام تلقائياً: كل ${n(y.hpd)} ساعات = يوم، وما يتبقى دون ذلك لا يُستخدم حتى يكتمل يوماً بتوصيات لاحقة.</div></div>
        <div class="form-grid">
          <div class="field"><label for="sd">من تاريخ *</label><input id="sd" name="start" type="date" required></div>
          <div class="field"><label for="ed">إلى تاريخ</label><input id="ed" name="end" type="date"><span class="hint">تُستبعد عطلة نهاية الأسبوع والعطل الرسمية من العدد. يُخصم من رصيد الأيام أولاً، ثم من الساعات المحوّلة.</span></div>
</div>
        <p class="days-preview" data-days-out role="status" aria-live="polite"></p>
        <div class="field"><label for="rs">سبب الغياب / ملاحظات</label><textarea id="rs" name="reason"></textarea></div>
        <div class="field"><label for="fl">مستند مؤيد (PDF)${y.reqReqAtt ? " *" : ""}</label><input id="fl" name="file" type="file" accept="application/pdf,.pdf" ${y.reqReqAtt ? "required" : ""}></div>
        <div class="actions"><button class="btn primary">رفع الطلب</button><a class="btn" href="#/requests">إلغاء</a></div></form>`);
  }

  V.approvals = (u) => {
    need(u, STAFF); escalateOverdue();
    const rows = DB.leaves.filter((r) => r.status === "pending" && canManage(u, byId("emps", r.emp))).sort((a, b) => a.created.localeCompare(b.created));
    rows.forEach((r) => (r._age = ageDays(r.created)));
    const oldest = Math.max(0, ...rows.map((r) => r._age)), late = rows.filter((r) => r._age >= LATE_DAYS).length, anyBehalf = rows.some((r) => onBehalf(u, byId("emps", r.emp)));
    return layout(u, u.role === "admin" ? "الاعتمادات" : "طلبات الموظفين", `${requestTabs("pending", rows.length + DB.recs.filter((r) => r.status === "pending" && canManage(u, byId("emps", r.emp))).length, u.role === "admin")}<div class="page-head"><div><h1>${ico("stamp", "h-ico")} ${u.role === "admin" ? "الاعتمادات" : "بانتظار قراري"}</h1><p>${cnt(rows.length, "req")} بانتظار الاعتماد${rows.length ? " · أقدمها منذ " + (oldest ? daysAr(oldest) : "اليوم") : ""}${late ? ` · <b>المتأخرة (تجاوزت ${daysAr(LATE_DAYS)}): ${cnt(late, "req")}</b>` : ""}. يُخصم الرصيد عند الاعتماد، ويُعاد عند الرفض أو الإلغاء.</p></div></div>
      ${(() => { const pr = DB.recs.filter((r) => r.status === "pending" && canManage(u, byId("emps", r.emp))).sort((a, b) => a.created.localeCompare(b.created)); return pr.length ? `<section class="card flush" id="recs"><h2>${ico("cal-check", "sm-ico")} توصيات مرفوعة من الموظفين <span class="badge warn">${cnt(pr.length, "rec")}</span></h2><p class="hint pad">راجع خطاب التوصية المرفق، ثم اعتمدها لتُضاف إلى رصيد الموظف أو ارفضها مع ذكر السبب.</p>
        <div class="table-wrap"><table class="responsive"><caption class="sr-only">توصيات مرفوعة من الموظفين بانتظار الاعتماد</caption><thead><tr><th>الموظف</th><th>القيمة</th><th>الخطاب</th><th>موضوع التكليف</th><th>منذ</th><th></th></tr></thead><tbody>
        ${pr.map((r) => { const e = byId("emps", r.emp); return `<tr><td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a>${u.role === "admin" ? `<br><small class="muted">${h(mgrName(e) || "غير مُسند")}</small>` : ""}</td><td data-label="القيمة"><b>${recAmount(r)}</b></td>
          <td data-label="الخطاب">${h(r.refNo || "—")} · <bdi class="d">${r.date}</bdi> ${pdfChip(r.att)}</td><td data-label="موضوع التكليف">${h(r.subject)}${r.assignedBy || r.taskFrom ? `<small class="muted d-block">${h(r.assignedBy || "")}${r.taskFrom ? (r.assignedBy ? " · " : "") + `<bdi class="d">${r.taskFrom}</bdi>` + (r.taskTo && r.taskTo !== r.taskFrom ? ` ← <bdi class="d">${r.taskTo}</bdi>` : "") : ""}</small>` : ""}</td>
          <td data-label="منذ" class="age-col">${ageBadge(ageDays(r.created))}</td><td class="actions-cell"><button class="btn sm ok" type="button" data-act="rec-decide" data-a="approve" data-id="${r.id}">اعتماد</button><button class="btn sm danger" type="button" data-act="rec-decide" data-a="reject" data-id="${r.id}">رفض</button></td></tr>`; }).join("")}</tbody></table></div></section>` : ""; })()}
      ${anyBehalf ? '<div class="alert info" role="note">الطلبات المعلَّمة «بالنيابة» تخص موظفين مسندين لمسؤولي شؤون موظفين آخرين؛ قرارك فيها يُسجَّل بالنيابة ويُشعَر المسؤول الأصلي.</div>' : ""}
      ${rows.length ? `<div class="card flush"><div class="table-wrap"><table class="responsive"><caption class="sr-only">الطلبات بانتظار الاعتماد</caption><thead><tr><th><label class="chk"><input type="checkbox" data-check-all="req" aria-label="تحديد الكل"></label></th><th>الموظف</th><th>المدة</th><th>التاريخ</th><th>منذ</th><th>السبب</th><th>المتاح للطلب حالياً</th><th></th></tr></thead><tbody>
      ${rows.map((r) => { const e = byId("emps", r.emp), b = balance(e.id, byId("years", r.year)), ob = onBehalf(u, e); return `<tr><td data-label="تحديد"><label><input type="checkbox" name="req" value="${r.id}" aria-label="تحديد طلب ${h(e.name)}"></label></td>
        <td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a>${u.role === "admin" ? `<br><small class="muted">${h(mgrName(e) || "غير مُسند")}</small>${ob ? ' <span class="badge muted">بالنيابة</span>' : ""}` : ""}${isDelegated(u, e) ? `<br><small class="muted">فريق ${h(mgrName(e))}</small> <span class="badge muted">بالتفويض</span>` : ""}</td>
        <td data-label="المدة"><b>${leaveAmount(r)}</b>${r.kind !== "use" ? " " + kindBadge(r.kind) : ""}</td><td data-label="التاريخ">${dateRange(r)}</td><td data-label="منذ" class="age-col">${ageBadge(r._age)}</td>
        <td data-label="السبب">${h(r.reason) || "—"} ${pdfChip(r.att)}</td><td data-label="المتاح للطلب حالياً" title="بعد خصم جميع الطلبات المعلّقة، ومنها هذا الطلب">${daysAr(b.bookable)}</td>
        <td class="actions-cell"><button class="btn sm ok" type="button" data-act="decide" data-a="approve" data-id="${r.id}">اعتماد</button><button class="btn sm danger" type="button" data-act="decide" data-a="reject" data-id="${r.id}">رفض</button></td></tr>`; }).join("")}
      </tbody></table></div><div class="actions pad"><button class="btn ok" type="button" data-act="bulk" data-a="approve">اعتماد المحدد</button><button class="btn danger" type="button" data-act="bulk" data-a="reject">رفض المحدد</button></div></div>` : DB.recs.some((r) => r.status === "pending" && canManage(u, byId("emps", r.emp))) ? "" : '<div class="card empty">لا توجد طلبات أو توصيات بانتظار الاعتماد.</div>'}`);
  };

  V.messages = (u, q, seg) => {
    if (seg[1] === "new") return msgForm(u, q);
    if (seg[1]) return msgView(u, Number(seg[1]));
    const box = q.get("box") === "sent" ? "sent" : "in";
    const rows = DB.msgs.filter((m) => (box === "sent" ? m.from === u.id : m.to === u.id)).sort((a, b) => b.at.localeCompare(a.at));
    const unread = DB.msgs.filter((m) => m.to === u.id && !m.read).length;
    return layout(u, "المراسلات", `<div class="page-head"><div><h1>${ico("mail", "h-ico")} المراسلات</h1><p>رسائل داخل المنصة${box === "in" ? " · " + unread + " غير مقروءة" : ""}. في النظام الفعلي تصل نسخة بالبريد الإلكتروني لمن لديه بريد مسجّل.</p></div><div class="actions"><a class="btn primary" href="#/messages/new">+ رسالة جديدة</a></div></div>
      <div class="seg mb" role="tablist" aria-label="صندوق الرسائل"><a href="#/messages" class="${box === "in" ? "on" : ""}">الوارد</a><a href="#/messages?box=sent" class="${box === "sent" ? "on" : ""}">المرسل</a></div>
      <div class="card flush"><ul class="msg-list">${rows.map((m) => `<li class="${box === "in" && !m.read ? "unread" : ""}"><a href="#/messages/${m.id}"><span class="who">${box === "in" ? h(displayName(m.from ? byId("users", m.from) : null)) : "إلى: " + h(displayName(byId("users", m.to)))}</span><b class="subj">${h(m.subject)}</b><span class="snip">${h(m.body.slice(0, 110))}</span><time class="num">${m.at}</time></a></li>`).join("") || '<li class="empty">لا توجد رسائل.</li>'}</ul></div>`);
  };
  function msgForm(u, q) {
    const rec = recipients(u); let to = Number(q.get("to") || 0), subject = "", body = "";
    const re = q.get("re") && byId("msgs", q.get("re"));
    if (re && [re.to, re.from].includes(u.id)) { to = to || re.from; subject = re.subject.startsWith("رد:") ? re.subject : "رد: " + re.subject; body = "\n\n—— الرسالة الأصلية ——\n" + re.body; }
    return layout(u, "رسالة جديدة", `<div class="page-head"><div><h1>${ico("send", "h-ico")} رسالة جديدة</h1><p>${u.role === "employee" ? "تُرسل إلى مسؤول شؤون الموظفين عنك." : u.role === "officer" ? "إلى مدير النظام أو الموظفين المسندين إليك." : "إلى أي مستخدم في المنصة."}</p></div></div>
      <form class="card form-narrow" data-form="msg"><div class="field"><label for="to">إلى *</label><select id="to" name="to" required ${rec.length > 1 ? `multiple size="${Math.min(rec.length, 6)}"` : ""}>
        ${rec.map((x) => `<option value="${x.id}" ${to === x.id || rec.length === 1 ? "selected" : ""}>${h(displayName(x))} — ${ROLES[x.role]}${empOf(x) && empOf(x).email ? " ✉" : ""}</option>`).join("")}</select>${rec.length > 1 ? '<span class="hint">يمكن اختيار أكثر من مستلم (Ctrl/⌘).</span>' : ""}</div>
        <div class="field"><label for="sb">الموضوع *</label><input id="sb" name="subject" required maxlength="200" value="${h(subject)}"></div>
        <div class="field"><label for="bd">نص الرسالة *</label><textarea id="bd" name="body" rows="8" required>${h(body)}</textarea></div>
        <div class="actions"><button class="btn primary">إرسال</button><a class="btn" href="#/messages">إلغاء</a></div></form>`);
  }
  function msgView(u, id) {
    const m = byId("msgs", id); if (!m || ![m.to, m.from].includes(u.id)) throw new Forbidden("الرسالة غير موجودة.");
    if (m.to === u.id && !m.read) { m.read = true; save(); }
    const fr = m.from ? byId("users", m.from) : null, canReply = fr && fr.id !== u.id && recipients(u).some((x) => x.id === fr.id);
    return layout(u, "المراسلات", `<div class="page-head"><div><h1>${ico("mail", "h-ico")} ${h(m.subject)}</h1><p>من: ${h(displayName(fr))} · إلى: ${h(displayName(byId("users", m.to)))} · ${m.at}</p></div>
      <div class="actions">${canReply ? `<a class="btn primary" href="#/messages/new?re=${m.id}">رد</a>` : ""}<a class="btn" href="#/print/msg/${m.id}">طباعة</a>${m.link ? `<a class="btn" href="${m.link}">فتح المرتبط</a>` : ""}<a class="btn" href="#/messages">رجوع</a></div></div>
      <article class="card msg-body">${h(m.body)}</article>`);
  }

  V.archive = (u, q) => {
    need(u, STAFF);
    const y = pickYear(q), kind = q.get("kind") || "", emp = Number(q.get("emp") || 0), qs = (q.get("q") || "").trim(), emps = managedEmps(u, true), ids = new Set(emps.map((e) => e.id));
    const st = q.get("status") || "", words = norm(qs).toLowerCase().split(" ").filter(Boolean);
    const match = (r, txt) => !words.length || words.every((w) => norm(txt).toLowerCase().includes(w));
    const recs = kind === "reqs" ? [] : DB.recs.filter((r) => r.year === y.id && ids.has(r.emp) && (!emp || r.emp === emp)).filter((r) => (!st || (["active", "cancelled"].includes(st) ? r.status === st : false))).filter((r) => { const e = byId("emps", r.emp); return match(r, [e.name, e.no, r.subject, r.ref, r.refNo, r.cancelNote].join(" ")); }).sort((a, b) => b.date.localeCompare(a.date));
    const reqs = kind === "recs" ? [] : DB.leaves.filter((r) => r.year === y.id && ids.has(r.emp) && (!emp || r.emp === emp)).filter((r) => (!st || (["pending", "approved", "rejected", "cancelled"].includes(st) ? r.status === st : false))).filter((r) => { const e = byId("emps", r.emp); return match(r, [e.name, e.no, r.reason, r.ref, r.note, r.cancelNote].join(" ")); }).sort((a, b) => b.start.localeCompare(a.start));
    const msgs = kind ? [] : DB.msgs.filter((m) => (m.from === u.id || m.to === u.id) && m.at.slice(0, 10) >= y.start && m.at.slice(0, 10) <= y.end).sort((a, b) => b.at.localeCompare(a.at));
    return layout(u, "الأرشيف", `<div class="page-head"><div><h1>${ico("archive", "h-ico")} الأرشيف</h1><p>سجل موثّق لكل التوصيات والطلبات والمراسلات${u.role === "officer" ? " للموظفين المسندين إليك" : ""} — السنة ${h(y.name)}</p></div>
      <div class="actions"><button class="btn primary" type="button" data-act="archive-export" data-year="${y.id}">${ico("download", "sm-ico")}تنزيل أرشيف السنة (Excel)</button></div></div>
      <form class="card filters" data-form="filter" data-route="archive"><div class="field grow"><label for="aq">بحث</label><input id="aq" type="search" name="q" value="${h(qs)}" placeholder="اسم، رقم وظيفي، موضوع، رقم توصية"></div>
        <div class="field"><label for="ast">الحالة</label><select id="ast" name="status"><option value="">الكل</option>${[["active", "توصية سارية"], ["cancelled", "ملغى"], ["pending", "بانتظار الاعتماد"], ["approved", "معتمد"], ["rejected", "مرفوض"]].map(([k, v]) => `<option value="${k}" ${st === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field"><label for="k">النوع</label><select id="k" name="kind"><option value="">الكل</option><option value="recs" ${kind === "recs" ? "selected" : ""}>التوصيات</option><option value="reqs" ${kind === "reqs" ? "selected" : ""}>الطلبات</option></select></div>
        <div class="field"><label for="e">الموظف</label><select id="e" name="emp">${empOptions(emps, emp, "الكل")}</select></div>${yearSelect(y)}<button class="btn primary">عرض</button></form>
      <p class="hint">في النظام الفعلي تُنزَّل حزمة ZIP تضم ملف Excel فهرساً مع ملفات PDF المرفقة، لحفظها في أرشيف الوحدة.</p>
      ${kind !== "reqs" ? `<section class="card flush"><h2>التوصيات (${recs.length})</h2><div class="table-wrap"><table class="responsive"><thead><tr><th>الرقم الصادر</th><th>التاريخ</th><th>الموظف</th><th>النوع</th><th>القيمة</th><th>رقم خطاب التوصية</th><th>الموضوع</th><th>الحالة</th><th></th></tr></thead><tbody>
        ${recs.map((r) => { const e = byId("emps", r.emp); return `<tr class="${r.status !== "active" ? "muted-row" : ""}"><td data-label="الرقم الصادر" class="num">${h(r.ref)}</td><td data-label="التاريخ" class="num">${r.date}</td><td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a></td><td data-label="النوع">${kindBadge(r.kind)}</td><td data-label="القيمة">${recAmount(r)}</td><td data-label="رقم خطاب التوصية">${h(r.refNo || "")}</td><td data-label="الموضوع">${h(r.subject)}</td><td data-label="الحالة">${statusBadge(r.status === "active" ? "approved" : "cancelled", r.status === "active" ? "سارية" : "ملغاة")}</td><td class="actions-cell"><a class="btn sm" href="#/print/rec/${r.id}">خطاب المنح</a> ${pdfChip(r.att)}</td></tr>`; }).join("") || '<tr><td colspan="9" class="empty">لا توجد توصيات.</td></tr>'}</tbody></table></div></section>` : ""}
      ${kind !== "recs" ? `<section class="card flush"><h2>الطلبات (${reqs.length})</h2><div class="table-wrap"><table class="responsive"><thead><tr><th>الرقم الصادر</th><th>الموظف</th><th>النوع</th><th>المدة</th><th>التاريخ</th><th>الحالة</th><th></th></tr></thead><tbody>
        ${reqs.map((r) => { const e = byId("emps", r.emp); return `<tr><td data-label="الرقم الصادر" class="num">${h(r.ref)}</td><td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a></td><td data-label="النوع">${kindBadge(r.kind)}</td><td data-label="المدة">${leaveAmount(r)}</td><td data-label="التاريخ" class="num">${dateRange(r)}</td><td data-label="الحالة">${statusBadge(r.status, REQ_ST[r.status])}${noteText(r) ? `<small class="muted d-block">${h(noteText(r))}</small>` : ""}</td><td class="actions-cell"><a class="btn sm" href="#/print/req/${r.id}">نموذج</a></td></tr>`; }).join("") || '<tr><td colspan="7" class="empty">لا توجد طلبات.</td></tr>'}</tbody></table></div></section>` : ""}
      ${msgs.length ? `<section class="card flush"><h2>مراسلاتي (${msgs.length})</h2><ul class="msg-list">${msgs.map((m) => `<li><a href="#/messages/${m.id}"><span class="who">${m.from === u.id ? "إلى: " + h(displayName(byId("users", m.to))) : h(displayName(m.from ? byId("users", m.from) : null))}</span><b class="subj">${h(m.subject)}</b><span class="snip">${h(m.body.slice(0, 110))}</span><time class="num">${m.at}</time></a></li>`).join("")}</ul></section>` : ""}`);
  };

  V.admin = (u, q, seg) => { need(u, ["admin"]); const f = A[seg[1] || "years"]; if (!f) throw new Forbidden("صفحة غير موجودة."); return f(u, q); };
  const A = {};
  const pageTabs = (label, items, active) => `<nav class="tabs" aria-label="${label}">${items.map(([href, k, l]) => `<a href="${href}" ${k === active ? 'aria-current="page" class="on"' : ""}>${l}</a>`).join("")}</nav>`;
  const requestTabs = (active, pending, admin) => pageTabs("أقسام الطلبات", [["#/approvals", "pending", (admin ? "بانتظار الاعتماد" : "بانتظار قراري") + (pending ? " (" + pending + ")" : "")], ["#/requests", "all", "كل الطلبات"]], active);
  const peopleTabs = (active) => pageTabs("أقسام الموظفين", [["#/employees", "list", "قائمة الموظفين"], ["#/admin/import", "import", "استيراد من Excel"]], active);
  const accountTabs = (active) => pageTabs("أقسام الحسابات", [["#/admin/users", "users", "الحسابات والصلاحيات"], ["#/admin/cards", "cards", "بطاقات الدخول"], ["#/admin/teams", "teams", "الفرق والتفويض"]], active);
  const settingsTabs = (active) => `<nav class="tabs" aria-label="أقسام الإعدادات">${[["years", "السنة وقواعد الرصيد"], ["depts", "الأقسام"], ["holidays", "العطل الرسمية"], ["settings", "هوية الجهة"], ["mail", "البريد الإلكتروني"]].map(([k, l]) => `<a href="#/admin/${k}" ${k === active ? 'aria-current="page" class="on"' : ""}>${l}</a>`).join("")}</nav>`;
  A.years = (u) => {
    const form = (y) => { const p = "y" + (y ? y.id : "new"), dis = y && y.locked ? "disabled" : "";
      const chk = (k, label, def) => `<label class="check"><input type="checkbox" name="${k}" value="1" ${(y ? y[k] : def) ? "checked" : ""}> ${label}</label>`;
      return `<form data-form="year" data-id="${y ? y.id : ""}">
        <fieldset ${dis}><legend>الفترة</legend><div class="form-grid">
          <div class="field"><label for="${p}n">اسم السنة</label><input id="${p}n" name="name" value="${y ? h(y.name) : ""}" required></div>
          <div class="field"><label for="${p}s">من</label><input id="${p}s" type="date" name="start" value="${y ? y.start : ""}" required></div>
          <div class="field"><label for="${p}e">إلى</label><input id="${p}e" type="date" name="end" value="${y ? y.end : ""}" required></div></div></fieldset>
        <fieldset ${dis}><legend>قواعد الرصيد (سنوي)</legend><div class="form-grid">
          <div class="field"><label for="${p}b">الحد الأقصى السنوي لكل موظف (يوم)</label><input id="${p}b" type="number" min="0" name="cap" value="${y ? y.cap : 20}"><span class="hint">مجموع توصيات الأيام والساعات (بالمعادل) لا يتجاوزه.</span></div>
          <div class="field"><label for="${p}h">عدد الساعات التي تعادل يوماً</label><input id="${p}h" type="number" step="0.25" min="0.25" name="hpd" value="${y ? y.hpd : 7}"></div></div></fieldset>
        <fieldset ${dis}><legend>المرفقات والقواعد</legend>
          ${chk("reqRecAtt", "إرفاق ملف التوصية (PDF) إلزامي عند رفع التوصية")}${chk("reqReqAtt", "إرفاق مستند مؤيد (PDF) إلزامي لطلبات الموظف")}
          ${chk("empCanRequest", "السماح للموظف بتقديم طلبات معالجة الغياب بنفسه", true)}${chk("empCanSubmitRec", "السماح للموظف برفع التوصيات الممنوحة له (بالأيام أو الساعات) لاعتمادها", true)}${chk("blockWeekends", "استبعاد أيام عطلة نهاية الأسبوع من مدة الطلب", true)}
          <div class="actions" style="margin:-.2rem 1.6rem .6rem 0">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<label class="check" style="margin:0"><input type="checkbox" name="weekend" value="${i}" ${(y ? y.weekend : [5, 6]).includes(i) ? "checked" : ""}> ${WD[i]}</label>`).join("")}</div></fieldset>
        ${y && (DB.recs.some((x) => x.year === y.id) || DB.leaves.some((x) => x.year === y.id)) ? `<label class="check confirm-impact"><input type="checkbox" name="confirmImpact" value="1"> أؤكد تطبيق التغيير بأثر رجعي على أرصدة السنة — مطلوب فقط عند تغيير ساعات اليوم أو الحد السنوي</label>` : ""}
        ${y && y.locked ? "" : `<button class="btn primary">${y ? "حفظ الإعدادات" : "إنشاء السنة"}</button>`}</form>`; };
    return layout(u, "الإعدادات", `${settingsTabs("years")}<div class="page-head"><div><h1>${ico("calendar", "h-ico")} السنة وقواعد الرصيد</h1><p>الرصيد سنوي (سنة ميلادية): يُمنح بالتوصيات التي يرفعها مسؤول شؤون الموظفين، ولا يُرحَّل إلى السنة التالية.</p></div></div>
      <div class="alert info">تغيير عدد الساعات المعادلة لليوم يعيد حساب أرصدة السنة فوراً (الرصيد يُحسب من التوصيات والطلبات). يُسجَّل كل تغيير في سجل التدقيق.</div>
      ${DB.years.slice().sort((a, b) => b.start.localeCompare(a.start)).map((y) => `<section class="card"><div class="page-head" style="margin-bottom:.5rem"><h2>السنة ${h(y.name)} ${y.active ? '<span class="badge ok">النشطة</span>' : ""}${y.locked ? ' <span class="badge muted">مقفلة</span>' : ""}</h2>
        <div class="actions">${y.active ? "" : `<button class="btn sm" type="button" data-act="activate-year" data-id="${y.id}">تعيينها السنة النشطة</button>`}<button class="btn sm ${y.locked ? "" : "danger"}" type="button" data-act="lock-year" data-id="${y.id}">${y.locked ? "فتح القفل" : "إقفال السنة"}</button></div></div>${form(y)}</section>`).join("")}
      <section class="card"><details class="disclose"><summary>+ إنشاء سنة جديدة</summary><div class="mt">${form(null)}</div></details></section>`);
  };

  let importPreview = null, createdAccounts = null;
  A.import = (u) => {
    if (createdAccounts) { const made = createdAccounts; createdAccounts = null; return accountsPage(u, made); }
    if (importPreview) {
      const rows = importPreview, c = (k) => rows.filter((r) => r.action === k).length;
      return layout(u, "استيراد الموظفين", `<div class="page-head"><div><h1>معاينة الاستيراد</h1></div></div>
        <div class="grid kpis"><div class="kpi ok"><div class="l">جديد</div><div class="v">${c("new")}</div></div><div class="kpi brand"><div class="l">تحديث موظف موجود</div><div class="v">${c("update")}</div></div><div class="kpi err"><div class="l">أخطاء (لن تُستورد)</div><div class="v">${c("error")}</div></div></div>
        <div class="card flush"><div class="table-wrap"><table class="responsive"><thead><tr><th>السطر</th><th>الاسم</th><th>الرقم الوظيفي</th><th>القسم</th><th>الدور</th><th>رقم مسؤول شؤون الموظفين</th><th>النتيجة</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="${r.action === "error" ? "has-err" : ""}"><td data-label="السطر">${r.line}</td><td data-label="الاسم">${h(r.name)}</td><td data-label="الرقم" class="num">${h(r.no)}</td><td data-label="القسم">${h(r.dept)}</td>
          <td data-label="الدور">${r.role ? ROLES[r.role] : "موظف (افتراضي)"}</td><td data-label="رقم مسؤول شؤون الموظفين" class="num">${h(r.manager)}</td>
          <td data-label="النتيجة">${r.action === "error" ? `<span class="badge err">⚠ ${h(r.errors.join("، "))}</span>` : r.action === "new" ? '<span class="badge ok">جديد</span>' : '<span class="badge">تحديث</span>'}${r.note ? `<div class="hint">${h(r.note)}</div>` : ""}</td></tr>`).join("")}
        </tbody></table></div></div>
        ${c("new") + c("update") ? `<form class="card" data-form="import-commit">
          <label class="check"><input type="checkbox" name="create" value="1" checked> إنشاء حساب لكل موظف ليس له حساب (اسم المستخدم = الرقم الوظيفي، وكلمة مرور أولية)</label>
          <label class="check"><input type="checkbox" name="roles" value="1" checked> تحديث منصب الحسابات الموجودة حسب الملف (لا يمس حسابات مدير النظام)</label>
          ${c("error") ? `<div class="alert warn">ستُتجاوز الصفوف التي فيها أخطاء (${c("error")}).</div>` : ""}
          <div class="actions"><button class="btn primary">استيراد ${c("new") + c("update")} موظف</button><button class="btn" type="button" data-act="import-back">رجوع</button></div></form>` : '<div class="actions"><button class="btn" type="button" data-act="import-back">رجوع وتصحيح البيانات</button></div>'}`);
    }
    return layout(u, "الموظفون والأرصدة", `${peopleTabs("import")}<div class="page-head"><div><h1>${ico("upload", "h-ico")} استيراد الموظفين وإنشاء حساباتهم</h1><p>ارفع ملف Excel أو الصق الأسماء والأرقام. يُنشأ لكل موظف حساب اسم المستخدم فيه رقمه الوظيفي، مع الدور المحدد.</p></div>
      <button class="btn" type="button" data-act="template">${ico("download", "sm-ico")}تنزيل نموذج Excel</button></div>
      <form data-form="import"><div class="grid two">
        <section class="card"><h2>1) رفع ملف Excel أو CSV</h2>
          <ol class="steps"><li><b>نزّل النموذج</b> وعبّئه (فيه ورقة «القوائم» بالأقسام وأرقام مسؤولي شؤون الموظفين، وورقة تعليمات):
            <div class="actions mt-sm"><button class="btn primary sm" type="button" data-act="template">${ico("download", "sm-ico")}نموذج فارغ للتعبئة</button><button class="btn sm" type="button" data-act="template" data-filled="1">${ico("download", "sm-ico")}الموظفون الحاليون (للتعديل)</button></div></li>
            <li><b>احفظه</b> بصيغة ‎.xlsx دون تغيير صف العناوين.</li><li><b>ارفعه هنا</b> ثم اضغط «معاينة قبل الحفظ».</li></ol><div class="field"><label for="if">الملف <span class="hint">(‎.xlsx أو ‎.csv، أول ورقة فقط)</span></label><input id="if" type="file" name="file" accept=".xlsx,.xlsm,.csv"></div>
          <p class="hint">يتعرّف النظام على الأعمدة من عناوينها: الاسم، الرقم الوظيفي، القسم، الدور، رقم مسؤول شؤون الموظفين، المسمى الوظيفي، البريد.</p></section>
        <section class="card"><h2>2) أو النسخ واللصق</h2><div class="field"><label for="ip">انسخ الأعمدة من Excel والصقها هنا <span class="hint">(سطر لكل موظف)</span></label>
          <textarea id="ip" name="pasted" rows="8" placeholder="محمد أحمد العتيبي	100500	وحدة الشؤون الإدارية	موظف	100100"></textarea></div>
          <p class="hint">بدون صف عناوين يُفترض الترتيب: الاسم، الرقم الوظيفي، القسم، الدور، رقم مسؤول شؤون الموظفين، المسمى، البريد.</p></section></div>
      <section class="card"><h2>الأدوار</h2><dl class="role-list">
        <div><dt>موظف</dt><dd>يتابع رصيده من الأيام والساعات ويرفع طلبات معالجة الغياب</dd></div><div><dt>شؤون الموظفين</dt><dd>يُسند له موظفون؛ يرفع توصياتهم ويعتمد طلباتهم ويراسلهم</dd></div></dl>
        <p class="hint mt">إن تُرك الدور فارغاً يكون «موظف». الرقم الوظيفي مفتاح المطابقة: إن كان الموظف موجوداً تُحدَّث بياناته بدل التكرار.</p></section>
      <button class="btn primary">معاينة قبل الحفظ</button></form>`);
  };
  // بطاقات الدخول: تُحفظ لكل حساب جديد أو إعادة تعيين، وتُمسح كلمة المرور حين يغيّرها صاحبها
  function saveCards(made, reason) {
    const labels = { import: "استيراد", bulk: "إنشاء جماعي", single: "حساب جديد", reset: "إعادة تعيين" };
    const batch = labels[reason] + " — " + nowStr(); DB.cards = DB.cards || [];
    made.forEach(([name, un, pw, role]) => { const usr = DB.users.find((x) => x.username.toLowerCase() === un.toLowerCase()); const e = usr ? empOf(usr) : null;
      if (usr) DB.cards.forEach((c) => { if (c.user === usr.id) c.pw = null; });
      DB.cards.push({ id: nid(), user: usr ? usr.id : null, username: un, name: name || (e ? e.name : un), no: e ? e.no : "", role, pw, batch, reason, at: nowStr(), activatedAt: null }); });
    lastBatch = batch; return batch;
  }
  let lastBatch = null;
  async function createEmpAccount(e) {
    if (DB.users.some((x) => x.emp === e.id)) throw new RuleError("للموظف حساب دخول مسبقاً.");
    if (isTmp(e)) throw new RuleError("رقم الموظف مؤقت؛ صحّح الرقم الوظيفي أولاً ثم أنشئ الحساب.");
    if (!e.active) throw new RuleError("الموظف غير نشط.");
    const un = String(e.no).toLowerCase();
    if (DB.users.some((x) => x.username.toLowerCase() === un)) throw new RuleError("اسم المستخدم " + un + " مستخدم لحساب آخر؛ أنشئ الحساب يدوياً من «المستخدمون والصلاحيات».");
    const pw = rand(), role = DB.emps.some((x) => x.mgr === e.id) ? "officer" : "employee";
    const nu = { id: nid(), username: un, pw: await sha(pw), role, emp: e.id, active: true, mustChange: false, last: null };
    DB.users.push(nu); saveCards([[e.name, un, pw, role]], "single"); audit("user_saved", "user", nu.id, { username: un, auto: true });
    return [un, pw];
  }
  function accountsPage(u, made) {
    return layout(u, "الحسابات المنشأة", `<div class="page-head"><div><h1>تم إنشاء ${made.length} حساب</h1><p>حُفظت بطاقات الدخول في «بطاقات الدخول» ويمكن طباعتها لاحقاً، وتبقى كلمة المرور فيها سارية حتى يغيّرها صاحبها إن شاء من «الملف الشخصي».</p></div>
      <div class="actions">${lastBatch ? `<a class="btn primary" href="#/print/cards?batch=${encodeURIComponent(lastBatch)}">طباعة بطاقات الدخول</a>` : ""}<button class="btn" type="button" data-act="cards-dl">${ico("download", "sm-ico")}تنزيل بطاقات الدخول (Excel)</button><button class="btn" data-print type="button">طباعة</button><a class="btn" href="#/admin/depts">مراجعة الأقسام</a><a class="btn primary" href="#/admin/users">المستخدمون</a></div></div>
      ${made.length ? "" : '<div class="alert info">لم يُنشأ أي حساب جديد: إما أن لكل الموظفين حسابات مسبقاً، أو أُلغي خيار إنشاء الحسابات.</div>'}
      <div class="card flush"><table><thead><tr><th>الموظف</th><th>اسم المستخدم</th><th>كلمة المرور</th><th>الدور</th></tr></thead><tbody>
      ${made.map(([nm, un, pw, r]) => `<tr><td>${h(nm)}</td><td class="num">${h(un)}</td><td class="num"><code>${h(pw)}</code></td><td>${ROLES[r]}</td></tr>`).join("")}</tbody></table></div>`);
  }

  A.users = (u) => {
    const linked = new Set(DB.users.filter((x) => x.emp).map((x) => x.emp));
    const emps = DB.emps.filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name, "ar"));
    const roleOpts = (sel) => Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v}</option>`).join("");
    const teamCount = (empId) => DB.emps.filter((e) => e.active && empId && e.mgr === empId).length;
    const assignBox = (offEmp, open) => `<div class="assign-box" data-role-dep="officer" ${open ? "" : "hidden"}><input type="hidden" name="assign_present" value="1">
      <div class="assign-head"><b>الموظفون المسندون لهذا المسؤول</b><span class="hint" data-assign-count></span></div>
      <input type="search" class="assign-filter" placeholder="بحث بالاسم أو الرقم أو القسم" data-assign-filter aria-label="بحث في الموظفين">
      <div class="assign-actions"><button type="button" class="btn sm" data-assign-all="1">تحديد الظاهر</button><button type="button" class="btn sm" data-assign-all="0">إلغاء التحديد</button></div>
      <div class="check-list">${emps.filter((e) => e.id !== offEmp).map((e) => `<label class="check" data-text="${h(e.name + " " + e.no + " " + deptName(e))}"><input type="checkbox" name="assign" value="${e.id}" ${offEmp && e.mgr === offEmp ? "checked" : ""}>
        <span>${h(e.name)} <small class="muted">(${h(e.no)})${deptName(e) ? " · " + h(deptName(e)) : ""}${e.mgr && e.mgr !== offEmp ? " · حالياً لدى: " + h(mgrName(e)) : ""}</small></span></label>`).join("") || '<p class="hint">لا يوجد موظفون. أضفهم من «استيراد الموظفين».</p>'}</div>
      <span class="hint">اختيار موظف مسند لمسؤول شؤون موظفين آخر ينقله إلى هذا المسؤول.</span></div>`;
    return layout(u, "المستخدمون والصلاحيات", `${accountTabs("users")}<div class="page-head"><div><h1>${ico("userkey", "h-ico")} المستخدمون والصلاحيات</h1><p>${DB.users.length} حساب</p></div>
      <button class="btn" type="button" data-act="bulk-users">إنشاء حسابات الموظفين دفعة واحدة</button></div>
      ${(() => { const na = emps.filter((e) => !linked.has(e.id) && !isTmp(e)); return na.length ? `<div class="alert warn" role="status">${na.length} موظف نشط بلا حساب دخول (${na.slice(0, 5).map((e) => h(e.name)).join("، ")}${na.length > 5 ? "…" : ""})، فلا يستطيعون الدخول إلى النظام. اضغط «إنشاء حسابات الموظفين دفعة واحدة» أعلاه لإنشاء حساباتهم وطباعة بطاقاتهم.</div>` : ""; })()}
      <div class="grid two"><section class="card"><h2>الأدوار</h2><ul>
        <li><b>مدير النظام:</b> إدارة المنصة: المستخدمون والصلاحيات، إسناد الموظفين لمسؤولي شؤون الموظفين، السنة وقواعد الرصيد، المؤشرات والاعتمادات، الإعدادات وسجل التدقيق.</li>
        <li><b>شؤون الموظفين:</b> يُسند له موظفون؛ يرفع التوصيات (بالأيام أو بالساعات) بملف PDF في حساب الموظف، ويعتمد طلبات معالجة الغياب، ويراسل موظفيه ومدير النظام.</li>
        <li><b>موظف:</b> يتابع رصيده من الأيام والساعات، ويرفع طلبات معالجة الغياب، ويراسل مسؤول شؤون الموظفين.</li></ul>
        <p class="hint">عند اختيار دور «شؤون الموظفين» تظهر قائمة لاختيار الموظفين المسندين إليه (أكثر من موظف)، ويمكن أيضاً الإسناد من بطاقة الموظف أو ملف الاستيراد.</p></section>
      <section class="card"><h2>إضافة حساب</h2><form data-form="user-new"><div class="form-grid">
        <div class="field"><label for="un">اسم المستخدم</label><input id="un" name="username" required></div>
        <div class="field"><label for="rl">الدور</label><select id="rl" name="role" data-role-select>${roleOpts("employee")}</select></div>
        <div class="field"><label for="ue">سجل الموظف المرتبط</label><select id="ue" name="emp">${empOptions(emps.filter((e) => !linked.has(e.id)), "", "—")}</select></div></div>
        ${assignBox(null, false)}
        <button class="btn primary">إنشاء الحساب</button></form></section></div>
      <div class="card flush"><div class="table-wrap"><table class="responsive"><thead><tr><th>اسم المستخدم</th><th>الدور والموظف</th><th></th></tr></thead><tbody>
      ${DB.users.map((x) => `<tr><td data-label="المستخدم"><b>${h(x.username)}</b>${x.mustChange ? '<div class="hint">بانتظار تغيير كلمة المرور</div>' : ""}</td>
        <td data-label="تعديل"><form class="filters" data-form="user-edit" data-id="${x.id}"><div class="field"><label class="sr-only" for="r${x.id}">الدور</label><select id="r${x.id}" name="role" data-role-select>${roleOpts(x.role)}</select></div>
          <div class="field grow"><label class="sr-only" for="e${x.id}">الموظف</label><select id="e${x.id}" name="emp">${empOptions(emps.filter((e) => !linked.has(e.id) || e.id === x.emp), x.emp || "", "—")}</select></div>
          <label class="check" style="margin:0"><input type="checkbox" name="active" value="1" ${x.active ? "checked" : ""}> نشط</label><button class="btn sm">حفظ</button>
          ${x.role === "officer" ? `<details class="assign-wrap" ${teamCount(x.emp) ? "" : "open"}><summary>الموظفون المسندون (${teamCount(x.emp)})</summary>${assignBox(x.emp, true)}</details>` : ""}</form></td>
        <td><button class="btn sm" type="button" data-act="reset-pw" data-id="${x.id}">إعادة تعيين كلمة المرور</button>${x.emp && x.id !== u.id && x.role !== "admin" ? ` <button class="btn sm danger" type="button" data-act="del-emp-quick" data-id="${x.emp}" title="حذف موظف أُدخل بالخطأ">حذف</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div></div>`);
  };

  A.depts = (u) => {
    const cnt = (id) => DB.emps.filter((e) => e.dept === id).length;
    const opts = DB.depts.map((d) => `<option value="${d.id}">${h(d.name)} (${cnt(d.id)})</option>`).join("");
    return layout(u, "الإعدادات", `${settingsTabs("depts")}<div class="page-head"><div><h1>${ico("building", "h-ico")} الأقسام والوحدات</h1><p>وحّد الأسماء المتشابهة بالدمج.</p></div></div>
      <div class="grid two"><section class="card"><h2>إضافة قسم</h2><form class="filters" data-form="dept-new"><div class="field grow"><label for="dn">اسم القسم</label><input id="dn" name="name" required></div><button class="btn primary">إضافة</button></form></section>
      <section class="card"><h2>دمج قسمين</h2><form class="filters" data-form="dept-merge"><div class="field"><label for="ds">القسم المكرر</label><select id="ds" name="src">${opts}</select></div><div class="field"><label for="dt">يُدمج في</label><select id="dt" name="dst">${opts}</select></div><button class="btn">دمج</button></form></section></div>
      <div class="card flush"><table class="responsive"><thead><tr><th>القسم</th><th class="n">الموظفون</th><th>تعديل</th></tr></thead><tbody>
      ${DB.depts.map((d) => `<tr class="${d.active ? "" : "muted"}"><td data-label="القسم">${h(d.name)}</td><td class="n" data-label="الموظفون">${cnt(d.id)}</td>
        <td data-label="تعديل"><form class="filters" data-form="dept-edit" data-id="${d.id}"><div class="field grow"><label class="sr-only" for="dn${d.id}">الاسم</label><input id="dn${d.id}" name="name" value="${h(d.name)}"></div><label class="check" style="margin:0"><input type="checkbox" name="active" value="1" ${d.active ? "checked" : ""}> نشط</label><button class="btn sm">حفظ</button></form></td></tr>`).join("")}
      </tbody></table></div>`);
  };

  // العطل الرسمية في السعودية: يوم التأسيس واليوم الوطني ثابتان، والعيدان وفق تقويم أم القرى (تقديري)
  const HIJRI_ANCHORS = { 2026: { fitr: "2026-03-20", arafah: "2026-05-26" }, 2027: { fitr: "2027-03-09", arafah: "2027-05-15" }, 2028: { fitr: "2028-02-26", arafah: "2028-05-04" } };
  const ANNOUNCED = { "2026:fitr": ["2026-03-13", "2026-03-24"] };
  const addDays = (d, k) => { const x = parseISO(d); x.setDate(x.getDate() + k); return iso(x); };
  function saPresets(yr) {
    const out = [{ key: "founding", name: "يوم التأسيس", start: yr + "-02-22", end: yr + "-02-22", note: "22 فبراير من كل عام." }], a = HIJRI_ANCHORS[yr];
    if (a) { const f = ANNOUNCED[yr + ":fitr"];
      out.push({ key: "fitr", name: "عيد الفطر", start: f ? f[0] : a.fitr, end: f ? f[1] : addDays(a.fitr, 3), note: f ? "وفق إعلان وزارة الموارد البشرية للقطاع الحكومي." : "1 شوال المتوقع " + a.fitr + " (أم القرى). المقترح 4 أيام؛ عدّلها حسب تعميم الوزارة للقطاع الحكومي." });
      out.push({ key: "adha", name: "عيد الأضحى", start: a.arafah, end: addDays(a.arafah, 3), note: "يوم عرفة المتوقع " + a.arafah + " (أم القرى). المقترح من عرفة إلى 12 ذو الحجة؛ عدّلها حسب تعميم الوزارة." }); }
    out.push({ key: "national", name: "اليوم الوطني", start: yr + "-09-23", end: yr + "-09-23", note: "23 سبتمبر من كل عام." });
    return out;
  }
  function holidayGroups() {
    const g = []; DB.holidays.slice().sort((x, y) => x.day.localeCompare(y.day)).forEach((h0) => { const last = g[g.length - 1];
      if (last && last.name === h0.name && addDays(last.end, 1) === h0.day) { last.end = h0.day; last.days++; } else g.push({ name: h0.name, start: h0.day, end: h0.day, days: 1 }); });
    return g.reverse();
  }
  function addHolidayRange(name, sd, ed) { let c = 0; for (let d = sd; d <= ed; d = addDays(d, 1)) { if (!DB.holidays.some((x) => x.day === d)) { DB.holidays.push({ id: nid(), day: d, name }); c++; } } return c; }
  A.holidays = (u, q) => {
    const now = new Date(), sel = Number(q.get("year")) || (now.getMonth() >= 10 ? now.getFullYear() + 1 : now.getFullYear());
    const groups = holidayGroups().filter((g0) => g0.start.slice(0, 4) === String(sel)).sort((x, y) => x.start.localeCompare(y.start));
    const savedNames = new Set(groups.map((g0) => g0.name));
    const lines = groups.map((g0) => ({ ...g0, saved: true })).concat(saPresets(sel).filter((p0) => !savedNames.has(p0.name)).map((p0) => { let n0 = 0; for (let d = p0.start; d <= p0.end; d = addDays(d, 1)) n0++; return { ...p0, days: n0, saved: false }; })).sort((x, y) => x.start.localeCompare(y.start));
    const yrs = [...new Set([...DB.holidays.map((x) => Number(x.day.slice(0, 4))), now.getFullYear(), now.getFullYear() + 1, sel])].sort();
    const unsaved = lines.filter((x) => !x.saved).length, mm = `min="${sel}-01-01" max="${sel}-12-31"`;
    return layout(u, "الإعدادات", `${settingsTabs("holidays")}<div class="page-head"><div><h1>${ico("holiday", "h-ico")} العطل الرسمية</h1><p>تُستبعد هذه الأيام من مدة طلبات معالجة الغياب.</p></div>
      <form class="inline year-pick" data-form="filter" data-route="admin/holidays"><label for="py">السنة الميلادية</label><select id="py" name="year" data-autosubmit>${yrs.map((y) => `<option value="${y}" ${y === sel ? "selected" : ""}>${y}</option>`).join("")}</select></form></div>
    <form class="card flush hol-form" data-form="holidays-save" data-year="${sel}" data-count="${lines.length + 3}"><h2>عطل سنة ${sel}${unsaved ? ` <span class="badge warn">${unsaved} مقترحة لم تُحفظ بعد</span>` : ""}</h2>
      <p class="hint pad">عدّل الاسم أو التاريخ مباشرة في الجدول، أو أضف عطلة في الأسطر الفارغة، ثم اضغط «حفظ». لكل عطلة سطر واحد بفترتها كاملة؛ ولا يُقبل اسم مكرر أو فترتان متداخلتان. تاريخا العيدين المقترحان بحسب تقويم أم القرى، فعدّلهما حسب تعميم وزارة الموارد البشرية أو تقويم الجهة.</p>
      <div class="table-wrap"><table class="responsive hol-table"><caption class="sr-only">عطل سنة ${sel}</caption><thead><tr><th>العطلة</th><th>من</th><th>إلى</th><th class="n">الأيام</th><th>الحالة</th><th>حذف</th></tr></thead><tbody>
      ${lines.map((x, i) => `<tr class="${x.saved ? "" : "is-suggested"}"><td data-label="العطلة"><input name="name_${i}" value="${h(x.name)}" class="cell-input" aria-label="اسم العطلة"></td>
        <td data-label="من"><input type="date" name="start_${i}" value="${x.start}" ${mm} class="cell-input" aria-label="من تاريخ ${h(x.name)}"></td><td data-label="إلى"><input type="date" name="end_${i}" value="${x.end}" ${mm} class="cell-input" aria-label="إلى تاريخ ${h(x.name)}"></td>
        <td class="n" data-label="الأيام">${daysAr(x.days)}</td><td data-label="الحالة">${x.saved ? '<span class="badge ok">محفوظة</span>' : `<span class="badge warn" title="${h(x.note || "")}">مقترحة</span>`}</td>
        <td data-label="حذف"><label class="chk"><input type="checkbox" name="del_${i}" value="1" aria-label="حذف ${h(x.name)}"></label></td></tr>`).join("")}
      ${[0, 1, 2].map((k) => { const i = lines.length + k; return `<tr class="is-new"><td data-label="عطلة جديدة"><input name="name_${i}" placeholder="عطلة جديدة (اختياري)" class="cell-input" aria-label="اسم عطلة جديدة"></td><td data-label="من"><input type="date" name="start_${i}" ${mm} class="cell-input" aria-label="من تاريخ"></td><td data-label="إلى"><input type="date" name="end_${i}" ${mm} class="cell-input" aria-label="إلى تاريخ"></td><td class="n" data-label="الأيام">—</td><td data-label="الحالة"><span class="muted">جديدة</span></td><td></td></tr>`; }).join("")}
      </tbody></table></div><div class="actions pad"><button class="btn primary">${ico("holiday", "sm-ico")}حفظ عطل ${sel}</button><a class="btn" href="#/admin/holidays?year=${sel}">تراجع عن التعديلات</a></div></form>`);
  };

  A.mail = (u) => layout(u, "الإعدادات", `${settingsTabs("mail")}<div class="page-head"><div><h1>${ico("mail", "h-ico")} البريد الإلكتروني</h1>
      <p>إشعارات البريد تصل للمستخدمين عند الرسائل الجديدة، واعتماد الطلبات أو رفضها أو إلغائها، ورفع التوصيات، وتنبيهات الرصيد.</p></div></div>
      <div class="alert info">في نسخة العرض لا يُرسل أي بريد فعلي. في النظام الفعلي تعرض هذه الصفحة حالة البريد، وخادم الإرسال والمرسِل، وآخر إرسال ناجح وآخر خطأ، مع زر «إرسال رسالة تجريبية» ومعاينة شكل الرسالة.</div>
      <div class="grid two"><section class="card"><h2>الحالة</h2><p><span class="badge muted">غير متاح في نسخة العرض</span></p>
        <dl class="kv"><div><dt>خادم البريد</dt><dd>—</dd></div><div><dt>المرسِل</dt><dd dir="ltr">no-reply@example.com</dd></div><div><dt>آخر إرسال ناجح</dt><dd>—</dd></div></dl></section>
        <section class="card"><h2>إرسال بريد تجريبي</h2><p class="hint">متاح في النظام الفعلي بعد ضبط خادم البريد.</p><div class="field"><label for="mt">إلى</label><input id="mt" type="email" dir="ltr" disabled placeholder="name@example.com"></div><button class="btn primary" type="button" disabled>إرسال رسالة تجريبية</button></section></div>`);
  A.settings = (u) => { const s = DB.settings; return layout(u, "الإعدادات", `${settingsTabs("settings")}<div class="page-head"><div><h1>${ico("palette", "h-ico")} هوية الجهة</h1><p>تظهر في الترويسة والكشوف الرسمية.</p></div></div>
    <form class="card" style="max-width:720px" data-form="settings">
      <div class="field"><label for="s1">الجامعة</label><input id="s1" name="university" value="${h(s.university)}"></div>
      <div class="field"><label for="s2">الكلية / الجهة</label><input id="s2" name="college" value="${h(s.college)}"></div>
      <div class="field"><label for="s3">اسم النظام</label><input id="s3" name="system_title" value="${h(s.system_title)}"></div>
      <div class="field"><label for="s5">الشعار النصي <span class="hint">(يظهر تحت اسم النظام)</span></label><input id="s5" name="tagline" value="${h(s.tagline || "")}"></div>
      <div class="field"><label for="s4">سطر الحقوق <span class="hint">(اختياري)</span></label><input id="s4" name="credit" value="${h(s.credit)}"></div>
      <button class="btn primary">حفظ</button></form>`); };

  const WIPE_WORD = "حذف", RESTORE_WORD = "استعادة";
  A.data = (u) => {
    const last = DB.audit.find((a) => a.action === "backup_downloaded");
    return layout(u, "النسخ الاحتياطي والبيانات", `<div class="page-head"><div><h1>${ico("backup", "h-ico")} النسخ الاحتياطي والبيانات</h1>
      <p>البيانات الحالية: ${DB.emps.length} موظف · ${DB.users.length} حساب · ${DB.recs.length} توصية · ${DB.leaves.length} طلب · ${DB.msgs.length} رسالة</p></div></div>
      <div class="grid two">
        <section class="card"><h2>${ico("archive", "sm-ico")} أخذ نسخة احتياطية</h2>
          <p>ملف واحد يضم كل البيانات (الموظفين، الحسابات، التوصيات، الطلبات، المراسلات، الإعدادات، سجل التدقيق). في النظام الفعلي يضم أيضاً ملفات PDF المرفقة.</p>
          <p class="hint">${last ? "آخر نسخة نُزّلت: " + h(last.at) + " بواسطة " + h(last.user) + "." : "لم تُنزَّل أي نسخة احتياطية بعد."} احفظ الملف في مكان آمن.</p>
          <p class="nightly ok"><b>النسخ الليلية على الخادم:</b> في النظام الفعلي تظهر هنا آخر نسخة ليلية وعدد النسخ المحفوظة.</p><button class="btn primary" type="button" data-act="backup">${ico("download", "sm-ico")}تنزيل نسخة احتياطية الآن</button>
          ${autoList().length ? `<details class="disclose mt"><summary>النسخ التلقائية (${autoList().length})</summary><p class="hint">تُؤخذ تلقائياً قبل كل حذف أو استعادة (آخر 3 نسخ في هذا المتصفح).</p><ul class="plain">${autoList().map((a, i) => `<li><button class="btn sm" type="button" data-act="auto-dl" data-i="${i}">${ico("download", "sm-ico")}تنزيل</button> ${h(a.at)} · ${h(a.reason)}</li>`).join("")}</ul></details>` : ""}</section>
        <section class="card"><h2>${ico("upload", "sm-ico")} استعادة نسخة احتياطية</h2>
          <p>تستبدل <b>كل</b> البيانات الحالية بمحتوى النسخة، ثم يُطلب تسجيل الدخول من جديد.</p>
          <form data-form="restore"><div class="field"><label for="bf">ملف النسخة</label><input id="bf" type="file" name="file" accept=".json,application/json" required></div>
            <div class="field"><label for="rc">للتأكيد اكتب كلمة «${RESTORE_WORD}»</label><input id="rc" name="confirm" autocomplete="off" required></div><div class="field"><label for="rcp">كلمة مرور مدير النظام</label><input id="rcp" name="password" type="password" autocomplete="current-password" required></div>
            <button class="btn danger">استعادة</button></form></section></div>
      <section class="card danger-zone"><h2>⚠ حذف جميع البيانات</h2>
        <p>يحذف نهائياً: الموظفين، وجميع الحسابات عدا حسابك، والتوصيات، والطلبات، والمراسلات، والأقسام، والعطل. تبقى السنوات وهوية الجهة وحسابك و<b>سجل التدقيق</b> (يُحذف عند الحاجة من صفحة «سجل التدقيق» فقط). <b>لا يمكن التراجع</b> إلا باستعادة نسخة احتياطية.</p>
        <p class="hint">ننصح بتنزيل نسخة احتياطية أولاً. (في نسخة العرض يمكنك إرجاع البيانات التجريبية من «استعادة بيانات العرض».)</p>
        <form class="filters" data-form="wipe"><div class="field grow"><label for="wc">للتأكيد اكتب كلمة «${WIPE_WORD}»</label><input id="wc" name="confirm" autocomplete="off" required placeholder="${WIPE_WORD}"></div><div class="field"><label for="wcp">كلمة مرور مدير النظام</label><input id="wcp" name="password" type="password" autocomplete="current-password" required></div>
          <button class="btn danger">حذف جميع البيانات</button></form></section>`);
  };

  A.cards = (u, q) => {
    const batch = q.get("batch") || "", st = q.get("state") || "", qs = norm(q.get("q") || "").toLowerCase(), all = DB.cards || [];
    const rows = all.filter((c) => (!batch || c.batch === batch) && (!st || (st === "pending" ? !!c.pw : !c.pw)) && (!qs || norm(c.name + " " + c.username + " " + c.no).toLowerCase().includes(qs))).sort((a, b) => b.at.localeCompare(a.at) || a.id - b.id);
    const batches = [...new Set(all.slice().sort((a, b) => b.at.localeCompare(a.at)).map((c) => c.batch))];
    return layout(u, "المستخدمون والصلاحيات", `${accountTabs("cards")}<div class="page-head"><div><h1>${ico("badge", "h-ico")} بطاقات الدخول</h1><p>تُحفظ هنا بطاقة دائمة لكل حساب جديد أو كلمة مرور أُعيد تعيينها، ويمكن طباعتها والرجوع إليها في أي وقت. يستطيع الموظف تغيير كلمة المرور متى شاء من «الملف الشخصي»، وعندها تُعلَّم بطاقته بأنها غُيّرت (لا تُعرض كلمات المرور التي يختارها المستخدمون لأنها تُحفظ مشفّرة).</p></div>
      <div class="actions"><a class="btn primary" href="#/print/cards?${batch ? "batch=" + encodeURIComponent(batch) + "&" : ""}state=pending">طباعة البطاقات ${batch ? "لهذه الدفعة" : "السارية"}</a><button class="btn" type="button" data-act="cards-dl">${ico("download", "sm-ico")}تنزيل Excel</button></div></div>
      <form class="card filters" data-form="filter" data-route="admin/cards"><div class="field grow"><label for="cq">بحث</label><input id="cq" type="search" name="q" value="${h(q.get("q") || "")}" placeholder="الاسم، اسم المستخدم، الرقم الوظيفي"></div>
        <div class="field"><label for="cb">الدفعة</label><select id="cb" name="batch"><option value="">كل الدفعات</option>${batches.map((b) => `<option value="${h(b)}" ${b === batch ? "selected" : ""}>${h(b)} (${all.filter((c) => c.batch === b).length})</option>`).join("")}</select></div>
        <div class="field"><label for="cs">الحالة</label><select id="cs" name="state"><option value="">الكل</option><option value="pending" ${st === "pending" ? "selected" : ""}>سارية</option><option value="active" ${st === "active" ? "selected" : ""}>غيّرها صاحبها</option></select></div><button class="btn primary">عرض</button></form>
      <div class="card flush"><div class="table-wrap"><table class="responsive"><thead><tr><th>الموظف</th><th>الرقم الوظيفي</th><th>اسم المستخدم</th><th>كلمة المرور</th><th>الدور</th><th>الدفعة</th><th>الحالة</th><th>آخر دخول</th><th></th></tr></thead><tbody>
      ${rows.map((c) => `<tr><td data-label="الموظف">${h(c.name)}</td><td data-label="الرقم الوظيفي" class="num">${h(c.no)}</td><td data-label="اسم المستخدم" class="num"><b>${h(c.username)}</b></td>
        <td data-label="كلمة المرور" class="num">${c.pw ? `<code>${h(c.pw)}</code>` : '<span class="muted">— غُيّرت —</span>'}</td><td data-label="الدور">${ROLES[c.role] || c.role}</td><td data-label="الدفعة"><small>${h(c.batch)}</small></td>
        <td data-label="الحالة">${c.pw ? '<span class="badge ok">البطاقة سارية</span>' : `<span class="badge muted">غيّرها صاحبها${c.activatedAt ? " " + h(c.activatedAt) : ""}</span>`}</td><td data-label="آخر دخول" class="num">${(() => { const cu = c.user && byId("users", c.user); return cu && cu.last ? h(cu.last) : "— لم يدخل بعد —"; })()}</td>
        <td class="actions-cell">${c.pw ? `<a class="btn sm" href="#/print/cards?ids=${c.id}">طباعة البطاقة</a>` : ""}</td></tr>`).join("") || '<tr><td colspan="8" class="empty">لا توجد بطاقات. تُنشأ تلقائياً عند استيراد الموظفين أو إنشاء الحسابات أو إعادة تعيين كلمة المرور.</td></tr>'}
      </tbody></table></div></div>`);
  };

  const AUDIT_ACTIONS = {"login": "تسجيل دخول", "login_failed": "محاولة دخول فاشلة", "logout": "تسجيل خروج", "password_changed": "تغيير كلمة المرور", "password_reset": "إعادة تعيين كلمة المرور", "profile_updated": "تحديث الملف الشخصي", "user_saved": "إنشاء/تعديل حساب", "users_bulk_created": "إنشاء حسابات دفعة واحدة", "login_cards_printed": "طباعة بطاقات الدخول", "employee_created": "إضافة موظف", "employee_updated": "تعديل بيانات موظف", "employee_deleted": "حذف موظف أُدخل بالخطأ", "employees_imported": "استيراد موظفين", "recommendation_added": "رفع توصية", "recommendation_cancelled": "إلغاء توصية", "recommendation_submitted": "رفع توصية من الموظف للاعتماد", "recommendation_approved": "اعتماد توصية مرفوعة من الموظف", "recommendation_rejected": "رفض توصية مرفوعة من الموظف", "recommendation_withdrawn": "سحب توصية قبل اعتمادها", "leave_requested": "تقديم طلب معالجة غياب", "leave_approved": "اعتماد طلب", "leave_rejected": "رفض طلب", "leave_cancelled": "إلغاء طلب", "message_sent": "إرسال رسالة", "department_saved": "حفظ قسم", "department_merged": "دمج أقسام", "holiday_added": "إضافة عطلة رسمية", "holiday_deleted": "حذف عطلة رسمية", "holiday_updated": "تعديل عطلة رسمية", "year_saved": "حفظ إعدادات السنة", "year_activated": "تفعيل سنة", "year_locked": "إقفال سنة", "year_unlocked": "فتح سنة", "settings_saved": "حفظ هوية الجهة", "mail_test": "إرسال بريد تجريبي", "backup_downloaded": "تنزيل نسخة احتياطية", "auto_backup": "نسخة احتياطية تلقائية", "backup_restored": "استعادة نسخة احتياطية", "restore_denied": "رفض استعادة (كلمة مرور خاطئة)", "all_data_wiped": "حذف جميع البيانات", "wipe_denied": "رفض حذف البيانات (كلمة مرور خاطئة)", "archive_exported": "تصدير أرشيف السنة", "data_exported": "تصدير بيانات إلى Excel", "audit_exported": "تصدير سجل التدقيق", "leave_escalated": "تصعيد طلب متأخر لمدير النظام", "reminder_sent": "إرسال تذكير بالرصيد", "team_transferred": "نقل فريق بين المسؤولين", "delegation_created": "إنشاء تفويض", "delegation_cancelled": "إلغاء تفويض", "audit_cleared": "حذف من سجل التدقيق", "audit_clear_denied": "رفض حذف سجل التدقيق (كلمة مرور خاطئة)"};
  const AUDIT_ENTITIES = {"user": "حساب", "employee": "موظف", "recommendation": "توصية", "leave_request": "طلب", "message": "رسالة", "department": "قسم", "holiday": "عطلة", "fiscal_year": "سنة", "settings": "الإعدادات", "system": "النظام", "archive": "الأرشيف", "login_card": "بطاقة دخول", "export": "تصدير", "delegation": "تفويض", "team": "فريق"};
  const AUDIT_FIELDS = {"employee": "الموظف", "employee_id": "رقم سجل الموظف", "kind": "النوع", "unit": "الوحدة", "days": "أيام", "hours": "ساعات", "amount": "المقدار", "note": "الملاحظة", "reason": "السبب", "username": "اسم المستخدم", "role": "الدور", "count": "العدد", "file": "الملف", "batch": "الدفعة", "prev": "الحالة السابقة", "previous": "الحالة السابقة", "on_behalf": "بالنيابة", "to": "إلى", "ok": "النتيجة", "error": "الخطأ", "fields": "الحقول", "active": "نشط", "assigned": "عدد المسندين", "unassigned": "أُلغي إسنادهم", "by": "بواسطة", "auto_backup": "النسخة التلقائية", "year": "السنة", "rows": "عدد الصفوف", "created": "أُنشئ", "updated": "حُدّث", "before": "قبل", "after": "بعد", "auto": "تلقائي", "name": "الاسم", "subject": "الموضوع", "filters": "عوامل التصفية", "delegated": "بالتفويض", "from": "من", "start": "من تاريخ", "end": "إلى تاريخ", "moved": "عدد المنقولين", "pending_requests": "طلبات معلّقة انتقلت", "notify_employees": "إشعار الموظفين", "scope": "النطاق"};
  const auditVal = (v) => Array.isArray(v) ? v.map(auditVal).join("، ") : v === true ? "نعم" : v === false ? "لا" : v && typeof v === "object" ? Object.entries(v).map(([k, x]) => (AUDIT_FIELDS[k] || k) + ": " + auditVal(x)).join("، ") : ({ approved: "معتمد", pending: "بانتظار الاعتماد", rejected: "مرفوض", cancelled: "ملغى", days: "أيام", hours: "ساعات", use: "معالجة غياب", employee: "موظف", officer: "شؤون الموظفين", admin: "مدير النظام", wrong_password: "كلمة مرور خاطئة" })[v] || String(v);
  const auditDetails = (d) => { if (!d) return ""; if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) { return d; } } return typeof d === "object" ? Object.entries(d).filter(([, v]) => v != null && v !== "").map(([k, v]) => (AUDIT_FIELDS[k] || k) + ": " + auditVal(v)).join(" · ") : String(d); };
  function auditRows(q) {
    const qs = (q.get("q") || "").trim(), who = q.get("who") || "", act = q.get("action") || "", df = q.get("date_from") || "", dt = q.get("date_to") || "";
    return DB.audit.filter((a) => (!qs || [a.user, a.action, AUDIT_ACTIONS[a.action] || "", a.entity, JSON.stringify(a.details || "")].join(" ").includes(qs)) && (!who || a.user === who) && (!act || a.action === act)
      && (!df || a.at.slice(0, 10) >= df) && (!dt || a.at.slice(0, 10) <= dt));
  }
  A.audit = (u, q) => {
    const rows = auditRows(q), who = q.get("who") || "", act = q.get("action") || "", users = [...new Set(DB.audit.map((a) => a.user).filter(Boolean))].sort();
    const acts = [...new Set(DB.audit.map((a) => a.action))].map((k) => [k, AUDIT_ACTIONS[k] || k]).sort((a, b) => a[1].localeCompare(b[1], "ar"));
    return layout(u, "سجل التدقيق", `<div class="page-head"><div><h1>${ico("audit", "h-ico")} سجل التدقيق</h1><p>كل عملية دخول وإنشاء وتعديل واعتماد وتصدير، بالمنفّذ والوقت · ${DB.audit.length} قيد${DB.audit.length ? " منذ " + DB.audit[DB.audit.length - 1].at.slice(0, 10) : ""}.</p></div>
      <div class="actions"><button class="btn" type="button" data-act="audit-dl">${ico("download", "sm-ico")}تصدير Excel</button></div></div>
      <form class="card filters" data-form="filter" data-route="admin/audit"><div class="field grow"><label for="aq">بحث</label><input id="aq" type="search" name="q" value="${h(q.get("q") || "")}" placeholder="اسم المستخدم، العملية، التفاصيل"></div>
        <div class="field"><label for="aw">المستخدم</label><select id="aw" name="who"><option value="">الكل</option>${users.map((x) => `<option value="${h(x)}" ${x === who ? "selected" : ""}>${h(x)}</option>`).join("")}</select></div>
        <div class="field"><label for="aa">العملية</label><select id="aa" name="action"><option value="">الكل</option>${acts.map(([k, l]) => `<option value="${k}" ${k === act ? "selected" : ""}>${h(l)}</option>`).join("")}</select></div>
        <div class="field"><label for="adf">من تاريخ</label><input id="adf" type="date" name="date_from" value="${h(q.get("date_from") || "")}"></div>
        <div class="field"><label for="adt">إلى تاريخ</label><input id="adt" type="date" name="date_to" value="${h(q.get("date_to") || "")}"></div><button class="btn primary">عرض</button></form>
      <div class="card flush"><div class="table-wrap"><table class="responsive"><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>الكيان</th><th>التفاصيل</th></tr></thead><tbody>
      ${rows.slice(0, 300).map((a) => `<tr><td class="num nowrap" data-label="الوقت">${a.at}</td><td data-label="المستخدم">${h(a.user || "النظام")}</td><td data-label="العملية"><b>${h(AUDIT_ACTIONS[a.action] || a.action)}</b>${AUDIT_ACTIONS[a.action] ? `<br><small class="muted" dir="ltr">${h(a.action)}</small>` : ""}</td>
        <td data-label="الكيان">${h(AUDIT_ENTITIES[a.entity] || a.entity || "")}${a.entityId ? ` <span class="num muted">#${a.entityId}</span>` : ""}</td><td data-label="التفاصيل"><small>${h(auditDetails(a.details))}</small></td></tr>`).join("") || '<tr><td colspan="5" class="empty">لا توجد سجلات مطابقة.</td></tr>'}
      </tbody></table></div></div>
      <details class="card danger-zone" id="clear"><summary><b>${ico("audit", "sm-ico")} حذف سجل التدقيق</b> <span class="hint">لمدير النظام فقط</span></summary>
        <div class="alert warn" role="note">سجل التدقيق مرجع المساءلة عند أي اعتراض أو مراجعة؛ يُنصح بحذف القيود القديمة فقط بعد تصديرها إلى Excel وحفظها. تُحفظ نسخة احتياطية تلقائية قبل الحذف، ويبقى قيد يوثّق عملية الحذف نفسها (من حذف ومتى وكم قيداً).</div>
        <form class="filters" data-form="audit-clear"><div class="field"><label for="cs">ما يُحذف</label><select id="cs" name="scope"><option value="before">القيود السابقة لتاريخ</option><option value="all">السجل كاملاً</option></select></div>
          <div class="field"><label for="cb">قبل تاريخ</label><input id="cb" type="date" name="before" value="${(() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return iso(d); })()}"></div>
          <div class="field"><label for="cc">اكتب «${WIPE_WORD}» للتأكيد</label><input id="cc" name="confirm" autocomplete="off" required></div>
          <div class="field"><label for="cp">كلمة مرور مدير النظام</label><input id="cp" type="password" name="password" autocomplete="current-password" required></div>
          <button class="btn danger">حذف</button></form></details>`); };
  // ============================================================ الاستيراد
  const HEADERS = { name: ["الاسم", "اسم الموظف", "الاسم الكامل", "الموظف", "name"], no: ["الرقم الوظيفي", "الرقم", "رقم الموظف", "رقم وظيفي", "employee no", "id"],
    dept: ["القسم", "الوحده", "الاداره", "الجهه", "department"], role: ["المنصب", "الدور", "الصلاحيه", "نوع الحساب", "role"],
    manager: ["رقم مسؤول شؤون الموظفين", "مسؤول شؤون الموظفين", "شؤون الموظفين", "رقم مسؤول الشؤون الاداريه", "مسؤول الشؤون الاداريه", "الشؤون الاداريه", "رقم الإداري المسؤول", "رقم الإداري", "الإداري المسؤول", "الإداري", "رقم المدير المباشر", "المدير المباشر", "رقم المدير", "المدير", "manager"], title: ["المسمى الوظيفي", "المسمى", "الوظيفه", "title"], email: ["البريد", "البريد الالكتروني", "البريد الجامعي", "الايميل", "email"] };
  const HL = {}; Object.entries(HEADERS).forEach(([k, vs]) => vs.forEach((v) => (HL[norm(v).toLowerCase()] = k)));
  const ROLE_WORDS = { "موظف": "employee", "employee": "employee", "اداري": "officer", "الشؤون الاداريه": "officer", "شؤون الموظفين": "officer", "مسؤول شؤون الموظفين": "officer", "شؤون اداريه": "officer", "مسؤول الشؤون الاداريه": "officer", "officer": "officer", "مسؤول": "officer", "مسئول": "officer", "مسؤول الادخال": "officer", "مدخل بيانات": "officer",
    "مدير مباشر": "officer", "مدير": "officer", "رئيس مباشر": "officer", "manager": "officer", "متابع": "officer", "مراقب": "officer", "viewer": "officer" };
  const cell = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
  function parseText(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    const s = lines.slice(0, 20).join("\n");
    const delim = s.includes("\t") ? "\t" : s.includes(";") && !s.includes(",") ? ";" : s.includes(",") || s.includes("،") ? "," : "\t";
    return lines.map((l) => l.replace(/،/g, ",").split(delim).map((c) => cell(c.replace(/^"|"$/g, ""))));
  }
  function buildRows(table) {
    table = table.filter((r) => r.some((c) => c));
    if (!table.length) throw new RuleError("لم يتم إدخال أي بيانات. ارفع ملفاً أو الصق الأسماء والأرقام.");
    if (table.length > 2001) throw new RuleError("الحد الأقصى 2000 صف في المرة الواحدة.");
    const map = {}; table[0].forEach((c, i) => { const k = HL[norm(c).toLowerCase()]; if (k && !(k in map)) map[k] = i; });
    let body = table, start = 1;
    if ("name" in map) { body = table.slice(1); start = 2; }
    else { const [a, b] = table[0]; const num = (x) => /^\d[\d-]*$/.test(x || "");
      Object.assign(map, num(a) && b && !num(b) ? { no: 0, name: 1, dept: 2, role: 3, manager: 4, title: 5, email: 6 } : { name: 0, no: 1, dept: 2, role: 3, manager: 4, title: 5, email: 6 }); }
    return body.map((r, i) => { const g = (k) => (map[k] != null ? cell(r[map[k]]) : ""); const row = { line: i + start, name: g("name"), no: g("no"), dept: g("dept"), manager: g("manager"), title: g("title"), email: g("email"), role: null, errors: [] };
      const rt = norm(g("role")).toLowerCase(); if (rt) { if (ROLE_WORDS[rt]) row.role = ROLE_WORDS[rt]; else row.errors.push("دور غير معروف «" + g("role") + "» (المسموح: موظف، شؤون الموظفين)"); }
      return row; });
  }
  const DEPT_WORDS = ["قسم", "وحده", "اداره", "مكتب", "شعبه"];
  const deptCore = (nm) => norm(nm).split(" ").filter((w) => !DEPT_WORDS.includes(w)).map((w) => (w.startsWith("ال") && w.length > 3 ? w.slice(2) : w)).join(" ");
  function validateRows(rows) {
    const seenNo = {}, seenName = {}, fileNos = new Set(rows.filter((r) => r.no).map((r) => r.no));
    const byNo = {}, byName = {}; DB.emps.forEach((e) => { byNo[e.no] = e; byName[norm(e.name)] = e; });
    rows.forEach((r) => {
      if (!r.name) r.errors.push("الاسم فارغ");
      if (!r.no) r.errors.push("الرقم الوظيفي فارغ"); else if (/^tmp-/i.test(r.no)) r.errors.push("لا يُقبل رقم مؤقت");
      if (r.no && seenNo[r.no]) r.errors.push("الرقم مكرر في السطر " + seenNo[r.no]); if (r.no && !seenNo[r.no]) seenNo[r.no] = r.line;
      const k = norm(r.name); if (k && seenName[k]) r.errors.push("الاسم مكرر في السطر " + seenName[k]); if (k && !seenName[k]) seenName[k] = r.line;
      if (r.manager && r.manager === r.no) r.errors.push("لا يُسند الموظف إلى نفسه");
      else if (r.manager && !fileNos.has(r.manager) && !byNo[r.manager]) r.errors.push("رقم مسؤول شؤون الموظفين " + r.manager + " غير موجود");
      if (r.errors.length) { r.action = "error"; return; }
      const ex = byNo[r.no], same = byName[k];
      if (ex) { r.action = "update"; if (norm(ex.name) !== k) r.note = "سيُحدَّث الاسم من «" + ex.name + "»"; }
      else if (same && isTmp(same)) { r.action = "update"; r.note = "سيُستبدل الرقم المؤقت " + same.no; }
      else if (same) { r.action = "error"; r.errors.push("الاسم مسجل مسبقاً برقم آخر (" + same.no + ")"); }
      else r.action = "new";
      if (r.dept && !DB.depts.some((d) => norm(d.name) === norm(r.dept))) { const near = DB.depts.find((d) => deptCore(d.name) === deptCore(r.dept)); if (near) { const tip = "القسم «" + r.dept + "» قريب من القسم الموجود «" + near.name + "» — وحّد الاسم أو ادمجهما لاحقاً من الإعدادات"; r.note = r.note ? r.note + " · " + tip : tip; } }
    });
    return rows;
  }
  async function applyRows(rows, create, roles) {
    rows = validateRows(rows.map((r) => ({ ...r, errors: [] })));
    const byNo = {}, byName = {}; DB.emps.forEach((e) => { byNo[e.no] = e; byName[norm(e.name)] = e; });
    const depts = {}; DB.depts.forEach((d) => (depts[norm(d.name)] = d));
    const deptFor = (nm) => { if (!nm) return null; const k = norm(nm); if (!depts[k]) { depts[k] = { id: nid(), name: nm, active: true }; DB.depts.push(depts[k]); } return depts[k].id; };
    const res = { created: 0, updated: 0, accounts: [], roles: 0 }, touched = [];
    rows.forEach((r) => {
      if (!["new", "update"].includes(r.action)) return;
      let e = byNo[r.no];
      if (!e && r.action === "update") { e = byName[norm(r.name)]; e.no = r.no; byNo[r.no] = e; }
      if (!e) { e = { id: nid(), no: r.no, name: r.name, dept: null, mgr: null, title: "", email: "", active: true }; DB.emps.push(e); byNo[r.no] = e; res.created++; } else res.updated++;
      e.name = r.name; if (r.dept) e.dept = deptFor(r.dept); if (r.title) e.title = r.title; if (r.email) e.email = r.email;
      touched.push([r, e]);
    });
    touched.forEach(([r, e]) => { if (r.manager) e.mgr = byNo[r.manager].id; });
    for (const [r, e] of touched) {
      const ex = DB.users.find((x) => x.emp === e.id);
      if (ex) { if (roles && r.role && ex.role !== "admin" && ex.role !== r.role) { ex.role = r.role; res.roles++; } continue; }
      if (!create) continue;
      const un = String(e.no).toLowerCase();
      if (DB.users.some((x) => x.username.toLowerCase() === un)) continue;
      const pw = rand(), role = ASSIGNABLE.includes(r.role) ? r.role : "employee";
      DB.users.push({ id: nid(), username: un, pw: await sha(pw), role, emp: e.id, active: true, mustChange: false, last: null });
      res.accounts.push([e.name, un, pw, role]);
    }
    return res;
  }

  // ============================================================ التصدير
  function exportXlsx(kind, yearId) {
    const u = me(), y = byId("years", yearId) || activeYear(), ids = new Set(managedEmps(u, true).map((e) => e.id));
    let head, rows, name;
    if (kind === "balances") { head = ["م", "اسم الموظف", "الرقم الوظيفي", "القسم", "مسؤول شؤون الموظفين", "أيام ممنوحة", "ساعات ممنوحة", "أيام مستخدمة", "ساعات مستخدمة", "رصيد الأيام", "رصيد الساعات", "الإجمالي (أيام)", "+ ساعات", "الممنوح بالأيام المعادلة", "الحد الأقصى"];
      rows = managedEmps(u).map((e, i) => { const b = balance(e.id, y); return [i + 1, e.name, e.no, deptName(e), mgrName(e), b.gDays, b.gHours, b.uDays, b.uHours, b.daysLeft, b.hoursLeft, b.totalDays, b.totalRem, b.grantedEq, b.cap]; });
      name = "أرصدة بدل الراحة " + y.name; }
    else if (kind === "recs") { head = ["الرقم الصادر", "اسم الموظف", "الرقم الوظيفي", "تاريخ التوصية", "النوع", "القيمة", "رقم خطاب التوصية", "الموضوع", "جهة التكليف", "التكليف من", "التكليف إلى", "الحالة", "ملف PDF"];
      rows = DB.recs.filter((r) => r.year === y.id && ids.has(r.emp)).sort((a, b) => a.date.localeCompare(b.date)).map((r, i) => { const e = byId("emps", r.emp); return [r.ref || i + 1, e.name, e.no, r.date, REC_KINDS[r.kind], r.amount, r.refNo || "", r.subject, r.assignedBy || "", r.taskFrom || "", r.taskTo || "", r.status === "active" ? "سارية" : "ملغاة", r.att ? "نعم" : ""]; });
      name = "توصيات بدل الراحة " + y.name; }
    else if (kind === "summary") {
      const D = reportData(u, y, 0, 0), cols = ["عدد الموظفين", "الممنوح (يوم معادل)", "المستخدم", "المعلّق", "المتاح", "نسبة الاستخدام %", "طلبات معتمدة", "طلبات مرفوضة", "طلبات معلّقة", "متوسط مدة القرار (يوم)"];
      const rowsOf = (lst) => lst.map(([k, d]) => [k, d.count, round2(d.granted), round2(d.used), round2(d.pending), d.left, d.util, d.approved, d.rejected, d.nPending, d.avgLead == null ? "" : d.avgLead]);
      const sheets = [["حسب القسم", [["القسم", ...cols], ...rowsOf(D.byDept)]]];
      if (u.role === "admin") sheets.push(["حسب المسؤول", [["مسؤول شؤون الموظفين", ...cols], ...rowsOf(D.byOff)]]);
      sheets.push(["شهرياً", [["الشهر", "السنة", "الممنوح (يوم معادل)", "المستخدم (يوم معادل)"], ...D.months.map((m) => [m.label, m.year, m.g, m.u])]]);
      sheets.push(["أعلى الأرصدة المتاحة", [["الموظف", "الرقم الوظيفي", "القسم", "المتاح (يوم معادل)"], ...D.unused.map(([e, a]) => [e.name, e.no, deptName(e), a])]]);
      downloadBook(sheets, "ملخص التقارير " + y.name); return; }
    else { head = ["م", "اسم الموظف", "الرقم الوظيفي", "نوع الطلب", "من", "إلى", "أيام", "ساعات", "الحالة", "السبب", "ملاحظة القرار"];
      rows = DB.leaves.filter((r) => r.year === y.id && ids.has(r.emp)).sort((a, b) => a.start.localeCompare(b.start)).map((r, i) => { const e = byId("emps", r.emp); return [i + 1, e.name, e.no, LEAVE_KINDS[r.kind], r.start, r.end, r.unit === "days" ? r.days : "", r.unit === "hours" ? r.hours : "", REQ_ST[r.status], r.reason, r.note]; });
      name = "طلبات بدل الراحة " + y.name; }
    download([head, ...rows], name);
  }
  function downloadBook(sheets, name) {
    if (window.XLSX) { const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; sheets.forEach(([title, aoa]) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!views"] = [{ RTL: true }]; XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 30)); }); XLSX.writeFile(wb, name + ".xlsx"); return; }
    download(sheets[0][1], name); // بديل CSV: الورقة الأولى فقط حتى يبقى الملف قابلاً لإعادة الرفع
  }
  function download(aoa, name) {
    if (window.XLSX) { const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!views"] = [{ RTL: true }]; const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 30)); XLSX.writeFile(wb, name + ".xlsx"); return; }
    const csv = "﻿" + aoa.map((r) => r.map((c) => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = name + ".csv"; document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 2000);
  }

  // ============================================================ النماذج
  const F = {};
  const fd = (form) => new FormData(form);
  const pdfCheck = async (file) => { if (!file || !file.name) return ""; if (file.size > 5 * 1024 * 1024) throw new RuleError("حجم الملف يتجاوز 5 ميجابايت."); const head = new Uint8Array(await file.slice(0, 4).arrayBuffer()); if (String.fromCharCode(...head) !== "%PDF") throw new RuleError("الملف المرفق يجب أن يكون بصيغة PDF."); return file.name; };

  F.login = async (form) => {
    const d = fd(form), un = String(d.get("username") || "").trim().toLowerCase();
    const u = DB.users.find((x) => x.username.toLowerCase() === un);
    if (u && u.lockedUntil && u.lockedUntil > Date.now()) { flash("تم قفل الحساب مؤقتاً بسبب محاولات دخول متكررة. حاول بعد 15 دقيقة.", "error"); return render(); }
    if (u && u.active && u.pw === (await sha(String(d.get("password") || "")))) {
      u.failed = 0; u.last = nowStr(); sessionStorage.setItem("hr_uid", u.id); audit("login", "user", u.id); save(); return go(u.mustChange ? "#/password" : "#/");
    }
    if (u) { u.failed = (u.failed || 0) + 1; if (u.failed >= 5) { u.lockedUntil = Date.now() + 15 * 60000; u.failed = 0; } save(); }
    flash("اسم المستخدم أو كلمة المرور غير صحيحة.", "error"); render();
  };
  F.password = async (form, u) => {
    const d = fd(form), cur = String(d.get("current")), nw = String(d.get("new")), cf = String(d.get("confirm"));
    if (u.pw !== (await sha(cur))) throw new RuleError("كلمة المرور الحالية غير صحيحة.");
    if (nw !== cf) throw new RuleError("كلمتا المرور غير متطابقتين.");
    if (nw === cur) throw new RuleError("اختر كلمة مرور مختلفة عن الحالية.");
    if (nw.length < 8 || /^\d+$/.test(nw) || /^[^\d]+$/.test(nw)) throw new RuleError("كلمة المرور يجب ألا تقل عن 8 أحرف وتحتوي على أحرف وأرقام.");
    u.pw = await sha(nw); u.mustChange = false; (DB.cards || []).forEach((c) => { if (c.user === u.id && c.pw) { c.pw = null; c.activatedAt = nowStr(); } }); audit("password_changed", "user", u.id); save(); flash("تم تغيير كلمة المرور بنجاح."); go("#/");
  };
  F.profile = (form, u) => {
    const d = fd(form), e = empOf(u), adm = u.role === "admin", ch = [];
    const email = cleanEmail(d.get("email")), phone = cleanPhone(d.get("phone")), ext = e ? cleanExt(d.get("ext")) : "";
    const name = String(d.get("name") || "").replace(/\s+/g, " ").trim(), dept = Number(d.get("dept") || 0) || null;
    const T = e || u, set = (k, v) => { if ((T[k] || "") !== (v || "")) { T[k] = v; ch.push(k); } };
    if (adm && e && name && name !== e.name && DB.emps.some((x) => norm(x.name) === norm(name) && x.id !== e.id)) throw new RuleError("يوجد موظف مسجل بنفس الاسم.");
    set("email", email); set("phone", phone); if (e) set("ext", ext);
    if (adm) { if (e) { if (name) set("name", name); set("title", String(d.get("title") || "").replace(/\s+/g, " ").trim()); } else set("name", name); if ((T.dept || null) !== dept) { T.dept = dept; ch.push("dept"); } }
    if (!ch.length) { flash("لم يتغيّر شيء.", "info"); render(); return; }
    audit("profile_updated", "user", u.id, { fields: ch }); save(); flash("تم حفظ بياناتك الشخصية."); render();
  };
  F.quicksearch = (form) => go("#/employees?q=" + encodeURIComponent(fd(form).get("q") || ""));
  let keepFocus = null, liveMsg = false, ftimer = null;
  F.filter = (form) => { liveMsg = true; const p = new URLSearchParams(); for (const [k, v] of fd(form)) if (v) p.append(k, v); go("#/" + form.dataset.route + (p.toString() ? "?" + p : "")); };
  F.employee = async (form, u) => {
    need(u, ["admin"]);
    const d = fd(form), id = Number(form.dataset.id || 0), no = String(d.get("no")).trim(), name = String(d.get("name")).replace(/\s+/g, " ").trim();
    if (!no || !name) throw new RuleError("الرقم الوظيفي والاسم حقلان إلزاميان.");
    const dup = DB.emps.find((e) => e.no === no && e.id !== id); if (dup) throw new RuleError("الرقم الوظيفي مستخدم لموظف آخر: " + dup.name + ".");
    if (DB.emps.find((e) => norm(e.name) === norm(name) && e.id !== id)) throw new RuleError("يوجد موظف مسجل بنفس الاسم. أضف ما يميّزه.");
    const mgr = Number(d.get("mgr") || 0) || null; if (id && mgr === id) throw new RuleError("لا يمكن إسناد الموظف إلى نفسه.");
    const email = cleanEmail(d.get("email")), phone = cleanPhone(d.get("phone")), ext = cleanExt(d.get("ext"));
    let e = id ? byId("emps", id) : null;
    const wasActive = e ? e.active : true, oldMgr = e ? e.mgr : null;
    if (e && e.active && !d.get("active")) { const team = DB.emps.filter((x) => x.active && x.mgr === e.id).length; if (team) throw new RuleError("لا يمكن إيقاف «" + e.name + "»: يوجد " + team + " موظف نشط مسند إلى هذا السجل بصفته مسؤول شؤون موظفين؛ انقل الفريق كاملاً لمسؤول آخر أولاً من «المستخدمون والصلاحيات ‹ الفرق والتفويض»."); }
    if (!e) { e = { id: nid(), active: true }; DB.emps.push(e); } else e.active = !!d.get("active");
    Object.assign(e, { no, name, dept: Number(d.get("dept") || 0) || null, mgr, title: String(d.get("title") || ""), email, phone, ext });
    if (mgr && mgr !== oldMgr) notifyReassign(e, mgr, u);
    if (id && wasActive !== e.active) {
      const acct = DB.users.find((x) => x.emp === e.id); const pend = DB.leaves.filter((x) => x.emp === e.id && x.status === "pending").length;
      if (acct && acct.role !== "admin") { acct.active = e.active; flash((e.active ? "أُعيد تفعيل" : "عُطّل") + " حساب الدخول (" + acct.username + ") تبعاً لحالة الموظف.", "info"); }
      if (!e.active && pend) flash("تنبيه: للموظف " + pend + " طلب بانتظار الاعتماد — راجعها من «الاعتمادات» (تُبتّ أو تُلغى).", "warn");
    }
    audit(id ? "employee_updated" : "employee_created", "employee", e.id, { no, name, officer: mgr }); flash("تم حفظ بيانات الموظف.");
    if (!id && d.get("create_account")) { try { const [un, pw] = await createEmpAccount(e); flash("تم إنشاء حساب الدخول: اسم المستخدم " + un + " وكلمة المرور " + pw + " (يستطيع تغييرها متى شاء من «الملف الشخصي»). اطبع بطاقة دخوله من أعلى الصفحة."); } catch (err) { if (!(err instanceof RuleError)) throw err; flash("حُفظ الموظف لكن لم يُنشأ حساب دخول: " + err.message, "warn"); } }
    save(); go("#/employee/" + e.id);
  };
  F.rec = async (form, u) => {
    need(u, STAFF);
    const d = fd(form), kind = form.dataset.kind, ids = [...new Set(d.getAll("emps").map(Number).filter(Boolean))];
    const emps = ids.map((i) => byId("emps", i));
    if (!emps.length || emps.some((e) => !e || !canManage(u, e))) throw new RuleError("اختر موظفاً واحداً على الأقل من الموظفين المسندين إليك.");
    const amount = toNum(d.get("amount")), date = String(d.get("date") || todayISO()), refNo = String(d.get("ref") || "").trim();
    const tFrom = String(d.get("task_from") || ""), tTo = String(d.get("task_to") || "") || tFrom;
    if (tFrom && tTo < tFrom) throw new RuleError("فترة التكليف غير صحيحة: تاريخ النهاية قبل تاريخ البداية.");
    if (tFrom && tFrom > date) throw new RuleError("لا يمكن أن تبدأ فترة التكليف بعد تاريخ التوصية.");
    const att = await pdfCheck(d.get("file")), errs = [], warn = []; let y = null;
    emps.forEach((e) => {
      try { y = validateRec(e, kind, amount, date, !!att); } catch (err) { if (!(err instanceof RuleError)) throw err; errs.push(e.name + ": " + err.message); return; }
      if (refNo) { const same = DB.recs.find((r) => r.emp === e.id && r.status === "active" && String(r.refNo || "").toLowerCase() === refNo.toLowerCase());
        if (same && same.date === date && Math.abs(same.amount - amount) < 1e-9 && same.kind === kind) errs.push(e.name + ": توجد توصية مطابقة بالخطاب نفسه (" + refNo + ") والتاريخ والقيمة نفسها؛ يبدو أنها مكررة.");
        else if (same) warn.push(e.name); }
    });
    if (errs.length) throw new RuleError("لم تُرفع أي توصية: " + errs.slice(0, 6).join(" | ") + (errs.length > 6 ? " …" : ""));
    const batch = emps.length > 1 ? "B" + nid() : "";
    let last = null;
    emps.forEach((e) => {
      const beforeA = alertKeys(balance(e.id, y));
      const r = { id: nid(), emp: e.id, year: y.id, kind, amount, date, refNo, subject: String(d.get("subject") || "").trim(), assignedBy: String(d.get("assigned_by") || "").trim().slice(0, 160), taskFrom: tFrom, taskTo: tFrom ? tTo : "", batch, status: "active", att, by: u.id, cancelNote: "", created: nowStr() };
      assignRef(r, "REC"); DB.recs.push(r); audit("recommendation_added", "recommendation", r.id, { employee: e.no, kind, amount, batch: batch || undefined });
      notify(userOfEmp(e), "منحك بدل راحة: " + recAmount(r), "أُضيفت إلى رصيدك توصية بمنحك " + REC_KINDS[kind] + ": " + recAmount(r) + (r.subject ? " — " + r.subject : "") + ".", "#/me", u);
      notifyAlerts(e, y, beforeA, u); last = r;
    });
    save();
    if (warn.length) flash("تنبيه: رقم الخطاب «" + refNo + "» مستخدم سابقاً في توصية أخرى لـ: " + warn.slice(0, 5).join("، ") + ". تأكد أنه ليس تكراراً.", "warn");
    if (emps.length === 1) { flash("تم رفع التوصية وإضافة " + recAmount(last) + " إلى رصيد " + emps[0].name + "."); go("#/employee/" + emps[0].id); }
    else { flash("تم رفع التوصية بخطاب واحد، وأُضيف " + recAmount(last) + " إلى رصيد كل موظف (عدد الموظفين: " + cnt(emps.length, "emp") + ")."); go("#/recs"); }
  };
  F.leave = async (form, u) => {
    const d = fd(form), kind = form.dataset.kind, unit = "days", y0 = activeYear();
    const e = byId("emps", d.get("emp") || u.emp); if (!e) throw new RuleError("اختر الموظف.");
    const own = e.id === u.emp; if (!own && !canManage(u, e)) throw new RuleError("ليست لديك صلاحية لتقديم طلب لهذا الموظف.");
    if (own && u.role === "employee" && !y0.empCanRequest) throw new RuleError("تقديم الطلبات من الموظفين غير مفعّل حالياً.");
    const att = await pdfCheck(d.get("file"));
    const v = validateLeave(e, kind, unit, String(d.get("start") || ""), unit === "hours" ? null : String(d.get("end") || "") || null, unit === "hours" ? toNum(d.get("hours")) : null, !!att);
    const r = { id: nid(), emp: e.id, year: v.y.id, kind, unit, start: String(d.get("start")), end: v.end, days: v.days, hours: v.hours, reason: String(d.get("reason") || "").trim(), status: "pending", att, by: u.id, decidedBy: null, decidedAt: null, note: "", created: nowStr() };
    assignRef(r, "REQ"); DB.leaves.push(r); audit("leave_requested", "leave_request", r.id, { employee: e.no, kind, unit, days: v.days, hours: v.hours });
    if (own) (officerUsersFor(e).length ? officerUsersFor(e) : DB.users.filter((x) => x.role === "admin")).forEach((o) => notify(o, "طلب " + LEAVE_KINDS[kind] + " جديد من " + e.name, LEAVE_KINDS[kind] + " — " + leaveAmount(r) + " بتاريخ " + r.start + ". " + r.reason, "#/approvals", u));
    save(); flash("تم رفع طلب " + LEAVE_KINDS[kind] + " (" + leaveAmount(r) + ")" + (own ? " وهو بانتظار اعتماد مسؤول شؤون الموظفين." : ".")); go("#/requests");
  };
  F.msg = (form, u) => {
    const d = fd(form), allowed = new Set(recipients(u).map((x) => x.id)), to = d.getAll("to").map(Number).filter((x) => allowed.has(x));
    const subject = String(d.get("subject") || "").trim(), body = String(d.get("body") || "").trim();
    if (!to.length || !subject || !body) throw new RuleError("اختر المستلم واكتب الموضوع ونص الرسالة.");
    to.forEach((id) => notify(byId("users", id), subject, body, "", u));
    audit("message_sent", "message", null, { to: to.length, subject }); save();
    flash("تم إرسال الرسالة." + (to.some((id) => { const e = empOf(byId("users", id)); return e && e.email; }) ? " (في النظام الفعلي تصل نسخة بالبريد لمن لديه بريد مسجّل.)" : "")); go("#/messages?box=sent");
  };
  F.year = (form, u) => {
    need(u, ["admin"]);
    const d = fd(form), id = Number(form.dataset.id || 0), name = String(d.get("name")).trim(), start = d.get("start"), end = d.get("end");
    const hpd = toNum(d.get("hpd")), cap = toNum(d.get("cap"));
    if (!name || !parseISO(start) || !parseISO(end) || end < start) throw new RuleError("أدخل اسم السنة وتاريخي بداية ونهاية صحيحين.");
    if (!hpd || hpd <= 0 || cap == null || cap < 0) throw new RuleError("قيم الإعدادات الرقمية غير صحيحة.");
    const ov = DB.years.find((y) => y.id !== id && y.start <= end && y.end >= start); if (ov) throw new RuleError("الفترة تتداخل مع السنة " + ov.name + ".");
    if (id && (DB.recs.some((x) => x.year === id && (x.date < start || x.date > end)) || DB.leaves.some((x) => x.year === id && (x.start < start || x.end > end)))) throw new RuleError("توجد حركات خارج الفترة الجديدة، لا يمكن تضييق السنة.");
    let y = id ? byId("years", id) : null; if (!y) { y = { id: nid(), active: false, locked: false }; DB.years.push(y); }
    if (y.locked) throw new RuleError("السنة مقفلة.");
    const moves = DB.recs.filter((x) => x.year === y.id).length + DB.leaves.filter((x) => x.year === y.id).length;
    if (id && moves && (Number(hpd) !== Number(y.hpd) || Math.trunc(cap) !== Number(y.cap)) && !d.get("confirmImpact")) {
      const empsAff = [...new Set(DB.recs.filter((x) => x.year === y.id).map((x) => x.emp))];
      const over = empsAff.filter((eid) => { const b0 = balance(eid, y); return b0.gDays + b0.gHours / hpd > cap + 1e-9; }).length;
      throw new RuleError("تنبيه: في السنة " + y.name + " " + moves + " حركة، والتغيير سيعيد حساب أرصدة " + empsAff.length + " موظف بأثر رجعي" + (over ? "، و" + over + " موظف سيتجاوزون الحد الجديد" : "") + ". لم يُحفظ شيء: ضع علامة على «أؤكد تطبيق التغيير بأثر رجعي» ثم احفظ.");
    }
    Object.assign(y, { name, start, end, cap: Math.trunc(cap), hpd, weekend: d.getAll("weekend").map(Number) });
    ["reqRecAtt", "reqReqAtt", "empCanRequest", "empCanSubmitRec", "blockWeekends", "allowLateCancel"].forEach((k) => (y[k] = !!d.get(k)));
    if (!y.weekend.length) y.weekend = [5, 6];
    audit("year_saved", "fiscal_year", y.id, { cap: y.cap, hpd }); save(); flash("تم حفظ إعدادات السنة " + name + "."); render();
  };
  F.import = async (form) => {
    const d = fd(form), file = d.get("file"); let table = [];
    if (file && file.name) {
      if (file.size > 2 * 1024 * 1024) throw new RuleError("حجم الملف يتجاوز 2 ميجابايت.");
      if (/\.csv$/i.test(file.name)) table = parseText(await file.text());
      else { if (!window.XLSX) throw new RuleError("تعذّر تحميل قارئ Excel. استخدم النسخ واللصق أو ملف CSV.");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" }); table = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" }).map((r) => r.map(cell)); }
    } else table = parseText(String(d.get("pasted") || ""));
    importPreview = validateRows(buildRows(table)); render();
  };
  F["import-commit"] = async (form, u) => {
    const d = fd(form), rows = importPreview.filter((r) => r.action !== "error");
    const res = await applyRows(rows, !!d.get("create"), !!d.get("roles"));
    audit("employees_imported", "employee", null, { created: res.created, updated: res.updated, accounts: res.accounts.length, roles_changed: res.roles });
    if (res.accounts.length) saveCards(res.accounts, "import"); else lastBatch = null;
    save(); importPreview = null; createdAccounts = res.accounts;
    flash("تمت إضافة " + res.created + " موظف وتحديث " + res.updated + "، وإنشاء " + res.accounts.length + " حساب" + (res.roles ? "، وتغيير منصب " + res.roles : "") + "."); render();
  };
  // إسناد الموظفين لمسؤول شؤون الموظفين (اختيار متعدد). يعيد عدد المسندين أو null إن لم تُرسل القائمة
  function notifyReassign(e, officerEmpId, from) {
    const pend = DB.leaves.filter((x) => x.emp === e.id && x.status === "pending").length;
    DB.users.filter((x) => x.emp === officerEmpId && x.active).forEach((o) => notify(o, "أُسند إليك الموظف " + e.name, "أصبحت مسؤول شؤون الموظفين عن " + e.name + " (" + e.no + ")." + (pend ? " لديه " + pend + " طلب بانتظار قرارك." : ""), pend ? "#/approvals" : "#/employee/" + e.id, from));
    return pend;
  }
  function applyAssign(d, role, emp, prevRole, prevEmp) {
    if (prevRole === "officer" && prevEmp && (role !== "officer" || prevEmp !== emp)) {
      const moved = DB.emps.filter((e) => e.mgr === prevEmp); moved.forEach((e) => (e.mgr = null));
      if (moved.length) flash("أُلغي إسناد " + moved.length + " موظف لأن الحساب لم يعد «شؤون الموظفين» لنفس السجل. أسندهم لمسؤول شؤون موظفين آخر.", "warn");
    }
    if (role !== "officer" || !emp || !d.get("assign_present")) return null;
    const wanted = new Set(d.getAll("assign").map(Number).filter((id) => id !== emp));
    let pendMoved = 0;
    DB.emps.forEach((e) => { if (wanted.has(e.id)) { if (e.mgr !== emp) pendMoved += notifyReassign(e, emp, me()); e.mgr = emp; } else if (e.mgr === emp) e.mgr = null; });
    if (pendMoved) flash("نُقل مع الموظفين " + pendMoved + " طلب معلّق، وأُشعر مسؤول شؤون الموظفين بها.", "info");
    return wanted.size;
  }
  F["user-new"] = async (form, u) => {
    const d = fd(form), un = String(d.get("username")).trim().toLowerCase(), role = d.get("role"), emp = Number(d.get("emp") || 0) || null;
    if (!un || DB.users.some((x) => x.username.toLowerCase() === un)) throw new RuleError("اسم المستخدم فارغ أو مستخدم مسبقاً.");
    if (["employee", "officer"].includes(role) && !emp) throw new RuleError("يجب ربط حساب الموظف/مسؤول شؤون الموظفين بسجل موظف.");
    if (emp && DB.users.some((x) => x.emp === emp)) throw new RuleError("هذا الموظف مرتبط مسبقاً بحساب آخر.");
    const pw = rand(); DB.users.push({ id: nid(), username: un, pw: await sha(pw), role, emp, active: true, mustChange: false });
    saveCards([[emp ? byId("emps", emp).name : un, un, pw, role]], "single");
    const n_ = applyAssign(d, role, emp, null, null);
    audit("user_saved", "user", null, { username: un, role, assigned: n_ }); save(); flash("تم إنشاء الحساب " + un + ". كلمة المرور: " + pw + (n_ != null ? " · الموظفون المسندون: " + n_ : "")); render();
  };
  F["user-edit"] = (form, u) => {
    const d = fd(form), x = byId("users", form.dataset.id), role = d.get("role"), emp = Number(d.get("emp") || 0) || null, active = !!d.get("active");
    if (["employee", "officer"].includes(role) && !emp) throw new RuleError("يجب ربط حساب الموظف/مسؤول شؤون الموظفين بسجل موظف.");
    if (x.id === u.id && (role !== "admin" || !active)) throw new RuleError("لا يمكنك إزالة صلاحية مدير النظام أو تعطيل حسابك بنفسك.");
    const prevRole = x.role, prevEmp = x.emp;
    Object.assign(x, { role, emp, active });
    const n_ = applyAssign(d, role, emp, prevRole, prevEmp);
    audit("user_saved", "user", x.id, { role, active, assigned: n_ }); save();
    flash("تم حفظ الحساب." + (n_ != null ? " الموظفون المسندون: " + n_ + "." : "")); if (role === "officer" && prevRole !== "officer") flash("أصبح الحساب «شؤون الموظفين». افتح «الموظفون المسندون» تحت الحساب لاختيار موظفيه.", "info"); render();
  };
  F["dept-new"] = (form) => { const nm = String(fd(form).get("name")).replace(/\s+/g, " ").trim(); if (!nm || DB.depts.some((d) => norm(d.name) === norm(nm))) throw new RuleError("اسم القسم فارغ أو مكرر."); DB.depts.push({ id: nid(), name: nm, active: true }); audit("department_saved", "department", null, { name: nm }); save(); flash("تم حفظ القسم."); render(); };
  F["dept-edit"] = (form) => { const d = fd(form), x = byId("depts", form.dataset.id), nm = String(d.get("name")).trim(); if (!nm || DB.depts.some((y) => y.id !== x.id && norm(y.name) === norm(nm))) throw new RuleError("اسم القسم فارغ أو مكرر."); x.name = nm; x.active = !!d.get("active"); save(); flash("تم حفظ القسم."); render(); };
  F["dept-merge"] = async (form) => { const d = fd(form), s = Number(d.get("src")), t = Number(d.get("dst")); if (s === t) throw new RuleError("اختر قسمين مختلفين."); if (!await confirmDlg("دمج القسمين ونقل موظفي الأول إلى الثاني وحذف الأول؟")) return; let c = 0; DB.emps.forEach((e) => { if (e.dept === s) { e.dept = t; c++; } }); const src = byId("depts", s); DB.depts = DB.depts.filter((x) => x.id !== s); audit("department_merged", "department", t, { source: src.name, moved: c }); save(); flash("تم الدمج ونقل " + c + " موظف."); render(); };
  F.holiday = (form) => { const d = fd(form), s = parseISO(d.get("start")), e = parseISO(d.get("end") || d.get("start")), nm = String(d.get("name")).trim(); if (!s || !e || e < s || (e - s) / 864e5 > 60 || !nm) throw new RuleError("بيانات العطلة غير صحيحة."); let c = 0; for (let x = new Date(s); x <= e; x.setDate(x.getDate() + 1)) { const k = iso(x); if (!DB.holidays.some((y) => y.day === k)) { DB.holidays.push({ id: nid(), day: k, name: nm }); c++; } } audit("holiday_added", "holiday", null, { name: nm }); save(); flash("تمت إضافة " + c + " يوم عطلة."); warnHolidayOverlap(iso(s), iso(e), true); render(); };
  function warnHolidayOverlap(sd, ed, added) {
    const rows = DB.leaves.filter((r) => ["approved", "pending"].includes(r.status) && r.start <= ed && (r.end || r.start) >= sd);
    if (!rows.length) return; const names = [...new Set(rows.map((r) => byId("emps", r.emp).name))];
    flash("تنبيه: " + rows.length + " طلب معتمد أو معلّق يتقاطع مع " + (added ? "العطلة المضافة" : "اليوم المحذوف") + " (" + names.slice(0, 5).join("، ") + (names.length > 5 ? "…" : "") + "). مدة هذه الطلبات حُسبت وقت تقديمها ولا تتغير تلقائياً؛ راجعها وألغِ ما يلزم تصحيحه ليُقدَّم من جديد.", "warn");
  }
  const AUTO_KEY = "hr_demo_autobackups";
  const autoList = () => { try { return JSON.parse(localStorage.getItem(AUTO_KEY) || "[]"); } catch (e) { return []; } };
  function autoBackup(reason) {
    const list = autoList(); list.unshift({ at: nowStr(), reason, db: JSON.parse(JSON.stringify(DB)) });
    try { localStorage.setItem(AUTO_KEY, JSON.stringify(list.slice(0, 3))); } catch (e) { try { localStorage.setItem(AUTO_KEY, JSON.stringify(list.slice(0, 1))); } catch (e2) {} }
  }
  F.restore = async (form, u) => {
    const d = fd(form), file = d.get("file");
    if (u.pw !== (await sha(String(d.get("password") || "")))) { audit("restore_denied", "system"); save(); throw new RuleError("لم تتم الاستعادة: كلمة مرور مدير النظام غير صحيحة."); }
    if (String(d.get("confirm") || "").trim() !== RESTORE_WORD) throw new RuleError("للتأكيد اكتب كلمة «" + RESTORE_WORD + "» في الحقل المخصص.");
    if (!file || !file.name) throw new RuleError("اختر ملف النسخة الاحتياطية.");
    let data; try { data = JSON.parse(await file.text()); } catch (e) { throw new RuleError("الملف ليس نسخة احتياطية صالحة من النظام."); }
    if (!data || data.format !== "itmam-demo-backup" || !data.db || !Array.isArray(data.db.users) || !data.db.users.length) throw new RuleError("الملف ليس نسخة احتياطية صالحة من النظام.");
    if (!await confirmDlg("استبدال كل البيانات الحالية بمحتوى النسخة الاحتياطية؟")) return;
    autoBackup("قبل الاستعادة");
    const keepAudit = DB.audit.slice(), keepCounters = DB.counters;
    DB = data.db; DB.audit = (DB.audit || []).concat(keepAudit); DB.counters = Object.assign({}, data.db.counters || {}, keepCounters || {});
    DB.audit.unshift({ id: nid(), at: nowStr(), user: u.username, action: "backup_restored", entity: "system", entityId: null, details: "" });
    save(); sessionStorage.removeItem("hr_uid"); flash("تمت استعادة النسخة الاحتياطية (" + DB.emps.length + " موظف، " + DB.users.length + " حساب). سجّل الدخول من جديد."); go("#/login");
  };
  F.wipe = async (form, u) => {
    need(u, ["admin"]);
    if (u.pw !== (await sha(String(fd(form).get("password") || "")))) { audit("wipe_denied", "system"); save(); throw new RuleError("لم يُحذف شيء: كلمة مرور مدير النظام غير صحيحة."); }
    if (String(fd(form).get("confirm") || "").trim() !== WIPE_WORD) throw new RuleError("لم يُحذف شيء: للتأكيد اكتب كلمة «" + WIPE_WORD + "» كما هي.");
    if (!await confirmDlg("تأكيد أخير: حذف جميع البيانات نهائياً؟")) return;
    autoBackup("قبل الحذف");
    u.emp = null;
    Object.assign(DB, { users: [u], emps: [], depts: [], recs: [], leaves: [], msgs: [], holidays: [], cards: [] });
    audit("all_data_wiped", "system"); save(); flash("تم حذف جميع البيانات. بقيت السنوات وهوية الجهة وحسابك وسجل التدقيق. حُفظت نسخة تلقائية قبل الحذف (انظر «النسخ التلقائية»)."); render();
  };
  F.settings = (form) => { const d = fd(form); ["university", "college", "system_title", "tagline", "credit"].forEach((k) => (DB.settings[k] = String(d.get(k) || "").trim())); audit("settings_saved", "settings"); save(); flash("تم حفظ الإعدادات."); render(); };

  // ============================================================ الإجراءات
  const ACT = {};
  // نافذة إدخال السبب (بدل prompt): نص متعدد الأسطر وأسباب جاهزة
  const REASONS = { reject: ["ضغط عمل في الوحدة", "تعارض مع جدول المناوبات أو التكليفات", "الرصيد غير كافٍ", "المستندات المؤيدة ناقصة"], cancel: ["تاريخ خاطئ في الطلب", "خطأ في الإدخال", "بناءً على طلب الموظف", "تغيّر موعد الإجازة"] };
  // نافذة تأكيد رسمية داخل النظام (بدل نافذة المتصفح)
  function confirmDlg(msg) {
    return new Promise((resolve) => {
      let d = document.getElementById("confirm-dlg");
      if (!d) { d = document.createElement("dialog"); d.id = "confirm-dlg"; d.className = "about-dlg confirm-dlg"; d.setAttribute("aria-labelledby", "confirm-title"); d.setAttribute("aria-describedby", "confirm-msg"); document.body.appendChild(d); }
      const danger = /حذف|إلغاء|استبدال|تعطيل|إعادة تعيين|نهائي/.test(msg), trigger = document.activeElement;
      d.innerHTML = `<div class="about-head"><h2 id="confirm-title">تأكيد الإجراء</h2></div><div class="about-doc"><p id="confirm-msg">${h(msg)}</p>
        <div class="actions"><button type="button" class="btn ${danger ? "danger" : "primary"}" data-ok>${danger ? "نعم، متابعة" : "تأكيد"}</button><button type="button" class="btn" data-no>تراجع</button></div></div>`;
      let ok = false;
      d.onclick = (ev) => { if (ev.target.closest("[data-ok]")) { ok = true; d.close(); } else if (ev.target.closest("[data-no]") || ev.target === d) d.close(); };
      d.onclose = () => { if (trigger && trigger.focus) trigger.focus(); resolve(ok); };
      if (d.showModal) d.showModal(); else d.setAttribute("open", "");
      d.querySelector("[data-no]").focus();
    });
  }
  function askReason(kind, title) {
    return new Promise((resolve) => {
      let d = document.getElementById("reason-dlg");
      if (!d) { d = document.createElement("dialog"); d.id = "reason-dlg"; d.className = "about-dlg reason-dlg"; document.body.appendChild(d); }
      d.innerHTML = `<form method="dialog" class="about-head"><h2>${h(title || (kind === "reject" ? "سبب الرفض" : "سبب الإلغاء"))}</h2><button class="btn ghost icon-btn" value="x" aria-label="إغلاق">×</button></form>
        <div class="about-doc"><div class="chips">${REASONS[kind].map((x) => `<button type="button" class="chip" data-chip>${h(x)}</button>`).join("")}</div>
        <label class="sr-only" for="reason-text">السبب</label><textarea id="reason-text" rows="4" placeholder="اكتب السبب هنا…"></textarea><p class="hint" data-err hidden>السبب مطلوب.</p>
        <div class="actions"><button type="button" class="btn primary" data-ok>تأكيد</button><button type="button" class="btn" data-no>تراجع</button></div></div>`;
      let val = "";
      d.onclick = (ev) => { const c = ev.target.closest("[data-chip]"); if (c) { d.querySelector("#reason-text").value = c.textContent; d.querySelector("#reason-text").focus(); }
        if (ev.target.closest("[data-no]")) d.close();
        if (ev.target.closest("[data-ok]")) { const v = d.querySelector("#reason-text").value.trim(); if (!v) { d.querySelector("[data-err]").hidden = false; return; } val = v; d.close(); }
        if (ev.target === d) d.close(); };
      d.onclose = () => resolve(val);
      if (d.showModal) d.showModal(); else d.setAttribute("open", "");
      d.querySelector("#reason-text").focus();
    });
  }
  function aboutHTML(s) { return `<div class="about-doc">
  <p class="doc-meta">الإصدار 1.0 — آخر تحديث: نوفمبر 2026</p>
  <p class="about-lead"><b>«${h(s.system_title)}»</b> نظام إلكتروني داخلي لإدارة أيام بدل الراحة لمنسوبي ${h(s.college)} في ${h(s.university)}، يحلّ محل السجلات الورقية وجداول Excel، ويوحّد في منصة واحدة آمنة وقابلة للتدقيق: توثيق التوصيات بمنح بدل الراحة، واحتساب الأرصدة آلياً، ومعالجة الغياب، والمراسلات والخطابات الرسمية.</p>

  <h3>أولاً: الأهداف</h3>
  <ul>
    <li>توحيد إجراءات بدل الراحة وضبطها وفق قواعد معتمدة يحددها مدير النظام لكل سنة.</li>
    <li>تمكين الموظف من الاطلاع على رصيده وحركاته بشفافية في أي وقت.</li>
    <li>تسريع دورة العمل بين مدير النظام ومسؤولي شؤون الموظفين والموظفين، وتوثيق المراسلات بينهم.</li>
    <li>توفير مرجعية موثّقة تدعم أعمال المراجعة والتدقيق الداخلي.</li>
  </ul>

  <h3>ثانياً: قواعد الرصيد</h3>
  <ul>
    <li>يُمنح بدل الراحة بموجب توصية مرفقة (PDF)، بالأيام أو بالساعات.</li>
    <li>الحد الأقصى لما يُمنح للموظف خلال السنة <b>20 يوماً</b> (الأيام والساعات المعادلة لها معاً)، ويُعدَّل من إعدادات السنة.</li>
    <li>كل <b>7 ساعات</b> تعادل يوماً واحداً، وتُحوَّل الساعات إلى أيام تلقائياً عند الطلب؛ وما يتبقى دون ذلك لا يُستخدم حتى يكتمل يوماً بتوصيات لاحقة.</li>
    <li>تُعالَج طلبات الغياب <b>بالأيام فقط</b>، وتُستبعد منها عطلة نهاية الأسبوع والعطل الرسمية.</li>
    <li>يُنبَّه الموظف آلياً عند اقترابه من الحد السنوي أو من نفاد رصيده.</li>
  </ul>

  <h3>ثالثاً: الخدمات الرئيسية</h3>
  <ul>
    <li><b>التوصيات:</b> يرفعها مسؤول شؤون الموظفين في حساب الموظف، ويصدر بها إشعار منح رسمي برقم مرجعي.</li>
    <li><b>طلب معالجة غياب:</b> يقدّمه الموظف من رصيده ويعتمده مسؤول شؤون الموظفين إلكترونياً، ويجوز إلغاء الاعتماد لاحقاً عند الحاجة (كخطأ في التاريخ) مع ذكر السبب وإعادة الرصيد وإشعار الموظف.</li>
    <li><b>المراسلات:</b> مراسلات داخل المنصة مع إشعار بالبريد الإلكتروني.</li>
    <li><b>الخطابات والتقارير:</b> إشعارات المنح ونماذج الطلبات وتقارير الموظفين والمراسلات بصيغة رسمية قابلة للطباعة والحفظ بصيغة PDF، مع لوحات مؤشرات وتصدير إلى Excel.</li>
    <li><b>الحسابات:</b> استيراد بيانات الموظفين، وإنشاء حساباتهم تلقائياً مع بطاقات دخول محفوظة قابلة للطباعة في أي وقت، وملف شخصي لتحديث بيانات التواصل.</li>
    <li><b>الأرشيف والنسخ الاحتياطي:</b> أرشيف سنوي قابل للبحث والتصدير، ونسخ احتياطي يومي للبيانات.</li>
  </ul>

  <h3>رابعاً: الأدوار والصلاحيات</h3>
  <ul>
    <li><b>مدير النظام:</b> إدارة المنصة والمستخدمين والصلاحيات، وإسناد الموظفين لمسؤولي شؤون الموظفين ونقل الفرق بينهم وتفويضهم مؤقتاً، وضبط السنة وقواعد الرصيد، والتقارير والنسخ الاحتياطي.</li>
    <li><b>مسؤول شؤون الموظفين:</b> رفع توصيات الموظفين المسندين إليه، واعتماد طلباتهم أو رفضها أو إلغاء اعتمادها، ومراسلتهم، وتفويض زميل بمتابعة فريقه مؤقتاً خلال غيابه.</li>
    <li><b>الموظف:</b> متابعة رصيده، وتقديم طلبات معالجة الغياب، ومراسلة مسؤول شؤون الموظفين، وتحديث بيانات التواصل.</li>
  </ul>

  <h3>خامساً: الحوكمة وأمن المعلومات</h3>
  <ul>
    <li>صلاحيات وصول مبنية على الدور الوظيفي، وفصل المهام: لا يبتّ أحد في طلب يخصّه ولا يرفع توصية لنفسه.</li>
    <li>سجل تدقيق يوثّق جميع العمليات ومنفّذيها وتوقيتها.</li>
    <li>اتصال مشفّر (HTTPS)، وكلمات مرور مشفّرة يستطيع صاحبها تغييرها متى شاء، وقفل مؤقت عند تكرار المحاولات الخاطئة، وإنهاء الجلسة تلقائياً عند عدم النشاط.</li>
  </ul>

  <h3>سادساً: الدعم الفني</h3>
  <p>للاستفسارات أو إعادة تعيين كلمة المرور، يُرجى التواصل مع مدير النظام في ${h(s.college)}.</p>
  <p class="about-credit">جميع الحقوق محفوظة © ${new Date().getFullYear()} — ${h(s.system_title)}${s.credit ? "<br>" + h(s.credit) : ""}</p>
</div>`; }
  function policyHTML(s) { return `<div class="about-doc policy-doc">
  <p class="doc-meta">الإصدار 1.0 — آخر تحديث: نوفمبر 2026</p>
  <p class="about-lead">تُنظّم هذه السياسة استخدام نظام «${h(s.system_title)}» في ${h(s.college)} في ${h(s.university)}، وتُعدّ ملزمة لجميع المستخدمين. ويُعدّ الدخول إلى النظام أو استخدامه إقراراً بالاطلاع على هذه السياسة والالتزام بأحكامها.</p>

  <h3>المادة (1): التعريفات</h3>
  <ul>
    <li><b>النظام:</b> نظام «${h(s.system_title)}» الإلكتروني لإدارة أيام بدل الراحة، بجميع صفحاته وخدماته ومخرجاته.</li>
    <li><b>الجهة:</b> ${h(s.college)} في ${h(s.university)}.</li>
    <li><b>المستخدم:</b> كل من مُنح حساب دخول إلى النظام، أياً كان دوره.</li>
    <li><b>مدير النظام:</b> المكلّف من الجهة بإدارة النظام والمستخدمين والصلاحيات.</li>
    <li><b>البيانات:</b> كل ما يُدخل في النظام أو يُحفظ فيه أو يصدر عنه من بيانات شخصية ووظيفية ومستندات وخطابات.</li>
  </ul>

  <h3>المادة (2): نطاق التطبيق</h3>
  <p>تسري هذه السياسة على جميع مستخدمي النظام، وعلى جميع العمليات التي تتم من خلاله، أياً كان الجهاز أو الموقع الذي يُستخدم منه.</p>

  <h3>المادة (3): الاستخدام المصرّح به</h3>
  <ul>
    <li>النظام مخصّص للاستخدام الرسمي في إجراءات بدل الراحة ومعالجة الغياب لمنسوبي الجهة، ولا يجوز استخدامه لأي غرض آخر.</li>
    <li>يقتصر وصول كل مستخدم على البيانات والصلاحيات اللازمة لأداء مهامه وفق دوره المعتمد.</li>
    <li>يُمنح الحساب لشخص المستخدم ولا يجوز التنازل عنه أو مشاركته.</li>
  </ul>

  <h3>المادة (4): التزامات المستخدم</h3>
  <ul>
    <li>الحفاظ على سرية اسم المستخدم وكلمة المرور، ويُستحسن تغيير كلمة المرور الأولية الواردة في بطاقة الدخول، واختيار كلمة مرور قوية وتغييرها دورياً.</li>
    <li>تسجيل الخروج بعد الانتهاء، وعدم ترك الجلسة مفتوحة على جهاز مشترك أو عام.</li>
    <li>صحة البيانات المُدخلة ودقتها، وأن تكون المستندات المرفقة صحيحة وصادرة عن جهاتها المختصة.</li>
    <li>تحديث بيانات التواصل (البريد الإلكتروني ورقم الجوال) لضمان وصول الإشعارات.</li>
    <li>الإبلاغ فوراً لمدير النظام عن أي اشتباه في اختراق الحساب أو استخدامه من غير صاحبه، أو عن أي خلل أمني.</li>
  </ul>

  <h3>المادة (5): الاستخدامات المحظورة</h3>
  <ul>
    <li>استخدام حساب مستخدم آخر، أو تمكين الغير من استخدام الحساب.</li>
    <li>محاولة الوصول إلى بيانات أو صلاحيات غير مصرّح بها، أو تجاوز ضوابط الأمان، أو تعطيل النظام.</li>
    <li>إدخال بيانات غير صحيحة، أو رفع مستندات مزوّرة أو معدّلة، أو التلاعب بالأرصدة والطلبات.</li>
    <li>نسخ البيانات أو نشرها أو مشاركتها خارج الجهة دون إذن رسمي.</li>
    <li>رفع ملفات ضارة أو استخدام أدوات آلية لاستخراج البيانات من النظام.</li>
  </ul>

  <h3>المادة (6): سرية البيانات وحماية البيانات الشخصية</h3>
  <ul>
    <li>تُعامل جميع البيانات في النظام بسرية تامة، ولا تُستخدم إلا للأغراض الوظيفية التي جُمعت من أجلها.</li>
    <li>تلتزم الجهة والمستخدمون في معالجة البيانات الشخصية بالأنظمة واللوائح المعمول بها في المملكة العربية السعودية، ومنها نظام حماية البيانات الشخصية، وبالسياسات الداخلية المعتمدة لدى الجهة.</li>
    <li>لا يُفصح عن البيانات لأي طرف خارج الجهة إلا وفق ما تقتضيه الأنظمة أو بموافقة رسمية.</li>
    <li>تُحفظ البيانات ونسخها الاحتياطية بوسائل آمنة، ويُحتفظ بها للمدة التي تحددها الجهة.</li>
  </ul>

  <h3>المادة (7): المراقبة وسجل التدقيق</h3>
  <p>تُسجَّل جميع العمليات في النظام آلياً (المستخدم، والعملية، والوقت)، ويحق للجهة مراجعة هذه السجلات والاستناد إليها في أعمال التدقيق والتحقق، ولا يحق للمستخدم الاعتراض على ذلك.</p>

  <h3>المادة (8): المستندات الصادرة عن النظام</h3>
  <p>تحمل الخطابات والنماذج الصادرة عن النظام رقماً مرجعياً وتاريخ إصدار، ويُرجع في اعتمادها الرسمي إلى الإجراءات المعمول بها لدى الجهة.</p>

  <h3>المادة (9): الإخلال بالسياسة</h3>
  <p>يترتب على مخالفة أحكام هذه السياسة إيقاف الحساب أو تقييد صلاحياته، دون إخلال بحق الجهة في اتخاذ ما تقتضيه الأنظمة واللوائح المعمول بها.</p>

  <h3>المادة (10): توفر الخدمة وإخلاء المسؤولية</h3>
  <ul>
    <li>تسعى الجهة إلى إتاحة النظام بصورة مستمرة، وقد يتوقف مؤقتاً لأعمال الصيانة أو التحديث.</li>
    <li>لا تتحمل الجهة مسؤولية أي ضرر ناتج عن سوء استخدام المستخدم لحسابه أو إفشائه بيانات دخوله.</li>
  </ul>

  <h3>المادة (11): تعديل السياسة</h3>
  <p>يحق للجهة تعديل هذه السياسة متى دعت الحاجة، ويُعمل بالتعديل من تاريخ نشره في النظام، ويُعدّ استمرار الاستخدام بعده قبولاً به.</p>

  <h3>المادة (12): التواصل</h3>
  <p>للاستفسار عن هذه السياسة أو الإبلاغ عن مخالفة، يُرجى التواصل مع مدير النظام في ${h(s.college)}.</p>
</div>`; }
  function faqHTML(s) { return `<div class="about-doc faq-doc">
  <p class="about-lead">إجابات عن أكثر الأسئلة شيوعاً حول استخدام نظام «${h(s.system_title)}» وأمان بياناته.</p>
  <h3>عام</h3>
  <details class="faq-item"><summary>ما نظام «${h(s.system_title)}»؟</summary><p>نظام إلكتروني لإدارة أيام بدل الراحة في ${h(s.college)}: يرفع فيه مسؤول شؤون الموظفين التوصيات بالأيام أو الساعات، ويتابع الموظف رصيده ويقدّم طلبات معالجة الغياب، وتُعتمد الطلبات إلكترونياً مع أرشفة كاملة.</p></details>
  <details class="faq-item"><summary>من يستطيع الدخول إلى النظام؟</summary><p>منسوبو الجهة المصرّح لهم فقط، بحساب يُنشئه مدير النظام. لا يوجد تسجيل ذاتي، ولكل مستخدم دور يحدّد ما يراه: الموظف يرى رصيده وطلباته فقط، ومسؤول شؤون الموظفين يرى الموظفين المسندين إليه فقط، ومدير النظام يدير المنصة.</p></details>
  <details class="faq-item"><summary>كيف أحصل على اسم المستخدم وكلمة المرور؟</summary><p>يسلّمك مدير النظام بطاقة دخول فيها اسم المستخدم (غالباً رقمك الوظيفي) وكلمة المرور. يمكنك تغيير كلمة المرور متى شئت من «الملف الشخصي».</p></details>
  <details class="faq-item"><summary>نسيت كلمة المرور، ماذا أفعل؟</summary><p>تواصل مع مدير النظام في الجهة، فيعيد تعيينها ويسلّمك بطاقة دخول جديدة. لا يستطيع أحد — حتى مدير النظام — الاطلاع على كلمة المرور التي اخترتها بنفسك.</p></details>
  <h3>الرصيد والطلبات</h3>
  <details class="faq-item"><summary>كيف يُحسب رصيدي؟</summary><p>يُمنح الرصيد بالتوصيات التي يرفعها مسؤول شؤون الموظفين (أياماً أو ساعات)، ويُخصم منه ما اعتُمد من طلبات معالجة الغياب. تُحوَّل الساعات إلى أيام وفق عدد ساعات اليوم المعتمد في السنة، والساعات المتبقية التي لا تكمل يوماً لا يمكن طلبها.</p></details>
  <details class="faq-item"><summary>هل يُرحَّل الرصيد غير المستخدم إلى السنة التالية؟</summary><p>لا؛ الرصيد مرتبط بسنته، فاحرص على استخدامه قبل نهايتها، ويُنبَّه مدير النظام قبل نهاية السنة إلى الأرصدة غير المستخدمة.</p></details>
  <details class="faq-item"><summary>كيف أقدّم طلب معالجة غياب؟</summary><p>من «طلب معالجة غياب» تختار التاريخ أو الفترة، فيحسب النظام أيام العمل تلقائياً مستبعداً عطلة نهاية الأسبوع والعطل الرسمية، ثم يصل الطلب إلى مسؤول شؤون الموظفين لاعتماده، ويصلك إشعار بالقرار.</p></details>
  <details class="faq-item"><summary>هل يمكن إلغاء طلب بعد اعتماده؟</summary><p>نعم، يستطيع مسؤول شؤون الموظفين أو مدير النظام إلغاء الاعتماد عند الحاجة (كخطأ في التاريخ) مع ذكر السبب، فيعود الرصيد إليك ويصلك إشعار بذلك. ويمكنك إلغاء طلبك بنفسك ما دام بانتظار الاعتماد.</p></details>
  <details class="faq-item"><summary>من يعتمد طلبي إذا كان مسؤولي في إجازة؟</summary><p>يمكن تفويض مسؤول آخر بمتابعة الفريق خلال فترة الغياب، فيعتمد الطلبات بدلاً منه، ويُوثَّق كل قرار «بالتفويض» ويُشعَر به المسؤول الأصلي.</p></details>
  <h3>الأمان وسرية المعلومات</h3>
  <details class="faq-item"><summary>هل بياناتي آمنة؟</summary><p>نعم. يعمل النظام عبر اتصال مشفّر (HTTPS)، وتُحفظ كلمات المرور مشفّرة تشفيراً أحادي الاتجاه بخوارزمية Argon2 فلا يمكن استرجاعها أو قراءتها، وكل نموذج محمي من الطلبات المزوّرة، ولا تظهر بيانات أي موظف إلا لصاحبها والمسؤول المختص ومدير النظام.</p></details>
  <details class="faq-item"><summary>ماذا يحدث عند محاولات دخول خاطئة متكررة؟</summary><p>يُقفل الحساب مؤقتاً لمدة 15 دقيقة بعد 5 محاولات خاطئة متتالية، وتُسجَّل المحاولات الفاشلة في سجل التدقيق.</p></details>
  <details class="faq-item"><summary>هل تنتهي جلستي تلقائياً؟</summary><p>نعم، يُسجَّل الخروج تلقائياً بعد ساعتين من عدم النشاط، حمايةً لحسابك إذا نسيت الجهاز مفتوحاً. ويُنصح دائماً بتسجيل الخروج من الأجهزة المشتركة.</p></details>
  <details class="faq-item"><summary>من يستطيع الاطلاع على بياناتي؟</summary><p>أنت، ومسؤول شؤون الموظفين المسند إليك (أو المفوَّض بمتابعة فريقه خلال فترة التفويض فقط)، ومدير النظام. ولا تُشارك البيانات مع أي جهة خارج الجهة المالكة للنظام.</p></details>
  <details class="faq-item"><summary>هل تُراقب العمليات في النظام؟</summary><p>تُسجَّل العمليات المهمة آلياً في سجل التدقيق (الدخول، والاعتماد، والتعديل، والتصدير، وغيرها) باسم المنفّذ ووقت التنفيذ، ويطّلع عليه مدير النظام لأغراض المراجعة والمساءلة.</p></details>
  <details class="faq-item"><summary>هل تُرسَل بياناتي بالبريد الإلكتروني؟</summary><p>تصلك إشعارات مختصرة بالقرارات والتنبيهات على بريدك المسجّل، من نطاق موثّق للنظام، وفيها رابط للدخول. ولا تحتوي الرسائل على كلمات مرور. والإشعارات متاحة دائماً داخل النظام في «المراسلات».</p></details>
  <h3>البيانات والاستضافة</h3>
  <details class="faq-item"><summary>أين تُحفظ البيانات؟</summary><p>في قاعدة بيانات PostgreSQL على خادم مخصّص للنظام في مركز بيانات داخل المملكة العربية السعودية، ولا تُخزَّن في خدمات مشتركة مع جهات أخرى.</p></details>
  <details class="faq-item"><summary>هل تُؤخذ نسخ احتياطية؟</summary><p>نعم، تُؤخذ نسخة احتياطية تلقائية من قاعدة البيانات والمرفقات كل ليلة ويُحتفظ بآخر 14 نسخة، إضافة إلى نسخة تلقائية قبل أي عملية حذف أو استعادة، ويمكن لمدير النظام تنزيل نسخة كاملة في أي وقت.</p></details>
  <details class="faq-item"><summary>ما الملفات التي يمكن رفعها؟</summary><p>ملفات PDF فقط (مثل خطاب التوصية)، ويتحقق النظام من نوع الملف وحجمه قبل حفظه، ولا تُتاح المرفقات إلا لمن يحق له الاطلاع على السجل المرتبط بها.</p></details>
  <details class="faq-item"><summary>هل يمكن تصدير البيانات؟</summary><p>نعم، يستطيع مسؤول شؤون الموظفين ومدير النظام تصدير الأرصدة والتوصيات والطلبات والتقارير إلى Excel، ويُسجَّل كل تصدير في سجل التدقيق.</p></details>
  <h3>الدعم</h3>
  <details class="faq-item"><summary>هل يعمل النظام على الجوال؟</summary><p>نعم، صُمّم ليعمل على الجوال والجهاز اللوحي والحاسب، ويدعم الوضع الداكن.</p></details>
  <details class="faq-item"><summary>لمن أتوجّه عند وجود مشكلة أو ملاحظة؟</summary><p>لمسؤول شؤون الموظفين المختص بك فيما يخص الرصيد والطلبات، ولمدير النظام فيما يخص الحسابات والمشكلات التقنية. ويمكنك مراسلتهما من داخل النظام عبر «رسالة جديدة».</p></details>
</div>`; }
  const BKEY = "hr_demo_banner_hidden";
  function bannerHidden() { try { return localStorage.getItem(BKEY) === "1"; } catch (e) { return false; } }
  ACT.hideBanner = () => { try { localStorage.setItem(BKEY, "1"); } catch (e) {} render(); };
  ACT.showBanner = () => { try { localStorage.removeItem(BKEY); } catch (e) {} render(); };
  ACT.logout = () => { sessionStorage.removeItem("hr_uid"); go("#/login"); };
  ACT.reset = async () => { if (!await confirmDlg("استعادة بيانات العرض الأصلية؟ ستُحذف كل التغييرات في هذا المتصفح.")) return; await seed(); sessionStorage.removeItem("hr_uid"); flash("تمت استعادة بيانات العرض."); go("#/login"); };
  ACT["emp-account"] = async (b, u) => { need(u, ["admin"]); const e = byId("emps", b.dataset.id); try { const [un, pw] = await createEmpAccount(e); save(); flash("تم إنشاء حساب الدخول: اسم المستخدم " + un + " وكلمة المرور " + pw + " (يستطيع تغييرها متى شاء من «الملف الشخصي»)."); } catch (err) { if (!(err instanceof RuleError)) throw err; flash(err.message, "error"); } render(); };
  ACT["cancel-leave"] = async (b, u) => { const r = byId("leaves", b.dataset.id); let note = ""; if (b.dataset.needNote) { note = await askReason("cancel"); if (!note) return; } else if (!await confirmDlg("تأكيد إلغاء الطلب؟")) return; const prev = cancelLeave(u, r, note); save(); flash(prev === "approved" ? "تم إلغاء اعتماد الطلب وإعادة الرصيد وإشعار الموظف." : "تم إلغاء الطلب."); render(); };
  ACT["cancel-rec"] = async (b, u) => { const r = byId("recs", b.dataset.id); const note = await askReason("cancel", "سبب إلغاء التوصية (ستُخصم من الرصيد)"); if (!note) return; cancelRec(u, r, note); save(); flash("تم إلغاء التوصية وتحديث الرصيد."); render(); };
  ACT.decide = async (b, u) => { const a = b.dataset.a; let note = ""; if (a === "reject") { note = await askReason("reject"); if (!note) return; } decideLeave(u, byId("leaves", b.dataset.id), a, note); save(); flash(a === "approve" ? "تم الاعتماد وخصم الرصيد." : "تم الرفض."); render(); };
  ACT.bulk = async (b, u) => { const a = b.dataset.a; const rs = [...document.querySelectorAll('input[name="req"]:checked')].map((c) => Number(c.value));
    if (!rs.length) return toast("حدّد طلباً واحداً على الأقل.", "error");
    let note = ""; if (a === "reject") { note = await askReason("reject", "سبب الرفض (سيُطبَّق السبب نفسه على جميع الطلبات المحددة ويصل لكل موظف)"); if (!note) return; } else if (!await confirmDlg("اعتماد كل الطلبات المحددة؟")) return;
    let ok = 0; const errs = []; rs.forEach((id) => { try { decideLeave(u, byId("leaves", id), a, note); ok++; } catch (e) { errs.push(byId("emps", byId("leaves", id).emp).name + ": " + e.message); } });
    save(); flash("تمت معالجة " + cnt(ok, "req") + "." + (errs.length ? " تعذّر " + errs.length + "." : ""), errs.length ? "error" : "ok"); errs.slice(0, 5).forEach((m) => flash(m, "error")); render(); };
  ACT.export = (b) => { exportXlsx(b.dataset.kind, b.dataset.year); audit("data_exported", "export", null, { kind: b.dataset.kind }); save(); };
  ACT["audit-dl"] = () => { const rows = auditRows(parts().q); download([["الوقت", "المستخدم", "العملية", "الكيان", "التفاصيل", "رمز العملية"], ...rows.map((a) => [a.at, a.user || "النظام", AUDIT_ACTIONS[a.action] || a.action, AUDIT_ENTITIES[a.entity] || a.entity || "", auditDetails(a.details), a.action])], "سجل التدقيق"); audit("audit_exported", "system", null, { rows: rows.length }); save(); };
  ACT.template = (b) => {
    const filled = b && b.dataset.filled === "1";
    const head = ["الاسم", "الرقم الوظيفي", "القسم", "الدور", "رقم مسؤول شؤون الموظفين", "المسمى الوظيفي", "البريد"];
    const rows = filled ? DB.emps.filter((e) => e.active && !isTmp(e)).sort((x, y) => x.name.localeCompare(y.name, "ar")).map((e) => { const usr = DB.users.find((x) => x.emp === e.id); const m = e.mgr ? byId("emps", e.mgr) : null; return [e.name, e.no, deptName(e), usr && usr.role === "officer" ? "شؤون الموظفين" : "موظف", m ? m.no : "", e.title || "", e.email || ""]; }) : [];
    const depts = DB.depts.filter((d) => d.active).map((d) => d.name), offs = officers();
    const lists = [["الأقسام الحالية", "", "رقم مسؤول شؤون الموظفين", "اسم مسؤول شؤون الموظفين"]];
    for (let i = 0; i < Math.max(depts.length, offs.length); i++) lists.push([depts[i] || "", "", offs[i] ? offs[i].no : "", offs[i] ? offs[i].name : ""]);
    const help = [["طريقة الاستخدام"], ["1) عبّئ ورقة «الموظفون» بدءاً من السطر الثاني، ولا تغيّر صف العناوين."], ["2) احفظ الملف بصيغة Excel ‏(‎.xlsx) ثم ارفعه من صفحة «استيراد الموظفين» واضغط «معاينة قبل الحفظ»."], ["3) راجع المعاينة: الصفوف السليمة تُستورد، والصفوف التي فيها أخطاء تظهر لتصحيحها وإعادة الرفع."], [""],
      ["الاسم والرقم الوظيفي إلزاميان، وبقية الأعمدة اختيارية."], ["الدور: موظف أو شؤون الموظفين (الافتراضي: موظف)."], ["القسم: اكتب اسم القسم كما في ورقة «القوائم» أو اسم قسم جديد فيُنشأ تلقائياً."], ["رقم مسؤول شؤون الموظفين: الرقم الوظيفي لمسؤول شؤون الموظفين (انظر ورقة «القوائم»)، ويمكن أن يكون مسؤولاً جديداً في الملف نفسه."], ["البريد: يُستخدم لإرسال إشعارات المراسلات والقرارات."], ["الرقم الوظيفي مفتاح المطابقة: إن كان الموظف موجوداً تُحدَّث بياناته بدل تكراره."]];
    downloadBook([["الموظفون", [head, ...rows]], ["القوائم", lists], ["تعليمات", help]], filled ? "الموظفون الحاليون للتعديل" : "نموذج استيراد الموظفين");
  };
  ACT["import-back"] = () => { importPreview = null; render(); };
  ACT["activate-year"] = (b) => { DB.years.forEach((y) => (y.active = y.id === Number(b.dataset.id))); audit("year_activated", "fiscal_year", Number(b.dataset.id)); save(); flash("تم تغيير السنة النشطة."); render(); };
  ACT["lock-year"] = async (b) => { const y = byId("years", b.dataset.id);
    if (!y.locked) { const p = DB.leaves.filter((r) => r.year === y.id && r.status === "pending").length; if (p) throw new RuleError("لا يمكن الإقفال: توجد " + p + " حركة بانتظار الاعتماد."); if (!await confirmDlg("إقفال السنة؟ لن تُقبل أي حركات جديدة عليها.")) return; }
    y.locked = !y.locked; audit(y.locked ? "year_locked" : "year_unlocked", "fiscal_year", y.id); save(); flash((y.locked ? "تم إقفال" : "تم فتح") + " السنة " + y.name + "."); render(); };
  ACT["reset-pw"] = async (b) => { const x = byId("users", b.dataset.id); if (!await confirmDlg("إعادة تعيين كلمة مرور " + x.username + "؟")) return; const pw = rand(); x.pw = await sha(pw); x.mustChange = false; x.failed = 0; x.lockedUntil = null; saveCards([[displayName(x), x.username, pw, x.role]], "reset"); audit("password_reset", "user", x.id); save(); flash("كلمة مرور الحساب " + x.username + ": " + pw + " — حُفظت بطاقة دخول جديدة في «بطاقات الدخول»."); render(); };
  ACT["bulk-users"] = async () => { if (!await confirmDlg("إنشاء حساب لكل موظف نشط ليس له حساب (اسم المستخدم = الرقم الوظيفي)؟")) return; const linked = new Set(DB.users.filter((x) => x.emp).map((x) => x.emp)); const made = [];
    for (const e of DB.emps.filter((x) => x.active && !linked.has(x.id) && !isTmp(x))) { const un = String(e.no).toLowerCase(); if (DB.users.some((x) => x.username.toLowerCase() === un)) continue; const pw = rand(); const role = DB.emps.some((x) => x.mgr === e.id) ? "officer" : "employee"; DB.users.push({ id: nid(), username: un, pw: await sha(pw), role, emp: e.id, active: true, mustChange: false }); made.push([e.name, un, pw, role]); }
    if (made.length) saveCards(made, "bulk"); else lastBatch = null;
    audit("users_bulk_created", "user", null, { count: made.length }); save(); createdAccounts = made; go("#/admin/import"); };
  ACT["cards-dl"] = () => { audit("data_exported", "login_card", null, { kind: "login_cards" }); save(); const t = document.querySelector("main table"); if (!t) return; download([...t.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.textContent.trim())), "بطاقات الدخول"); };
  ACT["auto-dl"] = (b, u) => {
    need(u, ["admin"]); const a = autoList()[Number(b.dataset.i)]; if (!a) return;
    const blob = new Blob([JSON.stringify({ format: "itmam-demo-backup", version: 1, created_at: a.at, db: a.db }, null, 1)], { type: "application/json" });
    const x = document.createElement("a"); x.href = URL.createObjectURL(blob); x.download = "itmam-auto-backup-" + a.at.replace(/[: ]/g, "-") + ".json"; document.body.appendChild(x); x.click(); setTimeout(() => { x.remove(); URL.revokeObjectURL(x.href); }, 2000);
    audit("backup_downloaded", "system"); save();
  };
  ACT.backup = (b, u) => {
    need(u, ["admin"]);
    audit("backup_downloaded", "system"); save();
    const blob = new Blob([JSON.stringify({ format: "itmam-demo-backup", version: 1, created_at: nowStr(), db: DB }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "itmam-backup-" + nowStr().replace(/[: ]/g, "-") + ".json"; document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 2000);
    flash("تم تنزيل النسخة الاحتياطية."); render();
  };
  ACT["archive-export"] = (b, u) => {
    need(u, STAFF);
    const y = byId("years", b.dataset.year) || activeYear(), ids = new Set(managedEmps(u, true).map((e) => e.id)), U = (id) => (id ? displayName(byId("users", id)) : "");
    const recs = DB.recs.filter((r) => r.year === y.id && ids.has(r.emp)), reqs = DB.leaves.filter((r) => r.year === y.id && ids.has(r.emp));
    const msgs = DB.msgs.filter((m) => (u.role === "admin" || m.from === u.id || m.to === u.id) && m.at.slice(0, 10) >= y.start && m.at.slice(0, 10) <= y.end);
    downloadBook([
      ["التوصيات", [["الرقم الصادر", "اسم الموظف", "الرقم الوظيفي", "تاريخ التوصية", "النوع", "القيمة", "رقم خطاب التوصية", "الموضوع", "رفعها", "تاريخ الرفع", "الحالة", "ألغاها", "تاريخ الإلغاء", "سبب الإلغاء", "ملف PDF"],
        ...recs.map((r) => { const e = byId("emps", r.emp); return [r.ref, e.name, e.no, r.date, REC_KINDS[r.kind], r.amount, r.refNo || "", r.subject, U(r.by), r.created, r.status === "active" ? "سارية" : "ملغاة", U(r.cancelledBy), r.cancelledAt || "", r.cancelNote || "", r.att ? "pdf/" + r.ref + ".pdf" : ""]; })]],
      ["الطلبات", [["الرقم الصادر", "اسم الموظف", "الرقم الوظيفي", "نوع الطلب", "من", "إلى", "أيام", "ساعات", "السبب", "تاريخ الطلب", "الحالة", "صاحب القرار", "تاريخ القرار", "ملاحظة القرار", "ألغاه", "تاريخ الإلغاء", "سبب الإلغاء"],
        ...reqs.map((r) => { const e = byId("emps", r.emp); return [r.ref, e.name, e.no, LEAVE_KINDS[r.kind], r.start, r.end, r.unit === "days" ? r.days : "", r.unit === "hours" ? r.hours : "", r.reason, r.created, REQ_ST[r.status], U(r.decidedBy), r.decidedAt || "", r.note || "", U(r.cancelledBy), r.cancelledAt || "", r.cancelNote || ""]; })]],
      ["المراسلات", [["الرقم", "التاريخ", "من", "إلى", "الموضوع", "النص", "قُرئت"], ...msgs.map((m) => [refNo("MSG", m.id, m.at), m.at, m.from ? U(m.from) : "إشعار النظام", U(m.to), m.subject, m.body, m.read ? "نعم" : ""])]],
      ["الأرصدة", [["اسم الموظف", "الرقم الوظيفي", "أيام ممنوحة", "ساعات ممنوحة", "رصيد الأيام", "رصيد الساعات", "الإجمالي (أيام)", "+ ساعات"], ...managedEmps(u, true).map((e) => { const x = balance(e.id, y); return [e.name, e.no, x.gDays, x.gHours, x.daysLeft, x.hoursLeft, x.totalDays, x.totalRem]; })]],
    ], "أرشيف بدل الراحة " + y.name);
    audit("archive_exported", "archive", null, { year: y.name }); save();
  };
  ACT["del-holiday"] = async (b) => { if (!await confirmDlg("حذف هذا اليوم؟")) return; const hd = DB.holidays.find((x) => x.id === Number(b.dataset.id)); DB.holidays = DB.holidays.filter((x) => x.id !== Number(b.dataset.id)); audit("holiday_deleted", "holiday", hd && hd.id, { name: hd && hd.name }); save(); if (hd) warnHolidayOverlap(hd.day, hd.day, false); render(); };

  // ============================================================ الأحداث
  const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  // بيانات التقارير مع التصفية (القسم، ومسؤول شؤون الموظفين لمدير النظام) — للصفحة وللتصدير
  function reportData(u, y, dept, off) {
    const hpd = y.hpd || 7;
    let emps = managedEmps(u, true);
    if (dept) emps = emps.filter((e) => e.dept === dept);
    if (off && u.role === "admin") emps = emps.filter((e) => (e.mgr || -1) === off);
    const ids = new Set(emps.map((e) => e.id));
    const recs = DB.recs.filter((r) => r.year === y.id && r.status === "active" && ids.has(r.emp)), reqs = DB.leaves.filter((r) => r.year === y.id && ids.has(r.emp));
    const recEq = (r) => (r.kind === "days" ? r.amount : r.amount / hpd), reqEq = (r) => (r.unit === "days" ? r.days : r.hours / hpd);
    const c = (st) => reqs.filter((r) => r.status === st).length;
    const leadOf = (r) => (r.decidedAt && ["approved", "rejected"].includes(r.status) ? (new Date(r.decidedAt.replace(" ", "T")) - new Date(String(r.created).replace(" ", "T"))) / 864e5 : null);
    const leads = reqs.map(leadOf).filter((x) => x != null), avg = (a) => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10 : null);
    const stats = { employees: emps.filter((e) => e.active).length, recs: recs.length, recDays: recs.filter((r) => r.kind === "days").reduce((s, r) => s + r.amount, 0), recHours: recs.filter((r) => r.kind === "hours").reduce((s, r) => s + r.amount, 0),
      requests: reqs.length, approved: c("approved"), pending: c("pending"), rejected: c("rejected"), cancelled: c("cancelled"), avgLead: avg(leads) || 0, noAtt: recs.filter((r) => !r.att).length,
      grantedEq: round2(recs.reduce((s, r) => s + recEq(r), 0)), usedEq: round2(reqs.filter((r) => r.status === "approved").reduce((s, r) => s + reqEq(r), 0)) };
    stats.util = stats.grantedEq ? Math.round((stats.usedEq / stats.grantedEq) * 100) : 0;
    const months = []; let cur = new Date(parseISO(y.start).getFullYear(), parseISO(y.start).getMonth(), 1); const endD = parseISO(y.end);
    while (cur <= endD && months.length < 24) { months.push({ k: cur.getFullYear() + "-" + String(cur.getMonth() + 1).padStart(2, "0"), label: MONTHS_AR[cur.getMonth()], year: cur.getFullYear(), g: 0, u: 0 }); cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); }
    const mi = Object.fromEntries(months.map((m) => [m.k, m]));
    recs.forEach((r) => { const m = mi[String(r.date).slice(0, 7)]; if (m) m.g += recEq(r); });
    reqs.filter((r) => r.status === "approved").forEach((r) => { const m = mi[String(r.start).slice(0, 7)]; if (m) m.u += reqEq(r); });
    const peak = Math.max(1, ...months.map((m) => Math.max(m.g, m.u)));
    months.forEach((m) => { m.g = round2(m.g); m.u = round2(m.u); m.gp = Math.round((m.g / peak) * 100); m.up = Math.round((m.u / peak) * 100); });
    const byDept = {}, byOff = {}, unused = [];
    const blank = () => ({ count: 0, granted: 0, used: 0, pending: 0, nPending: 0, approved: 0, rejected: 0, leads: [] });
    emps.filter((e) => e.active).forEach((e) => {
      const b = balance(e.id, y), er = reqs.filter((r) => r.emp === e.id), pend = er.filter((r) => r.status === "pending").reduce((s, r) => s + reqEq(r), 0), avail = round2(b.grantedEq - b.usedEq - pend);
      [[deptName(e) || "— بلا قسم —", byDept], [mgrName(e) || "— غير مُسند —", byOff]].forEach(([k, bucket]) => { const d = (bucket[k] = bucket[k] || blank()); d.count++; d.granted += b.grantedEq; d.used += b.usedEq; d.pending += pend;
        er.forEach((r) => { if (r.status === "pending") d.nPending++; if (r.status === "approved") d.approved++; if (r.status === "rejected") d.rejected++; const l = leadOf(r); if (l != null) d.leads.push(l); }); });
      if (avail > 0) unused.push([e, avail]);
    });
    const finish = (bucket) => Object.entries(bucket).sort(([a], [b]) => (a.startsWith("—") - b.startsWith("—")) || a.localeCompare(b, "ar")).map(([k, d]) => { d.left = round2(d.granted - d.used - d.pending); d.util = d.granted ? Math.round((d.used / d.granted) * 100) : 0; d.avgLead = avg(d.leads); return [k, d]; });
    unused.sort((a, b) => b[1] - a[1]);
    const tot = reqs.length, pie = [["approved", "معتمدة"], ["pending", "بانتظار الاعتماد"], ["cancelled", "ملغاة"], ["rejected", "مرفوضة"]].map(([key, label]) => { const v = c(key); return { key, label, value: v, pct: tot ? Math.round((v / tot) * 100) : 0 }; });
    return { stats, months, byDept: finish(byDept), byOff: finish(byOff), unused: unused.slice(0, 10), unusedTotal: round2(unused.reduce((s, [, a]) => s + a, 0)), pie, tot };
  }
  const monthBars = (months) => `<div class="mbars" role="img" aria-label="الممنوح والمستخدم شهرياً بالأيام المعادلة">${months.map((m) => `<div class="mcol" title="${m.label} ${m.year}: ممنوح ${n(m.g)} · مستخدم ${n(m.u)}"><div class="mpair"><span class="mb g" style="height:${m.gp}%">${m.g ? `<em>${n(m.g)}</em>` : ""}</span><span class="mb u" style="height:${m.up}%">${m.u ? `<em>${n(m.u)}</em>` : ""}</span></div><small>${m.label}</small></div>`).join("")}</div>
    <div class="legend mlegend"><span><i class="sw g"></i>الممنوح</span><span><i class="sw u"></i>المستخدم</span></div>
    <table class="sr-only"><caption>الممنوح والمستخدم شهرياً</caption><thead><tr><th>الشهر</th><th>الممنوح</th><th>المستخدم</th></tr></thead><tbody>${months.map((m) => `<tr><td>${m.label} ${m.year}</td><td>${n(m.g)}</td><td>${n(m.u)}</td></tr>`).join("")}</tbody></table>`;
  const aggTable = (rows, first, lead) => `<div class="table-wrap"><table class="responsive"><thead><tr><th>${first}</th><th class="n">الموظفون</th><th class="n">الممنوح</th><th class="n">المستخدم</th><th class="n">المتاح</th><th>نسبة الاستخدام</th><th class="n">معلّقة</th>${lead ? '<th class="n">متوسط مدة القرار</th>' : ""}</tr></thead><tbody>
    ${rows.map(([k, d]) => `<tr><td data-label="${first}">${h(k)}</td><td class="n" data-label="الموظفون">${d.count}</td><td class="n" data-label="الممنوح">${n(round2(d.granted))}</td><td class="n" data-label="المستخدم">${n(round2(d.used))}</td><td class="n" data-label="المتاح">${n(d.left)}</td>
      <td data-label="نسبة الاستخدام"><span class="ubar" aria-hidden="true"><i style="width:${Math.min(100, d.util)}%"></i></span> ${d.util}%</td><td class="n" data-label="معلّقة">${d.nPending || "—"}</td>
      ${lead ? `<td class="n" data-label="متوسط مدة القرار">${d.avgLead != null ? n(d.avgLead) + " يوم" + (d.avgLead >= 3 ? ' <span class="badge warn">بطيء</span>' : "") : "—"}</td>` : ""}</tr>`).join("") || `<tr><td colspan="${lead ? 8 : 7}" class="empty">لا توجد بيانات.</td></tr>`}</tbody></table></div>`;
  V.reports = (u, q) => {
    need(u, STAFF);
    const y = pickYear(q), dept = Number(q.get("dept")) || 0, off = Number(q.get("officer")) || 0, admin = u.role === "admin";
    const D = reportData(u, y, dept, off), s = D.stats;
    return layout(u, "التقارير", `<div class="page-head"><div><h1>${ico("reports", "h-ico")} التقارير</h1><p>السنة ${h(y.name)} · ${s.employees} موظف نشط · الأرقام بالأيام المعادلة (كل ${n(y.hpd)} ساعات = يوم)</p></div>
        <button class="btn" type="button" data-act="export" data-kind="summary" data-year="${y.id}">${ico("download", "sm-ico")}تنزيل الملخص (Excel)</button></div>
      <form class="card filters" data-form="filter" data-route="reports">${yearSelect(y)}
        <div class="field"><label for="dp">القسم</label><select id="dp" name="dept"><option value="">كل الأقسام</option>${DB.depts.map((d) => `<option value="${d.id}" ${dept === d.id ? "selected" : ""}>${h(d.name)}</option>`).join("")}</select></div>
        ${admin ? `<div class="field"><label for="of">مسؤول شؤون الموظفين</label><select id="of" name="officer"><option value="">الكل</option><option value="-1" ${off === -1 ? "selected" : ""}>— غير مُسند —</option>${officers().map((o) => `<option value="${o.id}" ${off === o.id ? "selected" : ""}>${h(o.name)}</option>`).join("")}</select></div>` : ""}
        <button class="btn primary">عرض</button>${dept || off ? `<a class="clear-link" href="#/reports?year=${y.id}">مسح الفلاتر</a>` : ""}</form>
      <div class="grid kpis">
        <div class="kpi brand">${ico("cal-check")}<div class="l">الممنوح بالتوصيات</div><div class="v">${n(s.grantedEq)}</div><div class="s">${s.recs} توصية · أيام ${n(s.recDays)} · ساعات ${n(s.recHours)}</div></div>
        <div class="kpi accent">${ico("calendar")}<div class="l">المستخدم بطلبات معتمدة</div><div class="v">${n(s.usedEq)}</div><div class="s">نسبة الاستخدام ${s.util}%</div></div>
        <div class="kpi ok">${ico("approvals")}<div class="l">طلبات معتمدة</div><div class="v">${s.approved}</div><div class="s">من ${s.requests} · مرفوضة ${s.rejected} · ملغاة ${s.cancelled}</div></div>
        <div class="kpi warn">${ico("hourglass")}<div class="l">بانتظار الاعتماد</div><div class="v">${s.pending}</div><div class="s">متوسط مدة القرار ${n(s.avgLead)} يوم</div></div>
        <div class="kpi">${ico("audit")}<div class="l">توصيات بلا PDF</div><div class="v">${s.noAtt}</div></div></div>
      <section class="card"><h2>الممنوح والمستخدم شهرياً</h2><p class="hint chart-sub">الممنوح حسب تاريخ التوصية، والمستخدم حسب تاريخ بداية الطلب المعتمد — السنة ${h(y.name)}</p>${s.grantedEq || s.usedEq ? monthBars(D.months) : '<p class="empty">لا توجد توصيات أو طلبات معتمدة في هذه السنة بعد.</p>'}</section>
      <div class="grid two">
        <section class="card"><h2>الطلبات حسب الحالة</h2><p class="hint chart-sub">عدد طلبات معالجة الغياب موزّعة على حالاتها</p>${D.tot ? donut(D.pie, D.tot, "طلب", "الطلبات حسب الحالة", "إجمالي الطلبات") : '<p class="empty">لا توجد طلبات في هذه السنة بعد.</p>'}</section>
        <section class="card flush"><h2>أعلى الأرصدة المتاحة${D.unusedTotal ? ` <span class="badge muted">الإجمالي ${n(D.unusedTotal)} يوم</span>` : ""}</h2><p class="hint pad">أرصدة لم تُستخدم بعد؛ راجعها قبل نهاية السنة (${h(y.end)})، فالرصيد غير المستخدم لا يُرحَّل إلى السنة التالية.</p>
          <div class="table-wrap"><table class="responsive"><thead><tr><th>الموظف</th><th>القسم</th><th class="n">المتاح</th></tr></thead><tbody>${D.unused.map(([e, a]) => `<tr><td data-label="الموظف"><a href="#/employee/${e.id}?year=${y.id}">${h(e.name)}</a></td><td data-label="القسم">${h(deptName(e) || "—")}</td><td class="n" data-label="المتاح">${n(a)}</td></tr>`).join("") || '<tr><td colspan="3" class="empty">لا توجد أرصدة متاحة.</td></tr>'}</tbody></table></div></section></div>
      <section class="card flush"><h2>حسب القسم</h2>${aggTable(D.byDept, "القسم")}</section>
      ${admin ? `<section class="card flush"><h2>حسب مسؤول شؤون الموظفين</h2>${aggTable(D.byOff, "مسؤول شؤون الموظفين", true)}</section>` : ""}
      <section class="card"><h2>التصدير إلى Excel</h2><div class="actions"><button class="btn" type="button" data-act="export" data-kind="summary" data-year="${y.id}">${ico("download", "sm-ico")}ملخص التقارير</button><button class="btn" type="button" data-act="export" data-kind="balances" data-year="${y.id}">${ico("download", "sm-ico")}أرصدة الموظفين</button><button class="btn" type="button" data-act="export" data-kind="recs" data-year="${y.id}">${ico("download", "sm-ico")}سجل التوصيات</button><button class="btn" type="button" data-act="export" data-kind="requests" data-year="${y.id}">${ico("download", "sm-ico")}سجل الطلبات</button></div></section>`);
  };

  // ============================================================ الفرق والتفويض
  const MAX_DELEG_DAYS = 180;
  const delegBadge = (d) => { const st = delegState(d); return `<span class="badge ${{ active: "ok", upcoming: "warn" }[st] || "muted"}">${DELEG_ST[st]}</span>`; };
  const delegForm = (offs, admin) => `<form class="filters" data-form="delegation">
      ${admin ? `<div class="field"><label for="df">الفريق (المفوِّض)</label><select id="df" name="from" required><option value="">— اختر —</option>${offs.map((o) => `<option value="${o.id}">${h(o.name)}</option>`).join("")}</select></div>` : ""}
      <div class="field"><label for="dt">المفوَّض بالمتابعة</label><select id="dt" name="to" required><option value="">— اختر —</option>${offs.map((o) => `<option value="${o.id}">${h(o.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="ds">من</label><input id="ds" type="date" name="start" value="${todayISO()}" required></div>
      <div class="field"><label for="de">إلى</label><input id="de" type="date" name="end" required></div>
      <div class="field grow"><label for="dn">ملاحظة <span class="hint">(اختياري، مثل: إجازة سنوية)</span></label><input id="dn" name="note" maxlength="300"></div>
      <button class="btn primary">${ico("swap", "sm-ico")}إنشاء التفويض</button></form>
    <p class="hint">خلال الفترة يعتمد المفوَّض طلبات الفريق ويرفع توصياته، وتصله إشعاراته، ويبقى للمسؤول الأصلي اطلاعه الكامل. يُسجَّل كل قرار «بالتفويض» في سجل التدقيق ويُشعَر به المسؤول الأصلي. أقصى مدة ${MAX_DELEG_DAYS} يوماً، وينتهي التفويض تلقائياً في آخر يوم من الفترة.</p>`;
  const delegTable = (rows) => { const ord = { active: 0, upcoming: 1, ended: 2, cancelled: 3 };
    rows = rows.slice().sort((a, b) => ord[delegState(a)] - ord[delegState(b)] || b.start.localeCompare(a.start));
    return `<div class="table-wrap"><table class="responsive"><thead><tr><th>الفريق (المفوِّض)</th><th>المفوَّض</th><th>الفترة</th><th>الحالة</th><th>ملاحظة</th><th></th></tr></thead><tbody>
    ${rows.map((d) => { const st = delegState(d); return `<tr${["ended", "cancelled"].includes(st) ? ' class="dim"' : ""}><td data-label="الفريق">${h(byId("emps", d.from).name)}</td><td data-label="المفوَّض">${h(byId("emps", d.to).name)}</td><td data-label="الفترة" class="num">${h(d.start)} – ${h(d.end)}</td><td data-label="الحالة">${delegBadge(d)}</td><td data-label="ملاحظة">${h(d.note || "—")}</td>
      <td>${["active", "upcoming"].includes(st) ? `<button class="btn sm danger" type="button" data-act="cancel-deleg" data-id="${d.id}">إلغاء</button>` : ""}</td></tr>`; }).join("") || '<tr><td colspan="6" class="empty">لا توجد تفويضات.</td></tr>'}</tbody></table></div>`; };
  A.teams = (u) => {
    const offs = officers(), act = activeDelegs(), unassigned = DB.emps.filter((e) => e.active && !e.mgr).length;
    const stats = offs.map((o) => ({ o, count: DB.emps.filter((e) => e.active && e.mgr === o.id).length, pending: DB.leaves.filter((r) => r.status === "pending" && byId("emps", r.emp).mgr === o.id).length, away: act.find((d) => d.from === o.id), covering: act.filter((d) => d.to === o.id) }));
    return layout(u, "المستخدمون والصلاحيات", `${accountTabs("teams")}<div class="page-head"><div><h1>${ico("swap", "h-ico")} الفرق والتفويض</h1><p>${offs.length} مسؤول شؤون موظفين${unassigned ? ` · <a href="#/employees?officer=-1">${unassigned} موظف غير مُسند</a>` : ""}. انقل فريقاً كاملاً نقلاً دائماً، أو فوّض مسؤولاً بمتابعة فريق زميله مؤقتاً (أثناء إجازته مثلاً).</p></div></div>
      <section class="card flush"><h2>فرق مسؤولي شؤون الموظفين</h2><div class="table-wrap"><table class="responsive"><thead><tr><th>مسؤول شؤون الموظفين</th><th class="n">الموظفون</th><th class="n">طلبات معلّقة</th><th>التفويض الساري</th></tr></thead><tbody>
        ${stats.map((s) => `<tr><td data-label="المسؤول"><a href="#/employees?officer=${s.o.id}">${h(s.o.name)}</a></td><td class="n" data-label="الموظفون">${s.count}</td><td class="n" data-label="معلّقة">${s.pending || "—"}</td>
          <td data-label="التفويض">${s.away ? `<span class="badge warn">فريقه لدى ${h(byId("emps", s.away.to).name)} حتى ${h(s.away.end)}</span> ` : ""}${s.covering.map((c) => `<span class="badge ok">يتابع فريق ${h(byId("emps", c.from).name)}</span> `).join("")}${!s.away && !s.covering.length ? "—" : ""}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">لا يوجد مسؤولو شؤون موظفين. أنشئ حساباً بدور «شؤون الموظفين» من «الحسابات والصلاحيات».</td></tr>'}</tbody></table></div></section>
      <div class="grid two">
        <section class="card" id="transfer"><h2>نقل فريق كامل</h2><p class="hint">ينقل جميع الموظفين المسندين إلى المسؤول الأول إلى الثاني نقلاً دائماً (مثل انتقال المسؤول أو تقاعده)، ومعهم طلباتهم المعلّقة. لنقل موظفين محددين استخدم «الحسابات والصلاحيات».</p>
          <form class="stack" data-form="team-transfer">
            <div class="field"><label for="tf">من</label><select id="tf" name="from" required><option value="">— اختر —</option>${stats.map((s) => `<option value="${s.o.id}" ${s.count ? "" : "disabled"}>${h(s.o.name)} (${s.count} موظف)</option>`).join("")}</select></div>
            <div class="field"><label for="tt">إلى</label><select id="tt" name="to" required><option value="">— اختر —</option>${offs.map((o) => `<option value="${o.id}">${h(o.name)}</option>`).join("")}</select></div>
            <label class="check"><input type="checkbox" name="notify" value="1" checked><span>إشعار الموظفين المنقولين باسم مسؤولهم الجديد</span></label>
            <div><button class="btn primary">${ico("swap", "sm-ico")}نقل الفريق</button></div></form></section>
        <section class="card" id="delegation"><h2>تفويض مؤقت</h2>${delegForm(offs, true)}</section></div>
      <section class="card flush"><h2>سجل التفويضات</h2>${delegTable(DB.delegations || [])}</section>`);
  };
  V.delegation = (u) => {
    need(u, ["officer", "admin"]); if (u.role === "admin") { go("#/admin/teams"); return ""; }
    const offs = officers().filter((o) => o.id !== u.emp), mine = (DB.delegations || []).filter((d) => d.from === u.emp || d.to === u.emp);
    const team = DB.emps.filter((e) => e.active && e.mgr === u.emp).length, cover = mine.filter((d) => d.to === u.emp && delegState(d) === "active");
    return layout(u, "التفويض", `<div class="page-head"><div><h1>${ico("swap", "h-ico")} التفويض</h1><p>فوّض زميلاً من مسؤولي شؤون الموظفين بمتابعة فريقك (${cnt(team, "emp")}) خلال غيابك، فيعتمد طلباتهم ويرفع توصياتهم حتى نهاية الفترة.</p></div></div>
      ${cover.length ? `<div class="alert info" role="status">أنت مفوَّض حالياً بمتابعة: ${cover.map((d) => "فريق " + h(byId("emps", d.from).name) + " حتى " + h(d.end)).join("، ")}. تظهر طلباتهم في «الاعتمادات» وموظفوهم في «قائمة الموظفين».</div>` : ""}
      <section class="card"><h2>تفويض جديد</h2>${offs.length ? delegForm(offs, false) : '<p class="empty">لا يوجد مسؤولو شؤون موظفين آخرون للتفويض.</p>'}</section>
      <section class="card flush"><h2>تفويضاتي</h2>${delegTable(mine)}</section>`);
  };
  F["team-transfer"] = async (form, u) => {
    need(u, ["admin"]); const d = fd(form), src = byId("emps", d.get("from")), dst = officers().find((o) => o.id === Number(d.get("to")));
    if (!src || !dst) throw new RuleError("اختر مسؤولَي شؤون الموظفين (المنقول منه والمنقول إليه).");
    if (src.id === dst.id) throw new RuleError("لا يمكن نقل الفريق إلى المسؤول نفسه.");
    const moved = DB.emps.filter((e) => e.mgr === src.id && e.id !== dst.id);
    if (!moved.length) throw new RuleError("لا يوجد موظفون مسندون إلى «" + src.name + "».");
    if (!await confirmDlg("نقل " + moved.length + " موظف من «" + src.name + "» إلى «" + dst.name + "»؟ يمكن إعادة توزيعهم لاحقاً من «الحسابات والصلاحيات».")) return;
    const mids = new Set(moved.map((e) => e.id)), pend = DB.leaves.filter((r) => r.status === "pending" && mids.has(r.emp)).length;
    moved.forEach((e) => (e.mgr = dst.id));
    const names = moved.slice(0, 8).map((e) => e.name).join("، ") + (moved.length > 8 ? "…" : "");
    const du = userOfEmp(dst), su = userOfEmp(src);
    if (du) notify(du, "أُسند إليك فريق " + src.name, "نقل مدير النظام إليك " + moved.length + " موظفاً كانوا مسندين إلى " + src.name + ": " + names + "." + (pend ? " لديهم " + pend + " طلب بانتظار قرارك." : ""), pend ? "#/approvals" : "#/employees", u);
    if (su) notify(su, "نُقل فريقك إلى مسؤول آخر", "نقل مدير النظام " + moved.length + " موظفاً من فريقك إلى " + dst.name + ".", "#/employees", u);
    if (d.get("notify")) moved.forEach((e) => notify(userOfEmp(e), "تغيّر مسؤول شؤون الموظفين", "أصبح " + dst.name + " مسؤول شؤون الموظفين المختص بطلباتك وتوصياتك.", "#/messages/new", u));
    audit("team_transferred", "team", src.id, { from: src.name, to: dst.name, moved: moved.length, pending_requests: pend, notify_employees: !!d.get("notify") });
    save(); flash("نُقل " + moved.length + " موظف من «" + src.name + "» إلى «" + dst.name + "»" + (pend ? "، ومعهم " + pend + " طلب معلّق صار بانتظار قرار المسؤول الجديد" : "") + "."); render();
  };
  F.delegation = (form, u) => {
    need(u, ["officer", "admin"]); const d = fd(form), offs = officers();
    const src = offs.find((o) => o.id === (u.role === "admin" ? Number(d.get("from")) : u.emp)), dst = offs.find((o) => o.id === Number(d.get("to")));
    const sd = String(d.get("start") || ""), ed = String(d.get("end") || ""), note = String(d.get("note") || "").trim().slice(0, 300);
    if (!src || !dst) throw new RuleError("اختر مسؤول شؤون الموظفين المفوِّض والمفوَّض.");
    if (src.id === dst.id) throw new RuleError("لا يمكن تفويض المسؤول نفسه.");
    if (!parseISO(sd) || !parseISO(ed) || ed < sd) throw new RuleError("حدّد فترة صحيحة (تاريخ النهاية بعد تاريخ البداية أو يساويه).");
    if (ed < todayISO()) throw new RuleError("فترة التفويض منتهية؛ اختر فترة حالية أو قادمة.");
    if ((parseISO(ed) - parseISO(sd)) / 864e5 + 1 > MAX_DELEG_DAYS) throw new RuleError("أقصى مدة للتفويض " + MAX_DELEG_DAYS + " يوماً؛ للنقل الدائم استخدم «نقل فريق».");
    const all = DB.delegations || (DB.delegations = []), ov = (x) => !x.cancelled && x.start <= ed && x.end >= sd;
    const clash = all.find((x) => x.from === src.id && ov(x));
    if (clash) throw new RuleError("يوجد تفويض آخر لفريق «" + src.name + "» يتداخل مع هذه الفترة (إلى " + byId("emps", clash.to).name + " من " + clash.start + " إلى " + clash.end + "). ألغه أولاً أو اختر فترة أخرى.");
    if (all.find((x) => x.from === dst.id && ov(x))) throw new RuleError("«" + dst.name + "» نفسه مفوِّض لفريقه خلال هذه الفترة، فلا يمكن تفويضه.");
    const rec = { id: nid(), from: src.id, to: dst.id, start: sd, end: ed, note, by: u.id, at: nowStr(), cancelled: null }; all.push(rec);
    const period = "من " + sd + " إلى " + ed;
    notify(userOfEmp(dst), "فُوِّضت بمتابعة فريق " + src.name, "أصبحت مفوَّضاً بمتابعة فريق " + src.name + " " + period + ": اعتماد الطلبات ورفع التوصيات." + (note ? " ملاحظة: " + note : ""), "#/approvals", u);
    if (u.role === "admin") notify(userOfEmp(src), "تفويض فريقك", "فوّض مدير النظام " + dst.name + " بمتابعة فريقك " + period + ".", "#/delegation", u);
    audit("delegation_created", "delegation", rec.id, { from: src.name, to: dst.name, start: sd, end: ed, note });
    save(); flash("تم تفويض «" + dst.name + "» بمتابعة فريق «" + src.name + "» " + period + "."); render();
  };
  ACT["cancel-deleg"] = async (b, u) => {
    const d = (DB.delegations || []).find((x) => x.id === Number(b.dataset.id)); if (!d) return;
    if (u.role !== "admin" && ![d.from, d.to].includes(u.emp)) { flash("لا يمكنك إلغاء هذا التفويض.", "error"); render(); return; }
    const fe = byId("emps", d.from), te = byId("emps", d.to);
    if (!await confirmDlg("إلغاء تفويض " + te.name + " بمتابعة فريق " + fe.name + "؟")) return;
    d.cancelled = nowStr(); d.cancelledBy = u.id;
    [d.from, d.to].filter((x) => x !== u.emp).forEach((x) => notify(userOfEmp(byId("emps", x)), "إلغاء تفويض", "أُلغي تفويض " + te.name + " بمتابعة فريق " + fe.name + " (" + d.start + " – " + d.end + ").", "#/delegation", u));
    audit("delegation_cancelled", "delegation", d.id, { from: fe.name, to: te.name }); save(); flash("أُلغي التفويض."); render();
  };

  F["audit-clear"] = async (form, u) => {
    need(u, ["admin"]); const d = fd(form);
    if (u.pw !== (await sha(String(d.get("password") || "")))) { audit("audit_clear_denied", "system", null, { reason: "wrong_password" }); save(); throw new RuleError("لم يُحذف شيء: كلمة مرور مدير النظام غير صحيحة."); }
    if (String(d.get("confirm") || "").trim() !== WIPE_WORD) throw new RuleError("لم يُحذف شيء: للتأكيد اكتب كلمة «" + WIPE_WORD + "» كما هي.");
    const all = d.get("scope") === "all", before = String(d.get("before") || "");
    if (!all && !parseISO(before)) throw new RuleError("لم يُحذف شيء: حدّد التاريخ الذي تُحذف القيود السابقة له.");
    const label = all ? "السجل كاملاً" : "القيود قبل " + before, keep = DB.audit.filter((a) => !all && a.at.slice(0, 10) >= before), n = DB.audit.length - keep.length;
    if (!await confirmDlg("حذف " + n + " قيد من سجل التدقيق نهائياً (" + label + ")؟")) return;
    DB.audit = keep; audit("audit_cleared", "system", null, { scope: label, rows: n }); save();
    flash("حُذف " + n + " قيد من سجل التدقيق (" + label + ")."); render();
  };

  // تفاصيل الطلب ومساره الزمني
  function reqView(u, id) {
    const r = byId("leaves", id), e = r && byId("emps", r.emp);
    if (!r || !canView(u, e)) throw new Forbidden("الطلب غير موجود.");
    const mg = canManage(u, e), uName = (uid) => { const x = uid && byId("users", uid); return x ? displayName(x) : ""; };
    const cap = (uid) => { const x = uid && byId("users", uid); if (!x) return ""; if (x.role === "admin") return "مدير النظام" + (e.mgr && e.mgr !== x.emp ? " (بالنيابة)" : ""); if (x.emp && x.emp === e.mgr) return "مسؤول شؤون الموظفين"; if (x.emp === e.id) return "صاحب الطلب"; return "مسؤول شؤون الموظفين (بالتفويض)"; };
    const steps = [{ st: "done", t: "قُدّم الطلب", at: r.created, who: uName(r.by) || e.name, note: r.reason, icon: "request" }];
    if (r.status === "pending") {
      const due = new Date(String(r.created).replace(" ", "T")); due.setDate(due.getDate() + LATE_DAYS); const late = new Date() > due;
      steps.push({ st: late ? "late" : "current", t: "بانتظار قرار مسؤول شؤون الموظفين", who: mgrName(e) || "مدير النظام", note: late ? `تجاوز الطلب مدة القرار المعتمدة (${daysAr(LATE_DAYS)}).` : `يُتوقع القرار قبل ${iso(due)} (خلال ${daysAr(LATE_DAYS)} من التقديم).`, icon: "hourglass" });
    } else if (r.decidedAt || ["approved", "rejected"].includes(r.status)) {
      steps.push({ st: r.status === "rejected" ? "err" : "ok", t: r.status === "rejected" ? "رُفض الطلب" : "اعتُمد الطلب", at: r.decidedAt, who: uName(r.decidedBy), role: cap(r.decidedBy), note: r.note, icon: "stamp" });
    }
    if (r.status === "cancelled") steps.push({ st: "err", t: "أُلغي الطلب" + (r.decidedAt ? " بعد اعتماده وأُعيد الرصيد" : ""), at: r.cancelledAt, who: uName(r.cancelledBy), role: cap(r.cancelledBy), note: r.cancelNote, icon: "adjust" });
    const ref = r.ref || r.id;
    const acts = r.status === "pending" && (r.emp === u.emp || mg) ? `<div class="actions">${mg ? `<button class="btn ok" type="button" data-act="decide" data-a="approve" data-id="${r.id}">اعتماد</button><button class="btn danger" type="button" data-act="decide" data-a="reject" data-id="${r.id}">رفض</button>` : ""}<button class="btn" type="button" data-act="cancel-leave" data-id="${r.id}">إلغاء الطلب</button></div>`
      : r.status === "approved" && mg ? `<div class="actions"><button class="btn danger" type="button" data-act="cancel-leave" data-id="${r.id}" data-need-note="1">إلغاء الاعتماد</button></div>` : "";
    return layout(u, "تفاصيل الطلب", `<div class="page-head"><div><h1>${ico("request", "h-ico")} طلب معالجة غياب <bdi class="d">${h(ref)}</bdi></h1><p>${u.emp !== r.emp ? h(e.name) + " · " : ""}${statusBadge(r.status, REQ_ST[r.status])}${r.kind !== "use" ? " " + kindBadge(r.kind) : ""}</p></div>
      <div class="actions"><a class="btn" href="#/print/req/${r.id}">طباعة النموذج</a><a class="btn" href="#/requests">كل الطلبات</a></div></div>
      <div class="grid two"><section class="card"><h2>بيانات الطلب</h2><dl class="kv">
        <div><dt>المدة</dt><dd><b>${leaveAmount(r)}</b></dd></div><div><dt>التاريخ</dt><dd>${dateRange(r)}</dd></div>
        <div><dt>السبب</dt><dd>${h(r.reason) || "—"}</dd></div><div><dt>تاريخ التقديم</dt><dd class="num">${h(String(r.created).slice(0, 10))}</dd></div>
        <div><dt>مسؤول شؤون الموظفين</dt><dd>${h(mgrName(e) || "غير مُسند (يعتمده مدير النظام)")}</dd></div></dl>${acts}</section>
      <section class="card"><h2>مسار الطلب</h2><ol class="timeline">${steps.map((x) => `<li class="tl-${x.st}"><span class="tl-dot" aria-hidden="true">${ico(x.icon)}</span><div><b>${x.t}</b><small class="muted d-block">${x.at ? `<bdi class="d">${h(String(x.at).slice(0, 16))}</bdi>` : ""}${x.who ? " · " + h(x.who) : ""}${x.role ? " (" + x.role + ")" : ""}</small>${x.note ? `<p class="tl-note">${h(x.note)}</p>` : ""}</div></li>`).join("")}</ol></section></div>`);
  }
  V.faq = (u) => layout(u, "الأسئلة الشائعة", `<div class="page-head"><div><h1>${ico("shield", "h-ico")} الأسئلة الشائعة</h1></div></div><div class="card">${faqHTML(DB.settings)}</div>`);
  // معاينة فورية لعدد الأيام التي ستُخصم في نموذج الطلب
  function daysPreview(form) {
    const out = form.querySelector("[data-days-out]"); if (!out) return;
    const sd = form.querySelector('[name="start"]').value, ed = form.querySelector('[name="end"]').value || sd, emp = Number((form.querySelector('[name="emp"]') || {}).value || 0);
    const unitSel = form.querySelector('[name="unit"]:checked'), isH = unitSel && unitSel.value === "hours", hv = toNum((form.querySelector('[name="hours"]') || {}).value);
    if (!sd) { out.textContent = ""; return; }
    const y = yearFor(sd); if (!y) { out.textContent = "التاريخ لا يقع ضمن سنة معرّفة في النظام."; out.classList.add("err"); return; }
    if (isH) {
      if (!workingDays(y, sd, sd).length) { out.textContent = "التاريخ المختار ليس يوم عمل."; out.classList.add("err"); return; }
      const av = emp ? Math.max(balance(emp, y).hoursAvail, 0) : null, overH = av != null && hv > av + 1e-9;
      out.classList.toggle("err", overH); out.textContent = hv ? "سيُخصم من رصيد الساعات: " + hoursAr(hv) + (overH ? " — يتجاوز المتاح (" + hoursAr(av) + ")" : "") : "أدخل عدد الساعات"; return;
    }
    if (ed < sd) { out.textContent = ""; return; }
    const nd = workingDays(y, sd, ed).length, avail = emp ? balance(emp, y).bookable : null, over = avail != null && nd > avail;
    out.classList.toggle("err", over);
    out.textContent = nd ? "سيُخصم من الرصيد: " + daysAr(nd) + (over ? " — يتجاوز المتاح (" + avail + ")" : "") : "لا توجد أيام عمل في هذه الفترة";
  }
  document.addEventListener("change", (ev) => { const f = ev.target.closest && ev.target.closest("form[data-days-preview]"); if (f && ["start", "end", "unit"].includes(ev.target.name)) daysPreview(f); });
  document.addEventListener("input", (ev) => { const f = ev.target.closest && ev.target.closest("form[data-days-preview]"); if (f && ev.target.name === "hours") daysPreview(f); });

  ACT["remind-yearend"] = async (b, u) => {
    need(u, STAFF); const y = byId("years", b.dataset.year) || activeYear();
    if (!await confirmDlg("إرسال تذكير لكل من لديه رصيد متاح يسقط بنهاية السنة؟")) return;
    const subject = "تذكير من شؤون الموظفين: رصيدك يسقط بنهاية السنة " + y.name, since = Date.now() - 7 * 864e5; let sent = 0, skipped = 0;
    managedEmps(u).forEach((e) => { const bal = balance(e.id, y), eu = userOfEmp(e); if (bal.bookable <= 0 || !eu) return;
      if (DB.msgs.some((m) => m.to === eu.id && m.subject === subject && new Date(String(m.at).replace(" ", "T")).getTime() >= since)) { skipped++; return; }
      notify(eu, subject, "لديك " + daysAr(bal.bookable) + " متاحة للطلب من رصيد بدل الراحة، وتسقط في " + y.end + " لأن الرصيد لا يُرحَّل. قدّم طلب معالجة غياب قبل نهاية السنة إن رغبت في استخدامها.", "#/requests/new", u); sent++; });
    audit("reminder_sent", "employee", null, { count: sent, year: y.name }); save();
    flash((sent ? "أُرسل التذكير (عدد الموظفين: " + cnt(sent, "emp") + ")." : "لم يُرسل تذكير جديد.") + (skipped ? " لم يُكرَّر لمن ذُكّروا خلال الأيام السبعة الماضية (" + cnt(skipped, "emp") + ")." : "")); render();
  };
  // تصعيد الطلبات المتأخرة لمدير النظام مرة واحدة لكل طلب
  function escalateOverdue() {
    DB.escalated = DB.escalated || [];
    const fresh = DB.leaves.filter((r) => r.status === "pending" && ageDays(r.created) >= LATE_DAYS && !DB.escalated.includes(r.id));
    if (!fresh.length) return;
    const lines = fresh.slice(0, 15).map((r) => { const e = byId("emps", r.emp); return "• " + e.name + " (" + leaveAmount(r) + " بتاريخ " + r.start + ") — مسؤوله: " + (mgrName(e) || "غير مُسند") + "، منذ " + daysAr(ageDays(r.created)); });
    DB.users.filter((x) => x.role === "admin" && x.active).forEach((a) => notify(a, "تصعيد: " + cnt(fresh.length, "req") + " تجاوزت مدة القرار المعتمدة", "الطلبات الآتية تجاوزت مدة القرار المعتمدة (" + daysAr(LATE_DAYS) + ") دون قرار:\n" + lines.join("\n") + (fresh.length > 15 ? "\n…" : "") + "\nيمكنك البت فيها بالنيابة أو متابعة المسؤول.", "#/approvals"));
    fresh.forEach((r) => { DB.escalated.push(r.id); audit("leave_escalated", "leave_request", r.id, { employee: byId("emps", r.emp).name }); });
    save();
  }
  function pickSync(box) {
    const c = box.querySelectorAll('input[name="emps"]:checked').length, out = box.querySelector("[data-pick-count]");
    if (out) { out.classList.remove("err-text"); out.textContent = c ? (c === 1 ? "موظف واحد محدد" : c === 2 ? "موظفان محددان" : c + " موظفين محددين") : "لم يُحدَّد أحد"; }
    const btn = box.closest("form") && box.closest("form").querySelector("[data-pick-submit]"); if (btn) btn.textContent = c > 1 ? "رفع التوصية بخطاب واحد (" + c + ")" : "رفع التوصية وإضافة الرصيد";
  }
  document.addEventListener("change", (ev) => { const bx = ev.target.closest && ev.target.closest("[data-pick-box]"); if (bx) pickSync(bx); });
  document.addEventListener("submit", (ev) => { const bx = ev.target.querySelector && ev.target.querySelector("[data-pick-box]"); if (bx && !bx.querySelector('input[name="emps"]:checked')) { ev.preventDefault(); ev.stopImmediatePropagation(); const o = bx.querySelector("[data-pick-count]"); if (o) { o.textContent = "اختر موظفاً واحداً على الأقل"; o.classList.add("err-text"); } bx.scrollIntoView({ block: "center" }); } }, true);

  // حذف موظف أُدخل بالخطأ: يُمنع لمن له سجلات أو فريق أو حساب مدير نظام
  function empDeleteBlockers(e) {
    const out = [], nr = DB.recs.filter((r) => r.emp === e.id).length, nq = DB.leaves.filter((r) => r.emp === e.id).length, team = DB.emps.filter((x) => x.mgr === e.id).length;
    if (nr) out.push("له " + cnt(nr, "rec")); if (nq) out.push("له " + cnt(nq, "req"));
    if (team) out.push("مسند إليه " + cnt(team, "emp") + " بصفته مسؤول شؤون موظفين");
    DB.users.filter((x) => x.emp === e.id).forEach((x) => { if (x.role === "admin") out.push("مرتبط بحساب مدير النظام");
      if (DB.recs.some((r) => r.by === x.id || r.cancelledBy === x.id) || DB.leaves.some((r) => r.decidedBy === x.id || r.cancelledBy === x.id || (r.by === x.id && r.emp !== e.id))) out.push("حسابه اتخذ إجراءات مسجّلة على موظفين آخرين"); });
    return out;
  }
  function removeEmp(e) {
    const uids = DB.users.filter((x) => x.emp === e.id).map((x) => x.id);
    DB.msgs = DB.msgs.filter((m) => !uids.includes(m.to) && !uids.includes(m.from));
    DB.cards = (DB.cards || []).filter((c) => !uids.includes(c.user) && !(c.user == null && c.no === e.no)); // بطاقة الدخول تُحذف مع الحساب
    DB.users = DB.users.filter((x) => !uids.includes(x.id));
    DB.delegations = (DB.delegations || []).filter((d) => d.from !== e.id && d.to !== e.id);
    DB.emps = DB.emps.filter((x) => x.id !== e.id);
    audit("employee_deleted", "employee", e.id, { name: e.name, employee: e.no }); save();
  }
  F["del-emp"] = async (form, u) => {
    need(u, ["admin"]); const e = byId("emps", form.dataset.id); if (!e) return;
    const bl = empDeleteBlockers(e); if (bl.length) throw new RuleError("لا يمكن حذف «" + e.name + "»: " + bl.join("، و") + ".");
    if (String(fd(form).get("confirm_no") || "").trim() !== e.no) throw new RuleError("لم يُحذف الموظف: للتأكيد اكتب رقمه الوظيفي كما هو.");
    if (!await confirmDlg("حذف «" + e.name + "» نهائياً؟")) return;
    removeEmp(e); flash("حُذف الموظف «" + e.name + "» (" + e.no + ") وحسابه."); go("#/employees");
  };

  // رفع الموظف توصية ممنوحة له للاعتماد
  function recSubmitForm(u, q) {
    const e = empOf(u); if (!e) throw new Forbidden("حسابك غير مرتبط بسجل موظف.");
    if (activeYear().empCanSubmitRec === false) throw new Forbidden("رفع التوصيات من الموظفين غير مفعّل حالياً. تواصل مع مسؤول شؤون الموظفين.");
    const kind = q.get("kind") === "hours" ? "hours" : "days", isD = kind === "days", y = activeYear(), b = balance(e.id, y);
    return layout(u, "رفع توصية ممنوحة لي", `<div class="page-head"><div><h1>${ico("upload", "h-ico")} رفع توصية ممنوحة لي</h1><p>ارفع خطاب التوصية الذي مُنحت فيه بدل راحة (بالأيام أو بالساعات)، فيصل إلى ${h(mgrName(e) || "مدير النظام")} لاعتماده، وتُضاف القيمة إلى رصيدك بعد الاعتماد.</p></div>
      <div class="seg" role="tablist" aria-label="نوع التوصية"><a href="#/recs/submit?kind=days" class="${isD ? "on" : ""}">بالأيام</a><a href="#/recs/submit?kind=hours" class="${isD ? "" : "on"}">بالساعات</a></div></div>
      <form class="card form-narrow" data-form="rec-submit" data-kind="${kind}">
        <div class="alert info" role="note">${ico("hourglass", "sm-ico")}<span>تبقى التوصية «بانتظار الاعتماد» ولا تُحتسب في رصيدك حتى يعتمدها مسؤول شؤون الموظفين بعد مراجعة الخطاب. الحد الأقصى السنوي ${daysAr(y.cap)}، والمتاح للمنح حالياً ${isD ? n(b.capLeftHours / b.hpd) + " يوم" : n(b.capLeftHours) + " ساعة"}.</span></div>
        <div class="form-grid"><div class="field"><label for="am">${isD ? "عدد الأيام الممنوحة" : "عدد الساعات الممنوحة"} *</label><input id="am" name="amount" type="number" required min="${isD ? 1 : 0.25}" step="${isD ? 1 : 0.25}" inputmode="decimal"></div>
          <div class="field"><label for="dt">تاريخ التوصية (الخطاب) *</label><input id="dt" name="date" type="date" required></div>
          <div class="field"><label for="rf">رقم الخطاب</label><input id="rf" name="ref" maxlength="64"></div></div>
        <div class="field"><label for="sb">موضوع التكليف *</label><input id="sb" name="subject" required placeholder="مثال: المراقبة في الاختبارات النهائية"></div>
        <div class="form-grid"><div class="field"><label for="ab">جهة التكليف</label><input id="ab" name="assigned_by" maxlength="160" placeholder="مثال: وكالة الكلية للشؤون الأكاديمية"></div>
          <div class="field"><label for="tf">فترة التكليف: من</label><input id="tf" name="task_from" type="date"></div><div class="field"><label for="tt">إلى</label><input id="tt" name="task_to" type="date"></div></div>
        <div class="field"><label for="fl">خطاب التوصية (PDF) *</label><input id="fl" name="file" type="file" accept="application/pdf,.pdf" required><span class="hint">نسخة العرض تتحقق من الملف ولا تحفظ محتواه.</span></div>
        <div class="actions"><button class="btn primary">رفع التوصية للاعتماد</button><a class="btn" href="#/me">إلغاء</a></div></form>`);
  }
  F["rec-submit"] = async (form, u) => {
    const e = empOf(u); if (!e) throw new RuleError("حسابك غير مرتبط بسجل موظف.");
    if (activeYear().empCanSubmitRec === false) throw new RuleError("رفع التوصيات من الموظفين غير مفعّل حالياً. تواصل مع مسؤول شؤون الموظفين.");
    const d = fd(form), kind = form.dataset.kind, amount = toNum(d.get("amount")), date = String(d.get("date") || ""), refNo = String(d.get("ref") || "").trim(), subject = String(d.get("subject") || "").trim();
    if (!parseISO(date)) throw new RuleError("أدخل تاريخ التوصية كما في الخطاب.");
    if (!subject) throw new RuleError("اكتب موضوع التكليف كما في الخطاب.");
    const tFrom = String(d.get("task_from") || ""), tTo = String(d.get("task_to") || "") || tFrom;
    if (tFrom && tTo < tFrom) throw new RuleError("فترة التكليف غير صحيحة: تاريخ النهاية قبل تاريخ البداية.");
    const att = await pdfCheck(d.get("file")); if (!att) throw new RuleError("أرفق خطاب التوصية (PDF)؛ هو مستند الاعتماد.");
    const y = validateRec(e, kind, amount, date, true);
    if (refNo && DB.recs.some((r) => r.emp === e.id && ["active", "pending"].includes(r.status) && String(r.refNo || "").toLowerCase() === refNo.toLowerCase())) throw new RuleError("رقم الخطاب «" + refNo + "» مرفوع سابقاً في توصية سارية أو بانتظار الاعتماد.");
    const r = { id: nid(), emp: e.id, year: y.id, kind, amount, date, refNo, subject, assignedBy: String(d.get("assigned_by") || "").trim().slice(0, 160), taskFrom: tFrom, taskTo: tFrom ? tTo : "", batch: "", status: "pending", att, by: u.id, cancelNote: "", created: nowStr() };
    DB.recs.push(r); audit("recommendation_submitted", "recommendation", r.id, { employee: e.no, kind, amount });
    (officerUsersFor(e).length ? officerUsersFor(e) : DB.users.filter((x) => x.role === "admin" && x.active)).filter((o) => o.id !== u.id).forEach((o) => notify(o, "توصية مرفوعة من " + e.name + " بانتظار اعتمادك", "رفع " + e.name + " توصية ممنوحة له (" + recAmount(r) + ") بشأن: " + subject + (refNo ? " — خطاب رقم " + refNo : "") + ". راجع الخطاب المرفق واعتمدها أو ارفضها.", "#/approvals", u));
    save(); flash("رُفعت التوصية (" + recAmount(r) + ") وهي بانتظار اعتماد مسؤول شؤون الموظفين؛ تُضاف إلى رصيدك بعد اعتمادها."); go("#/me");
  };
  ACT["rec-decide"] = async (b, u) => {
    const r = byId("recs", b.dataset.id), e = r && byId("emps", r.emp); if (!r || r.status !== "pending" || !canManage(u, e)) return;
    try {
      if (b.dataset.a === "approve") {
        if (!await confirmDlg("اعتماد التوصية وإضافة القيمة إلى رصيد " + e.name + "؟")) return;
        const y = validateRec(e, r.kind, r.amount, r.date, true), beforeA = alertKeys(balance(e.id, y));
        r.status = "active"; r.year = y.id; r.approvedBy = u.id; r.approvedAt = nowStr(); assignRef(r, "REC");
        audit("recommendation_approved", "recommendation", r.id, { employee: e.name, amount: r.amount });
        notify(userOfEmp(e), "اعتُمدت توصيتك: " + recAmount(r), "اعتُمدت التوصية التي رفعتها (" + r.subject + ") وأُضيف " + recAmount(r) + " إلى رصيدك.", "#/me", u); notifyAlerts(e, y, beforeA, u);
        save(); flash("اعتُمدت التوصية وأُضيف " + recAmount(r) + " إلى رصيد " + e.name + ".");
      } else {
        const note = await askReason("reject"); if (!note) return;
        r.status = "rejected"; r.cancelNote = note; r.cancelledBy = u.id; r.cancelledAt = nowStr();
        audit("recommendation_rejected", "recommendation", r.id, { employee: e.name, note });
        notify(userOfEmp(e), "رُفضت التوصية التي رفعتها", "رُفضت التوصية (" + recAmount(r) + " بشأن: " + r.subject + "). السبب: " + note, "#/me", u);
        save(); flash("رُفضت التوصية وأُشعر الموظف بالسبب.");
      }
    } catch (err) { if (!(err instanceof RuleError)) throw err; flash(err.message, "error"); }
    render();
  };
  ACT["rec-withdraw"] = async (b, u) => {
    const r = byId("recs", b.dataset.id); if (!r || r.emp !== u.emp || r.status !== "pending") return;
    if (!await confirmDlg("سحب التوصية قبل اعتمادها؟")) return;
    r.status = "cancelled"; r.cancelNote = "سحبها مقدّمها قبل الاعتماد"; r.cancelledBy = u.id; r.cancelledAt = nowStr();
    audit("recommendation_withdrawn", "recommendation", r.id); save(); flash("سُحبت التوصية."); render();
  };
  ACT["del-emp-quick"] = async (b, u) => {
    need(u, ["admin"]); const e = byId("emps", b.dataset.id); if (!e) return;
    const bl = empDeleteBlockers(e);
    if (bl.length) { flash("لا يمكن حذف «" + e.name + "»: " + bl.join("، و") + ". للحفاظ على السجلات أوقفه بدلاً من حذفه.", "error"); render(); return; }
    if (!await confirmDlg("حذف الموظف «" + e.name + "» وحسابه نهائياً؟ يُسمح بذلك لمن أُدخل بالخطأ ولا سجلات له.")) return;
    removeEmp(e); flash("حُذف الموظف «" + e.name + "» (" + e.no + ") وحسابه."); render();
  };

  F["holidays-save"] = (form) => {
    const d = fd(form), year = Number(form.dataset.year), count = Number(form.dataset.count), items = [], errs = [];
    for (let i = 0; i < count; i++) {
      if (d.get("del_" + i)) continue;
      const nm = String(d.get("name_" + i) || "").trim().replace(/\s+/g, " "), sd = String(d.get("start_" + i) || ""), ed = String(d.get("end_" + i) || "") || sd;
      if (!nm && !sd) continue;
      if (!nm || !parseISO(sd)) { errs.push("السطر " + (i + 1) + ": أكمل اسم العطلة وتاريخ بدايتها."); continue; }
      if (!parseISO(ed) || ed < sd) { errs.push("«" + nm + "»: الفترة غير صحيحة."); continue; }
      if (sd.slice(0, 4) !== String(year) || ed.slice(0, 4) !== String(year)) { errs.push("«" + nm + "»: يجب أن تقع الفترة داخل سنة " + year + "."); continue; }
      items.push([nm, sd, ed]);
    }
    const nms = items.map((x) => x[0]); [...new Set(nms.filter((x, i) => nms.indexOf(x) !== i))].forEach((x) => errs.push("اسم العطلة «" + x + "» مكرر؛ اجعل لكل عطلة سطراً واحداً بفترتها كاملة."));
    items.forEach((x, i) => items.slice(i + 1).forEach((y) => { if (x[1] <= y[2] && y[1] <= x[2]) errs.push("«" + x[0] + "» و«" + y[0] + "» تتداخلان في التاريخ."); }));
    if (errs.length) throw new RuleError(errs.slice(0, 4).join(" | ") + " — لم يُحفظ شيء.");
    const before = DB.holidays.filter((x) => x.day.slice(0, 4) === String(year)).map((x) => x.day + x.name).sort().join();
    DB.holidays = DB.holidays.filter((x) => x.day.slice(0, 4) !== String(year)); let c = 0; items.forEach(([nm, sd, ed]) => (c += addHolidayRange(nm, sd, ed)));
    const after = DB.holidays.filter((x) => x.day.slice(0, 4) === String(year)).map((x) => x.day + x.name).sort().join();
    if (before === after) { flash("لا توجد تغييرات للحفظ.", "warn"); render(); return; }
    audit("holiday_updated", "holiday", null, { year, count: c, name: nms.join("، ") }); save();
    flash("حُفظت عطل سنة " + year + ": " + daysAr(c) + " (عدد العطل: " + items.length + ")."); warnHolidayOverlap(year + "-01-01", year + "-12-31", true); render();
  };

  document.addEventListener("submit", async (ev) => {
    const form = ev.target.closest("form[data-form]"); if (!form) return;
    ev.preventDefault();
    const fn = F[form.dataset.form]; const u = me();
    try { await fn(form, u); }
    catch (e) { if (e instanceof RuleError || e instanceof Forbidden) { keepDraft(form); flash(e.message, "error"); render(); restoreDraft(); } else { console.error(e); toast("حدث خطأ غير متوقع.", "error"); } }
  });
  document.addEventListener("click", async (ev) => {
    const t = ev.target;
    const sk = t.closest(".skip"); if (sk) { ev.preventDefault(); const m = document.getElementById("main"); if (m) m.focus(); return; }
    const dl = t.closest("[data-demo-login]"); if (dl) { document.getElementById("u").value = dl.dataset.demoLogin; document.getElementById("p").value = DEMO_PW; document.querySelector('form[data-form="login"]').requestSubmit(); return; }
    const od = t.closest("[data-open-dialog]"); if (od) { const d = document.getElementById(od.dataset.openDialog); if (d && d.showModal) d.showModal(); else if (d) d.setAttribute("open", ""); return; }
    if (t.tagName === "DIALOG" && t.open) { t.close(); return; }
    const a = t.closest("[data-act]");
    if (a) { try { await ACT[a.dataset.act](a, me()); } catch (e) { if (e instanceof RuleError || e instanceof Forbidden) { flash(e.message, "error"); render(); } else { console.error(e); toast("حدث خطأ غير متوقع.", "error"); } } return; }
    if (t.closest("[data-theme-toggle]")) { const cur = document.documentElement.getAttribute("data-theme"); const dark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; const nx = dark ? "light" : "dark"; document.documentElement.setAttribute("data-theme", nx); try { localStorage.setItem("theme", nx); } catch (e) {} return; }
    const mb = t.closest("[data-menu]"); const sb = document.getElementById("sidebar");
    if (mb && sb) { const o = sb.classList.toggle("open"); mb.setAttribute("aria-expanded", o ? "true" : "false"); document.body.classList.toggle("nav-open", o); return; }
    if (sb && sb.classList.contains("open") && !t.closest("#sidebar")) { sb.classList.remove("open"); document.body.classList.remove("nav-open"); const mbb = document.querySelector("[data-menu]"); if (mbb) mbb.setAttribute("aria-expanded", "false"); }
    document.querySelectorAll("details.acct[open]").forEach((d) => { if (!d.contains(t)) d.removeAttribute("open"); });
    if (t.closest("[data-print]")) { ev.preventDefault(); window.print(); return; }
    const all = t.closest("[data-check-all]"); if (all) document.querySelectorAll(`input[name="${all.dataset.checkAll}"]`).forEach((c) => (c.checked = all.checked));
  });
  // بحث وتصفية داخل قوائم اختيار الموظف (بالاسم أو الرقم الوظيفي)
  var EMP_SELECTS = 'select[name="emp"]:not([multiple]), select[name="employee_id"]:not([multiple]), select[name="mgr"]:not([multiple]), select[name="manager_id"]:not([multiple])';
  function normAr(s) {
    return String(s || "").replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
      .replace(/[٠-٩]/g, function (d) { return "٠١٢٣٤٥٦٧٨٩".indexOf(d); }).replace(/\s+/g, " ").trim().toLowerCase();
  }
  function enhanceFiles(root) {
    root.querySelectorAll('input[type="file"]:not([data-fp])').forEach((inp) => {
      inp.dataset.fp = "1"; const wrap = document.createElement("span"); wrap.className = "file-pick"; inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp); inp.classList.add("file-input");
      const btn = document.createElement("span"); btn.className = "btn sm file-btn"; btn.setAttribute("aria-hidden", "true"); btn.textContent = inp.multiple ? "اختر ملفات" : "اختر ملفاً";
      const name = document.createElement("span"); name.className = "file-name"; name.setAttribute("aria-live", "polite"); name.textContent = "لم يُختر ملف";
      wrap.append(btn, name);
      inp.addEventListener("change", () => { const has = !!(inp.files && inp.files.length); name.textContent = has ? [...inp.files].map((f) => f.name).join("، ") : "لم يُختر ملف"; wrap.classList.toggle("has-file", has); });
    });
  }
  function enhanceSelects(root) {
    (root || document).querySelectorAll(EMP_SELECTS).forEach(function (sel) {
      if (sel.dataset.searchReady || sel.options.length < 4) return;
      sel.dataset.searchReady = "1";
      var all = Array.prototype.slice.call(sel.options);
      var box = document.createElement("div");
      box.className = "opt-search";
      var inp = document.createElement("input");
      inp.type = "search";
      inp.placeholder = "ابحث بالاسم أو الرقم الوظيفي…";
      inp.setAttribute("aria-label", "بحث في قائمة الموظفين");
      inp.setAttribute("autocomplete", "off");
      var cnt = document.createElement("small");
      cnt.className = "hint";
      box.appendChild(inp); box.appendChild(cnt);
      sel.parentNode.insertBefore(box, sel);
      inp.addEventListener("input", function () {
        var q = normAr(inp.value), cur = sel.value, n = 0;
        all.forEach(function (o) {
          var keep = !o.value || (o.value === cur && sel.dataset.auto !== cur) || !q || normAr(o.textContent).indexOf(q) !== -1;
          if (keep && o.value) n++;
          if (keep && o.parentNode !== sel) sel.appendChild(o);
          if (!keep && o.parentNode === sel) sel.removeChild(o);
        });
        all.forEach(function (o) { if (o.parentNode === sel) sel.appendChild(o); }); // الحفاظ على الترتيب الأصلي
        cnt.textContent = q ? n + " نتيجة" : "";
        var real = all.filter(function (o) { return o.value && o.parentNode === sel; });
        if (sel.dataset.auto && sel.value === "" ) sel.dataset.auto = "";
        if (q && real.length === 1 && (!sel.value || sel.dataset.auto) && !sel.hasAttribute("data-reqemp") && !sel.hasAttribute("data-autosubmit-get")) { sel.value = real[0].value; sel.dataset.auto = sel.value; }
        else if (sel.dataset.auto && real.indexOf(sel.selectedOptions[0]) === -1) { sel.value = ""; sel.dataset.auto = ""; }
      });
      inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); sel.focus(); } });
      sel.addEventListener("change", function () { sel.dataset.auto = ""; });
    });
  }
  function syncUnit(form) { const u = form.querySelector("[data-unit]:checked"); if (!u) return; form.querySelectorAll("[data-for-unit]").forEach((el) => { const on = el.dataset.forUnit === u.value; el.hidden = !on; el.querySelectorAll("input").forEach((i) => (i.required = on && i.name === "hours")); }); }
  function assignSync(form) {
    const sel = form.querySelector("[data-role-select]");
    form.querySelectorAll("[data-role-dep]").forEach((box) => { const on = !!sel && sel.value === box.dataset.roleDep; box.hidden = !on; box.querySelectorAll("input").forEach((i) => (i.disabled = !on));
      const c = box.querySelector("[data-assign-count]"); if (c) c.textContent = box.querySelectorAll('input[name="assign"]:checked').length + " محدد"; });
  }
  document.addEventListener("input", (ev) => { const f = ev.target.closest("[data-assign-filter]"); if (!f) return; const q = f.value.trim(); f.closest(".assign-box").querySelectorAll(".check-list .check").forEach((l) => (l.hidden = !!q && !l.dataset.text.includes(q))); });
  // إظهار/إخفاء كلمة المرور
  document.addEventListener("click", (ev) => { const b = ev.target.closest("[data-pw-toggle]"); if (!b) return; const inp = b.parentElement.querySelector("input"); const show = inp.type === "password"; inp.type = show ? "text" : "password"; b.setAttribute("aria-pressed", String(show)); const t = show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"; b.setAttribute("aria-label", t); b.title = t; inp.focus(); });
  document.addEventListener("click", (ev) => { const b = ev.target.closest("[data-assign-all]"); if (!b) return; const on = b.dataset.assignAll === "1"; b.closest(".assign-box").querySelectorAll(".check-list .check").forEach((l) => { if (!l.hidden) l.querySelector("input").checked = on; }); assignSync(b.form); });
  const NAVKEY = "nav_groups";
  const navState = () => { try { return JSON.parse(localStorage.getItem(NAVKEY) || "{}"); } catch (e) { return {}; } };
  const setGroup = (g, open) => { g.querySelector(".nav-toggle").setAttribute("aria-expanded", open ? "true" : "false"); g.querySelector(".nav-sub").hidden = !open; };
  function initNavGroups() { const st = navState(); document.querySelectorAll(".nav-group").forEach((g) => { const k = g.dataset.group; setGroup(g, g.dataset.active ? true : k in st ? st[k] : g.dataset.default !== "closed"); }); }
  document.addEventListener("click", (ev) => { const b = ev.target.closest(".nav-toggle"); if (!b) return; const g = b.closest(".nav-group"), open = b.getAttribute("aria-expanded") !== "true"; setGroup(g, open); const st = navState(); st[g.dataset.group] = open; try { localStorage.setItem(NAVKEY, JSON.stringify(st)); } catch (e) {} });
  document.addEventListener("input", (ev) => {
    const f = ev.target.closest('form[data-form="filter"]'); if (!f || !ev.target.matches("input[type=search][name]") || ev.isComposing) return;
    clearTimeout(ftimer); if (ev.target.value.trim().length === 1) return;
    ftimer = setTimeout(() => { keepFocus = { id: ev.target.id, pos: ev.target.selectionStart || ev.target.value.length }; F.filter(f); }, 450);
  });
  document.addEventListener("keydown", (ev) => { if (ev.key !== "Escape") return; const sb = document.getElementById("sidebar"); if (sb && sb.classList.contains("open")) { sb.classList.remove("open"); document.body.classList.remove("nav-open"); const mb = document.querySelector("[data-menu]"); if (mb) { mb.setAttribute("aria-expanded", "false"); mb.focus(); } } });
  document.addEventListener("change", (ev) => {
    const ff = ev.target.closest('form[data-form="filter"]');
    if (ff && ev.target.matches("select[name]")) { keepFocus = ev.target.id ? { id: ev.target.id } : null; F.filter(ff); return; }
    if (ev.target.matches("[data-role-select], input[name='assign']") && ev.target.form) assignSync(ev.target.form);
    if (ev.target.matches("[data-unit]")) syncUnit(ev.target.form);
    if (ev.target.matches("[data-yearnav]") && !ev.target.closest("form[data-form]")) { const { seg, q } = parts(); q.set("year", ev.target.value); go("#/" + seg.join("/") + "?" + q); }
    if (ev.target.matches("[data-reqemp]") && ev.target.value) go("#/requests/new?emp=" + ev.target.value);
  });
  let draft = null;
  function keepDraft(form) { if (["filter", "login", "restore", "wipe"].includes(form.dataset.form)) return; const vals = []; for (const el of form.elements) { if (!el.name || el.type === "file" || el.type === "submit" || el.type === "button") continue; if ((el.type === "radio" || el.type === "checkbox") && !el.checked) continue; vals.push([el.name, el.value]); } draft = { form: form.dataset.form, id: form.dataset.id || "", vals }; }
  function restoreDraft() {
    if (!draft) return; const f = document.querySelector(`form[data-form="${draft.form}"]${draft.id ? `[data-id="${draft.id}"]` : ""}`); const dd = draft; draft = null; if (!f) return;
    dd.vals.forEach(([k, v]) => f.querySelectorAll(`[name="${k}"]`).forEach((el) => { if (el.type === "radio" || el.type === "checkbox") el.checked = el.value === v; else if (el.multiple) [...el.options].forEach((o) => { if (o.value === v) o.selected = true; }); else el.value = v; }));
    if (f.matches("[data-leave-form]")) syncUnit(f);
  }
  window.addEventListener("hashchange", render);

  function render() {
    document.body.className = "";
    const u = me();
    const { seg, q } = parts();
    let html;
    try {
      if (!u) { html = V.login(); if (seg[0] !== "login" && seg.length) history.replaceState(null, "", "#/login"); }
      else if (u.mustChange && seg[0] !== "password") { go("#/password"); return; }
      else {
        let r = seg[0] || (u.role === "employee" ? "me" : "dashboard");
        if (r === "login") r = u.role === "employee" ? "me" : "dashboard";
        const view = V[r];
        if (!view) throw new Forbidden("الصفحة غير موجودة.");
        html = view(u, q, seg.length ? seg : [r]);
      }
    } catch (e) {
      if (e instanceof Forbidden) html = layout(u, "تعذّر الوصول", `<div class="card"><h2>غير مصرح</h2><p>${h(e.message)}</p><a class="btn" href="#/">العودة إلى الرئيسية</a></div>`);
      else { console.error(e); html = `<div class="card" style="margin:2rem">حدث خطأ: ${h(e.message)} <button class="btn" data-act="reset">استعادة بيانات العرض</button></div>`; }
    }
    if (html === "" || html == null) return;
    $app.innerHTML = html;
    document.querySelectorAll("[data-leave-form]").forEach(syncUnit);
    enhanceSelects($app); enhanceFiles($app); document.querySelectorAll("[data-pick-box]").forEach(pickSync);
    document.querySelectorAll("form").forEach((f) => { if (f.querySelector("[data-role-select]")) assignSync(f); });
    document.body.classList.remove("nav-open");
    initNavGroups();
    const qsNow = location.hash.split("?")[1];
    document.querySelectorAll('form[data-form="filter"]').forEach((f) => { if (qsNow) f.insertAdjacentHTML("beforeend", `<a class="clear-link" href="#/${f.dataset.route}">مسح الفلاتر</a>`); });
    if (keepFocus) {
      const el = keepFocus.id && document.getElementById(keepFocus.id);
      if (el) { el.focus({ preventScroll: true }); if (keepFocus.pos != null) try { el.setSelectionRange(keepFocus.pos, keepFocus.pos); } catch (e) {} }
      keepFocus = null;
    } else {
      const main = document.getElementById("main"); if (main && seg[0] !== "login") main.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    if (liveMsg) { liveMsg = false; const live = document.getElementById("live"); const sub = document.querySelector("main .page-head p"); if (live && sub) live.textContent = "تم تحديث النتائج: " + sub.textContent.trim(); }
  }

  (async function start() {
    DB = load();
    if (!DB || !DB.years || !DB.recs) await seed();
    try { localStorage.removeItem("hr_demo_v1"); localStorage.removeItem("hr_demo_v2"); localStorage.removeItem("hr_demo_v3"); } catch (e) {}
    // ترقية بيانات العرض القديمة إلى هوية «إتمام»
    DB.delegations = DB.delegations || [];
    { const names = new Set(DB.users.map((x) => String(x.username).toLowerCase())); DB.cards = (DB.cards || []).filter((c) => c.user != null || names.has(String(c.username || "").toLowerCase())); } // بطاقات بلا حساب
    if (DB.settings.system_title === "إدارة أيام بدل الراحة للموظفين") DB.settings.system_title = "إتمام";
    if (DB.settings.tagline == null || DB.settings.tagline === "إدارة أيام بدل الراحة بكفاءة واحتراف") DB.settings.tagline = TAGLINE;
    if (!DB.settings.credit || DB.settings.credit === "تطوير مريم حمدي") DB.settings.credit = CREDIT;
    if (!document.getElementById("live")) document.body.insertAdjacentHTML("beforeend", '<p id="live" class="sr-only" role="status" aria-live="polite"></p>');
    [SPRITE_INLINE, HERO_INLINE] = await Promise.all([inlineSprite("icons.svg"), inlineSprite("hero.svg")]);
    render();
  })();
})();

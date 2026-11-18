/* نظام بدل الراحة — نسخة العرض (تعمل في المتصفح فقط، والبيانات في localStorage) */
(function () {
  "use strict";

  // ============================================================ أدوات
  const KEY = "hr_demo_v1";
  const CREDIT = "تصميم وتطوير: مريم حمدي";
  const TAGLINE = "إدارة أيام بدل الراحة بكفاءة واحتراف";
  const $app = document.getElementById("app");
  const ROLES = { admin: "مدير النظام", officer: "مسؤول الإدخال", manager: "مدير مباشر", viewer: "متابع", employee: "موظف" };
  const ASSIGNABLE = ["employee", "officer", "manager", "viewer"];
  const MODES = { fixed: "ثابت (رصيد سنوي محدد)", earned: "مكتسب (من الساعات المعتمدة فقط)", mixed: "مختلط (الرصيد السنوي + المكتسب من الساعات)" };
  const WD = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const TASK_ST = { pending: "بانتظار الاعتماد", approved: "معتمد", rejected: "مرفوض" };
  const REQ_ST = { pending: "بانتظار الاعتماد", approved: "معتمد", rejected: "مرفوض", cancelled: "ملغى" };
  const STAFF = ["admin", "officer", "manager", "viewer"];
  const EDITORS = ["admin", "officer"];
  const DEMO_PW = "Demo12345";

  const h = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const n = (v) => (v == null || v === "" ? "" : String(Math.round(Number(v) * 100) / 100));
  const todayISO = () => { const d = new Date(); return iso(d); };
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const parseISO = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return null; const [y, m, d] = s.split("-").map(Number); const dt = new Date(y, m - 1, d); return dt.getMonth() === m - 1 ? dt : null; };
  const weekday = (s) => parseISO(s).getDay();
  const nowStr = () => { const d = new Date(); return iso(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  const norm = (s) => String(s || "").replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
  const toNum = (s) => { if (s == null || String(s).trim() === "") return null; const v = Number(String(s).trim().replace("٫", ".").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))); return isNaN(v) ? null : v; };
  const rand = () => Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6).toUpperCase() + Math.floor(Math.random() * 90 + 10);
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
  const byId = (arr, id) => DB[arr].find((x) => x.id === Number(id));
  function audit(action, entity, entityId, details) {
    const u = me();
    DB.audit.unshift({ id: nid(), at: nowStr(), user: u ? u.username : "", action, entity, entityId: entityId || null, details: details ? JSON.stringify(details) : "" });
    if (DB.audit.length > 3000) DB.audit.length = 3000;
  }

  async function seed() {
    const pw = await sha(DEMO_PW);
    const db = { seq: 0, settings: { university: "جامعة الملك سعود", college: "كلية التمريض", system_title: "إتمام", tagline: TAGLINE, credit: CREDIT },
      years: [], depts: [], emps: [], users: [], balances: [], tasks: [], reqs: [], holidays: [], audit: [] };
    DB = db;
    db.years.push({ id: nid(), name: "2027", start: "2027-01-01", end: "2027-12-31", active: true, locked: false, mode: "mixed", base: 20, hpd: 7, maxh: 12,
      reqTaskAtt: false, reqReqAtt: false, weekend: [5, 6], blockWeekends: true, allowFuture: true, allowLateCancel: false, empCanRequest: true });
    const depts = ["وحدة الشؤون الإدارية", "وحدة المعامل", "العلاقات العامة", "وكالة الشؤون الأكاديمية"];
    depts.forEach((name) => db.depts.push({ id: nid(), name, active: true }));
    const D = (i) => db.depts[i].id;
    const people = [
      ["100100", "سارة عبدالله المطيري", 0, null, "رئيسة الوحدة"],
      ["100101", "نوف محمد القحطاني", 0, "100100", "أخصائية إدارية"],
      ["100102", "خالد سعد الدوسري", 0, "100100", "إداري"],
      ["100103", "ريم فهد الشمري", 0, "100100", "سكرتيرة"],
      ["100200", "عبدالرحمن علي الزهراني", 1, null, "رئيس وحدة المعامل"],
      ["100201", "منيرة ناصر العنزي", 1, "100200", "فنية مختبر"],
      ["100202", "ماجد حمد الحربي", 1, "100200", "فني مختبر"],
      ["100300", "هند إبراهيم السبيعي", 2, null, "مديرة العلاقات العامة"],
      ["100301", "فيصل تركي العتيبي", 2, "100300", "منسق فعاليات"],
      ["100400", "لمى سلطان الغامدي", 3, null, "منسقة أكاديمية"],
      ["100401", "بندر عبدالعزيز الشهري", 3, "100400", "إداري"],
    ];
    const byNo = {};
    people.forEach(([no, name, di, , title]) => { const e = { id: nid(), no, name, dept: D(di), mgr: null, title, email: "", active: true }; db.emps.push(e); byNo[no] = e; });
    people.forEach(([no, , , mgr]) => { if (mgr) byNo[no].mgr = byNo[mgr].id; });
    const addU = (username, role, emp) => db.users.push({ id: nid(), username, pw, role, emp: emp ? emp.id : null, active: true, mustChange: false, last: null });
    addU("admin", "admin", null);
    addU("officer", "officer", byNo["100103"]);
    addU("mgr", "manager", byNo["100100"]);
    addU("viewer", "viewer", null);
    addU("emp", "employee", byNo["100101"]);
    const y = db.years[0].id;
    const T = (no, date, desc, hours, status) => db.tasks.push({ id: nid(), emp: byNo[no].id, year: y, date, desc, hours, status, notes: "", att: "", enteredBy: 2, decidedBy: status === "pending" ? null : 3, decidedAt: status === "pending" ? null : date + " 10:00", note: "", created: date + " 09:00" });
    T("100101", "2027-01-12", "لجنة الاختبارات النهائية", 9.5, "approved");
    T("100101", "2027-01-20", "تنظيم فعالية الكلية", 4, "pending");
    T("100102", "2027-01-15", "جرد العهد", 7, "approved");
    T("100201", "2027-01-18", "تجهيز المعامل للاختبارات العملية", 12, "approved");
    T("100301", "2027-02-02", "حفل التخرج", 8, "pending");
    const R = (no, date, status) => db.reqs.push({ id: nid(), emp: byNo[no].id, year: y, date, status, notes: "", att: "", requestedBy: 2, decidedBy: status === "pending" ? null : 3, decidedAt: status === "pending" ? null : "2027-01-25 11:00", note: "", created: "2027-01-24 09:00" });
    R("100101", "2027-02-03", "approved");
    R("100101", "2027-03-08", "pending");
    R("100102", "2027-02-10", "approved");
    R("100201", "2027-02-15", "approved");
    R("100202", "2027-03-02", "pending");
    db.holidays.push({ id: nid(), day: "2027-02-22", name: "يوم التأسيس" });
    DB = db;
    save();
  }

  // ============================================================ الجلسة
  const me = () => { const id = Number(sessionStorage.getItem("hr_uid") || 0); const u = DB && DB.users.find((x) => x.id === id && x.active); return u || null; };
  const empOf = (u) => (u && u.emp ? byId("emps", u.emp) : null);
  const displayName = (u) => { const e = empOf(u); return e ? e.name : u.username; };
  const activeYear = () => DB.years.find((y) => y.active) || DB.years[0];
  const yearFor = (d) => DB.years.find((y) => y.start <= d && d <= y.end) || null;
  const deptName = (e) => { const d = e && e.dept ? byId("depts", e.dept) : null; return d ? d.name : ""; };
  const isTmp = (e) => String(e.no).startsWith("TMP-");

  // ============================================================ قواعد العمل
  function earned(hours, hpd) { if (hpd <= 0) return [0, 0]; const q = Math.round((hours / hpd) * 1e9) / 1e9; const d = Math.floor(q); return [d, Math.round((hours - d * hpd) * 100) / 100]; }
  function balance(empId, year) {
    const bal = DB.balances.find((b) => b.emp === empId && b.year === year.id);
    let base = 0;
    if (year.mode !== "earned") base = bal && bal.base != null && bal.base !== "" ? Number(bal.base) : year.base;
    const adj = bal ? Number(bal.adj || 0) : 0;
    const tk = DB.tasks.filter((t) => t.emp === empId && t.year === year.id);
    const ah = tk.filter((t) => t.status === "approved").reduce((s, t) => s + t.hours, 0);
    const ph = tk.filter((t) => t.status === "pending").reduce((s, t) => s + t.hours, 0);
    const [ed, rem] = earned(ah, year.hpd);
    const rq = DB.reqs.filter((r) => r.emp === empId && r.year === year.id);
    const used = rq.filter((r) => r.status === "approved").length;
    const pend = rq.filter((r) => r.status === "pending").length;
    const e = year.mode === "fixed" ? 0 : ed;
    const total = base + e + adj;
    return { base, adj, ah, ph, earned: e, rem: year.mode === "fixed" ? 0 : rem, used, pend, total, remaining: total - used, available: total - used - pend, hpd: year.hpd, mode: year.mode,
      taken: rq.filter((r) => r.status === "approved" && r.date < todayISO()).length };
  }
  const stateBadge = (b) => b.remaining < 0 ? '<span class="badge err">⚠ تجاوز الرصيد</span>' : b.remaining === 0 ? '<span class="badge muted">نفد الرصيد</span>' : '<span class="badge ok">متبقي رصيد</span>';
  const isDirectMgr = (u, e) => !!(u.emp && e.mgr === u.emp);
  function canView(u, e) { if (["admin", "officer", "viewer"].includes(u.role)) return true; if (u.emp === e.id) return true; return u.role === "manager" && isDirectMgr(u, e); }
  function canDecide(u, e, enteredBy) { if (u.emp === e.id) return false; if (enteredBy && enteredBy === u.id) return false; if (u.role === "admin") return true; return u.role === "manager" && isDirectMgr(u, e); }
  function visibleEmps(u, inactive) {
    let list = DB.emps.filter((e) => canView(u, e));
    if (!inactive) list = list.filter((e) => e.active);
    return list.sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }
  function openYear(y) { if (!y) throw new RuleError("التاريخ لا يقع ضمن أي سنة معرّفة في النظام."); if (y.locked) throw new RuleError("السنة " + y.name + " مقفلة ولا تقبل حركات جديدة."); return y; }
  function validateTask(e, d, hours, hasAtt) {
    if (!e.active) throw new RuleError("الموظف غير نشط.");
    const y = openYear(yearFor(d));
    if (hours == null || hours <= 0) throw new RuleError("أدخل عدد ساعات أكبر من صفر.");
    if (hours > y.maxh) throw new RuleError("الحد الأقصى لساعات المهمة الواحدة " + n(y.maxh) + " ساعة.");
    if (!y.allowFuture && d > todayISO()) throw new RuleError("لا يمكن تسجيل مهمة بتاريخ مستقبلي.");
    if (y.reqTaskAtt && !hasAtt) throw new RuleError("إرفاق ملف (PDF) إلزامي للمهام وفق إعدادات السنة.");
    return y;
  }
  function validateRest(e, d, hasAtt, extraPending) {
    if (!e.active) throw new RuleError("الموظف غير نشط.");
    const y = openYear(yearFor(d));
    if (y.blockWeekends && y.weekend.includes(weekday(d))) throw new RuleError("التاريخ " + d + " يوافق " + WD[weekday(d)] + " (عطلة نهاية الأسبوع).");
    const hol = DB.holidays.find((x) => x.day === d);
    if (hol) throw new RuleError("التاريخ " + d + " يوافق عطلة رسمية: " + hol.name + ".");
    if (DB.reqs.some((r) => r.emp === e.id && r.date === d && ["pending", "approved"].includes(r.status))) throw new RuleError("يوجد طلب فعّال لنفس الموظف في التاريخ " + d + " (تاريخ مكرر).");
    if (y.reqReqAtt && !hasAtt) throw new RuleError("إرفاق ملف التوصية (PDF) إلزامي وفق إعدادات السنة.");
    const b = balance(e.id, y);
    if (b.available - (extraPending || 0) <= 0) throw new RuleError("لا يوجد رصيد متاح (المتبقي " + b.remaining + "، والمعلّق " + b.pend + ").");
    return y;
  }
  function decideTask(u, t, action, note) {
    const e = byId("emps", t.emp);
    if (t.status !== "pending") throw new RuleError("تم البت في هذه المهمة مسبقاً.");
    if (!canDecide(u, e, t.enteredBy)) throw new RuleError("الاعتماد من صلاحية المدير المباشر للموظف، ولا يعتمد أحد ما أدخله بنفسه.");
    if (byId("years", t.year).locked) throw new RuleError("السنة مقفلة.");
    if (action === "reject" && !note) throw new RuleError("اذكر سبب الرفض.");
    t.status = action === "approve" ? "approved" : "rejected"; t.decidedBy = u.id; t.decidedAt = nowStr(); t.note = note || "";
    audit("task_" + t.status, "task", t.id, { note });
  }
  function decideReq(u, r, action, note) {
    const e = byId("emps", r.emp);
    if (r.status !== "pending") throw new RuleError("تم البت في هذا الطلب مسبقاً.");
    if (!canDecide(u, e, r.requestedBy)) throw new RuleError("الاعتماد من صلاحية المدير المباشر للموظف، ولا يعتمد أحد طلباً قدّمه بنفسه.");
    const y = openYear(byId("years", r.year));
    if (action === "approve") { if (balance(e.id, y).remaining <= 0) throw new RuleError("اعتماد هذا الطلب يتجاوز رصيد الموظف."); }
    else if (!note) throw new RuleError("اذكر سبب الرفض.");
    r.status = action === "approve" ? "approved" : "rejected"; r.decidedBy = u.id; r.decidedAt = nowStr(); r.note = note || "";
    audit("request_" + r.status, "rest_day_request", r.id, { note });
  }
  function cancelReq(u, r, note) {
    const e = byId("emps", r.emp);
    const allowed = EDITORS.includes(u.role) || (u.role === "manager" && canDecide(u, e, null)) || (u.emp === r.emp && r.status === "pending");
    if (!allowed) throw new RuleError("ليست لديك صلاحية لإلغاء هذا الطلب.");
    const y = openYear(byId("years", r.year));
    if (!["pending", "approved"].includes(r.status)) throw new RuleError("لا يمكن إلغاء هذا الطلب في حالته الحالية.");
    if (r.status === "approved" && r.date < todayISO() && !y.allowLateCancel && u.role !== "admin") throw new RuleError("لا يمكن إلغاء يوم بعد مرور تاريخه (يتطلب صلاحية الأدمن).");
    if (r.status === "approved" && !note) throw new RuleError("اذكر سبب إلغاء يوم معتمد.");
    const prev = r.status;
    r.status = "cancelled"; r.note = note || "ألغي"; r.decidedBy = u.id; r.decidedAt = nowStr();
    audit("request_cancelled", "rest_day_request", r.id, { previous: prev, note });
    return prev;
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
  const ASSET_V = "4";
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
    const sg = parts().seg;
    const p = "#/" + (!sg.length || sg[0] === "login" ? (u.role === "employee" ? "me" : "dashboard") : sg.join("/"));
    const item = (href, label, icon) => `<li><a href="${href}" title="${label}" ${p === href ? 'aria-current="page"' : ""}>${ico(icon)}<span class="lbl">${label}</span></a></li>`;
    const nav = [
      u.emp ? item("#/me", "كشف رصيدي", "idcard") : "",
      STAFF.includes(u.role) ? `<li class="sep">المتابعة</li>${item("#/dashboard", "لوحة المؤشرات", "dashboard")}${item("#/employees", "الموظفون والأرصدة", "users")}${["admin", "manager"].includes(u.role) ? item("#/approvals", "الاعتمادات", "approvals") : ""}${item("#/reports", "التقارير", "reports")}` : "",
      `<li class="sep">الحركات</li>${item("#/tasks", "المهام والساعات", "clock")}${item("#/requests", "أيام بدل الراحة", "calendar")}`,
      EDITORS.includes(u.role) ? item("#/tasks/new", "تسجيل ساعات", "clock-plus") : "",
      EDITORS.includes(u.role) || (y.empCanRequest && u.emp) ? item("#/requests/new", "طلب يوم بدل راحة", "calendar-plus") : "",
      u.role === "admin" ? `<li class="sep">الإدارة</li>${item("#/admin/years", "السنوات وقواعد الحساب", "gear")}${item("#/admin/import", "استيراد الموظفين", "upload")}${item("#/admin/users", "المستخدمون والصلاحيات", "shield")}${item("#/admin/depts", "الأقسام", "building")}${item("#/admin/holidays", "العطل الرسمية", "holiday")}${item("#/admin/settings", "هوية الجهة", "palette")}${item("#/admin/audit", "سجل التدقيق", "audit")}` : "",
    ].join("");
    const fl = flashQ.map(([k, m]) => `<div class="alert ${k}" role="${k === "error" ? "alert" : "status"}">${h(m)}</div>`).join("");
    flashQ = [];
    const s = DB.settings;
    return `<a class="skip" href="#main">تخطَّ إلى المحتوى</a>
<div class="layout">
  <aside class="sidebar" id="sidebar" aria-label="القائمة الرئيسية">
    <div class="brand"><div class="mark" aria-hidden="true"><img class="logo-img" src="assets/logo.svg?v=${ASSET_V}" alt="" width="40" height="40"></div><div><b class="wordmark">${h(s.system_title)}</b><small>${h(s.university)} · ${h(s.college)}</small></div></div>
    <ul class="nav">${nav}</ul>
  </aside>
  <div class="main">
    ${bannerHidden() ? "" : `<div class="demo-banner" role="note"><span>نسخة عرض: البيانات محفوظة في متصفحك فقط ولا تُشارك مع أحد. لا تُدخل بيانات حقيقية.</span> <button class="btn sm" data-act="reset" type="button">استعادة بيانات العرض</button><button class="banner-x" data-act="hideBanner" type="button" aria-label="إخفاء الشريط" title="إخفاء الشريط">×</button></div>`}
    <header class="topbar">
      <button class="btn ghost menu-btn icon-btn" type="button" data-menu aria-controls="sidebar" aria-expanded="false">☰ <span class="sr-only">القائمة</span></button>
      <span class="t-logo" aria-hidden="true"><img src="assets/logo.svg?v=${ASSET_V}" alt="" width="30" height="30"><b>${h(DB.settings.system_title)}</b></span>
      <span class="title">${h(title)}</span><span class="spacer"></span>
      <span class="badge muted">السنة ${h(y.name)}${y.locked ? " · مقفلة" : ""}</span>
      <button class="btn ghost icon-btn theme-top" type="button" data-theme-toggle aria-label="تبديل الوضع الداكن" title="الوضع الداكن/الفاتح">${ico("moon")}<span class="sr-only">الوضع</span></button>
      <details class="acct">
        <summary class="btn ghost" aria-label="حساب ${h(displayName(u))}"><span class="avatar" aria-hidden="true">${h(displayName(u).slice(0, 1))}</span><span class="acct-name">${h(displayName(u))}</span></summary>
        <div class="acct-menu">
          <div class="who-full"><b>${h(displayName(u))}</b><small>${ROLES[u.role]}</small></div>
          <button class="btn" type="button" data-theme-toggle>${ico("moon")}الوضع الداكن/الفاتح</button>
          <a class="btn" href="#/password">${ico("shield")}كلمة المرور</a>
          ${bannerHidden() ? `<button class="btn" type="button" data-act="showBanner">${ico("palette")}إظهار شريط نسخة العرض</button>` : ""}
          <button class="btn" type="button" data-act="reset">${ico("adjust")}استعادة بيانات العرض</button>
          <button class="btn logout" type="button" data-act="logout">${ico("logout")}خروج</button>
        </div>
      </details>
    </header>
    <main id="main" class="content" tabindex="-1">${fl}${body}</main>
    <footer class="footer">© ${new Date().getFullYear()} ${h(s.university)} – ${h(s.college)} · ${h(s.system_title)}${s.credit ? " · " + h(s.credit) : ""}</footer>
  </div>
</div>`;
  }
  const statusBadge = (s, label) => `<span class="badge ${{ approved: "ok", pending: "warn", rejected: "err", cancelled: "muted" }[s] || ""}">${h(label)}</span>`;
  const reqLabel = (r) => (r.status === "approved" && r.date < todayISO() ? "تم التمتع" : REQ_ST[r.status]);
  const yearSelect = (sel, name) => `<div class="field"><label for="ysel">السنة</label><select id="ysel" name="${name || "year"}" data-yearnav>${DB.years.slice().sort((a, b) => b.start.localeCompare(a.start)).map((y) => `<option value="${y.id}" ${y.id === sel.id ? "selected" : ""}>${h(y.name)}${y.active ? " (النشطة)" : ""}${y.locked ? " – مقفلة" : ""}</option>`).join("")}</select></div>`;
  const pickYear = (q) => (q.get("year") && byId("years", q.get("year"))) || activeYear();
  const empOptions = (list, sel, ph) => `<option value="">${ph || "— اختر الموظف —"}</option>` + list.map((e) => `<option value="${e.id}" ${String(sel) === String(e.id) ? "selected" : ""}>${h(e.name)} (${h(e.no)})</option>`).join("");

  // ---------------------------------------------------------- الشاشات
  const V = {};

  V.login = () => {
    const s = DB.settings;
    const accts = [["admin", "مدير النظام"], ["officer", "مسؤول الإدخال"], ["mgr", "مدير مباشر"], ["viewer", "متابع"], ["emp", "موظف"]];
    const SV = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
    return `<div class="gate">
  <div class="gate-strip" aria-hidden="true"></div>
  <main class="gate-main"><div class="gate-grid">
    <section class="gate-card" aria-labelledby="login-title">
      <button class="btn ghost icon-btn card-theme" type="button" data-theme-toggle aria-label="تبديل الوضع الداكن" title="الوضع الداكن/الفاتح">${ico("moon")}<span class="sr-only">الوضع</span></button>
      <span class="demo-tag" role="note">نسخة عرض — ليست النظام الفعلي</span>
      <div class="card-brand"><img class="logo-img" src="assets/logo.svg?v=${ASSET_V}" alt="" width="64" height="64"><div><b class="wordmark">${h(s.system_title)}</b><small>${h(s.tagline)}</small></div></div>
      <h1 id="login-title" class="login-h">تسجيل الدخول</h1>
      <p class="sub">أدخل بيانات حسابك للوصول إلى نظام ${h(s.system_title)}.</p>
      ${flashQ.splice(0).map(([k, m]) => `<div class="alert ${k}" role="alert">${h(m)}</div>`).join("")}
      <form data-form="login" novalidate>
        <div class="field"><label for="u">اسم المستخدم</label><div class="input-icon">${SV('<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5"/>')}<input id="u" name="username" type="text" autocomplete="username" required autofocus></div></div>
        <div class="field"><label for="p">كلمة المرور</label><div class="input-icon">${SV('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>')}<input id="p" name="password" type="password" autocomplete="current-password" required></div></div>
        <button class="btn primary block lg" type="submit">دخول</button>
      </form>
      <p class="gate-help">${SV('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>')}<span><b>نسيت كلمة المرور؟</b> تواصل مع مدير النظام في الكلية لإعادة تعيينها.</span></p>
      <div class="demo-accounts" role="group" aria-labelledby="demo-title">
        <div class="head"><b id="demo-title">حسابات تجريبية</b><span class="muted">كلمة المرور <code>${DEMO_PW}</code></span></div>
        <div class="list">${accts.map(([u, l]) => `<button class="btn sm" type="button" data-demo-login="${u}">${l}</button>`).join("")}</div>
        <p class="hint">البيانات وهمية ومحفوظة في هذا المتصفح فقط.</p>
      </div>
      <div class="card-foot">
        <button class="about-link" type="button" data-open-dialog="about-dlg" aria-haspopup="dialog">${SV('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>')}عن النظام</button>
        <p class="card-credit"><span>جميع الحقوق محفوظة © ${new Date().getFullYear()}</span>${s.credit ? `<span>${h(s.credit)}</span>` : ""}</p>
      </div>
    </section>
    <section class="gate-intro" aria-labelledby="intro-title">
      <span class="eyebrow">نظام داخلي · ${h(s.college)}</span>
      <h2 id="intro-title">${h(s.tagline)}</h2>
      <svg class="gate-hero" role="img" aria-label="رسم توضيحي: تقويم وساعة وبطاقة اعتماد"><use href="${HERO_INLINE ? "" : "assets/hero.svg?v=" + ASSET_V}#hero"/></svg>
      <p class="lead">منصة داخلية لمنسوبي ${h(s.college)} في ${h(s.university)} لإدارة أيام بدل الراحة: من تسجيل ساعات العمل حتى اعتماد الطلبات وإصدار الكشوف.</p>
      <ul class="gate-features">
        <li><span class="ico" aria-hidden="true">${ico("clock")}</span><div><b>تسجيل المهام والساعات</b><span>توثيق ساعات العمل الإضافية واحتساب الأيام المستحقة آلياً.</span></div></li>
        <li><span class="ico" aria-hidden="true">${ico("approvals")}</span><div><b>اعتماد الطلبات إلكترونياً</b><span>رفع طلبات التمتع واعتمادها من المدير المباشر مع سجل تدقيق.</span></div></li>
        <li><span class="ico" aria-hidden="true">${ico("idcard")}</span><div><b>كشوف أرصدة رسمية</b><span>كشف سنوي لكل موظف جاهز للطباعة والحفظ بصيغة PDF.</span></div></li>
      </ul>
    </section>
  </div></main>
</div>
<dialog id="about-dlg" class="about-dlg" aria-labelledby="about-title">
  <form method="dialog" class="about-head"><h2 id="about-title">عن نظام «${h(s.system_title)}»</h2><button class="btn ghost icon-btn" value="close" aria-label="إغلاق">×</button></form>
  ${aboutHTML(s)}
</dialog>`;
  };

  V.password = (u) => layout(u, "تغيير كلمة المرور", `<div class="card" style="max-width:480px">
    ${u.mustChange ? '<div class="alert info">يجب تعيين كلمة مرور جديدة قبل المتابعة.</div>' : ""}
    <form data-form="password">
      <div class="field"><label for="c">كلمة المرور الحالية</label><input id="c" type="password" name="current" required></div>
      <div class="field"><label for="nw">كلمة المرور الجديدة <span class="hint">(8 أحرف على الأقل، أحرف وأرقام)</span></label><input id="nw" type="password" name="new" required></div>
      <div class="field"><label for="cf">تأكيد كلمة المرور</label><input id="cf" type="password" name="confirm" required></div>
      <button class="btn primary">حفظ</button></form></div>`);

  V.dashboard = (u, q) => {
    need(u, STAFF);
    const y = pickYear(q);
    const emps = visibleEmps(u);
    const T = { employees: emps.length, total: 0, used: 0, remaining: 0, pending: 0, earned: 0, hours: 0, exhausted: 0, tmp: 0 };
    const dept = {};
    const alerts = [];
    emps.forEach((e) => {
      const b = balance(e.id, y);
      T.total += b.total; T.used += b.used; T.remaining += b.remaining; T.pending += b.pend; T.earned += b.earned; T.hours += b.ah;
      if (b.remaining <= 0) T.exhausted++;
      if (isTmp(e)) T.tmp++;
      if (b.remaining < 0) alerts.push(e);
      const k = deptName(e) || "بدون قسم";
      dept[k] = dept[k] || { count: 0, total: 0, used: 0, remaining: 0 };
      dept[k].count++; dept[k].total += b.total; dept[k].used += b.used; dept[k].remaining += b.remaining;
    });
    const ids = new Set(emps.map((e) => e.id));
    const monthly = Array(12).fill(0);
    DB.reqs.filter((r) => r.year === y.id && r.status === "approved" && ids.has(r.emp)).forEach((r) => monthly[Number(r.date.slice(5, 7)) - 1]++);
    const mx = Math.max(1, ...monthly);
    const months = ["ينا", "فبر", "مار", "أبر", "ماي", "يون", "يول", "أغس", "سبت", "أكت", "نوف", "ديس"];
    let pt = 0, pr = 0;
    if (["admin", "manager"].includes(u.role)) {
      pt = DB.tasks.filter((t) => t.status === "pending" && ids.has(t.emp) && canDecide(u, byId("emps", t.emp), t.enteredBy)).length;
      pr = DB.reqs.filter((r) => r.status === "pending" && ids.has(r.emp) && canDecide(u, byId("emps", r.emp), r.requestedBy)).length;
    }
    const rows = Object.entries(dept).sort((a, b) => b[1].used - a[1].used);
    return layout(u, "لوحة المؤشرات", `
      <div class="page-head"><div><h1>لوحة المؤشرات</h1><p>${u.role === "manager" ? "فريقك المباشر" : "جميع الموظفين"} · السنة ${h(y.name)} · طريقة الاحتساب: ${{ fixed: "ثابت", earned: "مكتسب", mixed: "مختلط" }[y.mode]}</p></div>
        <form class="filters no-print">${yearSelect(y)}</form></div>
      ${pt || pr ? `<div class="alert warn" role="status">لديك ${pt} مهمة و${pr} طلب بانتظار اعتمادك. <a href="#/approvals">اذهب إلى الاعتمادات</a></div>` : ""}
      <div class="grid kpis">
        <div class="kpi brand">${ico("users")}<div class="l">إجمالي الموظفين</div><div class="v">${T.employees}</div>${T.tmp ? `<div class="s">${T.tmp} برقم وظيفي مؤقت</div>` : ""}</div>
        <div class="kpi accent">${ico("calendar")}<div class="l">إجمالي أيام البدل</div><div class="v">${T.total}</div><div class="s">منها ${T.earned} مكتسبة من ${n(T.hours)} ساعة</div></div>
        <div class="kpi ok">${ico("cal-check")}<div class="l">الأيام المعتمدة (المستهلكة)</div><div class="v">${T.used}</div></div>
        <div class="kpi warn">${ico("hourglass")}<div class="l">طلبات معلّقة</div><div class="v">${T.pending}</div></div>
        <div class="kpi">${ico("pie")}<div class="l">إجمالي الأيام المتبقية</div><div class="v">${T.remaining}</div><div class="s">${T.exhausted} موظف نفد رصيده</div></div>
      </div>
      <div class="grid two">
        <section class="card"><h2>الأيام المعتمدة حسب الشهر</h2>
          <div class="bars" role="img" aria-label="رسم الأيام المعتمدة لكل شهر">${monthly.map((v, i) => `<div class="bar"><b>${v || ""}</b><span style="height:${Math.round((v / mx) * 100)}%"></span><small>${months[i]}</small></div>`).join("")}</div></section>
        <section class="card flush"><h2>حسب القسم</h2><div class="table-wrap"><table class="responsive">
          <thead><tr><th>القسم</th><th class="n">موظفون</th><th class="n">الرصيد</th><th class="n">مستهلك</th><th class="n">متبقٍ</th></tr></thead><tbody>
          ${rows.map(([k, d]) => `<tr><td data-label="القسم">${h(k)}</td><td class="n" data-label="موظفون">${d.count}</td><td class="n" data-label="الرصيد">${d.total}</td><td class="n" data-label="مستهلك">${d.used}</td><td class="n" data-label="متبقٍ">${d.remaining}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">لا توجد بيانات.</td></tr>'}
          </tbody></table></div></section>
      </div>
      ${alerts.length ? `<section class="card"><h2>تنبيهات</h2><ul>${alerts.map((e) => `<li><a href="#/employee/${e.id}">${h(e.name)}</a> — تجاوز الرصيد</li>`).join("")}</ul></section>` : ""}
      <section class="card"><h2>بحث سريع عن موظف</h2><form class="filters" data-form="quicksearch"><div class="field grow"><label for="qs">الاسم أو جزء منه، أو الرقم الوظيفي</label><input id="qs" type="search" name="q"></div><button class="btn primary">بحث</button></form></section>`);
  };

  function statement(u, e, y, selfView) {
    const b = balance(e.id, y);
    const reqs = DB.reqs.filter((r) => r.emp === e.id && r.year === y.id).sort((a, c) => c.date.localeCompare(a.date));
    const tasks = DB.tasks.filter((t) => t.emp === e.id && t.year === y.id).sort((a, c) => c.date.localeCompare(a.date));
    const bal = DB.balances.find((x) => x.emp === e.id && x.year === y.id);
    const mgr = e.mgr ? byId("emps", e.mgr) : null;
    const pct = b.hpd > 0 ? Math.round((b.rem / b.hpd) * 100) : 0;
    const canReq = EDITORS.includes(u.role) || (selfView && y.empCanRequest);
    return layout(u, selfView ? "كشف رصيدي" : "كشف موظف", `
      <div class="page-head"><div><h1>${h(e.name)}</h1><p>${h(deptName(e) || "بدون قسم")}${e.title ? " · " + h(e.title) : ""}</p></div>
        <div class="actions no-print"><form class="filters">${yearSelect(y)}</form>
          <a class="btn" href="#/print/${e.id}?year=${y.id}">طباعة كشف رسمي</a>
          ${EDITORS.includes(u.role) ? `<a class="btn" href="#/employee/${e.id}/edit">تعديل البيانات</a><a class="btn" href="#/tasks/new?emp=${e.id}">تسجيل ساعات</a>` : ""}
          ${canReq ? `<a class="btn primary" href="#/requests/new?emp=${e.id}">طلب يوم بدل راحة</a>` : ""}</div></div>
      <section class="card"><div class="stmt-head"><dl>
        <dt>الرقم الوظيفي</dt><dd>${h(e.no)}${isTmp(e) ? ' <span class="badge warn">مؤقت</span>' : ""}</dd>
        <dt>المدير المباشر</dt><dd>${mgr ? h(mgr.name) : "— غير محدد —"}</dd>
        <dt>حالة الرصيد</dt><dd>${stateBadge(b)}</dd></dl>
        ${b.mode !== "fixed" ? `<div style="min-width:240px"><div class="muted">التقدم نحو اليوم التالي</div><div class="meter"><div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div><span class="num">${n(b.rem)}/${n(b.hpd)}</span></div><div class="hint">متبقٍ ${hoursAr(b.hpd - b.rem)} لاستحقاق يوم جديد</div></div>` : ""}
      </div></section>
      <div class="grid kpis">
        ${b.mode !== "earned" ? `<div class="kpi brand">${ico("calendar")}<div class="l">الرصيد الأساسي</div><div class="v">${b.base}</div></div>` : ""}
        ${b.mode !== "fixed" ? `<div class="kpi accent">${ico("clock")}<div class="l">الأيام المكتسبة من الساعات</div><div class="v">${b.earned}</div><div class="s">من ${n(b.ah)} ساعة معتمدة${b.ph ? " · " + n(b.ph) + " بانتظار الاعتماد" : ""}</div></div>` : ""}
        ${b.adj ? `<div class="kpi">${ico("adjust")}<div class="l">تسوية</div><div class="v">${b.adj > 0 ? "+" : ""}${b.adj}</div></div>` : ""}
        <div class="kpi ok">${ico("cal-check")}<div class="l">الأيام التي تمتع بها/المعتمدة</div><div class="v">${b.used}</div></div>
        <div class="kpi warn">${ico("hourglass")}<div class="l">طلبات معلّقة</div><div class="v">${b.pend}</div></div>
        <div class="kpi ${b.remaining < 0 ? "err" : ""}">${ico("pie")}<div class="l">الرصيد المتبقي</div><div class="v">${b.remaining}</div><div class="s">المتاح للطلب: ${b.available}</div></div>
      </div>
      <p class="summary-line">إجمالي الرصيد: ${daysAr(b.total)}. الأيام التي تمتع بها: ${daysAr(b.used)}. الرصيد المتبقي: ${daysAr(b.remaining)}.</p>
      <section class="card flush mt"><h2>أيام بدل الراحة</h2>${reqTable(u, reqs, false)}</section>
      ${b.mode !== "fixed" || tasks.length ? `<section class="card flush"><h2>المهام والساعات</h2>${taskTable(u, tasks, false)}</section>` : ""}
      ${u.role === "admin" && !y.locked ? `<section class="card no-print"><details class="disclose"><summary>رصيد خاص / تسوية لهذه السنة (الأدمن)</summary>
        <form class="mt" data-form="balance" data-emp="${e.id}" data-year="${y.id}"><div class="form-grid">
          <div class="field"><label for="bo">رصيد أساسي خاص <span class="hint">(فارغ = الافتراضي ${y.base})</span></label><input id="bo" type="number" name="base" value="${bal && bal.base != null ? h(bal.base) : ""}"></div>
          <div class="field"><label for="ad">تسوية (+/− أيام)</label><input id="ad" type="number" name="adj" value="${bal ? h(bal.adj) : 0}"></div>
          <div class="field"><label for="ar">السبب (إلزامي)</label><input id="ar" type="text" name="reason" value="${bal ? h(bal.reason) : ""}"></div>
        </div><button class="btn">حفظ الرصيد</button></form></details></section>` : ""}`);
  }

  function reqTable(u, rows, withEmp) {
    return `<div class="table-wrap"><table class="responsive"><thead><tr><th>م</th>${withEmp ? "<th>اسم الموظف</th><th>الرقم الوظيفي</th>" : ""}<th>التاريخ</th><th>الحالة</th><th>ملف التوصية</th><th>ملاحظات</th><th class="no-print">إجراء</th></tr></thead><tbody>
      ${rows.map((r, i) => { const e = byId("emps", r.emp); const canCancel = r.status === "pending" || (r.status === "approved" && ["admin", "officer", "manager"].includes(u.role) && u.emp !== r.emp);
        return `<tr class="${["cancelled", "rejected"].includes(r.status) ? "muted" : ""}"><td data-label="م">${i + 1}</td>
        ${withEmp ? `<td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a></td><td data-label="الرقم" class="num">${h(e.no)}</td>` : ""}
        <td data-label="التاريخ" class="num">${r.date} <span class="hint">${WD[weekday(r.date)]}</span></td><td data-label="الحالة">${statusBadge(r.status, reqLabel(r))}</td>
        <td data-label="ملف التوصية">${r.att ? "📎 " + h(r.att) : ""}</td><td data-label="ملاحظات">${h(r.notes)}${r.note ? `<div class="hint">${h(r.note)}</div>` : ""}</td>
        <td data-label="إجراء" class="no-print">${canCancel ? `<button class="btn sm danger" type="button" data-act="cancel-req" data-id="${r.id}" data-need-note="${r.status === "approved" ? 1 : ""}">إلغاء</button>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="${withEmp ? 8 : 6}" class="empty">لا توجد سجلات.</td></tr>`}
      </tbody></table></div>`;
  }
  function taskTable(u, rows, withEmp) {
    return `<div class="table-wrap"><table class="responsive"><thead><tr><th>م</th>${withEmp ? "<th>اسم الموظف</th>" : ""}<th>التاريخ</th><th>وصف المهمة</th><th class="n">الساعات</th><th>الحالة</th><th>مرفق</th>${withEmp ? "<th>إجراء</th>" : ""}</tr></thead><tbody>
      ${rows.map((t, i) => { const e = byId("emps", t.emp); return `<tr class="${t.status === "rejected" ? "muted" : ""}"><td data-label="م">${i + 1}</td>
        ${withEmp ? `<td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a></td>` : ""}
        <td data-label="التاريخ" class="num">${t.date}</td><td data-label="الوصف">${h(t.desc)}${t.notes ? `<div class="hint">${h(t.notes)}</div>` : ""}${t.note ? `<div class="hint">القرار: ${h(t.note)}</div>` : ""}</td>
        <td class="n" data-label="الساعات">${n(t.hours)}</td><td data-label="الحالة">${statusBadge(t.status, TASK_ST[t.status])}</td><td data-label="مرفق">${t.att ? "📎 " + h(t.att) : ""}</td>
        ${withEmp ? `<td data-label="إجراء">${t.status === "pending" && EDITORS.includes(u.role) ? `<button class="btn sm danger" type="button" data-act="withdraw-task" data-id="${t.id}">سحب</button>` : ""}</td>` : ""}</tr>`; }).join("") || `<tr><td colspan="${withEmp ? 8 : 6}" class="empty">لا توجد مهام.</td></tr>`}
      </tbody></table></div>`;
  }

  V.me = (u, q) => { const e = empOf(u); if (!e) { if (u.role === "employee") throw new Forbidden("حسابك غير مرتبط بسجل موظف."); go("#/dashboard"); return ""; } return statement(u, e, pickYear(q), true); };
  V.employee = (u, q, seg) => {
    if (seg[1] === "new") { need(u, EDITORS); return empForm(u, null); }
    const e = byId("emps", seg[1]);
    if (!e) throw new Forbidden("الموظف غير موجود.");
    if (seg[2] === "edit") { need(u, EDITORS); return empForm(u, e); }
    if (!canView(u, e)) throw new Forbidden("ليست لديك صلاحية لعرض بيانات هذا الموظف.");
    return statement(u, e, pickYear(q), u.emp === e.id);
  };

  V.print = (u, q, seg) => {
    const e = byId("emps", seg[1]);
    if (!e || !canView(u, e)) throw new Forbidden("ليست لديك صلاحية.");
    const y = pickYear(q), b = balance(e.id, y), s = DB.settings, mgr = e.mgr ? byId("emps", e.mgr) : null;
    const ap = DB.reqs.filter((r) => r.emp === e.id && r.year === y.id && r.status === "approved").sort((a, c) => a.date.localeCompare(c.date));
    document.body.className = "print-page";
    return `<div class="actions no-print" style="justify-content:center;padding:1rem"><button class="btn primary" type="button" data-print>طباعة / حفظ PDF</button><a class="btn" href="#/employee/${e.id}?year=${y.id}">رجوع</a></div>
    <article class="official"><header><div><h1>${h(s.university)}</h1><div>${h(s.college)}</div><div>${h(s.system_title)}</div></div>
      <div class="meta">الرقم المرجعي: BR-${h(y.name)}-${h(e.no)}<br>تاريخ الإصدار: ${todayISO()}<br>السنة: ${h(y.name)}</div></header>
      <h2 style="text-align:center">كشف أيام بدل الراحة لموظف</h2>
      <table><tbody><tr><th>اسم الموظف</th><td>${h(e.name)}</td><th>الرقم الوظيفي</th><td>${h(e.no)}</td></tr><tr><th>القسم</th><td>${h(deptName(e))}</td><th>المدير المباشر</th><td>${mgr ? h(mgr.name) : ""}</td></tr></tbody></table>
      <table class="mt"><thead><tr>${b.mode !== "earned" ? "<th>الرصيد الأساسي</th>" : ""}${b.mode !== "fixed" ? "<th>الساعات المعتمدة</th><th>الأيام المكتسبة</th>" : ""}${b.adj ? "<th>تسوية</th>" : ""}<th>إجمالي الرصيد</th><th>الأيام التي تمتع بها</th><th>الرصيد المتبقي</th></tr></thead>
      <tbody><tr>${b.mode !== "earned" ? `<td>${b.base}</td>` : ""}${b.mode !== "fixed" ? `<td>${n(b.ah)}</td><td>${b.earned}</td>` : ""}${b.adj ? `<td>${b.adj}</td>` : ""}<td>${b.total}</td><td>${b.used}</td><td><b>${b.remaining}</b></td></tr></tbody></table>
      <p>إجمالي الرصيد: ${daysAr(b.total)}. الأيام التي تمتع بها: ${daysAr(b.used)}. الرصيد المتبقي: ${daysAr(b.remaining)}.</p>
      <h3>سجل أيام بدل الراحة المعتمدة</h3><table><thead><tr><th>م</th><th>التاريخ</th><th>اليوم</th><th>الحالة</th><th>ملاحظات</th></tr></thead><tbody>
      ${ap.map((r, i) => `<tr><td>${i + 1}</td><td>${r.date}</td><td>${WD[weekday(r.date)]}</td><td>${reqLabel(r)}</td><td>${h(r.notes)}</td></tr>`).join("") || '<tr><td colspan="5" style="text-align:center">لا توجد أيام معتمدة.</td></tr>'}
      </tbody></table><div class="sign"><div>الموظف</div><div>المدير المباشر</div><div>الشؤون الإدارية</div></div></article>`;
  };

  V.employees = (u, q) => {
    need(u, STAFF);
    const y = pickYear(q), qs = (q.get("q") || "").trim(), dept = q.get("dept") || "", st = q.get("state") || "";
    let list = visibleEmps(u, st === "inactive");
    if (st === "inactive") list = list.filter((e) => !e.active);
    if (qs) list = list.filter((e) => norm(e.name).includes(norm(qs)) || String(e.no).includes(qs));
    if (dept) list = list.filter((e) => String(e.dept) === dept);
    let rows = list.map((e) => [e, balance(e.id, y)]);
    if (st === "exhausted") rows = rows.filter(([, b]) => b.remaining <= 0);
    if (st === "tmp") rows = rows.filter(([e]) => isTmp(e));
    return layout(u, "الموظفون والأرصدة", `
      <div class="page-head"><div><h1>الموظفون والأرصدة</h1><p>السنة ${h(y.name)} · ${rows.length} موظف</p></div>
        <div class="actions"><button class="btn" type="button" data-act="export" data-kind="balances" data-year="${y.id}">تصدير Excel</button>${EDITORS.includes(u.role) ? '<a class="btn primary" href="#/employee/new">+ إضافة موظف</a>' : ""}</div></div>
      <form class="card filters" data-form="filter" data-route="employees" role="search">
        <div class="field grow"><label for="q">بحث بالاسم أو جزء منه أو الرقم الوظيفي</label><input id="q" type="search" name="q" value="${h(qs)}"></div>
        <div class="field"><label for="dp">القسم</label><select id="dp" name="dept"><option value="">الكل</option>${DB.depts.map((d) => `<option value="${d.id}" ${String(d.id) === dept ? "selected" : ""}>${h(d.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="st">تصفية</label><select id="st" name="state"><option value="">النشطون</option><option value="exhausted" ${st === "exhausted" ? "selected" : ""}>نفد رصيدهم</option><option value="tmp" ${st === "tmp" ? "selected" : ""}>رقم وظيفي مؤقت</option><option value="inactive" ${st === "inactive" ? "selected" : ""}>غير النشطين</option></select></div>
        ${yearSelect(y)}<button class="btn primary">عرض</button></form>
      <div class="card flush"><div class="table-wrap"><table class="responsive"><thead><tr><th>م</th><th>اسم الموظف</th><th>الرقم الوظيفي</th><th>القسم</th><th class="n">الرصيد</th><th class="n">مكتسب</th><th class="n">تمتع</th><th class="n">معلّق</th><th class="n">المتبقي</th><th>الحالة</th></tr></thead><tbody>
      ${rows.map(([e, b], i) => `<tr><td data-label="م">${i + 1}</td><td data-label="الاسم"><a href="#/employee/${e.id}?year=${y.id}">${h(e.name)}</a></td><td data-label="الرقم" class="num">${h(e.no)}${isTmp(e) ? ' <span class="badge warn">مؤقت</span>' : ""}</td><td data-label="القسم">${h(deptName(e))}</td>
        <td class="n" data-label="الرصيد">${b.total}</td><td class="n" data-label="مكتسب">${b.earned}</td><td class="n" data-label="تمتع">${b.used}</td><td class="n" data-label="معلّق">${b.pend}</td><td class="n" data-label="المتبقي"><b>${b.remaining}</b></td><td data-label="الحالة">${stateBadge(b)}</td></tr>`).join("") || '<tr><td colspan="10" class="empty">لا توجد نتيجة.</td></tr>'}
      </tbody></table></div></div>`);
  };

  function empForm(u, e) {
    const others = DB.emps.filter((x) => x.active && (!e || x.id !== e.id)).sort((a, b) => a.name.localeCompare(b.name, "ar"));
    return layout(u, e ? "تعديل بيانات موظف" : "إضافة موظف", `<div class="page-head"><h1>${e ? h(e.name) : "إضافة موظف جديد"}</h1></div>
      <form class="card" data-form="employee" data-id="${e ? e.id : ""}"><div class="form-grid">
        <div class="field"><label for="no">الرقم الوظيفي *</label><input id="no" name="no" required value="${e ? h(e.no) : ""}"></div>
        <div class="field"><label for="nm">الاسم *</label><input id="nm" name="name" required value="${e ? h(e.name) : ""}"></div>
        <div class="field"><label for="dp">القسم</label><select id="dp" name="dept"><option value="">—</option>${DB.depts.filter((d) => d.active).map((d) => `<option value="${d.id}" ${e && e.dept === d.id ? "selected" : ""}>${h(d.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="mg">المدير المباشر <span class="hint">(يعتمد طلباته)</span></label><select id="mg" name="mgr">${empOptions(others, e ? e.mgr : "", "—")}</select></div>
        <div class="field"><label for="jt">المسمى الوظيفي</label><input id="jt" name="title" value="${e ? h(e.title) : ""}"></div>
        <div class="field"><label for="em">البريد الجامعي</label><input id="em" name="email" type="email" value="${e ? h(e.email) : ""}"></div>
      </div>${e ? `<label class="check"><input type="checkbox" name="active" value="1" ${e.active ? "checked" : ""}> على رأس العمل (نشط)</label>` : ""}
      <div class="actions"><button class="btn primary">حفظ</button><a class="btn" href="${e ? "#/employee/" + e.id : "#/employees"}">إلغاء</a></div></form>`);
  }

  function listFilters(route, u, y, q, statuses) {
    const emps = visibleEmps(u);
    return `<form class="card filters" data-form="filter" data-route="${route}">
      ${emps.length > 1 ? `<div class="field grow"><label for="fe">الموظف</label><select id="fe" name="emp">${empOptions(emps, q.get("emp") || "", "الكل")}</select></div>` : ""}
      <div class="field"><label for="fs">الحالة</label><select id="fs" name="status"><option value="">الكل</option>${Object.entries(statuses).map(([k, v]) => `<option value="${k}" ${q.get("status") === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      ${yearSelect(y)}<button class="btn primary">عرض</button></form>`;
  }

  V.tasks = (u, q, seg) => {
    if (seg[1] === "new") return taskForm(u, q);
    const y = pickYear(q);
    const ids = new Set(visibleEmps(u, true).map((e) => e.id));
    let rows = DB.tasks.filter((t) => t.year === y.id && ids.has(t.emp));
    if (q.get("status")) rows = rows.filter((t) => t.status === q.get("status"));
    if (q.get("emp")) rows = rows.filter((t) => String(t.emp) === q.get("emp"));
    rows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    return layout(u, "المهام والساعات", `<div class="page-head"><div><h1>سجل المهام والساعات</h1><p>كل ${hoursAr(y.hpd)} معتمدة = يوم بدل راحة · السنة ${h(y.name)}</p></div>
      <div class="actions">${STAFF.includes(u.role) ? `<button class="btn" type="button" data-act="export" data-kind="tasks" data-year="${y.id}">تصدير Excel</button>` : ""}${EDITORS.includes(u.role) ? '<a class="btn primary" href="#/tasks/new">+ تسجيل ساعات</a>' : ""}</div></div>
      ${listFilters("tasks", u, y, q, TASK_ST)}<div class="card flush">${taskTable(u, rows, true)}</div>`);
  };

  function taskRow(i, r, emps) {
    return `<tr class="${r.error ? "has-err" : ""}"><td class="idx" data-label="صف">${i + 1}</td><td data-label="اسم الموظف"><select name="emp" aria-label="الموظف">${empOptions(emps, r.emp)}</select></td>
      <td data-label="تاريخ المهمة"><input type="date" name="date" value="${h(r.date)}" aria-label="تاريخ المهمة"></td><td data-label="وصف المهمة"><input type="text" name="desc" value="${h(r.desc)}" aria-label="وصف المهمة"></td>
      <td style="width:90px" data-label="الساعات"><input type="number" step="0.25" min="0" name="hours" value="${h(r.hours)}" aria-label="الساعات"></td><td data-label="ملاحظات"><input type="text" name="notes" value="${h(r.notes)}" aria-label="ملاحظات"></td>
      <td data-label="مرفق (PDF)"><input type="file" name="file" accept="application/pdf" aria-label="مرفق PDF"></td><td data-label="التحقق"><span class="chk ${r.error ? "bad" : ""}" aria-live="polite">${h(r.error || "")}</span></td></tr>`;
  }
  let taskDraft = null;
  function taskForm(u, q) {
    need(u, EDITORS);
    const emps = visibleEmps(u), y = activeYear();
    const rows = taskDraft || [{ emp: q.get("emp") || "" }, {}, {}, {}, {}];
    const err = taskDraft ? "بعض الصفوف تحتوي على أخطاء، صحّحها ثم أعد الحفظ. لم يُحفظ أي صف." : "";
    taskDraft = null;
    return layout(u, "تسجيل المهام والساعات", `<div class="page-head"><div><h1>تسجيل المهام والساعات</h1>
      <p>أدخل صفاً لكل مهمة. تُرسل المهام إلى <b>المدير المباشر</b> للاعتماد، وتُحتسب الأيام بعد الاعتماد (كل ${hoursAr(y.hpd)} = يوم).${y.reqTaskAtt ? " <b>إرفاق PDF إلزامي.</b>" : ""}</p></div></div>
      ${err ? `<div class="alert error" role="alert">${err}</div>` : ""}
      <form class="card" data-form="tasks"><div class="table-wrap"><table class="entry-grid" id="entry"><thead><tr><th>م</th><th>اسم الموظف</th><th>تاريخ المهمة</th><th>وصف المهمة</th><th>الساعات</th><th>ملاحظات</th><th>مرفق (PDF)</th><th>التحقق</th></tr></thead>
      <tbody>${rows.map((r, i) => taskRow(i, r, emps)).join("")}</tbody></table></div>
      <template id="row-tpl">${taskRow(0, {}, emps)}</template>
      <div class="actions mt"><button class="btn" type="button" data-add-row>+ إضافة صف</button><label class="check" style="margin:0"><input type="checkbox" name="allow_dup" value="1"> السماح بمهمة مطابقة لمهمة مسجلة</label><span class="right"></span><button class="btn primary">حفظ وإرسال للاعتماد</button></div></form>`);
  }

  V.requests = (u, q, seg) => {
    if (seg[1] === "new") return reqForm(u, q);
    const y = pickYear(q);
    const ids = new Set(visibleEmps(u, true).map((e) => e.id));
    let rows = DB.reqs.filter((r) => r.year === y.id && ids.has(r.emp));
    if (q.get("status")) rows = rows.filter((r) => r.status === q.get("status"));
    if (q.get("emp")) rows = rows.filter((r) => String(r.emp) === q.get("emp"));
    rows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    const canNew = EDITORS.includes(u.role) || (activeYear().empCanRequest && u.emp);
    return layout(u, "سجل أيام بدل الراحة", `<div class="page-head"><div><h1>سجل أيام بدل الراحة</h1><p>كل يوم في سجل مستقل · الإلغاء يعيد اليوم إلى الرصيد · السنة ${h(y.name)}</p></div>
      <div class="actions">${STAFF.includes(u.role) ? `<button class="btn" type="button" data-act="export" data-kind="requests" data-year="${y.id}">تصدير Excel</button>` : ""}${canNew ? '<a class="btn primary" href="#/requests/new">+ طلب يوم بدل راحة</a>' : ""}</div></div>
      ${listFilters("requests", u, y, q, REQ_ST)}<div class="card flush">${reqTable(u, rows, true)}</div>`);
  };

  function reqForm(u, q) {
    const y = activeYear();
    const editor = EDITORS.includes(u.role);
    if (!editor && !(y.empCanRequest && u.emp)) throw new Forbidden("تقديم الطلبات يتم عبر مسؤول الإدخال.");
    const emps = editor ? visibleEmps(u) : [empOf(u)];
    const sel = editor ? q.get("emp") || "" : String(u.emp);
    const b = sel ? balance(Number(sel), y) : null;
    return layout(u, "طلب يوم بدل راحة", `<div class="page-head"><div><h1>طلب يوم بدل راحة</h1><p>يُرسل الطلب إلى المدير المباشر للاعتماد، ويُحجز اليوم من الرصيد حتى البت فيه.</p></div></div>
      <form class="card" style="max-width:720px" data-form="request">
        ${editor ? `<div class="field"><label for="re">الموظف *</label><select id="re" name="emp" required data-reqemp>${empOptions(emps, sel)}</select><span class="hint">يُسجَّل أن الطلب مقدَّم نيابةً عن الموظف.</span></div>` : `<input type="hidden" name="emp" value="${u.emp}">`}
        ${b ? `<div class="alert ${b.available > 0 ? "ok" : "error"}" role="status">الرصيد المتبقي: <b>${b.remaining}</b> · المعلّق: ${b.pend} · <b>المتاح للطلب: ${b.available}</b></div>` : ""}
        <div class="field" id="dates"><label for="rd">تاريخ يوم بدل الراحة *</label><input id="rd" type="date" name="rest_date" required></div>
        <button class="btn sm" type="button" data-add-date>+ يوم آخر</button>
        <div class="field mt"><label for="rf">ملف التوصية (PDF)${y.reqReqAtt ? " *" : ' <span class="hint">اختياري</span>'}</label><input id="rf" type="file" name="file" accept="application/pdf"><span class="hint">في نسخة العرض يُحفظ اسم الملف فقط.</span></div>
        <div class="field"><label for="rn">ملاحظات</label><textarea id="rn" name="notes"></textarea></div>
        <div class="hint">لا يُقبل: تاريخ خارج السنة، ${y.blockWeekends ? "عطلة نهاية الأسبوع، " : ""}العطل الرسمية، أو تاريخ مكرر للموظف نفسه.</div>
        <div class="actions mt"><button class="btn primary">إرسال الطلب</button><a class="btn" href="#/requests">إلغاء</a></div></form>`);
  }

  V.approvals = (u) => {
    need(u, ["admin", "manager"]);
    const ids = new Set(visibleEmps(u, true).map((e) => e.id));
    const tasks = DB.tasks.filter((t) => t.status === "pending" && ids.has(t.emp) && canDecide(u, byId("emps", t.emp), t.enteredBy)).sort((a, b) => a.date.localeCompare(b.date));
    const reqs = DB.reqs.filter((r) => r.status === "pending" && ids.has(r.emp) && canDecide(u, byId("emps", r.emp), r.requestedBy)).sort((a, b) => a.date.localeCompare(b.date));
    return layout(u, "الاعتمادات", `<div class="page-head"><div><h1>بانتظار اعتمادي</h1><p>${tasks.length} مهمة · ${reqs.length} طلب يوم بدل راحة</p></div></div>
      <section class="card flush"><h2>طلبات أيام بدل الراحة</h2><div class="table-wrap"><table class="responsive"><thead><tr><th><input type="checkbox" data-check-all="req" aria-label="تحديد الكل"></th><th>الموظف</th><th>التاريخ</th><th>المتبقي قبل/بعد</th><th>التوصية</th><th>ملاحظات</th><th>قرار</th></tr></thead><tbody>
      ${reqs.map((r) => { const e = byId("emps", r.emp); const b = balance(e.id, byId("years", r.year)); return `<tr><td data-label="تحديد"><input type="checkbox" name="req" value="${r.id}" aria-label="تحديد"></td><td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a></td>
        <td data-label="التاريخ" class="num">${r.date} <span class="hint">${WD[weekday(r.date)]}</span></td><td data-label="المتبقي" class="num">${b.remaining} ← <b class="${b.remaining - 1 < 0 ? "badge err" : ""}">${b.remaining - 1}</b></td>
        <td data-label="التوصية">${r.att ? "📎 " + h(r.att) : '<span class="hint">لا يوجد</span>'}</td><td data-label="ملاحظات">${h(r.notes)}</td>
        <td data-label="قرار" class="nowrap"><button class="btn sm ok" type="button" data-act="decide" data-kind="req" data-id="${r.id}" data-a="approve">اعتماد</button> <button class="btn sm danger" type="button" data-act="decide" data-kind="req" data-id="${r.id}" data-a="reject">رفض</button></td></tr>`; }).join("") || '<tr><td colspan="7" class="empty">لا توجد طلبات بانتظارك.</td></tr>'}
      </tbody></table></div></section>
      <section class="card flush"><h2>المهام والساعات</h2><div class="table-wrap"><table class="responsive"><thead><tr><th><input type="checkbox" data-check-all="task" aria-label="تحديد الكل"></th><th>الموظف</th><th>التاريخ</th><th>الوصف</th><th class="n">الساعات</th><th>مرفق</th><th>قرار</th></tr></thead><tbody>
      ${tasks.map((t) => { const e = byId("emps", t.emp); return `<tr><td data-label="تحديد"><input type="checkbox" name="task" value="${t.id}" aria-label="تحديد"></td><td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a></td>
        <td data-label="التاريخ" class="num">${t.date}</td><td data-label="الوصف">${h(t.desc)}</td><td class="n" data-label="الساعات">${n(t.hours)}</td><td data-label="مرفق">${t.att ? "📎" : ""}</td>
        <td data-label="قرار" class="nowrap"><button class="btn sm ok" type="button" data-act="decide" data-kind="task" data-id="${t.id}" data-a="approve">اعتماد</button> <button class="btn sm danger" type="button" data-act="decide" data-kind="task" data-id="${t.id}" data-a="reject">رفض</button></td></tr>`; }).join("") || '<tr><td colspan="7" class="empty">لا توجد مهام بانتظارك.</td></tr>'}
      </tbody></table></div></section>
      ${tasks.length || reqs.length ? '<div class="actions"><span class="muted">للمحدد:</span><button class="btn ok" type="button" data-act="bulk" data-a="approve">اعتماد المحدد</button><button class="btn danger" type="button" data-act="bulk" data-a="reject">رفض المحدد</button></div>' : ""}`);
  };

  V.reports = (u, q) => {
    need(u, STAFF);
    const y = pickYear(q), ids = new Set(visibleEmps(u, true).map((e) => e.id));
    const reqs = DB.reqs.filter((r) => r.year === y.id && ids.has(r.emp)), tasks = DB.tasks.filter((t) => t.year === y.id && ids.has(t.emp));
    const c = (s) => reqs.filter((r) => r.status === s).length;
    const lead = reqs.filter((r) => r.decidedAt && ["approved", "rejected"].includes(r.status)).map((r) => (new Date(r.decidedAt.replace(" ", "T")) - new Date(r.created.replace(" ", "T"))) / 864e5);
    return layout(u, "التقارير", `<div class="page-head"><div><h1>التقارير والمؤشرات</h1><p>السنة ${h(y.name)}</p></div><form class="filters no-print">${yearSelect(y)}</form></div>
      <div class="grid kpis">
        <div class="kpi"><div class="l">إجمالي الطلبات</div><div class="v">${reqs.length}</div></div>
        <div class="kpi ok"><div class="l">معتمدة</div><div class="v">${c("approved")}</div></div>
        <div class="kpi warn"><div class="l">معلّقة</div><div class="v">${c("pending")}</div></div>
        <div class="kpi err"><div class="l">مرفوضة</div><div class="v">${c("rejected")}</div></div>
        <div class="kpi"><div class="l">نسبة الإلغاء</div><div class="v">${reqs.length ? Math.round((c("cancelled") / reqs.length) * 100) : 0}%</div></div>
        <div class="kpi"><div class="l">متوسط زمن الاعتماد</div><div class="v">${lead.length ? Math.round((lead.reduce((a, b) => a + b, 0) / lead.length) * 10) / 10 : 0}</div><div class="s">يوم</div></div>
        <div class="kpi accent"><div class="l">ساعات معتمدة</div><div class="v">${n(tasks.filter((t) => t.status === "approved").reduce((s, t) => s + t.hours, 0))}</div><div class="s">${tasks.length} مهمة</div></div>
        <div class="kpi warn"><div class="l">أيام معتمدة بلا ملف توصية</div><div class="v">${reqs.filter((r) => r.status === "approved" && !r.att).length}</div></div>
      </div>
      <section class="card"><h2>تصدير البيانات (Excel)</h2><div class="actions">
        <button class="btn" type="button" data-act="export" data-kind="balances" data-year="${y.id}">أرصدة الموظفين</button>
        <button class="btn" type="button" data-act="export" data-kind="requests" data-year="${y.id}">سجل أيام التمتع</button>
        <button class="btn" type="button" data-act="export" data-kind="tasks" data-year="${y.id}">سجل المهام والساعات</button></div>
        <p class="hint mt">الملفات بنفس أعمدة ملفات الإكسل السابقة.</p></section>`);
  };

  // ---------------------------------------------------------- الإدارة
  V.admin = (u, q, seg) => { need(u, ["admin"]); const f = A[seg[1] || "years"]; if (!f) throw new Forbidden("صفحة غير موجودة."); return f(u, q); };
  const A = {};
  A.years = (u) => {
    const form = (y) => { const p = "y" + (y ? y.id : "new"), dis = y && y.locked ? "disabled" : "";
      const chk = (k, label, def) => `<label class="check"><input type="checkbox" name="${k}" value="1" ${(y ? y[k] : def) ? "checked" : ""}> ${label}</label>`;
      return `<form data-form="year" data-id="${y ? y.id : ""}">
        <fieldset ${dis}><legend>الفترة</legend><div class="form-grid">
          <div class="field"><label for="${p}n">اسم السنة</label><input id="${p}n" name="name" value="${y ? h(y.name) : ""}" required></div>
          <div class="field"><label for="${p}s">من</label><input id="${p}s" type="date" name="start" value="${y ? y.start : ""}" required></div>
          <div class="field"><label for="${p}e">إلى</label><input id="${p}e" type="date" name="end" value="${y ? y.end : ""}" required></div></div></fieldset>
        <fieldset ${dis}><legend>احتساب الرصيد (سنوي)</legend><div class="form-grid">
          <div class="field"><label for="${p}m">طريقة الاحتساب</label><select id="${p}m" name="mode">${Object.entries(MODES).map(([k, v]) => `<option value="${k}" ${(y ? y.mode : "mixed") === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          <div class="field"><label for="${p}b">الرصيد الأساسي لكل موظف (يوم)</label><input id="${p}b" type="number" min="0" name="base" value="${y ? y.base : 20}"></div>
          <div class="field"><label for="${p}h">ساعات اليوم الواحد</label><input id="${p}h" type="number" step="0.25" min="0.25" name="hpd" value="${y ? y.hpd : 7}"></div>
          <div class="field"><label for="${p}x">الحد الأقصى لساعات المهمة</label><input id="${p}x" type="number" step="0.25" min="0.25" name="maxh" value="${y ? y.maxh : 12}"></div></div></fieldset>
        <fieldset ${dis}><legend>المرفقات والقواعد</legend>
          ${chk("reqTaskAtt", "إرفاق PDF إلزامي لكل مهمة/ساعات")}${chk("reqReqAtt", "إرفاق ملف التوصية (PDF) إلزامي لطلب يوم بدل الراحة")}
          ${chk("empCanRequest", "السماح للموظف بتقديم طلباته بنفسه", true)}${chk("blockWeekends", "منع الطلب في أيام عطلة نهاية الأسبوع", true)}
          <div class="actions" style="margin:-.2rem 1.6rem .6rem 0">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<label class="check" style="margin:0"><input type="checkbox" name="weekend" value="${i}" ${(y ? y.weekend : [5, 6]).includes(i) ? "checked" : ""}> ${WD[i]}</label>`).join("")}</div>
          ${chk("allowFuture", "السماح بتسجيل مهام بتاريخ مستقبلي")}${chk("allowLateCancel", "السماح بإلغاء يوم معتمد بعد مرور تاريخه (لغير الأدمن)")}</fieldset>
        ${y && y.locked ? "" : `<button class="btn primary">${y ? "حفظ الإعدادات" : "إنشاء السنة"}</button>`}</form>`; };
    return layout(u, "السنوات وقواعد الحساب", `<div class="page-head"><div><h1>السنوات وقواعد الحساب</h1><p>الرصيد سنوي: لكل سنة إعداداتها، ولا يُرحَّل رصيد من سنة لأخرى إلا بتسوية يعتمدها الأدمن.</p></div></div>
      <div class="alert info">تغيير ساعات اليوم أو طريقة الاحتساب يعيد حساب أرصدة تلك السنة فوراً. يُسجَّل كل تغيير في سجل التدقيق.</div>
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
        <div class="card flush"><div class="table-wrap"><table class="responsive"><thead><tr><th>السطر</th><th>الاسم</th><th>الرقم الوظيفي</th><th>القسم</th><th>المنصب</th><th>رقم المدير</th><th>النتيجة</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="${r.action === "error" ? "has-err" : ""}"><td data-label="السطر">${r.line}</td><td data-label="الاسم">${h(r.name)}</td><td data-label="الرقم" class="num">${h(r.no)}</td><td data-label="القسم">${h(r.dept)}</td>
          <td data-label="المنصب">${r.role ? ROLES[r.role] : "موظف (افتراضي)"}</td><td data-label="رقم المدير" class="num">${h(r.manager)}</td>
          <td data-label="النتيجة">${r.action === "error" ? `<span class="badge err">⚠ ${h(r.errors.join("، "))}</span>` : r.action === "new" ? '<span class="badge ok">جديد</span>' : '<span class="badge">تحديث</span>'}${r.note ? `<div class="hint">${h(r.note)}</div>` : ""}</td></tr>`).join("")}
        </tbody></table></div></div>
        ${c("new") + c("update") ? `<form class="card" data-form="import-commit">
          <label class="check"><input type="checkbox" name="create" value="1" checked> إنشاء حساب لكل موظف ليس له حساب (اسم المستخدم = الرقم الوظيفي، وكلمة مرور مؤقتة)</label>
          <label class="check"><input type="checkbox" name="roles" value="1" checked> تحديث منصب الحسابات الموجودة حسب الملف (لا يمس حسابات مدير النظام)</label>
          ${c("error") ? `<div class="alert warn">ستُتجاوز الصفوف التي فيها أخطاء (${c("error")}).</div>` : ""}
          <div class="actions"><button class="btn primary">استيراد ${c("new") + c("update")} موظف</button><button class="btn" type="button" data-act="import-back">رجوع</button></div></form>` : '<div class="actions"><button class="btn" type="button" data-act="import-back">رجوع وتصحيح البيانات</button></div>'}`);
    }
    return layout(u, "استيراد الموظفين", `<div class="page-head"><div><h1>استيراد الموظفين وإنشاء حساباتهم</h1><p>ارفع ملف Excel أو الصق الأسماء والأرقام. يُنشأ لكل موظف حساب اسم المستخدم فيه رقمه الوظيفي، مع المنصب المحدد.</p></div>
      <button class="btn" type="button" data-act="template">تنزيل نموذج Excel</button></div>
      <form data-form="import"><div class="grid two">
        <section class="card"><h2>1) رفع ملف Excel أو CSV</h2><div class="field"><label for="if">الملف <span class="hint">(‎.xlsx أو ‎.csv، أول ورقة فقط)</span></label><input id="if" type="file" name="file" accept=".xlsx,.xlsm,.csv"></div>
          <p class="hint">يتعرّف النظام على الأعمدة من عناوينها: الاسم، الرقم الوظيفي، القسم، المنصب، رقم المدير المباشر، المسمى الوظيفي، البريد.</p></section>
        <section class="card"><h2>2) أو النسخ واللصق</h2><div class="field"><label for="ip">انسخ الأعمدة من Excel والصقها هنا <span class="hint">(سطر لكل موظف)</span></label>
          <textarea id="ip" name="pasted" rows="8" placeholder="محمد أحمد العتيبي	100500	وحدة الشؤون الإدارية	موظف	100100"></textarea></div>
          <p class="hint">بدون صف عناوين يُفترض الترتيب: الاسم، الرقم الوظيفي، القسم، المنصب، رقم المدير المباشر.</p></section></div>
      <section class="card"><h2>المناصب</h2><div class="grid kpis" style="margin:0">
        <div class="kpi"><div class="l">موظف</div><div class="s">يتابع رصيده وكشفه ويقدّم طلباته</div></div><div class="kpi"><div class="l">مسؤول</div><div class="s">يُدخل الساعات والطلبات ويدير بيانات الموظفين</div></div>
        <div class="kpi"><div class="l">مدير مباشر</div><div class="s">يعتمد ساعات وطلبات فريقه المباشر</div></div><div class="kpi"><div class="l">متابع</div><div class="s">اطلاع فقط على جميع الأرصدة والتقارير</div></div></div>
        <p class="hint mt">إن تُرك المنصب فارغاً يكون «موظف». الرقم الوظيفي مفتاح المطابقة: إن كان الموظف موجوداً تُحدَّث بياناته بدل التكرار.</p></section>
      <button class="btn primary">معاينة قبل الحفظ</button></form>`);
  };
  function accountsPage(u, made) {
    return layout(u, "الحسابات المنشأة", `<div class="page-head"><div><h1>تم إنشاء ${made.length} حساب</h1><p>احفظ هذه القائمة أو اطبعها الآن — لن تظهر كلمات المرور مرة أخرى. يُطلب من كل مستخدم تغييرها عند أول دخول.</p></div>
      <div class="actions"><button class="btn" data-print type="button">طباعة</button><a class="btn primary" href="#/admin/users">المستخدمون</a></div></div>
      ${made.length ? "" : '<div class="alert info">لم يُنشأ أي حساب جديد: إما أن لكل الموظفين حسابات مسبقاً، أو أُلغي خيار إنشاء الحسابات.</div>'}
      <div class="card flush"><table><thead><tr><th>الموظف</th><th>اسم المستخدم</th><th>كلمة المرور المؤقتة</th><th>المنصب</th></tr></thead><tbody>
      ${made.map(([nm, un, pw, r]) => `<tr><td>${h(nm)}</td><td class="num">${h(un)}</td><td class="num"><code>${h(pw)}</code></td><td>${ROLES[r]}</td></tr>`).join("")}</tbody></table></div>`);
  }

  A.users = (u) => {
    const linked = new Set(DB.users.filter((x) => x.emp).map((x) => x.emp));
    const emps = DB.emps.filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name, "ar"));
    const roleOpts = (sel) => Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v}</option>`).join("");
    return layout(u, "المستخدمون والصلاحيات", `<div class="page-head"><div><h1>المستخدمون والصلاحيات</h1><p>${DB.users.length} حساب</p></div>
      <button class="btn" type="button" data-act="bulk-users">إنشاء حسابات الموظفين دفعة واحدة</button></div>
      <div class="grid two"><section class="card"><h2>الأدوار</h2><ul>
        <li><b>مدير النظام:</b> كل الصلاحيات، الإعدادات وقواعد الحساب، المستخدمون، التسويات، سجل التدقيق.</li>
        <li><b>مسؤول الإدخال:</b> إدارة بيانات الموظفين، تسجيل الساعات والطلبات نيابة عن الموظفين، التقارير.</li>
        <li><b>مدير مباشر:</b> متابعة فريقه المباشر واعتماد/رفض ساعاتهم وطلباتهم.</li>
        <li><b>متابع:</b> اطلاع فقط على لوحة المؤشرات وأرصدة وكشوف جميع الموظفين والتقارير.</li>
        <li><b>موظف:</b> متابعة رصيده وكشفه وتقديم طلباته (إن سمحت الإعدادات).</li></ul></section>
      <section class="card"><h2>إضافة حساب</h2><form data-form="user-new"><div class="form-grid">
        <div class="field"><label for="un">اسم المستخدم</label><input id="un" name="username" required></div>
        <div class="field"><label for="rl">الدور</label><select id="rl" name="role">${roleOpts("employee")}</select></div>
        <div class="field"><label for="ue">سجل الموظف المرتبط</label><select id="ue" name="emp">${empOptions(emps.filter((e) => !linked.has(e.id)), "", "—")}</select></div></div>
        <button class="btn primary">إنشاء الحساب</button></form></section></div>
      <div class="card flush"><div class="table-wrap"><table class="responsive"><thead><tr><th>اسم المستخدم</th><th>الدور والموظف</th><th></th></tr></thead><tbody>
      ${DB.users.map((x) => `<tr><td data-label="المستخدم"><b>${h(x.username)}</b>${x.mustChange ? '<div class="hint">بانتظار تغيير كلمة المرور</div>' : ""}</td>
        <td data-label="تعديل"><form class="filters" data-form="user-edit" data-id="${x.id}"><div class="field"><label class="sr-only" for="r${x.id}">الدور</label><select id="r${x.id}" name="role">${roleOpts(x.role)}</select></div>
          <div class="field grow"><label class="sr-only" for="e${x.id}">الموظف</label><select id="e${x.id}" name="emp">${empOptions(emps.filter((e) => !linked.has(e.id) || e.id === x.emp), x.emp || "", "—")}</select></div>
          <label class="check" style="margin:0"><input type="checkbox" name="active" value="1" ${x.active ? "checked" : ""}> نشط</label><button class="btn sm">حفظ</button></form></td>
        <td><button class="btn sm" type="button" data-act="reset-pw" data-id="${x.id}">إعادة تعيين كلمة المرور</button></td></tr>`).join("")}
      </tbody></table></div></div>`);
  };

  A.depts = (u) => {
    const cnt = (id) => DB.emps.filter((e) => e.dept === id).length;
    const opts = DB.depts.map((d) => `<option value="${d.id}">${h(d.name)} (${cnt(d.id)})</option>`).join("");
    return layout(u, "الأقسام", `<div class="page-head"><div><h1>الأقسام والوحدات</h1><p>وحّد الأسماء المتشابهة بالدمج.</p></div></div>
      <div class="grid two"><section class="card"><h2>إضافة قسم</h2><form class="filters" data-form="dept-new"><div class="field grow"><label for="dn">اسم القسم</label><input id="dn" name="name" required></div><button class="btn primary">إضافة</button></form></section>
      <section class="card"><h2>دمج قسمين</h2><form class="filters" data-form="dept-merge"><div class="field"><label for="ds">القسم المكرر</label><select id="ds" name="src">${opts}</select></div><div class="field"><label for="dt">يُدمج في</label><select id="dt" name="dst">${opts}</select></div><button class="btn">دمج</button></form></section></div>
      <div class="card flush"><table class="responsive"><thead><tr><th>القسم</th><th class="n">الموظفون</th><th>تعديل</th></tr></thead><tbody>
      ${DB.depts.map((d) => `<tr class="${d.active ? "" : "muted"}"><td data-label="القسم">${h(d.name)}</td><td class="n" data-label="الموظفون">${cnt(d.id)}</td>
        <td data-label="تعديل"><form class="filters" data-form="dept-edit" data-id="${d.id}"><div class="field grow"><label class="sr-only" for="dn${d.id}">الاسم</label><input id="dn${d.id}" name="name" value="${h(d.name)}"></div><label class="check" style="margin:0"><input type="checkbox" name="active" value="1" ${d.active ? "checked" : ""}> نشط</label><button class="btn sm">حفظ</button></form></td></tr>`).join("")}
      </tbody></table></div>`);
  };

  A.holidays = (u) => layout(u, "العطل الرسمية", `<div class="page-head"><div><h1>العطل الرسمية</h1><p>لا تُقبل طلبات بدل الراحة في هذه الأيام.</p></div></div>
    <section class="card"><form class="filters" data-form="holiday"><div class="field grow"><label for="hn">اسم العطلة</label><input id="hn" name="name" required></div>
      <div class="field"><label for="hs">من</label><input id="hs" type="date" name="start" required></div><div class="field"><label for="he">إلى <span class="hint">(اختياري)</span></label><input id="he" type="date" name="end"></div><button class="btn primary">إضافة</button></form></section>
    <div class="card flush"><table class="responsive"><thead><tr><th>التاريخ</th><th>اليوم</th><th>العطلة</th><th></th></tr></thead><tbody>
    ${DB.holidays.slice().sort((a, b) => b.day.localeCompare(a.day)).map((x) => `<tr><td class="num" data-label="التاريخ">${x.day}</td><td data-label="اليوم">${WD[weekday(x.day)]}</td><td data-label="العطلة">${h(x.name)}</td><td><button class="btn sm danger" type="button" data-act="del-holiday" data-id="${x.id}">حذف</button></td></tr>`).join("") || '<tr><td colspan="4" class="empty">لا توجد عطل مسجلة.</td></tr>'}
    </tbody></table></div>`);

  A.settings = (u) => { const s = DB.settings; return layout(u, "هوية الجهة", `<div class="page-head"><div><h1>هوية الجهة</h1><p>تظهر في الترويسة والكشوف الرسمية.</p></div></div>
    <form class="card" style="max-width:720px" data-form="settings">
      <div class="field"><label for="s1">الجامعة</label><input id="s1" name="university" value="${h(s.university)}"></div>
      <div class="field"><label for="s2">الكلية / الجهة</label><input id="s2" name="college" value="${h(s.college)}"></div>
      <div class="field"><label for="s3">اسم النظام</label><input id="s3" name="system_title" value="${h(s.system_title)}"></div>
      <div class="field"><label for="s5">الشعار النصي <span class="hint">(يظهر تحت اسم النظام)</span></label><input id="s5" name="tagline" value="${h(s.tagline || "")}"></div>
      <div class="field"><label for="s4">سطر الحقوق <span class="hint">(اختياري)</span></label><input id="s4" name="credit" value="${h(s.credit)}"></div>
      <button class="btn primary">حفظ</button></form>`); };

  A.audit = (u, q) => { const qs = (q.get("q") || "").trim(); const rows = DB.audit.filter((a) => !qs || [a.user, a.action, a.entity, a.details].join(" ").includes(qs)).slice(0, 300);
    return layout(u, "سجل التدقيق", `<div class="page-head"><div><h1>سجل التدقيق</h1><p>كل عملية دخول وإنشاء وتعديل واعتماد.</p></div></div>
      <form class="card filters" data-form="filter" data-route="admin/audit"><div class="field grow"><label for="aq">بحث</label><input id="aq" type="search" name="q" value="${h(qs)}"></div><button class="btn primary">بحث</button></form>
      <div class="card flush"><div class="table-wrap"><table class="responsive"><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>الكيان</th><th>التفاصيل</th></tr></thead><tbody>
      ${rows.map((a) => `<tr><td class="num nowrap" data-label="الوقت">${a.at}</td><td data-label="المستخدم">${h(a.user)}</td><td data-label="العملية"><code>${h(a.action)}</code></td><td data-label="الكيان">${h(a.entity)}${a.entityId ? " #" + a.entityId : ""}</td><td data-label="التفاصيل"><small>${h(a.details)}</small></td></tr>`).join("") || '<tr><td colspan="5" class="empty">لا توجد سجلات.</td></tr>'}
      </tbody></table></div></div>`); };

  // ============================================================ الاستيراد
  const HEADERS = { name: ["الاسم", "اسم الموظف", "الاسم الكامل", "الموظف", "name"], no: ["الرقم الوظيفي", "الرقم", "رقم الموظف", "رقم وظيفي", "employee no", "id"],
    dept: ["القسم", "الوحده", "الاداره", "الجهه", "department"], role: ["المنصب", "الدور", "الصلاحيه", "نوع الحساب", "role"],
    manager: ["رقم المدير المباشر", "المدير المباشر", "رقم المدير", "المدير", "manager"], title: ["المسمى الوظيفي", "المسمى", "الوظيفه", "title"], email: ["البريد", "البريد الالكتروني", "البريد الجامعي", "الايميل", "email"] };
  const HL = {}; Object.entries(HEADERS).forEach(([k, vs]) => vs.forEach((v) => (HL[norm(v).toLowerCase()] = k)));
  const ROLE_WORDS = { "موظف": "employee", "employee": "employee", "مسؤول": "officer", "مسئول": "officer", "مسؤول الادخال": "officer", "مدخل بيانات": "officer", "officer": "officer",
    "مدير مباشر": "manager", "مدير": "manager", "رئيس مباشر": "manager", "manager": "manager", "متابع": "viewer", "مراقب": "viewer", "viewer": "viewer" };
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
      const rt = norm(g("role")).toLowerCase(); if (rt) { if (ROLE_WORDS[rt]) row.role = ROLE_WORDS[rt]; else row.errors.push("منصب غير معروف «" + g("role") + "» (المسموح: موظف، مسؤول، مدير مباشر، متابع)"); }
      return row; });
  }
  function validateRows(rows) {
    const seenNo = {}, seenName = {}, fileNos = new Set(rows.filter((r) => r.no).map((r) => r.no));
    const byNo = {}, byName = {}; DB.emps.forEach((e) => { byNo[e.no] = e; byName[norm(e.name)] = e; });
    rows.forEach((r) => {
      if (!r.name) r.errors.push("الاسم فارغ");
      if (!r.no) r.errors.push("الرقم الوظيفي فارغ"); else if (/^tmp-/i.test(r.no)) r.errors.push("لا يُقبل رقم مؤقت");
      if (r.no && seenNo[r.no]) r.errors.push("الرقم مكرر في السطر " + seenNo[r.no]); if (r.no && !seenNo[r.no]) seenNo[r.no] = r.line;
      const k = norm(r.name); if (k && seenName[k]) r.errors.push("الاسم مكرر في السطر " + seenName[k]); if (k && !seenName[k]) seenName[k] = r.line;
      if (r.manager && r.manager === r.no) r.errors.push("لا يكون الموظف مديراً لنفسه");
      else if (r.manager && !fileNos.has(r.manager) && !byNo[r.manager]) r.errors.push("رقم المدير المباشر " + r.manager + " غير موجود");
      if (r.errors.length) { r.action = "error"; return; }
      const ex = byNo[r.no], same = byName[k];
      if (ex) { r.action = "update"; if (norm(ex.name) !== k) r.note = "سيُحدَّث الاسم من «" + ex.name + "»"; }
      else if (same && isTmp(same)) { r.action = "update"; r.note = "سيُستبدل الرقم المؤقت " + same.no; }
      else if (same) { r.action = "error"; r.errors.push("الاسم مسجل مسبقاً برقم آخر (" + same.no + ")"); }
      else r.action = "new";
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
      DB.users.push({ id: nid(), username: un, pw: await sha(pw), role, emp: e.id, active: true, mustChange: true, last: null });
      res.accounts.push([e.name, un, pw, role]);
    }
    return res;
  }

  // ============================================================ التصدير
  function exportXlsx(kind, yearId) {
    const u = me(), y = byId("years", yearId) || activeYear(), ids = new Set(visibleEmps(u, true).map((e) => e.id));
    let head, rows, name;
    if (kind === "balances") { head = ["م", "اسم الموظف", "الرقم الوظيفي", "القسم", "الرصيد الأساسي", "الساعات المعتمدة", "الأيام المكتسبة", "الساعات المتبقية", "تسوية", "إجمالي الرصيد", "الأيام التي تمتع بها", "طلبات معلقة", "الرصيد المتبقي", "حالة الرصيد"];
      rows = visibleEmps(u).map((e, i) => { const b = balance(e.id, y); return [i + 1, e.name, e.no, deptName(e), b.base, b.ah, b.earned, b.rem, b.adj, b.total, b.used, b.pend, b.remaining, b.remaining < 0 ? "تجاوز الرصيد" : b.remaining === 0 ? "نفد الرصيد" : "متبقي رصيد"]; });
      name = "أرصدة بدل الراحة " + y.name; }
    else if (kind === "requests") { head = ["م", "اسم الموظف", "الرقم الوظيفي", "تاريخ يوم بدل الراحة", "الحالة", "ملاحظات", "ملاحظة القرار", "ملف التوصية"];
      rows = DB.reqs.filter((r) => r.year === y.id && ids.has(r.emp)).sort((a, b) => a.date.localeCompare(b.date)).map((r, i) => { const e = byId("emps", r.emp); return [i + 1, e.name, e.no, r.date, reqLabel(r), r.notes, r.note, r.att ? "نعم" : ""]; });
      name = "سجل أيام التمتع " + y.name; }
    else { head = ["م", "اسم الموظف", "الرقم الوظيفي", "تاريخ المهمة", "وصف المهمة", "الساعات", "الحالة", "ملاحظات"];
      rows = DB.tasks.filter((t) => t.year === y.id && ids.has(t.emp)).sort((a, b) => a.date.localeCompare(b.date)).map((t, i) => { const e = byId("emps", t.emp); return [i + 1, e.name, e.no, t.date, t.desc, t.hours, TASK_ST[t.status], t.notes]; });
      name = "سجل المهام والساعات " + y.name; }
    download([head, ...rows], name);
  }
  function download(aoa, name) {
    if (window.XLSX) { const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!views"] = [{ RTL: true }]; const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 30)); XLSX.writeFile(wb, name + ".xlsx"); return; }
    const csv = "﻿" + aoa.map((r) => r.map((c) => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = name + ".csv"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
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
    u.pw = await sha(nw); u.mustChange = false; audit("password_changed", "user", u.id); save(); flash("تم تغيير كلمة المرور بنجاح."); go("#/");
  };
  F.quicksearch = (form) => go("#/employees?q=" + encodeURIComponent(fd(form).get("q") || ""));
  F.filter = (form) => { const p = new URLSearchParams(); for (const [k, v] of fd(form)) if (v) p.append(k, v); go("#/" + form.dataset.route + (p.toString() ? "?" + p : "")); };
  F.employee = (form, u) => {
    need(u, EDITORS);
    const d = fd(form), id = Number(form.dataset.id || 0), no = String(d.get("no")).trim(), name = String(d.get("name")).replace(/\s+/g, " ").trim();
    if (!no || !name) throw new RuleError("الرقم الوظيفي والاسم حقلان إلزاميان.");
    const dup = DB.emps.find((e) => e.no === no && e.id !== id); if (dup) throw new RuleError("الرقم الوظيفي مستخدم لموظف آخر: " + dup.name + ".");
    if (DB.emps.find((e) => norm(e.name) === norm(name) && e.id !== id)) throw new RuleError("يوجد موظف مسجل بنفس الاسم. أضف ما يميّزه.");
    const mgr = Number(d.get("mgr") || 0) || null; if (id && mgr === id) throw new RuleError("لا يمكن أن يكون الموظف مديراً مباشراً لنفسه.");
    let e = id ? byId("emps", id) : null;
    if (!e) { e = { id: nid(), active: true }; DB.emps.push(e); } else e.active = !!d.get("active");
    Object.assign(e, { no, name, dept: Number(d.get("dept") || 0) || null, mgr, title: String(d.get("title") || ""), email: String(d.get("email") || "") });
    audit(id ? "employee_updated" : "employee_created", "employee", e.id, { no, name }); save(); flash("تم حفظ بيانات الموظف."); go("#/employee/" + e.id);
  };
  F.balance = (form, u) => {
    need(u, ["admin"]);
    const d = fd(form), emp = Number(form.dataset.emp), year = Number(form.dataset.year), base = String(d.get("base")).trim(), adj = Number(d.get("adj") || 0), reason = String(d.get("reason") || "").trim();
    if ((adj || base) && !reason) throw new RuleError("اذكر سبب الرصيد الخاص أو التسوية.");
    let b = DB.balances.find((x) => x.emp === emp && x.year === year); if (!b) { b = { emp, year }; DB.balances.push(b); }
    b.base = base === "" ? null : Number(base); b.adj = adj; b.reason = reason;
    audit("balance_adjusted", "employee", emp, { base: b.base, adj, reason }); save(); flash("تم تحديث الرصيد."); render();
  };
  F.tasks = async (form, u) => {
    need(u, EDITORS);
    const trs = form.querySelectorAll("#entry tbody tr"), out = [], save_ = []; let bad = false;
    for (const tr of trs) {
      const g = (nm) => tr.querySelector(`[name="${nm}"]`); const file = g("file").files[0];
      const r = { emp: g("emp").value, date: g("date").value, desc: g("desc").value.trim(), hours: g("hours").value, notes: g("notes").value.trim(), error: "" };
      if (!r.emp && !r.date && !r.desc && !r.hours) continue;
      try {
        const e = byId("emps", r.emp); if (!e) throw new RuleError("اختر اسم الموظف.");
        if (!parseISO(r.date)) throw new RuleError("أدخل التاريخ."); if (!r.desc) throw new RuleError("أدخل وصف المهمة.");
        const hrs = toNum(r.hours); if (hrs == null) throw new RuleError("أدخل الساعات.");
        if (!form.allow_dup.checked && DB.tasks.some((t) => t.emp === e.id && t.date === r.date && t.desc === r.desc && t.status !== "rejected")) throw new RuleError("مهمة مطابقة مسجلة مسبقاً.");
        const att = await pdfCheck(file); const y = validateTask(e, r.date, hrs, !!att);
        save_.push({ e, r, hrs, att, y });
      } catch (err) { if (!(err instanceof RuleError)) throw err; r.error = "⚠ " + err.message; bad = true; }
      out.push(r);
    }
    if (!out.length) throw new RuleError("لم يتم إدخال أي صف.");
    if (bad) { taskDraft = out; return render(); }
    save_.forEach(({ e, r, hrs, att, y }) => { const t = { id: nid(), emp: e.id, year: y.id, date: r.date, desc: r.desc, hours: hrs, status: "pending", notes: r.notes, att, enteredBy: u.id, decidedBy: null, decidedAt: null, note: "", created: nowStr() }; DB.tasks.push(t); audit("task_created", "task", t.id, { employee: e.no, date: r.date, hours: hrs }); });
    save(); flash("تم تسجيل " + save_.length + " مهمة وإرسالها للاعتماد من المدير المباشر."); go("#/tasks?status=pending");
  };
  F.request = async (form, u) => {
    const d = fd(form), y = activeYear(), editor = EDITORS.includes(u.role);
    const empId = editor ? Number(d.get("emp") || 0) : u.emp;
    if (!editor && !y.empCanRequest) throw new Forbidden("تقديم الطلبات يتم عبر مسؤول الإدخال.");
    const e = byId("emps", empId); if (!e) throw new RuleError("اختر الموظف.");
    const dates = d.getAll("rest_date").filter(Boolean); if (!dates.length) throw new RuleError("أدخل تاريخ يوم بدل الراحة.");
    if (new Set(dates).size !== dates.length) throw new RuleError("تكرر التاريخ نفسه في الطلب.");
    const att = await pdfCheck(d.get("file"));
    const ys = dates.sort().map((dt, i) => { if (!parseISO(dt)) throw new RuleError("تاريخ غير صالح."); return validateRest(e, dt, !!att, i); });
    dates.forEach((dt, i) => { const r = { id: nid(), emp: e.id, year: ys[i].id, date: dt, status: "pending", notes: String(d.get("notes") || "").trim(), att, requestedBy: u.id, decidedBy: null, decidedAt: null, note: "", created: nowStr() }; DB.reqs.push(r); audit("request_created", "rest_day_request", r.id, { employee: e.no, date: dt, on_behalf: u.emp !== e.id }); });
    save(); flash("تم تقديم " + dates.length + " طلب، وهو الآن بانتظار اعتماد المدير المباشر."); go(STAFF.includes(u.role) ? "#/requests?status=pending" : "#/me");
  };
  F.year = (form, u) => {
    need(u, ["admin"]);
    const d = fd(form), id = Number(form.dataset.id || 0), name = String(d.get("name")).trim(), start = d.get("start"), end = d.get("end");
    const hpd = toNum(d.get("hpd")), base = toNum(d.get("base")), maxh = toNum(d.get("maxh"));
    if (!name || !parseISO(start) || !parseISO(end) || end < start) throw new RuleError("أدخل اسم السنة وتاريخي بداية ونهاية صحيحين.");
    if (!hpd || hpd <= 0 || base == null || base < 0 || !maxh || maxh <= 0) throw new RuleError("قيم الإعدادات الرقمية غير صحيحة.");
    const ov = DB.years.find((y) => y.id !== id && y.start <= end && y.end >= start); if (ov) throw new RuleError("الفترة تتداخل مع السنة " + ov.name + ".");
    if (id && [...DB.tasks, ...DB.reqs].some((x) => x.year === id && (x.date < start || x.date > end))) throw new RuleError("توجد حركات خارج الفترة الجديدة، لا يمكن تضييق السنة.");
    let y = id ? byId("years", id) : null; if (!y) { y = { id: nid(), active: false, locked: false }; DB.years.push(y); }
    if (y.locked) throw new RuleError("السنة مقفلة.");
    Object.assign(y, { name, start, end, mode: d.get("mode"), base: Math.trunc(base), hpd, maxh, weekend: d.getAll("weekend").map(Number) });
    ["reqTaskAtt", "reqReqAtt", "empCanRequest", "blockWeekends", "allowFuture", "allowLateCancel"].forEach((k) => (y[k] = !!d.get(k)));
    if (!y.weekend.length) y.weekend = [5, 6];
    audit("year_saved", "fiscal_year", y.id, { mode: y.mode, base: y.base, hpd }); save(); flash("تم حفظ إعدادات السنة " + name + "."); render();
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
    save(); importPreview = null; createdAccounts = res.accounts;
    flash("تمت إضافة " + res.created + " موظف وتحديث " + res.updated + "، وإنشاء " + res.accounts.length + " حساب" + (res.roles ? "، وتغيير منصب " + res.roles : "") + "."); render();
  };
  F["user-new"] = async (form, u) => {
    const d = fd(form), un = String(d.get("username")).trim().toLowerCase(), role = d.get("role"), emp = Number(d.get("emp") || 0) || null;
    if (!un || DB.users.some((x) => x.username.toLowerCase() === un)) throw new RuleError("اسم المستخدم فارغ أو مستخدم مسبقاً.");
    if (["employee", "manager"].includes(role) && !emp) throw new RuleError("يجب ربط حساب الموظف/المدير بسجل موظف.");
    const pw = rand(); DB.users.push({ id: nid(), username: un, pw: await sha(pw), role, emp, active: true, mustChange: true });
    audit("user_saved", "user", null, { username: un, role }); save(); flash("تم إنشاء الحساب " + un + ". كلمة المرور المؤقتة: " + pw); render();
  };
  F["user-edit"] = (form, u) => {
    const d = fd(form), x = byId("users", form.dataset.id), role = d.get("role"), emp = Number(d.get("emp") || 0) || null, active = !!d.get("active");
    if (["employee", "manager"].includes(role) && !emp) throw new RuleError("يجب ربط حساب الموظف/المدير بسجل موظف.");
    if (x.id === u.id && (role !== "admin" || !active)) throw new RuleError("لا يمكنك إزالة صلاحية الأدمن أو تعطيل حسابك بنفسك.");
    Object.assign(x, { role, emp, active }); audit("user_saved", "user", x.id, { role, active }); save(); flash("تم حفظ الحساب."); render();
  };
  F["dept-new"] = (form) => { const nm = String(fd(form).get("name")).replace(/\s+/g, " ").trim(); if (!nm || DB.depts.some((d) => norm(d.name) === norm(nm))) throw new RuleError("اسم القسم فارغ أو مكرر."); DB.depts.push({ id: nid(), name: nm, active: true }); audit("department_saved", "department", null, { name: nm }); save(); flash("تم حفظ القسم."); render(); };
  F["dept-edit"] = (form) => { const d = fd(form), x = byId("depts", form.dataset.id), nm = String(d.get("name")).trim(); if (!nm || DB.depts.some((y) => y.id !== x.id && norm(y.name) === norm(nm))) throw new RuleError("اسم القسم فارغ أو مكرر."); x.name = nm; x.active = !!d.get("active"); save(); flash("تم حفظ القسم."); render(); };
  F["dept-merge"] = (form) => { const d = fd(form), s = Number(d.get("src")), t = Number(d.get("dst")); if (s === t) throw new RuleError("اختر قسمين مختلفين."); if (!confirm("دمج القسمين ونقل موظفي الأول إلى الثاني وحذف الأول؟")) return; let c = 0; DB.emps.forEach((e) => { if (e.dept === s) { e.dept = t; c++; } }); const src = byId("depts", s); DB.depts = DB.depts.filter((x) => x.id !== s); audit("department_merged", "department", t, { source: src.name, moved: c }); save(); flash("تم الدمج ونقل " + c + " موظف."); render(); };
  F.holiday = (form) => { const d = fd(form), s = parseISO(d.get("start")), e = parseISO(d.get("end") || d.get("start")), nm = String(d.get("name")).trim(); if (!s || !e || e < s || (e - s) / 864e5 > 60 || !nm) throw new RuleError("بيانات العطلة غير صحيحة."); let c = 0; for (let x = new Date(s); x <= e; x.setDate(x.getDate() + 1)) { const k = iso(x); if (!DB.holidays.some((y) => y.day === k)) { DB.holidays.push({ id: nid(), day: k, name: nm }); c++; } } audit("holiday_added", "holiday", null, { name: nm }); save(); flash("تمت إضافة " + c + " يوم عطلة."); render(); };
  F.settings = (form) => { const d = fd(form); ["university", "college", "system_title", "tagline", "credit"].forEach((k) => (DB.settings[k] = String(d.get(k) || "").trim())); audit("settings_saved", "settings"); save(); flash("تم حفظ الإعدادات."); render(); };

  // ============================================================ الإجراءات
  const ACT = {};
  function aboutHTML(s) { return `<div class="about-doc">
  <p class="about-lead"><b>«${h(s.system_title)}»</b> نظام إلكتروني داخلي لإدارة أيام بدل الراحة لمنسوبي ${h(s.college)} في ${h(s.university)}. يحلّ محل السجلات الورقية وجداول Excel، ويوحّد في منصة واحدة آمنة وقابلة للتدقيق توثيقَ ساعات العمل الإضافية، واحتسابَ الأيام المستحقة، واعتمادَ طلبات التمتع.</p>
  <h3>الأهداف</h3>
  <ul>
    <li>توحيد إجراءات بدل الراحة وضبطها وفق قواعد معتمدة يحددها مدير النظام.</li>
    <li>تمكين الموظف من الاطلاع على رصيده وحركاته بشفافية في أي وقت.</li>
    <li>تسريع دورة الاعتماد بين الموظف ومسؤول الإدخال والمدير المباشر.</li>
    <li>توفير مرجعية موثّقة تدعم أعمال المراجعة والتدقيق الداخلي.</li>
  </ul>
  <h3>الخدمات الرئيسية</h3>
  <ul>
    <li><b>تسجيل المهام والساعات:</b> توثيق ساعات العمل الإضافية مع إمكانية إرفاق المستندات المؤيدة.</li>
    <li><b>الاحتساب الآلي:</b> تحويل الساعات المعتمدة إلى أيام مستحقة وفق المعادلة المعتمدة لكل سنة (افتراضياً: كل 7 ساعات تعادل يوماً واحداً).</li>
    <li><b>طلبات التمتع:</b> تقديم طلبات أيام بدل الراحة واعتمادها إلكترونياً من المدير المباشر.</li>
    <li><b>الأرصدة والكشوف:</b> رصيد سنوي لكل موظف، وكشف رسمي قابل للطباعة والحفظ بصيغة PDF.</li>
    <li><b>التقارير:</b> مؤشرات ولوحات متابعة، مع تصدير البيانات إلى Excel.</li>
    <li><b>إدارة المستخدمين:</b> استيراد بيانات الموظفين وإنشاء حساباتهم وإسناد الأدوار.</li>
  </ul>
  <h3>الأدوار والصلاحيات</h3>
  <p>مدير النظام، ومسؤول الإدخال، والمدير المباشر، والمتابع، والموظف؛ ولكلٍّ منهم صلاحيات محددة بحسب دوره.</p>
  <h3>الحوكمة وأمن المعلومات</h3>
  <ul>
    <li>صلاحيات وصول مبنية على الدور الوظيفي.</li>
    <li>فصل المهام: لا يعتمد أحدٌ طلباً يخصّه أو بيانات أدخلها بنفسه.</li>
    <li>سجل تدقيق يوثّق جميع العمليات ومنفّذيها وتوقيتها.</li>
    <li>حماية الحسابات بكلمات مرور مشفّرة، وقفل مؤقت عند تكرار المحاولات الخاطئة، وإنهاء الجلسة تلقائياً عند عدم النشاط.</li>
  </ul>
  <h3>الدعم الفني</h3>
  <p>للاستفسارات أو إعادة تعيين كلمة المرور، يُرجى التواصل مع مدير النظام في ${h(s.college)}.</p>
  <p class="about-credit">جميع الحقوق محفوظة © ${new Date().getFullYear()} — ${h(s.system_title)}${s.credit ? "<br>" + h(s.credit) : ""}</p>
</div>`; }
  const BKEY = "hr_demo_banner_hidden";
  function bannerHidden() { try { return localStorage.getItem(BKEY) === "1"; } catch (e) { return false; } }
  ACT.hideBanner = () => { try { localStorage.setItem(BKEY, "1"); } catch (e) {} render(); };
  ACT.showBanner = () => { try { localStorage.removeItem(BKEY); } catch (e) {} render(); };
  ACT.logout = () => { sessionStorage.removeItem("hr_uid"); go("#/login"); };
  ACT.reset = async () => { if (!confirm("استعادة بيانات العرض الأصلية؟ ستُحذف كل التغييرات في هذا المتصفح.")) return; await seed(); sessionStorage.removeItem("hr_uid"); flash("تمت استعادة بيانات العرض."); go("#/login"); };
  ACT["cancel-req"] = (b, u) => { const r = byId("reqs", b.dataset.id); let note = ""; if (b.dataset.needNote) { note = (prompt("اذكر سبب إلغاء اليوم المعتمد:") || "").trim(); if (!note) return; } else if (!confirm("تأكيد إلغاء الطلب؟")) return; const prev = cancelReq(u, r, note); save(); flash(prev === "approved" ? "تم إلغاء الطلب وإعادة اليوم إلى الرصيد." : "تم إلغاء الطلب."); render(); };
  ACT["withdraw-task"] = (b, u) => { need(u, EDITORS); const t = byId("tasks", b.dataset.id); if (t.status !== "pending" || !confirm("سحب هذه المهمة؟")) return; t.status = "rejected"; t.note = "سُحبت من قبل المدخل"; t.decidedBy = u.id; t.decidedAt = nowStr(); audit("task_withdrawn", "task", t.id); save(); flash("تم سحب المهمة."); render(); };
  ACT.decide = (b, u) => { const a = b.dataset.a; let note = ""; if (a === "reject") { note = (prompt("اذكر سبب الرفض:") || "").trim(); if (!note) return; } if (b.dataset.kind === "task") decideTask(u, byId("tasks", b.dataset.id), a, note); else decideReq(u, byId("reqs", b.dataset.id), a, note); save(); flash(a === "approve" ? "تم الاعتماد." : "تم الرفض."); render(); };
  ACT.bulk = (b, u) => { const a = b.dataset.a; const sel = (nm) => [...document.querySelectorAll(`input[name="${nm}"]:checked`)].map((c) => Number(c.value)); const ts = sel("task"), rs = sel("req");
    if (!ts.length && !rs.length) return toast("حدّد سجلاً واحداً على الأقل.", "error");
    let note = ""; if (a === "reject") { note = (prompt("اذكر سبب الرفض:") || "").trim(); if (!note) return; } else if (!confirm("اعتماد كل السجلات المحددة؟")) return;
    let ok = 0; const errs = []; ts.forEach((id) => { try { decideTask(u, byId("tasks", id), a, note); ok++; } catch (e) { errs.push(e.message); } }); rs.forEach((id) => { try { decideReq(u, byId("reqs", id), a, note); ok++; } catch (e) { errs.push(byId("emps", byId("reqs", id).emp).name + ": " + e.message); } });
    save(); flash("تمت معالجة " + ok + " سجل." + (errs.length ? " تعذّر " + errs.length + "." : ""), errs.length ? "error" : "ok"); errs.slice(0, 5).forEach((m) => flash(m, "error")); render(); };
  ACT.export = (b) => exportXlsx(b.dataset.kind, b.dataset.year);
  ACT.template = () => download([["الاسم", "الرقم الوظيفي", "القسم", "المنصب", "رقم المدير المباشر", "المسمى الوظيفي", "البريد"]], "نموذج استيراد الموظفين");
  ACT["import-back"] = () => { importPreview = null; render(); };
  ACT["activate-year"] = (b) => { DB.years.forEach((y) => (y.active = y.id === Number(b.dataset.id))); audit("year_activated", "fiscal_year", Number(b.dataset.id)); save(); flash("تم تغيير السنة النشطة."); render(); };
  ACT["lock-year"] = (b) => { const y = byId("years", b.dataset.id);
    if (!y.locked) { const p = DB.tasks.filter((t) => t.year === y.id && t.status === "pending").length + DB.reqs.filter((r) => r.year === y.id && r.status === "pending").length; if (p) throw new RuleError("لا يمكن الإقفال: توجد " + p + " حركة بانتظار الاعتماد."); if (!confirm("إقفال السنة؟ لن تُقبل أي حركات جديدة عليها.")) return; }
    y.locked = !y.locked; audit(y.locked ? "year_locked" : "year_unlocked", "fiscal_year", y.id); save(); flash((y.locked ? "تم إقفال" : "تم فتح") + " السنة " + y.name + "."); render(); };
  ACT["reset-pw"] = async (b) => { const x = byId("users", b.dataset.id); if (!confirm("إعادة تعيين كلمة مرور " + x.username + "؟")) return; const pw = rand(); x.pw = await sha(pw); x.mustChange = true; x.failed = 0; x.lockedUntil = null; audit("password_reset", "user", x.id); save(); flash("كلمة المرور المؤقتة للحساب " + x.username + ": " + pw); render(); };
  ACT["bulk-users"] = async () => { if (!confirm("إنشاء حساب لكل موظف نشط ليس له حساب (اسم المستخدم = الرقم الوظيفي)؟")) return; const linked = new Set(DB.users.filter((x) => x.emp).map((x) => x.emp)); const made = [];
    for (const e of DB.emps.filter((x) => x.active && !linked.has(x.id) && !isTmp(x))) { const un = String(e.no).toLowerCase(); if (DB.users.some((x) => x.username.toLowerCase() === un)) continue; const pw = rand(); const role = DB.emps.some((x) => x.mgr === e.id) ? "manager" : "employee"; DB.users.push({ id: nid(), username: un, pw: await sha(pw), role, emp: e.id, active: true, mustChange: true }); made.push([e.name, un, pw, role]); }
    audit("users_bulk_created", "user", null, { count: made.length }); save(); createdAccounts = made; go("#/admin/import"); };
  ACT["del-holiday"] = (b) => { if (!confirm("حذف هذا اليوم؟")) return; DB.holidays = DB.holidays.filter((x) => x.id !== Number(b.dataset.id)); save(); render(); };

  // ============================================================ الأحداث
  document.addEventListener("submit", async (ev) => {
    const form = ev.target.closest("form[data-form]"); if (!form) return;
    ev.preventDefault();
    const fn = F[form.dataset.form]; const u = me();
    try { await fn(form, u); }
    catch (e) { if (e instanceof RuleError || e instanceof Forbidden) { flash(e.message, "error"); render(); } else { console.error(e); toast("حدث خطأ غير متوقع.", "error"); } }
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
    if (mb && sb) { const o = sb.classList.toggle("open"); mb.setAttribute("aria-expanded", o ? "true" : "false"); return; }
    if (sb && sb.classList.contains("open") && !t.closest("#sidebar")) sb.classList.remove("open");
    document.querySelectorAll("details.acct[open]").forEach((d) => { if (!d.contains(t)) d.removeAttribute("open"); });
    if (t.closest("[data-print]")) { ev.preventDefault(); window.print(); return; }
    const all = t.closest("[data-check-all]"); if (all) document.querySelectorAll(`input[name="${all.dataset.checkAll}"]`).forEach((c) => (c.checked = all.checked));
    if (t.closest("[data-add-row]")) { const tb = document.querySelector("#entry tbody"), tpl = document.getElementById("row-tpl"); tb.insertAdjacentHTML("beforeend", tpl.innerHTML); tb.querySelectorAll(".idx").forEach((c, i) => (c.textContent = i + 1)); }
    if (t.closest("[data-add-date]")) { const box = document.getElementById("dates"); const i = document.createElement("input"); i.type = "date"; i.name = "rest_date"; i.className = "mt"; i.setAttribute("aria-label", "تاريخ إضافي"); box.appendChild(i); i.focus(); }
  });
  function checkRow(tr) { const o = tr.querySelector(".chk"); if (!o) return; const g = (nm) => tr.querySelector(`[name="${nm}"]`).value.trim(); const [e, d, s, hh] = [g("emp"), g("date"), g("desc"), g("hours")]; let m = "", ok = false;
    if (!e && !d && !s && !hh) m = ""; else if (!e) m = "⚠ اختر اسم الموظف"; else if (!d) m = "⚠ أدخل التاريخ"; else if (!s) m = "⚠ أدخل الوصف"; else if (!hh || Number(hh) <= 0) m = "⚠ أدخل الساعات"; else { m = "✓ سليم"; ok = true; }
    o.textContent = m; o.className = "chk " + (ok ? "ok" : m ? "bad" : ""); }
  document.addEventListener("input", (ev) => { const tr = ev.target.closest("#entry tbody tr"); if (tr) checkRow(tr); });
  document.addEventListener("change", (ev) => {
    const tr = ev.target.closest("#entry tbody tr"); if (tr) checkRow(tr);
    if (ev.target.matches("[data-yearnav]") && !ev.target.closest("form[data-form]")) { const { seg, q } = parts(); q.set("year", ev.target.value); go("#/" + seg.join("/") + "?" + q); }
    if (ev.target.matches("[data-reqemp]")) go("#/requests/new?emp=" + ev.target.value);
  });
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
        let r = seg[0] || (u.role === "employee" ? "me" : STAFF.includes(u.role) ? "dashboard" : "me");
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
    const main = document.getElementById("main"); if (main && seg[0] !== "login") main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  (async function start() {
    DB = load();
    if (!DB || !DB.years) await seed();
    // ترقية بيانات العرض القديمة إلى هوية «إتمام»
    if (DB.settings.system_title === "إدارة أيام بدل الراحة للموظفين") DB.settings.system_title = "إتمام";
    if (DB.settings.tagline == null) DB.settings.tagline = TAGLINE;
    if (!DB.settings.credit || DB.settings.credit === "تطوير مريم حمدي") DB.settings.credit = CREDIT;
    [SPRITE_INLINE, HERO_INLINE] = await Promise.all([inlineSprite("icons.svg"), inlineSprite("hero.svg")]);
    render();
  })();
})();

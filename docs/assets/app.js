/* «إتمام» — نسخة العرض (تعمل في المتصفح فقط، والبيانات في localStorage) */
(function () {
  "use strict";

  // ============================================================ أدوات
  const KEY = "hr_demo_v2";
  const CREDIT = "تصميم وتطوير: مريم حمدي";
  const TAGLINE = "إدارة أيام بدل الراحة بكفاءة واحتراف";
  const $app = document.getElementById("app");
  const ROLES = { admin: "مدير النظام", officer: "إداري", employee: "موظف" };
  const ASSIGNABLE = ["employee", "officer"];
  const WD = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const REQ_ST = { pending: "بانتظار الاعتماد", approved: "معتمد", rejected: "مرفوض", cancelled: "ملغى" };
  const REC_KINDS = { days: "بدل راحة بالأيام", hours: "بدل راحة بالساعات" };
  const LEAVE_KINDS = { use: "استبدال", compensation: "تعويض غياب" };
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
  const byId = (arr, id) => DB[arr].find((x) => x.id === Number(id));
  function audit(action, entity, entityId, details) {
    const u = me();
    DB.audit.unshift({ id: nid(), at: nowStr(), user: u ? u.username : "", action, entity, entityId: entityId || null, details: details ? JSON.stringify(details) : "" });
    if (DB.audit.length > 3000) DB.audit.length = 3000;
  }

  async function seed() {
    const pw = await sha(DEMO_PW);
    const db = { seq: 0, settings: { university: "جامعة الملك سعود", college: "كلية التمريض", system_title: "إتمام", tagline: TAGLINE, credit: CREDIT },
      years: [], depts: [], emps: [], users: [], recs: [], leaves: [], msgs: [], holidays: [], audit: [] };
    DB = db;
    db.years.push({ id: nid(), name: "2027", start: "2027-01-01", end: "2027-12-31", active: true, locked: false, cap: 20, hpd: 7,
      reqRecAtt: false, reqReqAtt: false, weekend: [5, 6], blockWeekends: true, allowLateCancel: false, empCanRequest: true });
    const depts = ["وحدة الشؤون الإدارية", "وحدة المعامل", "العلاقات العامة", "وكالة الشؤون الأكاديمية"];
    depts.forEach((name) => db.depts.push({ id: nid(), name, active: true }));
    const D = (i) => db.depts[i].id;
    // [الرقم، الاسم، القسم، رقم الإداري المسؤول، المسمى، البريد]
    const people = [
      ["100100", "سارة عبدالله المطيري", 0, null, "إدارية — شؤون الموظفين", "sara@example.com"],
      ["100200", "عبدالرحمن علي الزهراني", 1, null, "إداري — وحدة المعامل", "abdulrahman@example.com"],
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
    REC("100101", "days", 2, "2027-01-17", "المراقبة في الاختبارات النهائية للفصل الأول", "ت/112", off);
    REC("100101", "hours", 17.5, "2027-02-08", "تنظيم ملتقى التمريض السنوي", "ت/140", off);
    REC("100101", "days", 3, "2027-03-03", "لجنة الاعتماد الأكاديمي", "ت/171", off);
    REC("100102", "days", 4, "2027-01-20", "جرد العهد السنوي", "ت/118", off);
    REC("100103", "hours", 10, "2027-02-14", "حفل الخريجات", "ت/151", off);
    REC("100301", "days", 18, "2027-02-02", "تنظيم مؤتمر الكلية", "ت/133", off);
    REC("100201", "hours", 21, "2027-01-25", "تجهيز المعامل للاختبارات العملية", "ت/126", off2);
    REC("100202", "days", 2, "2027-02-22", "مناوبة المعامل", "ت/160", off2);
    const LV = (no, kind, unit, start, end, days, hours, reason, status, by, dec) => db.leaves.push({ id: nid(), emp: byNo[no].id, year: y, kind, unit, start, end: end || start, days, hours, reason, status, att: "", by: by.id,
      decidedBy: status === "pending" ? null : dec.id, decidedAt: status === "pending" ? null : start + " 12:00", note: status === "rejected" ? "ضغط عمل في الوحدة" : "", created: start + " 08:30" });
    LV("100101", "use", "days", "2027-02-01", "2027-02-01", 1, 0, "ظرف عائلي", "approved", emp, off);
    LV("100101", "use", "hours", "2027-03-10", null, 0, 3, "موعد طبي", "approved", emp, off);
    LV("100101", "compensation", "hours", "2027-03-15", null, 0, 4, "غياب صباحي اضطراري", "pending", emp, null);
    LV("100102", "use", "days", "2027-03-21", "2027-03-22", 2, 0, "سفر", "pending", byNo["100102"] && db.users[4], null);
    LV("100201", "compensation", "days", "2027-02-10", null, 1, 0, "غياب طارئ", "approved", off2, off2);
    const MSG = (from, to, subject, body, at, read) => db.msgs.push({ id: nid(), from: from ? from.id : null, to: to.id, subject, body, at, read: !!read, link: "" });
    MSG(admin, off, "تعميم: رفع توصيات الفصل الأول", "نأمل رفع توصيات بدل الراحة الخاصة بأعمال الاختبارات النهائية للفصل الأول قبل نهاية الشهر، مع إرفاق خطاب العميد بصيغة PDF.\n\nمع الشكر.", "2027-01-10 09:00", true);
    MSG(off, emp, "تمت إضافة توصية جديدة", "أُضيفت إلى رصيدك توصية بمنحك ثلاثة أيام بدل راحة (لجنة الاعتماد الأكاديمي). يمكنك الاطلاع على الإشعار وطباعته من صفحة رصيدك.", "2027-03-03 10:05", false);
    MSG(emp, off, "استفسار عن رصيد الساعات", "السلام عليكم، هل يمكن استخدام رصيد الساعات لساعتين نهاية الدوام يوم الخميس؟", "2027-03-05 13:20", false);
    db.holidays.push({ id: nid(), day: "2027-02-22", name: "يوم التأسيس" });
    DB = db;
    save();
  }

  // ============================================================ الجلسة
  const me = () => { const id = Number(sessionStorage.getItem("hr_uid") || 0); const u = DB && DB.users.find((x) => x.id === id && x.active); return u || null; };
  const empOf = (u) => (u && u.emp ? byId("emps", u.emp) : null);
  const displayName = (u) => { if (!u) return "إشعار النظام"; const e = empOf(u); return e ? e.name : u.username; };
  const activeYear = () => DB.years.find((y) => y.active) || DB.years[0];
  const yearFor = (d) => DB.years.find((y) => y.start <= d && d <= y.end) || null;
  const deptName = (e) => { const d = e && e.dept ? byId("depts", e.dept) : null; return d ? d.name : ""; };
  const mgrName = (e) => { const m = e && e.mgr ? byId("emps", e.mgr) : null; return m ? m.name : ""; };
  const isTmp = (e) => String(e.no).startsWith("TMP-");
  const userOfEmp = (e) => DB.users.find((u) => u.emp === e.id && u.active) || null;

  // ============================================================ قواعد العمل
  function earned(hours, hpd) { if (hpd <= 0) return [0, 0]; const q = Math.round((hours / hpd) * 1e9) / 1e9; const d = Math.floor(q); return [d, Math.round((hours - d * hpd) * 100) / 100]; }
  // الرصيد: يُمنح بالتوصيات (أيام وساعات) ويُستهلك بالطلبات المعتمدة؛ الحد الأقصى السنوي للأيام والساعات معاً
  function balance(empId, year) {
    const hpd = year.hpd;
    const recs = DB.recs.filter((r) => r.emp === empId && r.year === year.id && r.status === "active");
    const lv = DB.leaves.filter((r) => r.emp === empId && r.year === year.id);
    const sum = (arr, f) => arr.reduce((s, x) => s + Number(f(x) || 0), 0);
    const b = {
      hpd, cap: year.cap,
      gDays: sum(recs.filter((r) => r.kind === "days"), (r) => r.amount),
      gHours: round2(sum(recs.filter((r) => r.kind === "hours"), (r) => r.amount)),
      uDays: sum(lv.filter((r) => r.unit === "days" && r.status === "approved"), (r) => r.days),
      uHours: round2(sum(lv.filter((r) => r.unit === "hours" && r.status === "approved"), (r) => r.hours)),
      pDays: sum(lv.filter((r) => r.unit === "days" && r.status === "pending"), (r) => r.days),
      pHours: round2(sum(lv.filter((r) => r.unit === "hours" && r.status === "pending"), (r) => r.hours)),
    };
    b.daysLeft = b.gDays - b.uDays; b.hoursLeft = round2(b.gHours - b.uHours);
    b.daysAvail = b.daysLeft - b.pDays; b.hoursAvail = round2(b.hoursLeft - b.pHours);
    [b.hAsDays, b.hRem] = earned(Math.max(b.hoursLeft, 0), hpd);
    b.totalHours = round2(b.daysLeft * hpd + b.hoursLeft);
    [b.totalDays, b.totalRem] = earned(Math.max(b.totalHours, 0), hpd);
    b.grantedEq = round2(b.gDays + b.gHours / hpd);
    b.usedEq = round2(b.uDays + b.uHours / hpd);
    b.capLeftHours = round2(b.cap * hpd - (b.gDays * hpd + b.gHours));
    b.capPct = b.cap > 0 ? Math.min(100, Math.round((b.grantedEq / b.cap) * 100)) : 0;
    const granted = b.gDays * hpd + b.gHours;
    b.leftPct = granted > 0 ? Math.max(0, Math.min(100, Math.round((b.totalHours / granted) * 100))) : 0;
    return b;
  }
  const isOfficerOf = (u, e) => !!(u.role === "officer" && u.emp && e.mgr === u.emp);
  function canView(u, e) { return u.role === "admin" || u.emp === e.id || isOfficerOf(u, e); }
  function canManage(u, e) { if (u.emp === e.id) return false; return u.role === "admin" || isOfficerOf(u, e); }
  function visibleEmps(u, inactive) {
    let list = DB.emps.filter((e) => canView(u, e));
    if (!inactive) list = list.filter((e) => e.active);
    return list.sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }
  const managedEmps = (u, inactive) => visibleEmps(u, inactive).filter((e) => e.id !== u.emp);
  const officers = () => DB.emps.filter((e) => DB.users.some((u) => u.emp === e.id && u.role === "officer" && u.active)).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const officerUsersFor = (e) => (e.mgr ? DB.users.filter((u) => u.emp === e.mgr && u.active && STAFF.includes(u.role)) : []);
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
    if (!parseISO(start)) throw new RuleError("أدخل التاريخ.");
    const y = openYear(yearFor(start));
    if (kind === "compensation" && start > todayISO()) throw new RuleError("طلب التعويض يكون عن غياب حدث فعلاً (تاريخ اليوم أو قبله).");
    if (y.reqReqAtt && !hasAtt) throw new RuleError("إرفاق مستند مؤيد (PDF) إلزامي وفق إعدادات السنة.");
    const b = balance(e.id, y);
    if (unit === "days") {
      end = end || start; if (!parseISO(end)) throw new RuleError("تاريخ النهاية غير صالح."); if (end < start) throw new RuleError("تاريخ النهاية قبل تاريخ البداية.");
      if (yearFor(end) !== y) throw new RuleError("يجب أن تقع مدة الطلب ضمن سنة واحدة.");
      const wd = workingDays(y, start, end); if (!wd.length) throw new RuleError("المدة المختارة لا تتضمن أيام عمل (عطلة نهاية أسبوع أو عطلة رسمية).");
      if (DB.leaves.some((r) => r.emp === e.id && r.unit === "days" && ["pending", "approved"].includes(r.status) && r.start <= end && r.end >= start)) throw new RuleError("يوجد طلب فعّال يتداخل مع هذه المدة.");
      if (wd.length > b.daysAvail) throw new RuleError("رصيد الأيام المتاح (" + daysAr(Math.max(b.daysAvail, 0)) + ") لا يكفي لمدة " + daysAr(wd.length) + ".");
      return { y, days: wd.length, hours: 0, end };
    }
    if (hours == null || hours <= 0) throw new RuleError("أدخل عدد ساعات أكبر من صفر.");
    if (hours > y.hpd * 5) throw new RuleError("عدد الساعات كبير جداً لطلب واحد.");
    if (hours > b.hoursAvail + 1e-9) throw new RuleError("رصيد الساعات المتاح (" + hoursAr(Math.max(b.hoursAvail, 0)) + ") لا يكفي.");
    return { y, days: 0, hours: round2(hours), end: start };
  }
  const leaveAmount = (r) => (r.unit === "days" ? daysAr(r.days) : hoursAr(r.hours));
  const recAmount = (r) => (r.kind === "days" ? daysAr(r.amount) : hoursAr(r.amount));
  function decideLeave(u, r, action, note) {
    const e = byId("emps", r.emp);
    if (r.status !== "pending") throw new RuleError("الطلب ليس بانتظار الاعتماد.");
    if (!canManage(u, e)) throw new RuleError("لا يمكنك البت في هذا الطلب: الاعتماد للإداري المسؤول عن الموظف.");
    const y = openYear(byId("years", r.year)), b = balance(e.id, y);
    if (action === "approve") { if (r.unit === "days" ? r.days > b.daysLeft : r.hours > b.hoursLeft + 1e-9) throw new RuleError("اعتماد هذا الطلب يتجاوز الرصيد."); r.status = "approved"; }
    else { if (!note) throw new RuleError("اذكر سبب الرفض."); r.status = "rejected"; }
    r.decidedBy = u.id; r.decidedAt = nowStr(); r.note = note || "";
    audit("leave_" + r.status, "leave_request", r.id, { note });
    notify(userOfEmp(e), "تم " + (r.status === "approved" ? "اعتماد" : "رفض") + " طلب " + LEAVE_KINDS[r.kind], "طلبك (" + leaveAmount(r) + " بتاريخ " + r.start + "): " + REQ_ST[r.status] + "." + (note ? " الملاحظة: " + note : ""), "#/requests", u);
  }
  function cancelLeave(u, r, note) {
    const e = byId("emps", r.emp), own = r.emp === u.emp;
    if (!(canManage(u, e) || (own && r.status === "pending"))) throw new RuleError("ليست لديك صلاحية لإلغاء هذا الطلب.");
    const y = openYear(byId("years", r.year));
    if (!["pending", "approved"].includes(r.status)) throw new RuleError("لا يمكن إلغاء هذا الطلب في حالته الحالية.");
    if (r.status === "approved" && r.start < todayISO() && !y.allowLateCancel && u.role !== "admin") throw new RuleError("لا يمكن إلغاء طلب معتمد بعد مرور تاريخه (يتطلب صلاحية الأدمن).");
    if (r.status === "approved" && !note) throw new RuleError("اذكر سبب إلغاء طلب معتمد.");
    const prev = r.status; r.status = "cancelled"; r.note = (r.note ? r.note + " | " : "") + (note || "إلغاء");
    audit("leave_cancelled", "leave_request", r.id, { previous: prev, note });
    if (!own) notify(userOfEmp(e), "إلغاء طلب " + LEAVE_KINDS[r.kind], "أُلغي طلبك (" + leaveAmount(r) + " بتاريخ " + r.start + "). " + (note || ""), "#/requests", u);
    return prev;
  }
  function cancelRec(u, r, note) {
    const e = byId("emps", r.emp);
    if (!canManage(u, e)) throw new RuleError("ليست لديك صلاحية على هذه التوصية.");
    if (!note) throw new RuleError("اذكر سبب إلغاء التوصية.");
    const y = openYear(byId("years", r.year)); if (r.status !== "active") throw new RuleError("التوصية ملغاة مسبقاً.");
    const b = balance(e.id, y);
    if (r.kind === "days" ? b.daysLeft - r.amount < 0 : b.hoursLeft - r.amount < -1e-9) throw new RuleError("لا يمكن الإلغاء: الرصيد الممنوح بهذه التوصية مستخدم في طلبات معتمدة.");
    r.status = "cancelled"; r.cancelNote = note; audit("recommendation_cancelled", "recommendation", r.id, { note });
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
  const ASSET_V = "6";
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
    const pend = DB.leaves.filter((r) => r.status === "pending" && canManage(u, byId("emps", r.emp))).length;
    const item = (href, label, icon, badge) => `<li><a href="${href}" title="${label}" ${here === href || (href === "#/employees" && sg[0] === "employee") ? 'aria-current="page"' : ""}>${ico(icon)}<span class="lbl">${label}</span>${badge ? `<span class="badge count">${badge}</span>` : ""}</a></li>`;
    const nav = [
      STAFF.includes(u.role) ? `<li class="sep">المتابعة</li>${item("#/dashboard", "لوحة المؤشرات", "dashboard")}${item("#/employees", u.role === "admin" ? "الموظفون" : "موظفيّ", "users")}${item("#/approvals", "الاعتمادات", "approvals", pend)}${item("#/reports", "التقارير", "reports")}
        <li class="sep">التوصيات</li>${item("#/recs/new?kind=days", "توصية بالأيام", "calendar-plus")}${item("#/recs/new?kind=hours", "توصية بالساعات", "clock-plus")}${item("#/recs", "سجل التوصيات", "cal-check")}${item("#/requests", "طلبات الموظفين", "calendar")}${item("#/archive", "الأرشيف", "archive")}` : "",
      u.emp ? `<li class="sep">${u.role === "employee" ? "رصيدي وطلباتي" : "حسابي"}</li>${item("#/me", "رصيدي", "pie")}${u.role === "employee" ? item("#/requests", "طلباتي", "calendar") : ""}${y.empCanRequest ? item("#/requests/new?kind=use", "طلب استبدال", u.role === "employee" ? "calendar-plus" : "idcard") + item("#/requests/new?kind=compensation", "طلب تعويض غياب", "adjust") : ""}` : "",
      `<li class="sep">التواصل</li>${item("#/messages", "المراسلات", "mail", unread)}${item("#/messages/new", "رسالة جديدة", "send")}`,
      u.role === "admin" ? `<li class="sep">الإدارة</li>${item("#/admin/users", "المستخدمون والصلاحيات", "shield")}${item("#/admin/import", "استيراد الموظفين", "upload")}${item("#/admin/years", "السنة وقواعد الرصيد", "gear")}${item("#/admin/depts", "الأقسام", "building")}${item("#/admin/holidays", "العطل الرسمية", "holiday")}${item("#/admin/settings", "هوية الجهة", "palette")}${item("#/admin/audit", "سجل التدقيق", "audit")}${item("#/admin/data", "النسخ الاحتياطي والبيانات", "database")}` : "",
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
  const kindBadge = (k) => ({ days: '<span class="badge info">بالأيام</span>', hours: '<span class="badge accent">بالساعات</span>', use: '<span class="badge info">استبدال</span>', compensation: '<span class="badge accent">تعويض غياب</span>' }[k] || "");
  const yearSelect = (sel, name) => `<div class="field"><label for="ysel">السنة</label><select id="ysel" name="${name || "year"}" data-yearnav>${DB.years.slice().sort((a, b) => b.start.localeCompare(a.start)).map((y) => `<option value="${y.id}" ${y.id === sel.id ? "selected" : ""}>${h(y.name)}${y.active ? " (النشطة)" : ""}${y.locked ? " – مقفلة" : ""}</option>`).join("")}</select></div>`;
  const pickYear = (q) => (q.get("year") && byId("years", q.get("year"))) || activeYear();
  const empOptions = (list, sel, ph) => `<option value="">${ph || "— اختر الموظف —"}</option>` + list.map((e) => `<option value="${e.id}" ${String(sel) === String(e.id) ? "selected" : ""}>${h(e.name)} (${h(e.no)})</option>`).join("");
  const dateRange = (r) => r.start + (r.end && r.end !== r.start ? " ← " + r.end : "");
  const pdfChip = (name) => (name ? `<span class="badge muted" title="نسخة العرض لا تحفظ محتوى الملفات">📎 ${h(name)}</span>` : "");
  const months = ["ينا", "فبر", "مار", "أبر", "ماي", "يون", "يول", "أغس", "سبت", "أكت", "نوف", "ديس"];

  function board(b, big) {
    return `<section class="board${big ? " big" : ""}">
  <div class="gauge" style="--p: ${b.leftPct}" role="img" aria-label="الرصيد المتبقي ${b.totalDays} يوم و${n(b.totalRem)} ساعة">
    <div class="gauge-in"><b class="num">${b.totalDays}</b><span>يوماً متاحاً</span>${b.totalRem ? `<small>+ ${hoursAr(b.totalRem)}</small>` : ""}</div></div>
  <div class="board-cards">
    <div class="bcard days">${ico("calendar")}<div><span class="l">رصيد الأيام</span><b class="v num">${n(b.daysLeft)}</b><span class="s">ممنوح ${n(b.gDays)} · مستخدم ${b.uDays}${b.pDays ? " · معلّق " + b.pDays : ""}</span></div></div>
    <div class="bcard hours">${ico("clock")}<div><span class="l">رصيد الساعات</span><b class="v num">${n(b.hoursLeft)}</b><span class="s">= ${daysAr(b.hAsDays)}${b.hRem ? " و" + hoursAr(b.hRem) : ""} · كل ${n(b.hpd)} ساعات = يوم${b.pHours ? " · معلّق " + n(b.pHours) : ""}</span></div></div>
    <div class="bcard cap">${ico("pie")}<div><span class="l">من الحد الأقصى السنوي</span><b class="v num">${n(b.grantedEq)} <small class="of">من ${n(b.cap)} يوماً</small></b>
      <div class="progress" role="progressbar" aria-valuenow="${b.capPct}" aria-valuemin="0" aria-valuemax="100"><span style="width: ${b.capPct}%"></span></div></div></div>
  </div></section>`;
  }
  const tiles = (arr) => `<nav class="action-tiles" aria-label="إجراءات">${arr.map(([cls, href, icon, title, sub, badge]) => `<a class="tile ${cls}" href="${href}">${ico(icon)}<span><b>${title}</b><small>${sub}</small></span>${badge ? `<span class="badge warn">${badge}</span>` : ""}</a>`).join("")}</nav>`;

  // ---------------------------------------------------------- الشاشات
  const V = {};

  V.login = () => {
    const s = DB.settings;
    const accts = [["admin", "مدير النظام"], ["officer", "إداري"], ["emp", "موظف"]];
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
      <p class="lead">منصة داخلية لمنسوبي ${h(s.college)} في ${h(s.university)}: توصيات العميد بمنح بدل الراحة، وأرصدة الموظفين بالأيام والساعات، وطلبات الاستبدال والتعويض.</p>
      <ul class="gate-features">
        <li><span class="ico" aria-hidden="true">${ico("calendar-plus")}</span><div><b>توصيات بالأيام والساعات</b><span>يرفع الإداري توصية العميد (PDF) في حساب الموظف فيُحدَّث رصيده فوراً.</span></div></li>
        <li><span class="ico" aria-hidden="true">${ico("approvals")}</span><div><b>استبدال وتعويض</b><span>يطلب الموظف استخدام رصيده أو تعويض غيابه، ويعتمد الإداري إلكترونياً.</span></div></li>
        <li><span class="ico" aria-hidden="true">${ico("mail")}</span><div><b>مراسلات وخطابات رسمية</b><span>مراسلات داخلية مع إشعار بالبريد، وخطابات قابلة للطباعة.</span></div></li>
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
    if (u.role === "employee") { go("#/me"); return ""; }
    const y = pickYear(q), emps = managedEmps(u), ids = new Set(emps.map((e) => e.id));
    const t = { gd: 0, gh: 0, ud: 0, uh: 0, lh: 0, cap: 0, none: 0 }; const near = [], byOff = {};
    emps.forEach((e) => { const b = balance(e.id, y); t.gd += b.gDays; t.gh += b.gHours; t.ud += b.uDays; t.uh += b.uHours; t.lh += b.totalHours;
      if (b.capLeftHours <= 0) t.cap++; else if (b.capPct >= 80) near.push([e, b]); if (!b.gDays && !b.gHours) t.none++;
      const k = mgrName(e) || "— غير مُسند —"; const o = byOff[k] || (byOff[k] = { c: 0, g: 0, u: 0, l: 0 }); o.c++; o.g += b.grantedEq; o.u += b.usedEq; o.l += b.totalHours / y.hpd; });
    const [ld, lr] = earned(Math.max(t.lh, 0), y.hpd);
    const monthly = Array(12).fill(0);
    DB.recs.filter((r) => r.year === y.id && r.status === "active" && ids.has(r.emp)).forEach((r) => (monthly[Number(r.date.slice(5, 7)) - 1] += r.kind === "days" ? r.amount : r.amount / y.hpd));
    const mx = Math.max(...monthly) || 1;
    const pending = DB.leaves.filter((r) => r.status === "pending" && ids.has(r.emp) && canManage(u, byId("emps", r.emp))).sort((a, b) => a.created.localeCompare(b.created));
    const recent = DB.recs.filter((r) => ids.has(r.emp)).sort((a, b) => b.created.localeCompare(a.created)).slice(0, 6);
    const unread = DB.msgs.filter((m) => m.to === u.id && !m.read).length;
    return layout(u, "لوحة المؤشرات", `<div class="page-head"><div><h1>لوحة المؤشرات</h1><p>${u.role === "admin" ? "جميع الموظفين" : "الموظفون المسندون إليك"} · السنة ${h(y.name)} · الحد الأقصى ${daysAr(y.cap)} لكل موظف</p></div>${yearSelect(y)}</div>
      ${tiles([["days", "#/recs/new?kind=days", "calendar-plus", "توصية بدل راحة بالأيام", "رفع توصية العميد بأيام ممنوحة"], ["hours", "#/recs/new?kind=hours", "clock-plus", "توصية بدل راحة بالساعات", "كل " + n(y.hpd) + " ساعات = يوم"],
        ["appr", "#/approvals", "approvals", "الاعتمادات", pending.length + " طلب بانتظار قرارك", pending.length], ["msg", "#/messages", "mail", "المراسلات", unread + " رسالة غير مقروءة", unread]])}
      <div class="grid kpis">
        <div class="kpi brand">${ico("users")}<div class="l">الموظفون</div><div class="v">${emps.length}</div>${t.none ? `<div class="s">${t.none} بلا توصيات بعد</div>` : ""}</div>
        <div class="kpi accent">${ico("calendar")}<div class="l">أيام ممنوحة بالتوصيات</div><div class="v">${n(t.gd)}</div><div class="s">مستخدم منها ${t.ud}</div></div>
        <div class="kpi">${ico("clock")}<div class="l">ساعات ممنوحة بالتوصيات</div><div class="v">${n(t.gh)}</div><div class="s">مستخدم منها ${n(t.uh)}</div></div>
        <div class="kpi ok">${ico("pie")}<div class="l">الرصيد المتاح (معادل)</div><div class="v">${ld}</div><div class="s">يوماً${lr ? " + " + hoursAr(lr) : ""}</div></div>
        <div class="kpi warn">${ico("hourglass")}<div class="l">بلغوا الحد الأقصى</div><div class="v">${t.cap}</div><div class="s">${daysAr(y.cap)} في السنة</div></div></div>
      <div class="grid two">
        <section class="card"><h2>الممنوح شهرياً (بالأيام المعادلة)</h2><div class="bars" role="img" aria-label="الأيام الممنوحة لكل شهر">${monthly.map((v, i) => `<div class="bar"><b>${v ? n(v) : ""}</b><span style="height:${Math.round((v / mx) * 100)}%"></span><small>${months[i]}</small></div>`).join("")}</div></section>
        <section class="card flush"><h2>طلبات بانتظار القرار</h2><div class="table-wrap"><table class="responsive"><thead><tr><th>الموظف</th><th>النوع</th><th>المدة</th><th>التاريخ</th></tr></thead><tbody>
          ${pending.slice(0, 8).map((r) => { const e = byId("emps", r.emp); return `<tr><td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a></td><td data-label="النوع">${kindBadge(r.kind)}</td><td data-label="المدة">${leaveAmount(r)}</td><td data-label="التاريخ" class="num">${r.start}</td></tr>`; }).join("") || '<tr><td colspan="4" class="empty">لا توجد طلبات معلّقة.</td></tr>'}
        </tbody></table></div></section></div>
      <div class="grid two">
        ${u.role === "admin" ? `<section class="card flush"><h2>حسب الإداري</h2><div class="table-wrap"><table class="responsive"><thead><tr><th>الإداري</th><th class="n">موظفون</th><th class="n">ممنوح (يوم)</th><th class="n">مستخدم</th><th class="n">متاح</th></tr></thead><tbody>
          ${Object.entries(byOff).sort((a, b) => b[1].c - a[1].c).map(([k, o]) => `<tr><td data-label="الإداري">${h(k)}</td><td class="n" data-label="موظفون">${o.c}</td><td class="n" data-label="ممنوح">${n(o.g)}</td><td class="n" data-label="مستخدم">${n(o.u)}</td><td class="n" data-label="متاح">${n(o.l)}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
        <section class="card flush"><h2>أحدث التوصيات</h2><div class="table-wrap"><table class="responsive"><thead><tr><th>الموظف</th><th>النوع</th><th>القيمة</th><th>التاريخ</th></tr></thead><tbody>
          ${recent.map((r) => { const e = byId("emps", r.emp); return `<tr><td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a></td><td data-label="النوع">${kindBadge(r.kind)}</td><td data-label="القيمة">${recAmount(r)}${r.status !== "active" ? ' <span class="badge muted">ملغاة</span>' : ""}</td><td data-label="التاريخ" class="num">${r.date}</td></tr>`; }).join("") || '<tr><td colspan="4" class="empty">لم تُرفع توصيات بعد.</td></tr>'}
        </tbody></table></div></section>
        ${near.length ? `<section class="card"><h2>قاربوا الحد الأقصى (80% فأكثر)</h2><ul>${near.slice(0, 8).map(([e, b]) => `<li><a href="#/employee/${e.id}">${h(e.name)}</a> — ${n(b.grantedEq)} من ${n(b.cap)} يوماً</li>`).join("")}</ul></section>` : ""}
      </div>`);
  };

  function recRows(u, rows, withEmp, manage) {
    return rows.map((r) => { const e = byId("emps", r.emp); return `<tr class="${r.status !== "active" ? "muted-row" : ""}"><td data-label="التاريخ" class="num">${r.date}</td>${withEmp ? `<td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a></td>` : ""}<td data-label="النوع">${kindBadge(r.kind)}</td><td data-label="القيمة"><b>${recAmount(r)}</b></td><td data-label="رقم التوصية">${h(r.ref)}</td><td data-label="الموضوع">${h(r.subject)}</td>
      <td data-label="الحالة">${statusBadge(r.status === "active" ? "approved" : "cancelled", r.status === "active" ? "سارية" : "ملغاة")}${r.cancelNote ? `<small class="muted d-block">${h(r.cancelNote)}</small>` : ""}</td>
      <td class="actions-cell"><a class="btn sm" href="#/print/rec/${r.id}">إشعار</a> ${pdfChip(r.att)}${manage && r.status === "active" && canManage(u, e) ? ` <button class="btn sm danger" type="button" data-act="cancel-rec" data-id="${r.id}">إلغاء</button>` : ""}</td></tr>`; }).join("");
  }
  function leaveRows(u, rows, withEmp) {
    return rows.map((r) => { const e = byId("emps", r.emp), mg = canManage(u, e); return `<tr><td data-label="رقم" class="num">${r.id}</td>${withEmp ? `<td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a></td>` : ""}<td data-label="النوع">${kindBadge(r.kind)}</td><td data-label="المدة"><b>${leaveAmount(r)}</b></td><td data-label="التاريخ" class="num">${dateRange(r)}</td><td data-label="السبب">${h(r.reason)}</td>
      <td data-label="الحالة">${statusBadge(r.status, REQ_ST[r.status])}${r.note ? `<small class="muted d-block">${h(r.note)}</small>` : ""}</td>
      <td class="actions-cell"><a class="btn sm" href="#/print/req/${r.id}">طباعة</a>
        ${mg && r.status === "pending" ? `<button class="btn sm ok" type="button" data-act="decide" data-a="approve" data-id="${r.id}">اعتماد</button><button class="btn sm danger" type="button" data-act="decide" data-a="reject" data-id="${r.id}">رفض</button>` : ""}
        ${(r.status === "pending" && r.emp === u.emp) || (mg && ["pending", "approved"].includes(r.status)) ? `<button class="btn sm" type="button" data-act="cancel-leave" data-id="${r.id}" ${r.status === "approved" ? "data-need-note=1" : ""}>إلغاء</button>` : ""}</td></tr>`; }).join("");
  }
  const recHead = (withEmp) => `<thead><tr><th>التاريخ</th>${withEmp ? "<th>الموظف</th>" : ""}<th>النوع</th><th>القيمة</th><th>رقم التوصية</th><th>الموضوع</th><th>الحالة</th><th></th></tr></thead>`;
  const leaveHead = (withEmp) => `<thead><tr><th>رقم</th>${withEmp ? "<th>الموظف</th>" : ""}<th>النوع</th><th>المدة</th><th>التاريخ</th><th>السبب</th><th>الحالة</th><th></th></tr></thead>`;

  V.me = (u, q) => {
    const e = empOf(u); if (!e) { if (u.role === "employee") throw new Forbidden("حسابك غير مرتبط بسجل موظف."); go("#/dashboard"); return ""; }
    const y = pickYear(q), b = balance(e.id, y);
    const recs = DB.recs.filter((r) => r.emp === e.id && r.year === y.id).sort((a, c) => c.date.localeCompare(a.date));
    const reqs = DB.leaves.filter((r) => r.emp === e.id && r.year === y.id).sort((a, c) => c.created.localeCompare(a.created));
    return layout(u, "رصيدي", `<div class="page-head"><div><h1>مرحباً، ${h(e.name.split(" ")[0])}</h1><p>رصيد بدل الراحة للسنة ${h(y.name)}${e.mgr ? " · الإداري المسؤول: " + h(mgrName(e)) : ""}</p></div>
      <div class="actions no-print">${yearSelect(y)}<a class="btn" href="#/print/stmt/${e.id}?year=${y.id}">طباعة كشف رسمي</a></div></div>
      ${board(b, true)}
      ${y.empCanRequest ? tiles([["days", "#/requests/new?kind=use", "calendar-plus", "طلب استبدال", "استخدم أيامك أو ساعاتك في التاريخ الذي تختاره"], ["hours", "#/requests/new?kind=compensation", "adjust", "طلب تعويض غياب", "تعويض غياب حدث من رصيدك"], ["msg", "#/messages/new", "send", "مراسلة الإداري", "استفسار أو متابعة"]]) : ""}
      <section class="card flush"><h2>التوصيات الممنوحة</h2><div class="table-wrap"><table class="responsive">${recHead(false)}<tbody>${recRows(u, recs, false, false) || '<tr><td colspan="7" class="empty">لا توجد توصيات بعد.</td></tr>'}</tbody></table></div></section>
        <section class="card flush"><h2>طلباتي</h2><div class="table-wrap"><table class="responsive">${leaveHead(false)}<tbody>${leaveRows(u, reqs, false) || '<tr><td colspan="7" class="empty">لا توجد طلبات.</td></tr>'}</tbody></table></div></section>`);
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
    return layout(u, "كشف موظف", `<div class="page-head"><div><h1>${h(e.name)}</h1><p>${h(e.no)}${deptName(e) ? " · " + h(deptName(e)) : ""}${e.title ? " · " + h(e.title) : ""} · الإداري: ${h(mgrName(e) || "— غير مُسند —")}</p></div>
      <div class="actions no-print">${yearSelect(y)}<a class="btn" href="#/print/stmt/${e.id}?year=${y.id}">طباعة كشف رسمي</a>${u.role === "admin" ? `<a class="btn" href="#/employee/${e.id}/edit">تعديل البيانات</a>` : ""}</div></div>
      ${e.active ? "" : '<div class="alert warn">الموظف غير نشط.</div>'}
      ${board(b)}
      ${mg ? tiles([["days", "#/recs/new?kind=days&emp=" + e.id, "calendar-plus", "رفع توصية بالأيام", "المتاح للمنح: " + n(b.capLeftHours / b.hpd) + " يوم"], ["hours", "#/recs/new?kind=hours&emp=" + e.id, "clock-plus", "رفع توصية بالساعات", "المتاح للمنح: " + n(b.capLeftHours) + " ساعة"], ["appr", "#/requests/new?kind=use&emp=" + e.id, "calendar", "تسجيل طلب نيابةً عنه", "استبدال أو تعويض"]]) : ""}
      <section class="card flush"><h2>التوصيات</h2><div class="table-wrap"><table class="responsive">${recHead(false)}<tbody>${recRows(u, recs, false, true) || '<tr><td colspan="7" class="empty">لا توجد توصيات في هذه السنة.</td></tr>'}</tbody></table></div></section>
      <section class="card flush"><h2>الطلبات</h2><div class="table-wrap"><table class="responsive">${leaveHead(false)}<tbody>${leaveRows(u, reqs, false) || '<tr><td colspan="7" class="empty">لا توجد طلبات.</td></tr>'}</tbody></table></div></section>`);
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
        <table><tbody><tr><th>اسم الموظف</th><td>${h(e.name)}</td><th>الرقم الوظيفي</th><td>${h(e.no)}</td></tr><tr><th>القسم</th><td>${h(deptName(e))}</td><th>الإداري المسؤول</th><td>${h(mgrName(e))}</td></tr></tbody></table>
        <table class="mt"><thead><tr><th></th><th>ممنوح</th><th>مستخدم</th><th>معلّق</th><th>المتبقي</th></tr></thead><tbody>
          <tr><th>الأيام</th><td>${n(b.gDays)}</td><td>${b.uDays}</td><td>${b.pDays}</td><td><b>${n(b.daysLeft)}</b></td></tr>
          <tr><th>الساعات</th><td>${n(b.gHours)}</td><td>${n(b.uHours)}</td><td>${n(b.pHours)}</td><td><b>${n(b.hoursLeft)}</b></td></tr></tbody></table>
        <p>إجمالي الرصيد المتاح: <b>${daysAr(b.totalDays)}${b.totalRem ? " و" + hoursAr(b.totalRem) : ""}</b> (كل ${n(b.hpd)} ساعات تعادل يوماً). الممنوح خلال السنة ${n(b.grantedEq)} يوماً من حد أقصى ${n(b.cap)} يوماً.</p>
        <h3>التوصيات</h3><table><thead><tr><th>م</th><th>التاريخ</th><th>النوع</th><th>القيمة</th><th>رقم التوصية</th><th>الموضوع</th></tr></thead><tbody>
        ${recs.map((r, i) => `<tr><td>${i + 1}</td><td>${r.date}</td><td>${REC_KINDS[r.kind]}</td><td>${recAmount(r)}</td><td>${h(r.ref)}</td><td>${h(r.subject)}</td></tr>`).join("") || '<tr><td colspan="6" style="text-align:center">لا توجد توصيات.</td></tr>'}</tbody></table>
        <h3>الطلبات المعتمدة</h3><table><thead><tr><th>م</th><th>النوع</th><th>من</th><th>إلى</th><th>المدة</th><th>السبب</th></tr></thead><tbody>
        ${reqs.map((r, i) => `<tr><td>${i + 1}</td><td>${LEAVE_KINDS[r.kind]}</td><td>${r.start}</td><td>${r.end}</td><td>${leaveAmount(r)}</td><td>${h(r.reason)}</td></tr>`).join("") || '<tr><td colspan="6" style="text-align:center">لا توجد طلبات معتمدة.</td></tr>'}</tbody></table>
        <div class="sign"><div>الموظف</div><div>الإداري المسؤول</div><div>مدير النظام</div></div>`, e.id === u.emp ? "#/me" : "#/employee/" + e.id);
    }
    if (kind === "rec") {
      const r = byId("recs", id), e = r && byId("emps", r.emp); if (!r || !canView(u, e)) throw new Forbidden("التوصية غير موجودة.");
      const y = byId("years", r.year), b = balance(e.id, y), by = byId("users", r.by), s = DB.settings;
      return letter("إشعار منح بدل راحة " + (r.kind === "days" ? "بالأيام" : "بالساعات"), refNo("REC", r.id, r.created), "السنة: " + h(y.name), `
        ${r.status !== "active" ? `<p class="stamp-void">ملغى — ${h(r.cancelNote)}</p>` : ""}
        <p>المكرم/ <b>${h(e.name)}</b> &nbsp; الرقم الوظيفي: ${h(e.no)}${deptName(e) ? " &nbsp; القسم: " + h(deptName(e)) : ""}</p><p>السلام عليكم ورحمة الله وبركاته،</p>
        <p>بناءً على توصية سعادة عميد ${h(s.college)}${r.ref ? " رقم (" + h(r.ref) + ")" : ""} المؤرخة في ${r.date}${r.subject ? " بشأن: <b>" + h(r.subject) + "</b>" : ""}، نفيدكم بأنه قد مُنح لكم <b>${REC_KINDS[r.kind]}</b> مقداره <b>${recAmount(r)}</b>${r.kind === "hours" ? " (تعادل " + n(r.amount / y.hpd) + " يوماً، كل " + n(y.hpd) + " ساعات = يوم)" : ""}، وأُضيف إلى رصيدكم في نظام «${h(s.system_title)}».</p>
        <table class="mt"><tbody><tr><th>رصيد الأيام الحالي</th><td>${n(b.daysLeft)}</td><th>رصيد الساعات الحالي</th><td>${n(b.hoursLeft)}</td></tr>
          <tr><th>إجمالي المتاح</th><td colspan="3">${daysAr(b.totalDays)}${b.totalRem ? " و" + hoursAr(b.totalRem) : ""} — الممنوح خلال السنة ${n(b.grantedEq)} من ${n(b.cap)} يوماً</td></tr></tbody></table>
        <p>وتقبلوا خالص التحية والتقدير،</p><div class="sign"><div>الإداري المسؤول<br><small>${h(displayName(by))}</small></div><div>الموظف</div><div>الختم</div></div>`, e.id === u.emp ? "#/me" : "#/employee/" + e.id);
    }
    if (kind === "req") {
      const r = byId("leaves", id), e = r && byId("emps", r.emp); if (!r || !canView(u, e)) throw new Forbidden("الطلب غير موجود.");
      const y = byId("years", r.year), b = balance(e.id, y), dec = r.decidedBy ? byId("users", r.decidedBy) : null;
      return letter("نموذج طلب " + LEAVE_KINDS[r.kind] + " من رصيد بدل الراحة", refNo("REQ", r.id, r.created), "تاريخ الطلب: " + r.created.slice(0, 10), `
        <table><tbody><tr><th>اسم الموظف</th><td>${h(e.name)}</td><th>الرقم الوظيفي</th><td>${h(e.no)}</td></tr>
          <tr><th>القسم</th><td>${h(deptName(e))}</td><th>الإداري المسؤول</th><td>${h(mgrName(e))}</td></tr>
          <tr><th>نوع الطلب</th><td>${LEAVE_KINDS[r.kind]}</td><th>الرصيد المستخدم</th><td>${r.unit === "days" ? "رصيد الأيام" : "رصيد الساعات"}</td></tr>
          <tr><th>${r.kind === "use" ? "المدة" : "تاريخ الغياب"}</th><td>${r.start}${r.end !== r.start ? " إلى " + r.end : ""}</td><th>المقدار</th><td><b>${leaveAmount(r)}</b></td></tr>
          <tr><th>السبب</th><td colspan="3">${h(r.reason) || "—"}</td></tr></tbody></table>
        <h3>قرار الإداري</h3><table><tbody><tr><th>الحالة</th><td><b>${REQ_ST[r.status]}</b></td><th>تاريخ القرار</th><td>${r.decidedAt || "—"}</td></tr>
          <tr><th>صاحب القرار</th><td>${dec ? h(displayName(dec)) : "—"}</td><th>ملاحظة</th><td>${h(r.note) || "—"}</td></tr></tbody></table>
        <p class="mt">الرصيد بعد الحركات المعتمدة: الأيام ${n(b.daysLeft)} · الساعات ${n(b.hoursLeft)} · الإجمالي ${daysAr(b.totalDays)}${b.totalRem ? " و" + hoursAr(b.totalRem) : ""}.</p>
        <div class="sign"><div>مقدم الطلب</div><div>الإداري المسؤول</div><div>الختم</div></div>`, "#/requests");
    }
    if (kind === "msg") {
      const m = byId("msgs", id); if (!m || ![m.to, m.from].includes(u.id)) throw new Forbidden("الرسالة غير موجودة.");
      const fr = m.from ? byId("users", m.from) : null, to = byId("users", m.to);
      return letter("خطاب: " + h(m.subject), refNo("MSG", m.id, m.at), "", `<table><tbody><tr><th>من</th><td>${fr ? h(displayName(fr)) + " (" + ROLES[fr.role] + ")" : "نظام " + h(DB.settings.system_title)}</td><th>إلى</th><td>${h(displayName(to))} (${ROLES[to.role]})</td></tr><tr><th>التاريخ</th><td colspan="3">${m.at}</td></tr></tbody></table>
        <div class="letter-body">${h(m.body)}</div><div class="sign"><div>المرسل</div><div></div><div>الختم</div></div>`, "#/messages/" + m.id);
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
    return layout(u, admin ? "الموظفون والأرصدة" : "موظفيّ", `<div class="page-head"><div><h1>${admin ? "الموظفون والأرصدة" : "الموظفون المسندون إليّ"}</h1><p>السنة ${h(y.name)} · ${rows.length} موظف · الحد الأقصى ${daysAr(y.cap)}</p></div>
      <div class="actions"><button class="btn" type="button" data-act="export" data-kind="balances" data-year="${y.id}">تصدير Excel</button>${admin ? '<a class="btn primary" href="#/employee/new">+ إضافة موظف</a>' : ""}</div></div>
      <form class="card filters" data-form="filter" data-route="employees" role="search">
        <div class="field grow"><label for="q">بحث بالاسم أو الرقم الوظيفي</label><input id="q" type="search" name="q" value="${h(qs)}"></div>
        <div class="field"><label for="dept">القسم</label><select id="dept" name="dept"><option value="">الكل</option>${DB.depts.map((d) => `<option value="${d.id}" ${dept === d.id ? "selected" : ""}>${h(d.name)}</option>`).join("")}</select></div>
        ${admin ? `<div class="field"><label for="of">الإداري</label><select id="of" name="officer"><option value="">الكل</option><option value="-1" ${off === -1 ? "selected" : ""}>— غير مُسند —</option>${officers().map((o) => `<option value="${o.id}" ${off === o.id ? "selected" : ""}>${h(o.name)}</option>`).join("")}</select></div>` : ""}
        <div class="field"><label for="st">تصفية</label><select id="st" name="state"><option value="">النشطون</option><option value="cap" ${st === "cap" ? "selected" : ""}>بلغوا الحد الأقصى</option><option value="none" ${st === "none" ? "selected" : ""}>بلا توصيات</option><option value="inactive" ${st === "inactive" ? "selected" : ""}>غير النشطين</option></select></div>
        ${yearSelect(y)}<button class="btn primary">عرض</button></form>
      <div class="card flush"><div class="table-wrap"><table class="responsive"><thead><tr><th>م</th><th>اسم الموظف</th><th>الرقم الوظيفي</th>${admin ? "<th>الإداري</th>" : ""}<th class="n">رصيد الأيام</th><th class="n">رصيد الساعات</th><th class="n">الإجمالي</th><th>من الحد الأقصى</th><th></th></tr></thead><tbody>
      ${rows.map(([e, b], i) => `<tr><td data-label="م">${i + 1}</td><td data-label="الاسم"><a href="#/employee/${e.id}?year=${y.id}">${h(e.name)}</a>${deptName(e) ? `<small class="muted d-block">${h(deptName(e))}</small>` : ""}</td><td data-label="الرقم" class="num">${h(e.no)}</td>
        ${admin ? `<td data-label="الإداري">${h(mgrName(e) || "—")}</td>` : ""}<td class="n" data-label="رصيد الأيام">${n(b.daysLeft)}</td><td class="n" data-label="رصيد الساعات">${n(b.hoursLeft)}</td>
        <td class="n" data-label="الإجمالي"><b>${b.totalDays}</b>${b.totalRem ? `<small> +${n(b.totalRem)}س</small>` : ""}</td>
        <td data-label="من الحد"><div class="meter"><div class="progress"><span style="width:${b.capPct}%"></span></div><span class="num">${n(b.grantedEq)}/${n(b.cap)}</span></div></td>
        <td class="actions-cell"><a class="btn sm" href="#/recs/new?kind=days&emp=${e.id}">+ أيام</a> <a class="btn sm" href="#/recs/new?kind=hours&emp=${e.id}">+ ساعات</a></td></tr>`).join("") || `<tr><td colspan="9" class="empty">لا توجد نتيجة.${u.role === "officer" ? " لم يُسند إليك موظفون بعد — تواصل مع مدير النظام." : ""}</td></tr>`}
      </tbody></table></div></div>`);
  };

  function empForm(u, e) {
    const offs = officers().filter((o) => !e || o.id !== e.id);
    return layout(u, e ? "تعديل بيانات موظف" : "إضافة موظف", `<div class="page-head"><h1>${e ? h(e.name) : "إضافة موظف جديد"}</h1></div>
      <form class="card" data-form="employee" data-id="${e ? e.id : ""}"><div class="form-grid">
        <div class="field"><label for="no">الرقم الوظيفي *</label><input id="no" name="no" required value="${e ? h(e.no) : ""}"></div>
        <div class="field"><label for="nm">الاسم *</label><input id="nm" name="name" required value="${e ? h(e.name) : ""}"></div>
        <div class="field"><label for="dp">القسم</label><select id="dp" name="dept"><option value="">—</option>${DB.depts.filter((d) => d.active).map((d) => `<option value="${d.id}" ${e && e.dept === d.id ? "selected" : ""}>${h(d.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="mg">الإداري المسؤول <span class="hint">(يرفع توصياته ويعتمد طلباته)</span></label><select id="mg" name="mgr"><option value="">— غير مُسند —</option>${offs.map((o) => `<option value="${o.id}" ${e && e.mgr === o.id ? "selected" : ""}>${h(o.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="tt">المسمى الوظيفي</label><input id="tt" name="title" value="${e ? h(e.title) : ""}"></div>
        <div class="field"><label for="em">البريد الإلكتروني <span class="hint">(للإشعارات)</span></label><input id="em" type="email" name="email" value="${e ? h(e.email) : ""}"></div></div>
        ${e ? `<label class="check"><input type="checkbox" name="active" value="1" ${e.active ? "checked" : ""}> على رأس العمل (نشط)</label>` : ""}
        <div class="actions"><button class="btn primary">حفظ</button><a class="btn" href="${e ? "#/employee/" + e.id : "#/employees"}">إلغاء</a></div></form>`);
  }

  V.recs = (u, q, seg) => {
    if (seg[1] === "new") return recForm(u, q);
    const y = pickYear(q), kind = q.get("kind") || "", emp = Number(q.get("emp") || 0), ids = new Set(visibleEmps(u, true).map((e) => e.id));
    const rows = DB.recs.filter((r) => r.year === y.id && ids.has(r.emp) && (!kind || r.kind === kind) && (!emp || r.emp === emp)).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    return layout(u, "سجل التوصيات", `<div class="page-head"><div><h1>سجل التوصيات</h1><p>السنة ${h(y.name)} · ${rows.length} توصية</p></div>
      <div class="actions">${STAFF.includes(u.role) ? `<button class="btn" type="button" data-act="export" data-kind="recs" data-year="${y.id}">تصدير Excel</button><a class="btn primary" href="#/recs/new?kind=days">+ توصية بالأيام</a><a class="btn primary" href="#/recs/new?kind=hours">+ توصية بالساعات</a>` : ""}</div></div>
      <form class="card filters" data-form="filter" data-route="recs"><div class="field"><label for="k">النوع</label><select id="k" name="kind"><option value="">الكل</option><option value="days" ${kind === "days" ? "selected" : ""}>بالأيام</option><option value="hours" ${kind === "hours" ? "selected" : ""}>بالساعات</option></select></div>
        <div class="field grow"><label for="e">الموظف</label><select id="e" name="emp">${empOptions(managedEmps(u, true), emp, "الكل")}</select></div>${yearSelect(y)}<button class="btn primary">عرض</button></form>
      <div class="card flush"><div class="table-wrap"><table class="responsive">${recHead(true)}<tbody>${recRows(u, rows, true, true) || '<tr><td colspan="8" class="empty">لا توجد توصيات.</td></tr>'}</tbody></table></div></div>`);
  };
  function recForm(u, q) {
    need(u, STAFF);
    const kind = q.get("kind") === "hours" ? "hours" : "days", isD = kind === "days", emp = Number(q.get("emp") || 0) || "", y = activeYear(), emps = managedEmps(u), eq = emp ? "&emp=" + emp : "";
    return layout(u, "رفع توصية بدل راحة " + (isD ? "بالأيام" : "بالساعات"), `<div class="page-head"><div><h1>${ico(isD ? "calendar-plus" : "clock-plus", "h-ico")} توصية بدل راحة ${isD ? "بالأيام" : "بالساعات"}</h1>
      <p>ترفع توصية العميد (PDF) في حساب الموظف، وتُضاف القيمة إلى رصيده فوراً. الحد الأقصى السنوي ${daysAr(y.cap)} (الأيام والساعات معاً)${isD ? "" : "، وكل " + n(y.hpd) + " ساعات تعادل يوماً"}.</p></div>
      <div class="seg" role="tablist" aria-label="نوع التوصية"><a href="#/recs/new?kind=days${eq}" class="${isD ? "on" : ""}">بالأيام</a><a href="#/recs/new?kind=hours${eq}" class="${isD ? "" : "on"}">بالساعات</a></div></div>
      ${!emps.length ? '<div class="alert warn">لا يوجد موظفون مسندون إليك. يُسند مدير النظام الموظفين إلى الإداري من بطاقة الموظف.</div>' : `
      <form class="card form-narrow" data-form="rec" data-kind="${kind}">
        <div class="field"><label for="emp">الموظف *</label><select id="emp" name="emp" required><option value="">— اختر —</option>${emps.map((e) => { const b = balance(e.id, y); return `<option value="${e.id}" ${String(emp) === String(e.id) ? "selected" : ""} ${b.capLeftHours <= 0 ? "disabled" : ""}>${h(e.name)} — ${h(e.no)} (المتاح للمنح: ${isD ? n(b.capLeftHours / b.hpd) + " يوم" : n(b.capLeftHours) + " ساعة"})</option>`; }).join("")}</select></div>
        <div class="form-grid">
          <div class="field"><label for="am">${isD ? "عدد الأيام الممنوحة" : "عدد الساعات الممنوحة"} *</label><input id="am" name="amount" type="number" required min="${isD ? 1 : 0.25}" step="${isD ? 1 : 0.25}" inputmode="decimal"></div>
          <div class="field"><label for="dt">تاريخ التوصية *</label><input id="dt" name="date" type="date" required value="${yearFor(todayISO()) ? todayISO() : y.start}"></div>
          <div class="field"><label for="rf">رقم التوصية / الخطاب</label><input id="rf" name="ref" maxlength="64"></div></div>
        <div class="field"><label for="sb">موضوع التكليف</label><input id="sb" name="subject" placeholder="مثال: المراقبة في الاختبارات النهائية"></div>
        <div class="field"><label for="fl">ملف التوصية (PDF)${y.reqRecAtt ? " *" : ""}</label><input id="fl" name="file" type="file" accept="application/pdf,.pdf" ${y.reqRecAtt ? "required" : ""}><span class="hint">نسخة العرض تتحقق من الملف ولا تحفظ محتواه.</span></div>
        <div class="actions"><button class="btn primary">رفع التوصية وإضافة الرصيد</button><a class="btn" href="#/recs">إلغاء</a></div></form>`}`);
  }

  V.requests = (u, q, seg) => {
    if (seg[1] === "new") return reqForm(u, q);
    const y = pickYear(q), kind = q.get("kind") || "", st = q.get("status") || "", emp = Number(q.get("emp") || 0), ids = new Set(visibleEmps(u, true).map((e) => e.id)), isE = u.role === "employee";
    const rows = DB.leaves.filter((r) => r.year === y.id && ids.has(r.emp) && (!kind || r.kind === kind) && (!st || r.status === st) && (!emp || r.emp === emp)).sort((a, b) => b.created.localeCompare(a.created));
    return layout(u, isE ? "طلباتي" : "طلبات الموظفين", `<div class="page-head"><div><h1>${isE ? "طلباتي" : "طلبات الاستبدال والتعويض"}</h1><p>السنة ${h(y.name)} · ${rows.length} طلب</p></div>
      <div class="actions">${STAFF.includes(u.role) ? `<button class="btn" type="button" data-act="export" data-kind="requests" data-year="${y.id}">تصدير Excel</button>` : ""}<a class="btn primary" href="#/requests/new?kind=use">+ طلب استبدال</a><a class="btn primary" href="#/requests/new?kind=compensation">+ طلب تعويض</a></div></div>
      <form class="card filters" data-form="filter" data-route="requests"><div class="field"><label for="k">النوع</label><select id="k" name="kind"><option value="">الكل</option><option value="use" ${kind === "use" ? "selected" : ""}>استبدال</option><option value="compensation" ${kind === "compensation" ? "selected" : ""}>تعويض غياب</option></select></div>
        <div class="field"><label for="s">الحالة</label><select id="s" name="status"><option value="">الكل</option>${Object.entries(REQ_ST).map(([k, v]) => `<option value="${k}" ${st === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        ${isE ? "" : `<div class="field grow"><label for="e">الموظف</label><select id="e" name="emp">${empOptions(visibleEmps(u, true), emp, "الكل")}</select></div>`}${yearSelect(y)}<button class="btn primary">عرض</button></form>
      <div class="card flush"><div class="table-wrap"><table class="responsive">${leaveHead(!isE)}<tbody>${leaveRows(u, rows, !isE) || '<tr><td colspan="8" class="empty">لا توجد طلبات.</td></tr>'}</tbody></table></div></div>`);
  };
  function reqForm(u, q) {
    const kind = q.get("kind") === "compensation" ? "compensation" : "use", isU = kind === "use", y = activeYear();
    const managed = STAFF.includes(u.role) ? managedEmps(u) : [], self = empOf(u);
    if (!managed.length && !self) throw new Forbidden("حسابك غير مرتبط بسجل موظف.");
    if (self && !managed.length && !y.empCanRequest) throw new Forbidden("تقديم الطلبات من الموظفين غير مفعّل حالياً. تواصل مع الإداري.");
    const emp = Number(q.get("emp") || 0) || (self && !managed.length ? self.id : 0), b = emp ? balance(emp, y) : null, eq = emp ? "&emp=" + emp : "", mx = isU ? "" : `max="${todayISO()}"`;
    return layout(u, isU ? "طلب استبدال رصيد" : "طلب تعويض غياب", `<div class="page-head"><div><h1>${ico(isU ? "calendar-plus" : "adjust", "h-ico")} ${isU ? "طلب استبدال رصيد" : "طلب تعويض غياب"}</h1>
      <p>${isU ? "استخدم رصيدك من الأيام أو الساعات في المدة والتاريخ الذي تختاره." : "إذا اضطررت للغياب، يُعوَّض الغياب من رصيدك بعد اعتماد الإداري."} يُعتمد الطلب من الإداري المسؤول.</p></div>
      <div class="seg" role="tablist" aria-label="نوع الطلب"><a href="#/requests/new?kind=use${eq}" class="${isU ? "on" : ""}">استبدال</a><a href="#/requests/new?kind=compensation${eq}" class="${isU ? "" : "on"}">تعويض غياب</a></div></div>
      ${b ? board(b) : ""}
      <form class="card form-narrow" data-form="leave" data-kind="${kind}" data-leave-form>
        ${managed.length ? `<div class="field"><label for="emp">الموظف *</label><select id="emp" name="emp" required data-reqemp="${kind}"><option value="">— اختر —</option>${self ? `<option value="${self.id}" ${emp === self.id ? "selected" : ""}>${h(self.name)} (أنا)</option>` : ""}${managed.map((e) => `<option value="${e.id}" ${emp === e.id ? "selected" : ""}>${h(e.name)} — ${h(e.no)}</option>`).join("")}</select></div>` : `<input type="hidden" name="emp" value="${emp}">`}
        <fieldset class="unit-pick"><legend>الرصيد المستخدم *</legend>
          <label class="radio-card"><input type="radio" name="unit" value="days" checked data-unit> ${ico("calendar")}<span><b>من رصيد الأيام</b>${b ? `<small>المتاح: ${n(b.daysAvail)} يوم</small>` : ""}</span></label>
          <label class="radio-card"><input type="radio" name="unit" value="hours" data-unit> ${ico("clock")}<span><b>من رصيد الساعات</b>${b ? `<small>المتاح: ${n(b.hoursAvail)} ساعة</small>` : ""}</span></label></fieldset>
        <div class="form-grid">
          <div class="field"><label for="sd">${isU ? "من تاريخ" : "تاريخ الغياب"} *</label><input id="sd" name="start" type="date" required ${mx}></div>
          <div class="field" data-for-unit="days"><label for="ed">إلى تاريخ</label><input id="ed" name="end" type="date" ${mx}><span class="hint">تُستبعد عطلة نهاية الأسبوع والعطل الرسمية من العدد.</span></div>
          <div class="field" data-for-unit="hours" hidden><label for="hr">عدد الساعات *</label><input id="hr" name="hours" type="number" min="0.25" step="0.25" inputmode="decimal"><span class="hint">كل ${n(y.hpd)} ساعات = يوم.</span></div></div>
        <div class="field"><label for="rs">${isU ? "السبب / ملاحظات" : "سبب الغياب *"}</label><textarea id="rs" name="reason" ${isU ? "" : "required"}></textarea></div>
        <div class="field"><label for="fl">مستند مؤيد (PDF)${y.reqReqAtt ? " *" : ""}</label><input id="fl" name="file" type="file" accept="application/pdf,.pdf" ${y.reqReqAtt ? "required" : ""}></div>
        <div class="actions"><button class="btn primary">رفع الطلب</button><a class="btn" href="#/requests">إلغاء</a></div></form>`);
  }

  V.approvals = (u) => {
    need(u, STAFF);
    const rows = DB.leaves.filter((r) => r.status === "pending" && canManage(u, byId("emps", r.emp))).sort((a, b) => a.created.localeCompare(b.created));
    return layout(u, "الاعتمادات", `<div class="page-head"><div><h1>الطلبات بانتظار قرارك</h1><p>${rows.length} طلب · يُخصم الرصيد عند الاعتماد، ويُعاد عند الرفض أو الإلغاء.</p></div></div>
      ${rows.length ? `<div class="card flush"><div class="table-wrap"><table class="responsive"><thead><tr><th><input type="checkbox" data-check-all="req" aria-label="تحديد الكل"></th><th>الموظف</th><th>النوع</th><th>المدة</th><th>التاريخ</th><th>السبب</th><th>المتاح</th><th></th></tr></thead><tbody>
      ${rows.map((r) => { const e = byId("emps", r.emp), b = balance(e.id, byId("years", r.year)); return `<tr><td><input type="checkbox" name="req" value="${r.id}" aria-label="تحديد طلب ${h(e.name)}"></td><td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a></td><td data-label="النوع">${kindBadge(r.kind)}</td><td data-label="المدة"><b>${leaveAmount(r)}</b></td>
        <td data-label="التاريخ" class="num">${dateRange(r)}</td><td data-label="السبب">${h(r.reason)} ${pdfChip(r.att)}</td><td data-label="المتاح">${r.unit === "days" ? n(b.daysLeft) + " يوم" : n(b.hoursLeft) + " ساعة"}</td>
        <td class="actions-cell"><button class="btn sm ok" type="button" data-act="decide" data-a="approve" data-id="${r.id}">اعتماد</button><button class="btn sm danger" type="button" data-act="decide" data-a="reject" data-id="${r.id}">رفض</button></td></tr>`; }).join("")}
      </tbody></table></div><div class="actions pad"><button class="btn ok" type="button" data-act="bulk" data-a="approve">اعتماد المحدد</button><button class="btn danger" type="button" data-act="bulk" data-a="reject">رفض المحدد</button></div></div>` : '<div class="card empty">لا توجد طلبات بانتظار قرارك. 👍</div>'}`);
  };

  V.messages = (u, q, seg) => {
    if (seg[1] === "new") return msgForm(u, q);
    if (seg[1]) return msgView(u, Number(seg[1]));
    const box = q.get("box") === "sent" ? "sent" : "in";
    const rows = DB.msgs.filter((m) => (box === "sent" ? m.from === u.id : m.to === u.id)).sort((a, b) => b.at.localeCompare(a.at));
    const unread = DB.msgs.filter((m) => m.to === u.id && !m.read).length;
    return layout(u, "المراسلات", `<div class="page-head"><div><h1>المراسلات</h1><p>رسائل داخل المنصة${box === "in" ? " · " + unread + " غير مقروءة" : ""}. في النظام الفعلي تصل نسخة بالبريد الإلكتروني لمن لديه بريد مسجّل.</p></div><div class="actions"><a class="btn primary" href="#/messages/new">+ رسالة جديدة</a></div></div>
      <div class="seg mb" role="tablist" aria-label="صندوق الرسائل"><a href="#/messages" class="${box === "in" ? "on" : ""}">الوارد</a><a href="#/messages?box=sent" class="${box === "sent" ? "on" : ""}">المرسل</a></div>
      <div class="card flush"><ul class="msg-list">${rows.map((m) => `<li class="${box === "in" && !m.read ? "unread" : ""}"><a href="#/messages/${m.id}"><span class="who">${box === "in" ? h(displayName(m.from ? byId("users", m.from) : null)) : "إلى: " + h(displayName(byId("users", m.to)))}</span><b class="subj">${h(m.subject)}</b><span class="snip">${h(m.body.slice(0, 110))}</span><time class="num">${m.at}</time></a></li>`).join("") || '<li class="empty">لا توجد رسائل.</li>'}</ul></div>`);
  };
  function msgForm(u, q) {
    const rec = recipients(u); let to = Number(q.get("to") || 0), subject = "", body = "";
    const re = q.get("re") && byId("msgs", q.get("re"));
    if (re && [re.to, re.from].includes(u.id)) { to = to || re.from; subject = re.subject.startsWith("رد:") ? re.subject : "رد: " + re.subject; body = "\n\n—— الرسالة الأصلية ——\n" + re.body; }
    return layout(u, "رسالة جديدة", `<div class="page-head"><div><h1>رسالة جديدة</h1><p>${u.role === "employee" ? "تُرسل إلى الإداري المسؤول عنك." : u.role === "officer" ? "إلى مدير النظام أو الموظفين المسندين إليك." : "إلى أي مستخدم في المنصة."}</p></div></div>
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
    return layout(u, "المراسلات", `<div class="page-head"><div><h1>${h(m.subject)}</h1><p>من: ${h(displayName(fr))} · إلى: ${h(displayName(byId("users", m.to)))} · ${m.at}</p></div>
      <div class="actions">${canReply ? `<a class="btn primary" href="#/messages/new?re=${m.id}">رد</a>` : ""}<a class="btn" href="#/print/msg/${m.id}">طباعة</a>${m.link ? `<a class="btn" href="${m.link}">فتح المرتبط</a>` : ""}<a class="btn" href="#/messages">رجوع</a></div></div>
      <article class="card msg-body">${h(m.body)}</article>`);
  }

  V.archive = (u, q) => {
    need(u, STAFF);
    const y = pickYear(q), kind = q.get("kind") || "", emp = Number(q.get("emp") || 0), qs = (q.get("q") || "").trim(), emps = managedEmps(u, true), ids = new Set(emps.map((e) => e.id));
    const match = (r, txt) => !qs || txt.includes(qs);
    const recs = kind === "reqs" ? [] : DB.recs.filter((r) => r.year === y.id && ids.has(r.emp) && (!emp || r.emp === emp)).filter((r) => { const e = byId("emps", r.emp); return match(r, e.name + e.no + r.subject + r.ref); }).sort((a, b) => b.date.localeCompare(a.date));
    const reqs = kind === "recs" ? [] : DB.leaves.filter((r) => r.year === y.id && ids.has(r.emp) && (!emp || r.emp === emp)).filter((r) => { const e = byId("emps", r.emp); return match(r, e.name + e.no + r.reason); }).sort((a, b) => b.start.localeCompare(a.start));
    const msgs = kind ? [] : DB.msgs.filter((m) => (m.from === u.id || m.to === u.id) && m.at.slice(0, 10) >= y.start && m.at.slice(0, 10) <= y.end).sort((a, b) => b.at.localeCompare(a.at));
    return layout(u, "الأرشيف", `<div class="page-head"><div><h1>${ico("archive", "h-ico")} الأرشيف</h1><p>سجل موثّق لكل التوصيات والطلبات والمراسلات${u.role === "officer" ? " للموظفين المسندين إليك" : ""} — السنة ${h(y.name)}</p></div>
      <div class="actions"><button class="btn primary" type="button" data-act="archive-export" data-year="${y.id}">تنزيل أرشيف السنة (Excel)</button></div></div>
      <form class="card filters" data-form="filter" data-route="archive"><div class="field grow"><label for="aq">بحث</label><input id="aq" type="search" name="q" value="${h(qs)}" placeholder="اسم، رقم وظيفي، موضوع، رقم توصية"></div>
        <div class="field"><label for="k">النوع</label><select id="k" name="kind"><option value="">الكل</option><option value="recs" ${kind === "recs" ? "selected" : ""}>التوصيات</option><option value="reqs" ${kind === "reqs" ? "selected" : ""}>الطلبات</option></select></div>
        <div class="field"><label for="e">الموظف</label><select id="e" name="emp">${empOptions(emps, emp, "الكل")}</select></div>${yearSelect(y)}<button class="btn primary">عرض</button></form>
      <p class="hint">في النظام الفعلي تُنزَّل حزمة ZIP تضم ملف Excel فهرساً مع ملفات PDF المرفقة، لحفظها في أرشيف الوحدة.</p>
      ${kind !== "reqs" ? `<section class="card flush"><h2>التوصيات (${recs.length})</h2><div class="table-wrap"><table class="responsive"><thead><tr><th>رقم</th><th>التاريخ</th><th>الموظف</th><th>النوع</th><th>القيمة</th><th>رقم التوصية</th><th>الموضوع</th><th>الحالة</th><th></th></tr></thead><tbody>
        ${recs.map((r) => { const e = byId("emps", r.emp); return `<tr class="${r.status !== "active" ? "muted-row" : ""}"><td data-label="رقم" class="num">REC-${r.id}</td><td data-label="التاريخ" class="num">${r.date}</td><td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a></td><td data-label="النوع">${kindBadge(r.kind)}</td><td data-label="القيمة">${recAmount(r)}</td><td data-label="رقم التوصية">${h(r.ref)}</td><td data-label="الموضوع">${h(r.subject)}</td><td data-label="الحالة">${statusBadge(r.status === "active" ? "approved" : "cancelled", r.status === "active" ? "سارية" : "ملغاة")}</td><td class="actions-cell"><a class="btn sm" href="#/print/rec/${r.id}">إشعار</a> ${pdfChip(r.att)}</td></tr>`; }).join("") || '<tr><td colspan="9" class="empty">لا توجد توصيات.</td></tr>'}</tbody></table></div></section>` : ""}
      ${kind !== "recs" ? `<section class="card flush"><h2>الطلبات (${reqs.length})</h2><div class="table-wrap"><table class="responsive"><thead><tr><th>رقم</th><th>الموظف</th><th>النوع</th><th>المدة</th><th>التاريخ</th><th>الحالة</th><th></th></tr></thead><tbody>
        ${reqs.map((r) => { const e = byId("emps", r.emp); return `<tr><td data-label="رقم" class="num">REQ-${r.id}</td><td data-label="الموظف"><a href="#/employee/${e.id}">${h(e.name)}</a></td><td data-label="النوع">${kindBadge(r.kind)}</td><td data-label="المدة">${leaveAmount(r)}</td><td data-label="التاريخ" class="num">${dateRange(r)}</td><td data-label="الحالة">${statusBadge(r.status, REQ_ST[r.status])}</td><td class="actions-cell"><a class="btn sm" href="#/print/req/${r.id}">نموذج</a></td></tr>`; }).join("") || '<tr><td colspan="7" class="empty">لا توجد طلبات.</td></tr>'}</tbody></table></div></section>` : ""}
      ${msgs.length ? `<section class="card flush"><h2>مراسلاتي (${msgs.length})</h2><ul class="msg-list">${msgs.map((m) => `<li><a href="#/messages/${m.id}"><span class="who">${m.from === u.id ? "إلى: " + h(displayName(byId("users", m.to))) : h(displayName(m.from ? byId("users", m.from) : null))}</span><b class="subj">${h(m.subject)}</b><span class="snip">${h(m.body.slice(0, 110))}</span><time class="num">${m.at}</time></a></li>`).join("")}</ul></section>` : ""}`);
  };

  V.reports = (u, q) => {
    need(u, STAFF);
    const y = pickYear(q), ids = new Set(managedEmps(u, true).map((e) => e.id));
    const recs = DB.recs.filter((r) => r.year === y.id && r.status === "active" && ids.has(r.emp)), reqs = DB.leaves.filter((r) => r.year === y.id && ids.has(r.emp));
    const c = (f) => reqs.filter(f).length;
    return layout(u, "التقارير", `<div class="page-head"><div><h1>التقارير</h1><p>السنة ${h(y.name)}</p></div>${yearSelect(y)}</div>
      <div class="grid kpis">
        <div class="kpi brand">${ico("cal-check")}<div class="l">التوصيات السارية</div><div class="v">${recs.length}</div><div class="s">${n(recs.filter((r) => r.kind === "days").reduce((s, r) => s + r.amount, 0))} يوم · ${n(recs.filter((r) => r.kind === "hours").reduce((s, r) => s + r.amount, 0))} ساعة</div></div>
        <div class="kpi accent">${ico("calendar")}<div class="l">الطلبات</div><div class="v">${reqs.length}</div><div class="s">استبدال ${c((r) => r.kind === "use")} · تعويض ${c((r) => r.kind === "compensation")}</div></div>
        <div class="kpi ok">${ico("approvals")}<div class="l">معتمدة</div><div class="v">${c((r) => r.status === "approved")}</div><div class="s">مرفوضة ${c((r) => r.status === "rejected")} · ملغاة ${c((r) => r.status === "cancelled")}</div></div>
        <div class="kpi warn">${ico("hourglass")}<div class="l">بانتظار القرار</div><div class="v">${c((r) => r.status === "pending")}</div></div>
        <div class="kpi">${ico("audit")}<div class="l">توصيات بلا PDF</div><div class="v">${recs.filter((r) => !r.att).length}</div></div></div>
      <section class="card"><h2>التصدير إلى Excel</h2><div class="actions"><button class="btn" type="button" data-act="export" data-kind="balances" data-year="${y.id}">أرصدة الموظفين</button><button class="btn" type="button" data-act="export" data-kind="recs" data-year="${y.id}">سجل التوصيات</button><button class="btn" type="button" data-act="export" data-kind="requests" data-year="${y.id}">سجل الطلبات</button></div></section>`);
  };


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
        <fieldset ${dis}><legend>قواعد الرصيد (سنوي)</legend><div class="form-grid">
          <div class="field"><label for="${p}b">الحد الأقصى السنوي لكل موظف (يوم)</label><input id="${p}b" type="number" min="0" name="cap" value="${y ? y.cap : 20}"><span class="hint">مجموع توصيات الأيام والساعات (بالمعادل) لا يتجاوزه.</span></div>
          <div class="field"><label for="${p}h">عدد الساعات التي تعادل يوماً</label><input id="${p}h" type="number" step="0.25" min="0.25" name="hpd" value="${y ? y.hpd : 7}"></div></div></fieldset>
        <fieldset ${dis}><legend>المرفقات والقواعد</legend>
          ${chk("reqRecAtt", "إرفاق ملف التوصية (PDF) إلزامي عند رفع التوصية")}${chk("reqReqAtt", "إرفاق مستند مؤيد (PDF) إلزامي لطلبات الموظف")}
          ${chk("empCanRequest", "السماح للموظف بتقديم طلباته بنفسه", true)}${chk("blockWeekends", "استبعاد أيام عطلة نهاية الأسبوع من مدة الطلب", true)}
          <div class="actions" style="margin:-.2rem 1.6rem .6rem 0">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<label class="check" style="margin:0"><input type="checkbox" name="weekend" value="${i}" ${(y ? y.weekend : [5, 6]).includes(i) ? "checked" : ""}> ${WD[i]}</label>`).join("")}</div>
          ${chk("allowLateCancel", "السماح بإلغاء طلب معتمد بعد مرور تاريخه (لغير الأدمن)")}</fieldset>
        ${y && y.locked ? "" : `<button class="btn primary">${y ? "حفظ الإعدادات" : "إنشاء السنة"}</button>`}</form>`; };
    return layout(u, "السنة وقواعد الرصيد", `<div class="page-head"><div><h1>السنة وقواعد الرصيد</h1><p>الرصيد سنوي (سنة ميلادية): يُمنح بتوصيات العميد التي يرفعها الإداري، ولا يُرحَّل إلى السنة التالية.</p></div></div>
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
        <div class="card flush"><div class="table-wrap"><table class="responsive"><thead><tr><th>السطر</th><th>الاسم</th><th>الرقم الوظيفي</th><th>القسم</th><th>المنصب</th><th>رقم الإداري</th><th>النتيجة</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="${r.action === "error" ? "has-err" : ""}"><td data-label="السطر">${r.line}</td><td data-label="الاسم">${h(r.name)}</td><td data-label="الرقم" class="num">${h(r.no)}</td><td data-label="القسم">${h(r.dept)}</td>
          <td data-label="المنصب">${r.role ? ROLES[r.role] : "موظف (افتراضي)"}</td><td data-label="رقم الإداري" class="num">${h(r.manager)}</td>
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
        <section class="card"><h2>1) رفع ملف Excel أو CSV</h2>
          <ol class="steps"><li><b>نزّل النموذج</b> وعبّئه (فيه ورقة «القوائم» بالأقسام وأرقام الإداريين، وورقة تعليمات):
            <div class="actions mt-sm"><button class="btn primary sm" type="button" data-act="template">نموذج فارغ للتعبئة</button><button class="btn sm" type="button" data-act="template" data-filled="1">الموظفون الحاليون (للتعديل)</button></div></li>
            <li><b>احفظه</b> بصيغة ‎.xlsx دون تغيير صف العناوين.</li><li><b>ارفعه هنا</b> ثم اضغط «معاينة قبل الحفظ».</li></ol><div class="field"><label for="if">الملف <span class="hint">(‎.xlsx أو ‎.csv، أول ورقة فقط)</span></label><input id="if" type="file" name="file" accept=".xlsx,.xlsm,.csv"></div>
          <p class="hint">يتعرّف النظام على الأعمدة من عناوينها: الاسم، الرقم الوظيفي، القسم، المنصب، رقم الإداري المسؤول، المسمى الوظيفي، البريد.</p></section>
        <section class="card"><h2>2) أو النسخ واللصق</h2><div class="field"><label for="ip">انسخ الأعمدة من Excel والصقها هنا <span class="hint">(سطر لكل موظف)</span></label>
          <textarea id="ip" name="pasted" rows="8" placeholder="محمد أحمد العتيبي	100500	وحدة الشؤون الإدارية	موظف	100100"></textarea></div>
          <p class="hint">بدون صف عناوين يُفترض الترتيب: الاسم، الرقم الوظيفي، القسم، المنصب، رقم الإداري المسؤول، المسمى، البريد.</p></section></div>
      <section class="card"><h2>المناصب</h2><div class="grid kpis" style="margin:0">
        <div class="kpi"><div class="l">موظف</div><div class="s">يتابع رصيده من الأيام والساعات ويرفع طلبات الاستبدال والتعويض</div></div><div class="kpi"><div class="l">إداري</div><div class="s">يُسند له موظفون؛ يرفع توصياتهم ويعتمد طلباتهم ويراسلهم</div></div></div>
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
    const teamCount = (empId) => DB.emps.filter((e) => e.active && empId && e.mgr === empId).length;
    const assignBox = (offEmp, open) => `<div class="assign-box" data-role-dep="officer" ${open ? "" : "hidden"}><input type="hidden" name="assign_present" value="1">
      <div class="assign-head"><b>الموظفون المسندون لهذا الإداري</b><span class="hint" data-assign-count></span></div>
      <input type="search" class="assign-filter" placeholder="بحث بالاسم أو الرقم أو القسم" data-assign-filter aria-label="بحث في الموظفين">
      <div class="assign-actions"><button type="button" class="btn sm" data-assign-all="1">تحديد الظاهر</button><button type="button" class="btn sm" data-assign-all="0">إلغاء التحديد</button></div>
      <div class="check-list">${emps.filter((e) => e.id !== offEmp).map((e) => `<label class="check" data-text="${h(e.name + " " + e.no + " " + deptName(e))}"><input type="checkbox" name="assign" value="${e.id}" ${offEmp && e.mgr === offEmp ? "checked" : ""}>
        <span>${h(e.name)} <small class="muted">(${h(e.no)})${deptName(e) ? " · " + h(deptName(e)) : ""}${e.mgr && e.mgr !== offEmp ? " · حالياً لدى: " + h(mgrName(e)) : ""}</small></span></label>`).join("") || '<p class="hint">لا يوجد موظفون. أضفهم من «استيراد الموظفين».</p>'}</div>
      <span class="hint">اختيار موظف مسند لإداري آخر ينقله إلى هذا الإداري.</span></div>`;
    return layout(u, "المستخدمون والصلاحيات", `<div class="page-head"><div><h1>المستخدمون والصلاحيات</h1><p>${DB.users.length} حساب</p></div>
      <button class="btn" type="button" data-act="bulk-users">إنشاء حسابات الموظفين دفعة واحدة</button></div>
      <div class="grid two"><section class="card"><h2>الأدوار</h2><ul>
        <li><b>مدير النظام:</b> إدارة المنصة: المستخدمون والصلاحيات، إسناد الموظفين للإداريين، السنة وقواعد الرصيد، المؤشرات والاعتمادات، الإعدادات وسجل التدقيق.</li>
        <li><b>إداري:</b> يُسند له موظفون؛ يرفع توصيات العميد (بالأيام أو بالساعات) بملف PDF في حساب الموظف، ويعتمد طلبات الاستبدال والتعويض، ويراسل موظفيه والأدمن.</li>
        <li><b>موظف:</b> يتابع رصيده من الأيام والساعات، ويرفع طلبات الاستبدال أو تعويض الغياب، ويراسل الإداري المسؤول عنه.</li></ul>
        <p class="hint">عند اختيار دور «إداري» تظهر قائمة لاختيار الموظفين المسندين إليه (أكثر من موظف)، ويمكن أيضاً الإسناد من بطاقة الموظف أو ملف الاستيراد.</p></section>
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

  A.holidays = (u) => layout(u, "العطل الرسمية", `<div class="page-head"><div><h1>العطل الرسمية</h1><p>تُستبعد هذه الأيام من مدة طلبات الاستبدال والتعويض.</p></div></div>
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

  const WIPE_WORD = "حذف", RESTORE_WORD = "استعادة";
  A.data = (u) => {
    const last = DB.audit.find((a) => a.action === "backup_downloaded");
    return layout(u, "النسخ الاحتياطي والبيانات", `<div class="page-head"><div><h1>${ico("database", "h-ico")} النسخ الاحتياطي والبيانات</h1>
      <p>البيانات الحالية: ${DB.emps.length} موظف · ${DB.users.length} حساب · ${DB.recs.length} توصية · ${DB.leaves.length} طلب · ${DB.msgs.length} رسالة</p></div></div>
      <div class="grid two">
        <section class="card"><h2>${ico("archive", "sm-ico")} أخذ نسخة احتياطية</h2>
          <p>ملف واحد يضم كل البيانات (الموظفين، الحسابات، التوصيات، الطلبات، المراسلات، الإعدادات، سجل التدقيق). في النظام الفعلي يضم أيضاً ملفات PDF المرفقة.</p>
          <p class="hint">${last ? "آخر نسخة نُزّلت: " + h(last.at) + " بواسطة " + h(last.user) + "." : "لم تُنزَّل أي نسخة احتياطية بعد."} احفظ الملف في مكان آمن.</p>
          <button class="btn primary" type="button" data-act="backup">تنزيل نسخة احتياطية الآن</button></section>
        <section class="card"><h2>${ico("upload", "sm-ico")} استعادة نسخة احتياطية</h2>
          <p>تستبدل <b>كل</b> البيانات الحالية بمحتوى النسخة، ثم يُطلب تسجيل الدخول من جديد.</p>
          <form data-form="restore"><div class="field"><label for="bf">ملف النسخة</label><input id="bf" type="file" name="file" accept=".json,application/json" required></div>
            <div class="field"><label for="rc">للتأكيد اكتب كلمة «${RESTORE_WORD}»</label><input id="rc" name="confirm" autocomplete="off" required></div>
            <button class="btn">استعادة</button></form></section></div>
      <section class="card danger-zone"><h2>⚠ حذف جميع البيانات</h2>
        <p>يحذف نهائياً: الموظفين، وجميع الحسابات عدا حسابك، والتوصيات، والطلبات، والمراسلات، والأقسام، والعطل، وسجل التدقيق. تبقى السنوات وهوية الجهة وحسابك فقط. <b>لا يمكن التراجع</b> إلا باستعادة نسخة احتياطية.</p>
        <p class="hint">ننصح بتنزيل نسخة احتياطية أولاً. (في نسخة العرض يمكنك إرجاع البيانات التجريبية من «استعادة بيانات العرض».)</p>
        <form class="filters" data-form="wipe"><div class="field grow"><label for="wc">للتأكيد اكتب كلمة «${WIPE_WORD}»</label><input id="wc" name="confirm" autocomplete="off" required placeholder="${WIPE_WORD}"></div>
          <button class="btn danger">حذف جميع البيانات</button></form></section>`);
  };

  A.audit = (u, q) => { const qs = (q.get("q") || "").trim(); const rows = DB.audit.filter((a) => !qs || [a.user, a.action, a.entity, a.details].join(" ").includes(qs)).slice(0, 300);
    return layout(u, "سجل التدقيق", `<div class="page-head"><div><h1>سجل التدقيق</h1><p>كل عملية دخول وإنشاء وتعديل واعتماد.</p></div></div>
      <form class="card filters" data-form="filter" data-route="admin/audit"><div class="field grow"><label for="aq">بحث</label><input id="aq" type="search" name="q" value="${h(qs)}"></div><button class="btn primary">بحث</button></form>
      <div class="card flush"><div class="table-wrap"><table class="responsive"><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>الكيان</th><th>التفاصيل</th></tr></thead><tbody>
      ${rows.map((a) => `<tr><td class="num nowrap" data-label="الوقت">${a.at}</td><td data-label="المستخدم">${h(a.user)}</td><td data-label="العملية"><code>${h(a.action)}</code></td><td data-label="الكيان">${h(a.entity)}${a.entityId ? " #" + a.entityId : ""}</td><td data-label="التفاصيل"><small>${h(a.details)}</small></td></tr>`).join("") || '<tr><td colspan="5" class="empty">لا توجد سجلات.</td></tr>'}
      </tbody></table></div></div>`); };

  // ============================================================ الاستيراد
  const HEADERS = { name: ["الاسم", "اسم الموظف", "الاسم الكامل", "الموظف", "name"], no: ["الرقم الوظيفي", "الرقم", "رقم الموظف", "رقم وظيفي", "employee no", "id"],
    dept: ["القسم", "الوحده", "الاداره", "الجهه", "department"], role: ["المنصب", "الدور", "الصلاحيه", "نوع الحساب", "role"],
    manager: ["رقم الإداري", "الإداري المسؤول", "الإداري", "رقم المدير المباشر", "المدير المباشر", "رقم المدير", "المدير", "manager"], title: ["المسمى الوظيفي", "المسمى", "الوظيفه", "title"], email: ["البريد", "البريد الالكتروني", "البريد الجامعي", "الايميل", "email"] };
  const HL = {}; Object.entries(HEADERS).forEach(([k, vs]) => vs.forEach((v) => (HL[norm(v).toLowerCase()] = k)));
  const ROLE_WORDS = { "موظف": "employee", "employee": "employee", "اداري": "officer", "officer": "officer", "مسؤول": "officer", "مسئول": "officer", "مسؤول الادخال": "officer", "مدخل بيانات": "officer",
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
      const rt = norm(g("role")).toLowerCase(); if (rt) { if (ROLE_WORDS[rt]) row.role = ROLE_WORDS[rt]; else row.errors.push("منصب غير معروف «" + g("role") + "» (المسموح: موظف، إداري)"); }
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
      if (r.manager && r.manager === r.no) r.errors.push("لا يُسند الموظف إلى نفسه");
      else if (r.manager && !fileNos.has(r.manager) && !byNo[r.manager]) r.errors.push("رقم الإداري المسؤول " + r.manager + " غير موجود");
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
    const u = me(), y = byId("years", yearId) || activeYear(), ids = new Set(managedEmps(u, true).map((e) => e.id));
    let head, rows, name;
    if (kind === "balances") { head = ["م", "اسم الموظف", "الرقم الوظيفي", "القسم", "الإداري", "أيام ممنوحة", "ساعات ممنوحة", "أيام مستخدمة", "ساعات مستخدمة", "رصيد الأيام", "رصيد الساعات", "الإجمالي (أيام)", "+ ساعات", "الممنوح بالأيام المعادلة", "الحد الأقصى"];
      rows = managedEmps(u).map((e, i) => { const b = balance(e.id, y); return [i + 1, e.name, e.no, deptName(e), mgrName(e), b.gDays, b.gHours, b.uDays, b.uHours, b.daysLeft, b.hoursLeft, b.totalDays, b.totalRem, b.grantedEq, b.cap]; });
      name = "أرصدة بدل الراحة " + y.name; }
    else if (kind === "recs") { head = ["م", "اسم الموظف", "الرقم الوظيفي", "تاريخ التوصية", "النوع", "القيمة", "رقم التوصية", "الموضوع", "الحالة", "ملف PDF"];
      rows = DB.recs.filter((r) => r.year === y.id && ids.has(r.emp)).sort((a, b) => a.date.localeCompare(b.date)).map((r, i) => { const e = byId("emps", r.emp); return [i + 1, e.name, e.no, r.date, REC_KINDS[r.kind], r.amount, r.ref, r.subject, r.status === "active" ? "سارية" : "ملغاة", r.att ? "نعم" : ""]; });
      name = "توصيات بدل الراحة " + y.name; }
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
    u.pw = await sha(nw); u.mustChange = false; audit("password_changed", "user", u.id); save(); flash("تم تغيير كلمة المرور بنجاح."); go("#/");
  };
  F.quicksearch = (form) => go("#/employees?q=" + encodeURIComponent(fd(form).get("q") || ""));
  F.filter = (form) => { const p = new URLSearchParams(); for (const [k, v] of fd(form)) if (v) p.append(k, v); go("#/" + form.dataset.route + (p.toString() ? "?" + p : "")); };
  F.employee = (form, u) => {
    need(u, ["admin"]);
    const d = fd(form), id = Number(form.dataset.id || 0), no = String(d.get("no")).trim(), name = String(d.get("name")).replace(/\s+/g, " ").trim();
    if (!no || !name) throw new RuleError("الرقم الوظيفي والاسم حقلان إلزاميان.");
    const dup = DB.emps.find((e) => e.no === no && e.id !== id); if (dup) throw new RuleError("الرقم الوظيفي مستخدم لموظف آخر: " + dup.name + ".");
    if (DB.emps.find((e) => norm(e.name) === norm(name) && e.id !== id)) throw new RuleError("يوجد موظف مسجل بنفس الاسم. أضف ما يميّزه.");
    const mgr = Number(d.get("mgr") || 0) || null; if (id && mgr === id) throw new RuleError("لا يمكن إسناد الموظف إلى نفسه.");
    let e = id ? byId("emps", id) : null;
    if (!e) { e = { id: nid(), active: true }; DB.emps.push(e); } else e.active = !!d.get("active");
    Object.assign(e, { no, name, dept: Number(d.get("dept") || 0) || null, mgr, title: String(d.get("title") || ""), email: String(d.get("email") || "") });
    audit(id ? "employee_updated" : "employee_created", "employee", e.id, { no, name, officer: mgr }); save(); flash("تم حفظ بيانات الموظف."); go("#/employee/" + e.id);
  };
  F.rec = async (form, u) => {
    need(u, STAFF);
    const d = fd(form), kind = form.dataset.kind, e = byId("emps", d.get("emp"));
    if (!e || !canManage(u, e)) throw new RuleError("اختر موظفاً من الموظفين المسندين إليك.");
    const amount = toNum(d.get("amount")), date = String(d.get("date") || todayISO()), att = await pdfCheck(d.get("file"));
    const y = validateRec(e, kind, amount, date, !!att);
    const r = { id: nid(), emp: e.id, year: y.id, kind, amount, date, ref: String(d.get("ref") || "").trim(), subject: String(d.get("subject") || "").trim(), status: "active", att, by: u.id, cancelNote: "", created: nowStr() };
    DB.recs.push(r); audit("recommendation_added", "recommendation", r.id, { employee: e.no, kind, amount });
    notify(userOfEmp(e), "منحك بدل راحة: " + recAmount(r), "أُضيفت إلى رصيدك توصية بمنحك " + REC_KINDS[kind] + ": " + recAmount(r) + (r.subject ? " — " + r.subject : "") + ".", "#/me", u);
    save(); flash("تم رفع التوصية وإضافة " + recAmount(r) + " إلى رصيد " + e.name + "."); go("#/employee/" + e.id);
  };
  F.leave = async (form, u) => {
    const d = fd(form), kind = form.dataset.kind, unit = String(d.get("unit") || "days"), y0 = activeYear();
    const e = byId("emps", d.get("emp") || u.emp); if (!e) throw new RuleError("اختر الموظف.");
    const own = e.id === u.emp; if (!own && !canManage(u, e)) throw new RuleError("ليست لديك صلاحية لتقديم طلب لهذا الموظف.");
    if (own && u.role === "employee" && !y0.empCanRequest) throw new RuleError("تقديم الطلبات من الموظفين غير مفعّل حالياً.");
    const att = await pdfCheck(d.get("file"));
    const v = validateLeave(e, kind, unit, String(d.get("start") || ""), String(d.get("end") || "") || null, unit === "hours" ? toNum(d.get("hours")) : null, !!att);
    const r = { id: nid(), emp: e.id, year: v.y.id, kind, unit, start: String(d.get("start")), end: v.end, days: v.days, hours: v.hours, reason: String(d.get("reason") || "").trim(), status: "pending", att, by: u.id, decidedBy: null, decidedAt: null, note: "", created: nowStr() };
    DB.leaves.push(r); audit("leave_requested", "leave_request", r.id, { employee: e.no, kind, unit, days: v.days, hours: v.hours });
    if (own) (officerUsersFor(e).length ? officerUsersFor(e) : DB.users.filter((x) => x.role === "admin")).forEach((o) => notify(o, "طلب " + LEAVE_KINDS[kind] + " جديد من " + e.name, LEAVE_KINDS[kind] + " — " + leaveAmount(r) + " بتاريخ " + r.start + ". " + r.reason, "#/approvals", u));
    save(); flash("تم رفع طلب " + LEAVE_KINDS[kind] + " (" + leaveAmount(r) + ")" + (own ? " وهو بانتظار اعتماد الإداري." : ".")); go("#/requests");
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
    Object.assign(y, { name, start, end, cap: Math.trunc(cap), hpd, weekend: d.getAll("weekend").map(Number) });
    ["reqRecAtt", "reqReqAtt", "empCanRequest", "blockWeekends", "allowLateCancel"].forEach((k) => (y[k] = !!d.get(k)));
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
    save(); importPreview = null; createdAccounts = res.accounts;
    flash("تمت إضافة " + res.created + " موظف وتحديث " + res.updated + "، وإنشاء " + res.accounts.length + " حساب" + (res.roles ? "، وتغيير منصب " + res.roles : "") + "."); render();
  };
  // إسناد الموظفين للإداري (اختيار متعدد). يعيد عدد المسندين أو null إن لم تُرسل القائمة
  function applyAssign(d, role, emp, prevRole, prevEmp) {
    if (prevRole === "officer" && prevEmp && (role !== "officer" || prevEmp !== emp)) {
      const moved = DB.emps.filter((e) => e.mgr === prevEmp); moved.forEach((e) => (e.mgr = null));
      if (moved.length) flash("أُلغي إسناد " + moved.length + " موظف لأن الحساب لم يعد «إداري» لنفس السجل. أسندهم لإداري آخر.", "warn");
    }
    if (role !== "officer" || !emp || !d.get("assign_present")) return null;
    const wanted = new Set(d.getAll("assign").map(Number).filter((id) => id !== emp));
    DB.emps.forEach((e) => { if (wanted.has(e.id)) e.mgr = emp; else if (e.mgr === emp) e.mgr = null; });
    return wanted.size;
  }
  F["user-new"] = async (form, u) => {
    const d = fd(form), un = String(d.get("username")).trim().toLowerCase(), role = d.get("role"), emp = Number(d.get("emp") || 0) || null;
    if (!un || DB.users.some((x) => x.username.toLowerCase() === un)) throw new RuleError("اسم المستخدم فارغ أو مستخدم مسبقاً.");
    if (["employee", "officer"].includes(role) && !emp) throw new RuleError("يجب ربط حساب الموظف/الإداري بسجل موظف.");
    if (emp && DB.users.some((x) => x.emp === emp)) throw new RuleError("هذا الموظف مرتبط مسبقاً بحساب آخر.");
    const pw = rand(); DB.users.push({ id: nid(), username: un, pw: await sha(pw), role, emp, active: true, mustChange: true });
    const n_ = applyAssign(d, role, emp, null, null);
    audit("user_saved", "user", null, { username: un, role, assigned: n_ }); save(); flash("تم إنشاء الحساب " + un + ". كلمة المرور المؤقتة: " + pw + (n_ != null ? " · الموظفون المسندون: " + n_ : "")); render();
  };
  F["user-edit"] = (form, u) => {
    const d = fd(form), x = byId("users", form.dataset.id), role = d.get("role"), emp = Number(d.get("emp") || 0) || null, active = !!d.get("active");
    if (["employee", "officer"].includes(role) && !emp) throw new RuleError("يجب ربط حساب الموظف/الإداري بسجل موظف.");
    if (x.id === u.id && (role !== "admin" || !active)) throw new RuleError("لا يمكنك إزالة صلاحية الأدمن أو تعطيل حسابك بنفسك.");
    const prevRole = x.role, prevEmp = x.emp;
    Object.assign(x, { role, emp, active });
    const n_ = applyAssign(d, role, emp, prevRole, prevEmp);
    audit("user_saved", "user", x.id, { role, active, assigned: n_ }); save();
    flash("تم حفظ الحساب." + (n_ != null ? " الموظفون المسندون: " + n_ + "." : "")); if (role === "officer" && prevRole !== "officer") flash("أصبح الحساب «إداري». افتح «الموظفون المسندون» تحت الحساب لاختيار موظفيه.", "info"); render();
  };
  F["dept-new"] = (form) => { const nm = String(fd(form).get("name")).replace(/\s+/g, " ").trim(); if (!nm || DB.depts.some((d) => norm(d.name) === norm(nm))) throw new RuleError("اسم القسم فارغ أو مكرر."); DB.depts.push({ id: nid(), name: nm, active: true }); audit("department_saved", "department", null, { name: nm }); save(); flash("تم حفظ القسم."); render(); };
  F["dept-edit"] = (form) => { const d = fd(form), x = byId("depts", form.dataset.id), nm = String(d.get("name")).trim(); if (!nm || DB.depts.some((y) => y.id !== x.id && norm(y.name) === norm(nm))) throw new RuleError("اسم القسم فارغ أو مكرر."); x.name = nm; x.active = !!d.get("active"); save(); flash("تم حفظ القسم."); render(); };
  F["dept-merge"] = (form) => { const d = fd(form), s = Number(d.get("src")), t = Number(d.get("dst")); if (s === t) throw new RuleError("اختر قسمين مختلفين."); if (!confirm("دمج القسمين ونقل موظفي الأول إلى الثاني وحذف الأول؟")) return; let c = 0; DB.emps.forEach((e) => { if (e.dept === s) { e.dept = t; c++; } }); const src = byId("depts", s); DB.depts = DB.depts.filter((x) => x.id !== s); audit("department_merged", "department", t, { source: src.name, moved: c }); save(); flash("تم الدمج ونقل " + c + " موظف."); render(); };
  F.holiday = (form) => { const d = fd(form), s = parseISO(d.get("start")), e = parseISO(d.get("end") || d.get("start")), nm = String(d.get("name")).trim(); if (!s || !e || e < s || (e - s) / 864e5 > 60 || !nm) throw new RuleError("بيانات العطلة غير صحيحة."); let c = 0; for (let x = new Date(s); x <= e; x.setDate(x.getDate() + 1)) { const k = iso(x); if (!DB.holidays.some((y) => y.day === k)) { DB.holidays.push({ id: nid(), day: k, name: nm }); c++; } } audit("holiday_added", "holiday", null, { name: nm }); save(); flash("تمت إضافة " + c + " يوم عطلة."); render(); };
  F.restore = async (form, u) => {
    const d = fd(form), file = d.get("file");
    if (String(d.get("confirm") || "").trim() !== RESTORE_WORD) throw new RuleError("للتأكيد اكتب كلمة «" + RESTORE_WORD + "» في الحقل المخصص.");
    if (!file || !file.name) throw new RuleError("اختر ملف النسخة الاحتياطية.");
    let data; try { data = JSON.parse(await file.text()); } catch (e) { throw new RuleError("الملف ليس نسخة احتياطية صالحة من النظام."); }
    if (!data || data.format !== "itmam-demo-backup" || !data.db || !Array.isArray(data.db.users) || !data.db.users.length) throw new RuleError("الملف ليس نسخة احتياطية صالحة من النظام.");
    if (!confirm("استبدال كل البيانات الحالية بمحتوى النسخة الاحتياطية؟")) return;
    DB = data.db; DB.audit.unshift({ id: nid(), at: nowStr(), user: u.username, action: "backup_restored", entity: "system", entityId: null, details: "" });
    save(); sessionStorage.removeItem("hr_uid"); flash("تمت استعادة النسخة الاحتياطية (" + DB.emps.length + " موظف، " + DB.users.length + " حساب). سجّل الدخول من جديد."); go("#/login");
  };
  F.wipe = (form, u) => {
    need(u, ["admin"]);
    if (String(fd(form).get("confirm") || "").trim() !== WIPE_WORD) throw new RuleError("لم يُحذف شيء: للتأكيد اكتب كلمة «" + WIPE_WORD + "» كما هي.");
    if (!confirm("تأكيد أخير: حذف جميع البيانات نهائياً؟")) return;
    u.emp = null;
    Object.assign(DB, { users: [u], emps: [], depts: [], recs: [], leaves: [], msgs: [], holidays: [], audit: [] });
    audit("all_data_wiped", "system"); save(); flash("تم حذف جميع البيانات. بقيت السنوات وهوية الجهة وحسابك فقط."); render();
  };
  F.settings = (form) => { const d = fd(form); ["university", "college", "system_title", "tagline", "credit"].forEach((k) => (DB.settings[k] = String(d.get(k) || "").trim())); audit("settings_saved", "settings"); save(); flash("تم حفظ الإعدادات."); render(); };

  // ============================================================ الإجراءات
  const ACT = {};
  function aboutHTML(s) { return `<div class="about-doc">
  <p class="about-lead"><b>«${h(s.system_title)}»</b> نظام إلكتروني داخلي لإدارة أيام بدل الراحة لمنسوبي ${h(s.college)} في ${h(s.university)}. يحلّ محل السجلات الورقية وجداول Excel، ويوحّد في منصة واحدة آمنة وقابلة للتدقيق توثيقَ توصيات العميد بمنح بدل الراحة (بالأيام أو بالساعات)، واحتسابَ الأرصدة آلياً، واعتمادَ طلبات الاستبدال وتعويض الغياب.</p>
  <h3>الأهداف</h3>
  <ul>
    <li>توحيد إجراءات بدل الراحة وضبطها وفق قواعد معتمدة يحددها مدير النظام.</li>
    <li>تمكين الموظف من الاطلاع على رصيده وحركاته بشفافية في أي وقت.</li>
    <li>تسريع دورة العمل بين مدير النظام والإداري والموظف، وتوثيق المراسلات بينهم.</li>
    <li>توفير مرجعية موثّقة تدعم أعمال المراجعة والتدقيق الداخلي.</li>
  </ul>
  <h3>الخدمات الرئيسية</h3>
  <ul>
    <li><b>التوصيات:</b> رفع توصية العميد (PDF) في حساب الموظف بمنحه بدل راحة بالأيام أو بالساعات، ضمن حد أقصى سنوي (افتراضياً 20 يوماً).</li>
    <li><b>الاحتساب الآلي:</b> احتساب رصيد الأيام ورصيد الساعات، ومعادلة الساعات بالأيام وفق المعادلة المعتمدة (افتراضياً: كل 7 ساعات تعادل يوماً واحداً).</li>
    <li><b>طلبات الموظف:</b> طلب استبدال الرصيد بإجازة في التاريخ والمدة المختارة، أو طلب تعويض غياب من الرصيد، واعتمادهما إلكترونياً من الإداري المسؤول.</li>
    <li><b>المراسلات:</b> مراسلات داخل المنصة بين مدير النظام والإداريين والموظفين، مع إشعارات بالبريد الإلكتروني.</li>
    <li><b>الخطابات والكشوف:</b> إشعارات المنح ونماذج الطلبات والكشوف السنوية والمراسلات بصيغة رسمية قابلة للطباعة والحفظ بصيغة PDF.</li>
    <li><b>التقارير:</b> مؤشرات ولوحات متابعة، مع تصدير البيانات إلى Excel.</li>
    <li><b>إدارة المستخدمين:</b> استيراد بيانات الموظفين وإنشاء حساباتهم وإسناد الأدوار.</li>
  </ul>
  <h3>الأدوار والصلاحيات</h3>
  <ul>
    <li><b>مدير النظام:</b> إدارة المنصة والمستخدمين والصلاحيات، وإسناد الموظفين للإداريين، وتحديد السنة وقواعد الرصيد، ومتابعة المؤشرات والاعتمادات.</li>
    <li><b>الإداري:</b> رفع توصيات الموظفين المسندين إليه، واعتماد طلباتهم، ومراسلتهم.</li>
    <li><b>الموظف:</b> متابعة رصيده، ورفع طلبات الاستبدال والتعويض، ومراسلة الإداري المسؤول.</li>
  </ul>
  <h3>الحوكمة وأمن المعلومات</h3>
  <ul>
    <li>صلاحيات وصول مبنية على الدور الوظيفي.</li>
    <li>فصل المهام: لا يبتّ أحدٌ في طلب يخصّه، ولا يرفع توصية لنفسه.</li>
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
  ACT["cancel-leave"] = (b, u) => { const r = byId("leaves", b.dataset.id); let note = ""; if (b.dataset.needNote) { note = (prompt("اذكر سبب إلغاء الطلب المعتمد:") || "").trim(); if (!note) return; } else if (!confirm("تأكيد إلغاء الطلب؟")) return; const prev = cancelLeave(u, r, note); save(); flash(prev === "approved" ? "تم إلغاء الطلب وإعادة الرصيد." : "تم إلغاء الطلب."); render(); };
  ACT["cancel-rec"] = (b, u) => { const r = byId("recs", b.dataset.id); const note = (prompt("اذكر سبب إلغاء التوصية (ستُخصم من الرصيد):") || "").trim(); if (!note) return; cancelRec(u, r, note); save(); flash("تم إلغاء التوصية وتحديث الرصيد."); render(); };
  ACT.decide = (b, u) => { const a = b.dataset.a; let note = ""; if (a === "reject") { note = (prompt("اذكر سبب الرفض:") || "").trim(); if (!note) return; } decideLeave(u, byId("leaves", b.dataset.id), a, note); save(); flash(a === "approve" ? "تم الاعتماد وخصم الرصيد." : "تم الرفض."); render(); };
  ACT.bulk = (b, u) => { const a = b.dataset.a; const rs = [...document.querySelectorAll('input[name="req"]:checked')].map((c) => Number(c.value));
    if (!rs.length) return toast("حدّد طلباً واحداً على الأقل.", "error");
    let note = ""; if (a === "reject") { note = (prompt("اذكر سبب الرفض:") || "").trim(); if (!note) return; } else if (!confirm("اعتماد كل الطلبات المحددة؟")) return;
    let ok = 0; const errs = []; rs.forEach((id) => { try { decideLeave(u, byId("leaves", id), a, note); ok++; } catch (e) { errs.push(byId("emps", byId("leaves", id).emp).name + ": " + e.message); } });
    save(); flash("تمت معالجة " + ok + " طلب." + (errs.length ? " تعذّر " + errs.length + "." : ""), errs.length ? "error" : "ok"); errs.slice(0, 5).forEach((m) => flash(m, "error")); render(); };
  ACT.export = (b) => exportXlsx(b.dataset.kind, b.dataset.year);
  ACT.template = (b) => {
    const filled = b && b.dataset.filled === "1";
    const head = ["الاسم", "الرقم الوظيفي", "القسم", "المنصب", "رقم الإداري المسؤول", "المسمى الوظيفي", "البريد"];
    const rows = filled ? DB.emps.filter((e) => e.active && !isTmp(e)).sort((x, y) => x.name.localeCompare(y.name, "ar")).map((e) => { const usr = DB.users.find((x) => x.emp === e.id); const m = e.mgr ? byId("emps", e.mgr) : null; return [e.name, e.no, deptName(e), usr && usr.role === "officer" ? "إداري" : "موظف", m ? m.no : "", e.title || "", e.email || ""]; }) : [];
    const depts = DB.depts.filter((d) => d.active).map((d) => d.name), offs = officers();
    const lists = [["الأقسام الحالية", "", "رقم الإداري", "اسم الإداري"]];
    for (let i = 0; i < Math.max(depts.length, offs.length); i++) lists.push([depts[i] || "", "", offs[i] ? offs[i].no : "", offs[i] ? offs[i].name : ""]);
    const help = [["طريقة الاستخدام"], ["1) عبّئ ورقة «الموظفون» بدءاً من السطر الثاني، ولا تغيّر صف العناوين."], ["2) احفظ الملف بصيغة Excel ‏(‎.xlsx) ثم ارفعه من صفحة «استيراد الموظفين» واضغط «معاينة قبل الحفظ»."], ["3) راجع المعاينة: الصفوف السليمة تُستورد، والصفوف التي فيها أخطاء تظهر لتصحيحها وإعادة الرفع."], [""],
      ["الاسم والرقم الوظيفي إلزاميان، وبقية الأعمدة اختيارية."], ["المنصب: موظف أو إداري (الافتراضي: موظف)."], ["القسم: اكتب اسم القسم كما في ورقة «القوائم» أو اسم قسم جديد فيُنشأ تلقائياً."], ["رقم الإداري المسؤول: الرقم الوظيفي للإداري (انظر ورقة «القوائم»)، ويمكن أن يكون إدارياً جديداً في الملف نفسه."], ["البريد: يُستخدم لإرسال إشعارات المراسلات والقرارات."], ["الرقم الوظيفي مفتاح المطابقة: إن كان الموظف موجوداً تُحدَّث بياناته بدل تكراره."]];
    downloadBook([["الموظفون", [head, ...rows]], ["القوائم", lists], ["تعليمات", help]], filled ? "الموظفون الحاليون للتعديل" : "نموذج استيراد الموظفين");
  };
  ACT["import-back"] = () => { importPreview = null; render(); };
  ACT["activate-year"] = (b) => { DB.years.forEach((y) => (y.active = y.id === Number(b.dataset.id))); audit("year_activated", "fiscal_year", Number(b.dataset.id)); save(); flash("تم تغيير السنة النشطة."); render(); };
  ACT["lock-year"] = (b) => { const y = byId("years", b.dataset.id);
    if (!y.locked) { const p = DB.leaves.filter((r) => r.year === y.id && r.status === "pending").length; if (p) throw new RuleError("لا يمكن الإقفال: توجد " + p + " حركة بانتظار الاعتماد."); if (!confirm("إقفال السنة؟ لن تُقبل أي حركات جديدة عليها.")) return; }
    y.locked = !y.locked; audit(y.locked ? "year_locked" : "year_unlocked", "fiscal_year", y.id); save(); flash((y.locked ? "تم إقفال" : "تم فتح") + " السنة " + y.name + "."); render(); };
  ACT["reset-pw"] = async (b) => { const x = byId("users", b.dataset.id); if (!confirm("إعادة تعيين كلمة مرور " + x.username + "؟")) return; const pw = rand(); x.pw = await sha(pw); x.mustChange = true; x.failed = 0; x.lockedUntil = null; audit("password_reset", "user", x.id); save(); flash("كلمة المرور المؤقتة للحساب " + x.username + ": " + pw); render(); };
  ACT["bulk-users"] = async () => { if (!confirm("إنشاء حساب لكل موظف نشط ليس له حساب (اسم المستخدم = الرقم الوظيفي)؟")) return; const linked = new Set(DB.users.filter((x) => x.emp).map((x) => x.emp)); const made = [];
    for (const e of DB.emps.filter((x) => x.active && !linked.has(x.id) && !isTmp(x))) { const un = String(e.no).toLowerCase(); if (DB.users.some((x) => x.username.toLowerCase() === un)) continue; const pw = rand(); const role = DB.emps.some((x) => x.mgr === e.id) ? "officer" : "employee"; DB.users.push({ id: nid(), username: un, pw: await sha(pw), role, emp: e.id, active: true, mustChange: true }); made.push([e.name, un, pw, role]); }
    audit("users_bulk_created", "user", null, { count: made.length }); save(); createdAccounts = made; go("#/admin/import"); };
  ACT.backup = (b, u) => {
    need(u, ["admin"]);
    audit("backup_downloaded", "system"); save();
    const blob = new Blob([JSON.stringify({ format: "itmam-demo-backup", version: 1, created_at: nowStr(), db: DB }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "itmam-backup-" + nowStr().replace(/[: ]/g, "-") + ".json"; document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 2000);
    flash("تم تنزيل النسخة الاحتياطية."); render();
  };
  ACT["archive-export"] = (b, u) => {
    need(u, STAFF);
    const y = byId("years", b.dataset.year) || activeYear(), ids = new Set(managedEmps(u, true).map((e) => e.id));
    const recs = DB.recs.filter((r) => r.year === y.id && ids.has(r.emp)), reqs = DB.leaves.filter((r) => r.year === y.id && ids.has(r.emp));
    downloadBook([
      ["التوصيات", [["رقم", "اسم الموظف", "الرقم الوظيفي", "تاريخ التوصية", "النوع", "القيمة", "رقم التوصية", "الموضوع", "الحالة", "ملف PDF"], ...recs.map((r) => { const e = byId("emps", r.emp); return ["REC-" + r.id, e.name, e.no, r.date, REC_KINDS[r.kind], r.amount, r.ref, r.subject, r.status === "active" ? "سارية" : "ملغاة", r.att || ""]; })]],
      ["الطلبات", [["رقم", "اسم الموظف", "الرقم الوظيفي", "نوع الطلب", "من", "إلى", "أيام", "ساعات", "الحالة", "السبب", "ملاحظة القرار"], ...reqs.map((r) => { const e = byId("emps", r.emp); return ["REQ-" + r.id, e.name, e.no, LEAVE_KINDS[r.kind], r.start, r.end, r.unit === "days" ? r.days : "", r.unit === "hours" ? r.hours : "", REQ_ST[r.status], r.reason, r.note]; })]],
      ["الأرصدة", [["اسم الموظف", "الرقم الوظيفي", "أيام ممنوحة", "ساعات ممنوحة", "رصيد الأيام", "رصيد الساعات", "الإجمالي (أيام)", "+ ساعات"], ...managedEmps(u, true).map((e) => { const x = balance(e.id, y); return [e.name, e.no, x.gDays, x.gHours, x.daysLeft, x.hoursLeft, x.totalDays, x.totalRem]; })]],
    ], "أرشيف بدل الراحة " + y.name);
    audit("archive_exported", "archive", null, { year: y.name }); save();
  };
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
  });
  function syncUnit(form) { const u = form.querySelector("[data-unit]:checked"); if (!u) return; form.querySelectorAll("[data-for-unit]").forEach((el) => { const on = el.dataset.forUnit === u.value; el.hidden = !on; el.querySelectorAll("input").forEach((i) => (i.required = on && i.name === "hours")); }); }
  function assignSync(form) {
    const sel = form.querySelector("[data-role-select]");
    form.querySelectorAll("[data-role-dep]").forEach((box) => { const on = !!sel && sel.value === box.dataset.roleDep; box.hidden = !on; box.querySelectorAll("input").forEach((i) => (i.disabled = !on));
      const c = box.querySelector("[data-assign-count]"); if (c) c.textContent = box.querySelectorAll('input[name="assign"]:checked').length + " محدد"; });
  }
  document.addEventListener("input", (ev) => { const f = ev.target.closest("[data-assign-filter]"); if (!f) return; const q = f.value.trim(); f.closest(".assign-box").querySelectorAll(".check-list .check").forEach((l) => (l.hidden = !!q && !l.dataset.text.includes(q))); });
  document.addEventListener("click", (ev) => { const b = ev.target.closest("[data-assign-all]"); if (!b) return; const on = b.dataset.assignAll === "1"; b.closest(".assign-box").querySelectorAll(".check-list .check").forEach((l) => { if (!l.hidden) l.querySelector("input").checked = on; }); assignSync(b.form); });
  document.addEventListener("change", (ev) => {
    if (ev.target.matches("[data-role-select], input[name='assign']") && ev.target.form) assignSync(ev.target.form);
    if (ev.target.matches("[data-unit]")) syncUnit(ev.target.form);
    if (ev.target.matches("[data-yearnav]") && !ev.target.closest("form[data-form]")) { const { seg, q } = parts(); q.set("year", ev.target.value); go("#/" + seg.join("/") + "?" + q); }
    if (ev.target.matches("[data-reqemp]") && ev.target.value) go("#/requests/new?kind=" + ev.target.dataset.reqemp + "&emp=" + ev.target.value);
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
    document.querySelectorAll("form").forEach((f) => { if (f.querySelector("[data-role-select]")) assignSync(f); });
    const main = document.getElementById("main"); if (main && seg[0] !== "login") main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  (async function start() {
    DB = load();
    if (!DB || !DB.years || !DB.recs) await seed();
    try { localStorage.removeItem("hr_demo_v1"); } catch (e) {}
    // ترقية بيانات العرض القديمة إلى هوية «إتمام»
    if (DB.settings.system_title === "إدارة أيام بدل الراحة للموظفين") DB.settings.system_title = "إتمام";
    if (DB.settings.tagline == null) DB.settings.tagline = TAGLINE;
    if (!DB.settings.credit || DB.settings.credit === "تطوير مريم حمدي") DB.settings.credit = CREDIT;
    [SPRITE_INLINE, HERO_INLINE] = await Promise.all([inlineSprite("icons.svg"), inlineSprite("hero.svg")]);
    render();
  })();
})();

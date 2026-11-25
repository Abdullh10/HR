// تفاعلات بسيطة دون مكتبات خارجية
(function () {
  "use strict";
  document.documentElement.classList.add("js");
  // الوضع الداكن/الفاتح
  try {
    var t = localStorage.getItem("theme");
    if (t) document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
  document.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-theme-toggle]");
    if (el) {
      var cur = document.documentElement.getAttribute("data-theme");
      var dark = cur ? cur === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
      var next = dark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
    }
    var mb = ev.target.closest("[data-menu]");
    if (mb) {
      var sb = document.getElementById("sidebar");
      var open = sb.classList.toggle("open");
      mb.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.classList.toggle("nav-open", open);
    } else if (!ev.target.closest("#sidebar")) {
      var s = document.getElementById("sidebar");
      if (s && s.classList.contains("open")) {
        s.classList.remove("open");
        document.body.classList.remove("nav-open");
        var mbb = document.querySelector("[data-menu]"); if (mbb) mbb.setAttribute("aria-expanded", "false");
      }
    }
    // إغلاق قائمة الحساب عند النقر خارجها
    document.querySelectorAll("details.acct[open]").forEach(function (d) { if (!d.contains(ev.target)) d.removeAttribute("open"); });
    var pr = ev.target.closest("[data-print]");
    if (pr) { ev.preventDefault(); window.print(); }
    // تحديد الكل
    var all = ev.target.closest("[data-check-all]");
    if (all) {
      var name = all.getAttribute("data-check-all");
      document.querySelectorAll('input[name="' + name + '"]').forEach(function (c) { c.checked = all.checked; });
    }
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    document.querySelectorAll("details.acct[open]").forEach(function (d) { d.removeAttribute("open"); });
    var s = document.getElementById("sidebar");
    if (s && s.classList.contains("open")) { s.classList.remove("open"); document.body.classList.remove("nav-open"); var b = document.querySelector("[data-menu]"); if (b) { b.setAttribute("aria-expanded", "false"); b.focus(); } }
  });

  // نافذة إدخال السبب (بدل window.prompt): حقل نصي متعدد الأسطر وأسباب جاهزة، تعمل جيداً على الجوال
  var REASONS = {
    reject: ["ضغط عمل في الوحدة", "تعارض مع جدول المناوبات أو التكليفات", "الرصيد غير كافٍ", "المستندات المؤيدة ناقصة"],
    cancel: ["تاريخ خاطئ في الطلب", "خطأ في الإدخال", "بناءً على طلب الموظف", "تغيّر موعد الإجازة"]
  };
  function askReason(btn, done) {
    var kind = btn.value === "reject" ? "reject" : "cancel";
    var d = document.getElementById("reason-dlg");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "reason-dlg"; d.className = "about-dlg reason-dlg";
      d.innerHTML = '<form method="dialog" class="about-head"><h2 id="reason-title">اذكر السبب</h2><button class="btn ghost icon-btn" value="x" aria-label="إغلاق">×</button></form>' +
        '<div class="about-doc"><div class="chips" data-chips></div><label class="sr-only" for="reason-text">السبب</label><textarea id="reason-text" rows="4" placeholder="اكتب السبب هنا…"></textarea>' +
        '<p class="hint" data-reason-err hidden>السبب مطلوب.</p><div class="actions"><button type="button" class="btn primary" data-reason-ok>تأكيد</button><button type="button" class="btn" data-reason-cancel>تراجع</button></div></div>';
      document.body.appendChild(d);
      d.addEventListener("click", function (ev) {
        var c = ev.target.closest("[data-chip]");
        if (c) { var t = d.querySelector("#reason-text"); t.value = c.textContent; t.focus(); }
        if (ev.target.closest("[data-reason-cancel]")) d.close();
        if (ev.target.closest("[data-reason-ok]")) {
          var v = d.querySelector("#reason-text").value.trim();
          if (!v) { d.querySelector("[data-reason-err]").hidden = false; return; }
          d.close(); if (d._done) d._done(v);
        }
      });
    }
    d.querySelector("#reason-title").textContent = kind === "reject" ? "سبب الرفض" : "سبب الإلغاء";
    d.querySelector("[data-chips]").innerHTML = REASONS[kind].map(function (r) { return '<button type="button" class="chip" data-chip>' + r + "</button>"; }).join("");
    d.querySelector("#reason-text").value = "";
    d.querySelector("[data-reason-err]").hidden = true;
    d._done = done;
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
    d.querySelector("#reason-text").focus();
  }

  // حفظ ما كتبه المستخدم إذا رجع النموذج بخطأ تحقق (form[data-keep])
  var DKEY = "form_draft";
  document.addEventListener("submit", function (ev) {
    var f = ev.target;
    if (!f.matches("form[data-keep]")) return;
    var vals = {};
    Array.prototype.forEach.call(f.elements, function (el) {
      if (!el.name || el.type === "file" || el.type === "hidden" || el.type === "submit") return;
      if ((el.type === "radio" || el.type === "checkbox") && !el.checked) return;
      vals[el.name] = el.value;
    });
    try { sessionStorage.setItem(DKEY, JSON.stringify({ action: f.getAttribute("action"), vals: vals })); } catch (e) {}
  }, true);
  document.addEventListener("DOMContentLoaded", function () {
    var d = null;
    try { d = JSON.parse(sessionStorage.getItem(DKEY) || "null"); sessionStorage.removeItem(DKEY); } catch (e) {}
    if (!d || !document.querySelector(".alert.error")) return;
    var f = document.querySelector('form[data-keep][action="' + d.action + '"]');
    if (!f) return;
    Object.keys(d.vals).forEach(function (k) {
      f.querySelectorAll('[name="' + k + '"]').forEach(function (el) {
        if (el.type === "radio" || el.type === "checkbox") el.checked = el.value === d.vals[k];
        else if (!el.value || el.tagName === "TEXTAREA" || el.type !== "date") el.value = d.vals[k];
        else el.value = d.vals[k];
      });
    });
    if (f.matches("[data-leave-form]")) syncUnit(f);
  });

  // نافذة تأكيد رسمية داخل النظام (بدل نافذة المتصفح): «تراجع» هو الزر الافتراضي، وEsc يغلق، ويعود التركيز للزر
  var DANGER = /حذف|إلغاء|استبدال|تعطيل|إعادة تعيين|نهائي/;
  function confirmDlg(msg, done, trigger) {
    var d = document.getElementById("confirm-dlg");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "confirm-dlg"; d.className = "about-dlg confirm-dlg";
      d.setAttribute("aria-labelledby", "confirm-title"); d.setAttribute("aria-describedby", "confirm-msg");
      d.innerHTML = '<div class="about-head"><h2 id="confirm-title">تأكيد الإجراء</h2></div>' +
        '<div class="about-doc"><p id="confirm-msg"></p><div class="actions"><button type="button" class="btn primary" data-confirm-ok>تأكيد</button><button type="button" class="btn" data-confirm-no>تراجع</button></div></div>';
      document.body.appendChild(d);
      d.addEventListener("click", function (ev) {
        if (ev.target.closest("[data-confirm-ok]")) { d._ok = true; d.close(); }
        else if (ev.target.closest("[data-confirm-no]") || ev.target === d) d.close();
      });
      d.addEventListener("close", function () { var ok = d._ok, cb = d._done, t = d._trigger; d._done = null; if (t && t.focus) t.focus(); if (cb) cb(!!ok); });
    }
    var danger = DANGER.test(msg);
    d.querySelector("#confirm-msg").textContent = msg;
    var okb = d.querySelector("[data-confirm-ok]");
    okb.className = "btn " + (danger ? "danger" : "primary");
    okb.textContent = danger ? "نعم، متابعة" : "تأكيد";
    d._ok = false; d._done = done; d._trigger = trigger || document.activeElement;
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
    d.querySelector("[data-confirm-no]").focus();
  }
  window.confirmDlg = confirmDlg;

  // تأكيد قبل الإجراءات الحساسة + إلزام السبب
  document.addEventListener("submit", function (ev) {
    var f = ev.target;
    var msg = f.getAttribute("data-confirm");
    var sub = ev.submitter;
    if (sub && sub.getAttribute("data-confirm")) msg = sub.getAttribute("data-confirm");
    if (f._confirmed) { f._confirmed = false; return; }
    function resubmit() { f._confirmed = true; if (f.requestSubmit) f.requestSubmit(sub || undefined); else f.submit(); }
    if (sub && sub.hasAttribute("data-need-note")) {
      var note = f.querySelector('[name="note"]');
      if (note && !note.value.trim()) {
        ev.preventDefault();
        askReason(sub, function (v) {
          note.value = v;
          if (msg) confirmDlg(msg, function (ok) { if (ok) resubmit(); else note.value = ""; }, sub); else resubmit();
        });
        return;
      }
    }
    if (msg) { ev.preventDefault(); confirmDlg(msg, function (ok) { if (ok) resubmit(); }, sub); }
  });

  // إضافة صف في شبكة إدخال الساعات
  document.addEventListener("click", function (ev) {
    var add = ev.target.closest("[data-add-row]");
    if (!add) return;
    var tbody = document.querySelector("#entry tbody");
    var tpl = document.getElementById("row-tpl");
    if (!tbody || !tpl) return;
    var idx = tbody.querySelectorAll("tr").length;
    var html = tpl.innerHTML.replace(/__i__/g, String(idx)).replace(/__n__/g, String(idx + 1));
    tbody.insertAdjacentHTML("beforeend", html);
    renumber();
  });
  function renumber() {
    document.querySelectorAll("#entry tbody tr").forEach(function (tr, i) {
      var f = tr.querySelector('input[type="file"]');
      if (f) f.name = "file_" + i;
      var c = tr.querySelector(".idx");
      if (c) c.textContent = String(i + 1);
    });
  }

  // تحقق حي لصفوف الإدخال (يحاكي عمود "التحقق" في الإكسل)
  function checkRow(tr) {
    var out = tr.querySelector(".chk");
    if (!out) return;
    var emp = tr.querySelector('[name="emp"]').value;
    var d = tr.querySelector('[name="date"]').value;
    var desc = tr.querySelector('[name="desc"]').value.trim();
    var h = tr.querySelector('[name="hours"]').value;
    var msg = "", ok = false;
    if (!emp && !d && !desc && !h) msg = "";
    else if (!emp) msg = "⚠ اختر اسم الموظف";
    else if (!d) msg = "⚠ أدخل التاريخ";
    else if (!desc) msg = "⚠ أدخل الوصف";
    else if (!h || Number(h) <= 0) msg = "⚠ أدخل الساعات";
    else { msg = "✓ سليم"; ok = true; }
    out.textContent = msg;
    out.className = "chk " + (ok ? "ok" : msg ? "bad" : "");
  }
  document.addEventListener("input", function (ev) {
    var tr = ev.target.closest("#entry tbody tr");
    if (tr) checkRow(tr);
  });
  document.addEventListener("change", function (ev) {
    var tr = ev.target.closest("#entry tbody tr");
    if (tr) checkRow(tr);
    var auto = ev.target.closest("[data-autosubmit]");
    if (auto && auto.form) auto.form.submit();
  });

  // فتح النوافذ الحوارية (مثل «عن النظام»)
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-open-dialog]");
    if (!b) return;
    var d = document.getElementById(b.getAttribute("data-open-dialog"));
    if (d && d.showModal) d.showModal(); else if (d) d.setAttribute("open", "");
  });
  // إغلاق النافذة عند النقر على الخلفية
  document.addEventListener("click", function (ev) {
    if (ev.target.tagName === "DIALOG" && ev.target.open) ev.target.close();
  });

  // نموذج الطلب: إظهار حقول الأيام أو الساعات حسب الرصيد المختار
  function syncUnit(form) {
    var u = form.querySelector('[data-unit]:checked');
    if (!u) return;
    form.querySelectorAll("[data-for-unit]").forEach(function (el) {
      var on = el.getAttribute("data-for-unit") === u.value;
      el.hidden = !on;
      el.querySelectorAll("input").forEach(function (i) { i.required = on && i.name === "hours"; });
    });
  }
  document.addEventListener("change", function (ev) {
    if (ev.target.matches("[data-unit]")) syncUnit(ev.target.form);
    var g = ev.target.closest("[data-autosubmit-get]");
    if (g && g.value) window.location = g.getAttribute("data-autosubmit-get") + encodeURIComponent(g.value);
  });
  document.addEventListener("DOMContentLoaded", function () { document.querySelectorAll("[data-leave-form]").forEach(syncUnit); });

  // إسناد الموظفين للإداري: إظهار القائمة عند اختيار دور «إداري» + البحث والعدّ
  function assignSync(form) {
    var sel = form.querySelector("[data-role-select]");
    form.querySelectorAll("[data-role-dep]").forEach(function (box) {
      var on = sel && sel.value === box.getAttribute("data-role-dep");
      box.hidden = !on;
      box.querySelectorAll("input").forEach(function (i) { i.disabled = !on; });
      var c = box.querySelector("[data-assign-count]");
      if (c) c.textContent = box.querySelectorAll('input[name="assign"]:checked').length + " محدد";
    });
  }
  document.addEventListener("change", function (ev) {
    if (ev.target.matches("[data-role-select], input[name='assign']") && ev.target.form) assignSync(ev.target.form);
  });
  document.addEventListener("input", function (ev) {
    var f = ev.target.closest("[data-assign-filter]");
    if (!f) return;
    var q = f.value.trim();
    f.closest(".assign-box").querySelectorAll(".check-list .check").forEach(function (l) { l.hidden = q && l.getAttribute("data-text").indexOf(q) === -1; });
  });
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-assign-all]");
    if (!b) return;
    var box = b.closest(".assign-box"), on = b.getAttribute("data-assign-all") === "1";
    box.querySelectorAll(".check-list .check").forEach(function (l) { if (!l.hidden) l.querySelector("input").checked = on; });
    assignSync(b.form);
  });
  document.addEventListener("DOMContentLoaded", function () { document.querySelectorAll("form").forEach(function (f) { if (f.querySelector("[data-role-select]")) assignSync(f); }); });

  // بحث وتصفية داخل قوائم اختيار الموظف (بالاسم أو الرقم الوظيفي)
  var EMP_SELECTS = 'select[name="emp"]:not([multiple]), select[name="employee_id"]:not([multiple]), select[name="mgr"]:not([multiple]), select[name="manager_id"]:not([multiple])';
  function normAr(s) {
    return String(s || "").replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
      .replace(/[٠-٩]/g, function (d) { return "٠١٢٣٤٥٦٧٨٩".indexOf(d); }).replace(/\s+/g, " ").trim().toLowerCase();
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

  // منتقي الملفات بالعربية بدل «Choose File / No file chosen»: الحقل الأصلي يبقى (للنماذج والقارئ الشاشي) ويُخفى بصرياً
  function enhanceFiles(root) {
    Array.prototype.forEach.call(root.querySelectorAll('input[type="file"]:not([data-fp])'), function (inp) {
      inp.setAttribute("data-fp", "1");
      var wrap = document.createElement("span"); wrap.className = "file-pick";
      inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
      inp.classList.add("file-input");
      var btn = document.createElement("span"); btn.className = "btn sm file-btn"; btn.setAttribute("aria-hidden", "true");
      btn.textContent = inp.multiple ? "اختر ملفات" : "اختر ملفاً";
      var name = document.createElement("span"); name.className = "file-name"; name.setAttribute("aria-live", "polite"); name.textContent = "لم يُختر ملف";
      wrap.appendChild(btn); wrap.appendChild(name);
      inp.addEventListener("change", function () {
        var n = inp.files && inp.files.length ? Array.prototype.map.call(inp.files, function (f) { return f.name; }).join("، ") : "لم يُختر ملف";
        name.textContent = n; wrap.classList.toggle("has-file", !!(inp.files && inp.files.length));
      });
    });
  }
  document.addEventListener("DOMContentLoaded", function () { enhanceSelects(document); enhanceFiles(document); });

  // ---------------------------------------------------------- طيّ مجموعات القائمة الجانبية
  var NAVKEY = "nav_groups";
  function navState() { try { return JSON.parse(localStorage.getItem(NAVKEY) || "{}"); } catch (e) { return {}; } }
  function setGroup(g, open) {
    var btn = g.querySelector(".nav-toggle"), ul = g.querySelector(".nav-sub");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    ul.hidden = !open;
  }
  function initNavGroups() {
    var st = navState();
    document.querySelectorAll(".nav-group").forEach(function (g) {
      var k = g.getAttribute("data-group");
      var open = g.hasAttribute("data-active") ? true : (k in st ? st[k] : g.getAttribute("data-default") !== "closed");
      setGroup(g, open);
    });
  }
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest(".nav-toggle");
    if (!b) return;
    var g = b.closest(".nav-group"), open = b.getAttribute("aria-expanded") !== "true";
    setGroup(g, open);
    var st = navState(); st[g.getAttribute("data-group")] = open;
    try { localStorage.setItem(NAVKEY, JSON.stringify(st)); } catch (e) {}
  });
  document.addEventListener("DOMContentLoaded", initNavGroups);

  // ---------------------------------------------------------- تطبيق الفلترة تلقائياً (نماذج GET)
  var FKEY = "filter_focus";
  function submitFilter(form, keepEl) {
    if (keepEl && keepEl.id) {
      try { sessionStorage.setItem(FKEY, JSON.stringify({ id: keepEl.id, pos: keepEl.selectionStart || keepEl.value.length })); } catch (e) {}
    }
    // لا تُرسل الحقول الفارغة حتى يبقى الرابط نظيفاً وقابلاً للمشاركة
    form.querySelectorAll("[name]").forEach(function (el) { if (!el.value) el.disabled = true; });
    if (form.requestSubmit) form.requestSubmit(); else form.submit();
  }
  var ftimer = null;
  document.addEventListener("change", function (ev) {
    var f = ev.target.closest("form[data-autofilter]");
    if (!f || !ev.target.matches("select[name], input[type=date][name], input[type=checkbox][name]")) return;
    submitFilter(f, null);
  });
  document.addEventListener("input", function (ev) {
    var f = ev.target.closest("form[data-autofilter]");
    if (!f || !ev.target.matches("input[type=search][name]") || ev.isComposing) return;
    clearTimeout(ftimer);
    var v = ev.target.value.trim();
    if (v.length === 1) return;
    ftimer = setTimeout(function () { submitFilter(f, ev.target); }, 500);
  });
  document.addEventListener("DOMContentLoaded", function () {
    var st = null;
    try { st = JSON.parse(sessionStorage.getItem(FKEY) || "null"); sessionStorage.removeItem(FKEY); } catch (e) {}
    if (st) { var el = document.getElementById(st.id); if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(st.pos, st.pos); } catch (e) {} } }
  });

  // تنزيل جدول كملف CSV يفتح في Excel (مثل بطاقات الدخول بعد الاستيراد)
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-table-csv]");
    if (!b) return;
    var t = document.querySelector(b.getAttribute("data-table-csv"));
    if (!t) return;
    var rows = Array.prototype.map.call(t.querySelectorAll("tr"), function (tr) {
      return Array.prototype.map.call(tr.children, function (c) { return '"' + c.textContent.trim().replace(/"/g, '""') + '"'; }).join(",");
    });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = (b.getAttribute("data-csv-name") || "table") + ".csv";
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); }, 2000);
  });

  // إضافة تاريخ آخر في طلب بدل الراحة
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-add-date]");
    if (!b) return;
    var box = document.getElementById("dates");
    var inp = document.createElement("input");
    inp.type = "date"; inp.name = "rest_date"; inp.className = "mt";
    inp.setAttribute("aria-label", "تاريخ إضافي");
    box.appendChild(inp);
    inp.focus();
  });

  // إظهار/إخفاء كلمة المرور (button[data-pw-toggle] بجانب الحقل)
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-pw-toggle]");
    if (!b) return;
    var inp = b.parentElement.querySelector("input");
    var show = inp.type === "password";
    inp.type = show ? "text" : "password";
    b.setAttribute("aria-pressed", String(show));
    var t = show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور";
    b.setAttribute("aria-label", t); b.title = t;
    inp.focus();
  });
})();

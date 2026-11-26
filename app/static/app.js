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
    d.querySelector("#reason-title").textContent = btn.getAttribute("data-note-prompt") || (kind === "reject" ? "سبب الرفض" : "سبب الإلغاء");
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
      el.querySelectorAll("input").forEach(function (i) { i.required = on && i.name === "hours"; i.disabled = !on && i.name !== "start_date"; });
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

/* التاريخ الهجري (تقويم أم القرى) لشريط الترحيب — يُحسب في المتصفح ويُخفى إن لم يدعمه */
(function () {
  function fillHijri(root) {
    (root || document).querySelectorAll("[data-hijri]").forEach(function (el) {
      try {
        var p = el.getAttribute("data-hijri").split("-").map(Number);
        var txt = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long", year: "numeric" }).format(new Date(p[0], p[1] - 1, p[2], 12));
        if (/\d/.test(txt)) { el.textContent = txt.replace(/\s*هـ$/, "") + " هـ"; el.hidden = false; }
      } catch (e) { /* يبقى مخفياً */ }
    });
  }
  window.fillHijri = fillHijri;
  document.addEventListener("DOMContentLoaded", function () { fillHijri(); });
})();

/* تطبيق الويب وإشعارات الأجهزة: تسجيل عامل الخدمة، وشارة عدد الرسائل على الأيقونة، والاشتراك في الإشعارات */
(function () {
  var hasSW = "serviceWorker" in navigator;
  var canPush = hasSW && "PushManager" in window && "Notification" in window;
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function meta(n) { var m = document.querySelector('meta[name="' + n + '"]'); return m ? m.content : ""; }
  function post(url, data) {
    var fd = new FormData(); fd.append("csrf_token", meta("csrf-token"));
    Object.keys(data || {}).forEach(function (k) { fd.append(k, data[k]); });
    return fetch(url, { method: "POST", body: fd, credentials: "same-origin", keepalive: true });
  }
  function keyBytes(b64) {
    var s = (b64 + "===".slice((b64.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function deviceLabel() {
    var ua = navigator.userAgent;
    var os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "جهاز";
    var br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
    return (os + " " + br + (standalone ? " (تطبيق)" : "")).trim();
  }
  var regP = hasSW ? navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () { return null; }) : Promise.resolve(null);

  // شارة الرسائل غير المقروءة على أيقونة التطبيق
  var unread = parseInt(meta("hr-unread"), 10);
  if (!isNaN(unread) && "setAppBadge" in navigator) { (unread > 0 ? navigator.setAppBadge(unread) : navigator.clearAppBadge()).catch(function () {}); }

  function currentSub() {
    return regP.then(function (reg) { return reg && reg.pushManager ? reg.pushManager.getSubscription() : null; }).catch(function () { return null; });
  }
  function enable() {
    if (!canPush) return Promise.reject(new Error("unsupported"));
    return Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") throw new Error(perm === "denied" ? "denied" : "dismissed");
      return Promise.all([navigator.serviceWorker.ready, fetch("/push/key", { credentials: "same-origin" }).then(function (r) { return r.json(); })]);
    }).then(function (res) {
      var reg = res[0], key = res[1].key;
      return reg.pushManager.getSubscription().then(function (old) {
        return old || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
          .catch(function () { throw new Error("pushsvc"); });
      });
    }).then(function (sub) {
      return post("/push/subscribe", { subscription: JSON.stringify(sub), device: deviceLabel() }).then(function (r) { if (!r.ok) throw new Error("server"); return sub; });
    });
  }
  function disable() {
    return currentSub().then(function (sub) {
      if (!sub) return;
      var ep = sub.endpoint;
      return sub.unsubscribe().catch(function () {}).then(function () { return post("/push/unsubscribe", { endpoint: ep }); });
    });
  }
  var MSG = {
    denied: "الإشعارات محظورة لهذا الموقع في إعدادات المتصفح. اسمح بها من إعدادات الموقع (رمز القفل بجانب العنوان) ثم أعد المحاولة.",
    dismissed: "لم تُمنح الموافقة على الإشعارات. اضغط «تفعيل» مرة أخرى واختر «السماح».",
    unsupported: "هذا المتصفح لا يدعم إشعارات الأجهزة. جرّب Chrome أو Edge أو Safari بإصدار حديث.",
    server: "تعذّر حفظ الاشتراك على الخادم. أعد تحميل الصفحة وحاول مرة أخرى.",
    pushsvc: "تعذّر الاتصال بخدمة الإشعارات في المتصفح. تأكد من اتصالك بالإنترنت، وأنك لا تستخدم التصفح الخاص (Incognito)، ثم أعد المحاولة.",
  };

  // لوحة «إشعارات الجهاز» في الملف الشخصي
  function panel(root) {
    var st = root.querySelector("[data-push-status]"), en = root.querySelector("[data-push-enable]"),
      te = root.querySelector("[data-push-test]"), di = root.querySelector("[data-push-disable]"), ios = root.querySelector("[data-push-ios]");
    function show(text, on) { st.textContent = text; en.hidden = on !== false; te.hidden = di.hidden = on !== true; }
    function refresh() {
      if (!canPush) {
        if (isIOS && !standalone) { st.textContent = "لتفعيل الإشعارات على هذا الجهاز أضف النظام إلى الشاشة الرئيسية أولاً."; ios.hidden = false; }
        else st.textContent = MSG.unsupported;
        en.hidden = te.hidden = di.hidden = true; return;
      }
      if (Notification.permission === "denied") { show(MSG.denied, null); return; }
      currentSub().then(function (sub) {
        if (sub && Notification.permission === "granted") show("الإشعارات مفعّلة على هذا الجهاز ✓", true);
        else show("الإشعارات غير مفعّلة على هذا الجهاز.", false);
      });
    }
    en.addEventListener("click", function () {
      en.disabled = true; st.textContent = "جارٍ التفعيل…";
      enable().then(function () { refresh(); }).catch(function (e) { st.textContent = MSG[e.message] || MSG.server; }).then(function () { en.disabled = false; });
    });
    di.addEventListener("click", function () { disable().then(refresh); });
    te.addEventListener("click", function () {
      te.disabled = true;
      post("/push/test").then(function (r) { return r.json(); }).then(function (d) {
        st.textContent = d.ok ? "أُرسل إشعار تجريبي؛ سيظهر خلال ثوانٍ." : "لا يوجد جهاز مشترك؛ فعّل الإشعارات أولاً.";
      }).catch(function () { st.textContent = MSG.server; }).then(function () { te.disabled = false; });
    });
    refresh();
  }

  // شريط الدعوة للتفعيل في الصفحة الرئيسية (مرة واحدة، ويمكن تأجيله)
  function prompt(root) {
    var later = 0; try { later = +localStorage.getItem("push_later") || 0; } catch (e) {}
    if (!canPush || Notification.permission !== "default" || Date.now() - later < 7 * 864e5) return;
    if (isIOS && !standalone) return;
    root.hidden = false;
    root.querySelector("[data-push-enable]").addEventListener("click", function () {
      enable().then(function () { root.innerHTML = "<span>تم تفعيل الإشعارات على هذا الجهاز ✓</span>"; setTimeout(function () { root.hidden = true; }, 2500); })
        .catch(function (e) { root.querySelector("span").textContent = MSG[e.message] || MSG.server; });
    });
    root.querySelector("[data-push-later]").addEventListener("click", function () {
      try { localStorage.setItem("push_later", String(Date.now())); } catch (e) {}
      root.hidden = true;
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-push-panel]").forEach(panel);
    document.querySelectorAll("[data-push-prompt]").forEach(prompt);
    // عند تسجيل الخروج: إيقاف إشعارات هذا الجهاز حتى لا تصل تنبيهات الحساب لمن يستخدم الجهاز بعده
    document.querySelectorAll('form[action="/logout"]').forEach(function (f) {
      f.addEventListener("submit", function (ev) {
        if (f.dataset.pushDone) return;
        ev.preventDefault(); f.dataset.pushDone = "1";
        Promise.race([disable(), new Promise(function (r) { setTimeout(r, 1500); })]).then(function () { f.submit(); });
      });
    });
  });
})();

/* معاينة فورية لعدد الأيام التي ستُخصم في نموذج طلب معالجة الغياب */
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var f = document.querySelector("form[data-days-preview]"); if (!f) return;
    var out = f.querySelector("[data-days-out]"), sd = f.querySelector('[name="start_date"]'), ed = f.querySelector('[name="end_date"]'), emp = f.querySelector('[name="emp"]'), hr = f.querySelector('[name="hours"]');
    function unit() { var u = f.querySelector('[name="unit"]:checked'); return u ? u.value : "days"; }
    var t;
    function run() {
      if (!sd.value) { out.textContent = ""; return; }
      var q = "start=" + encodeURIComponent(sd.value) + "&end=" + encodeURIComponent(unit() === "hours" ? sd.value : (ed.value || sd.value)) + (emp && emp.value ? "&emp=" + encodeURIComponent(emp.value) : "") + "&unit=" + unit() + (hr && hr.value ? "&hours=" + encodeURIComponent(hr.value) : "");
      fetch("/requests/preview?" + q, { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) { out.textContent = d.msg || ""; out.classList.toggle("err", !!d.msg); return; }
        out.classList.toggle("err", !!d.over);
        out.textContent = d.unit === "hours" ? (hr && hr.value ? "سيُخصم من رصيد الساعات: " + d.label + (d.over ? " — يتجاوز المتاح (" + d.avail + ")" : "") : d.label)
          : d.days ? ("سيُخصم من الرصيد: " + d.label + (d.over ? " — يتجاوز المتاح (" + d.avail + ")" : "")) : d.label;
      }).catch(function () { out.textContent = ""; });
    }
    [sd, ed, hr].forEach(function (el) { if (el) el.addEventListener(el === hr ? "input" : "change", function () { clearTimeout(t); t = setTimeout(run, 200); }); });
    f.querySelectorAll('[name="unit"]').forEach(function (r) { r.addEventListener("change", run); });
    run();
  });
})();

/* نموذج التوصية: عدّ الموظفين المحددين ونص زر الرفع */
(function () {
  function sync(box) {
    var n = box.querySelectorAll('input[name="emps"]:checked').length, c = box.querySelector("[data-pick-count]");
    if (c) c.textContent = n ? (n === 1 ? "موظف واحد محدد" : n === 2 ? "موظفان محددان" : n + " موظفين محددين") : "لم يُحدَّد أحد";
    var btn = box.form && box.form.querySelector("[data-pick-submit]");
    if (btn) btn.textContent = n > 1 ? "رفع التوصية بخطاب واحد (" + n + ")" : "رفع التوصية وإضافة الرصيد";
  }
  document.addEventListener("change", function (ev) { var b = ev.target.closest && ev.target.closest("[data-pick-box]"); if (b) sync(b); });
  document.addEventListener("click", function (ev) { if (ev.target.closest("[data-assign-all]")) { var b = ev.target.closest("[data-pick-box]"); if (b) setTimeout(function () { sync(b); }, 0); } });
  document.addEventListener("submit", function (ev) {
    var b = ev.target.querySelector && ev.target.querySelector("[data-pick-box]");
    if (b && !b.querySelector('input[name="emps"]:checked')) { ev.preventDefault(); var c = b.querySelector("[data-pick-count]"); if (c) { c.textContent = "اختر موظفاً واحداً على الأقل"; c.classList.add("err-text"); } b.scrollIntoView({ block: "center" }); }
  }, true);
  document.addEventListener("DOMContentLoaded", function () { document.querySelectorAll("[data-pick-box]").forEach(sync); });
})();

// لوحة الإداري: إبراز شريحة الحلقة من المفتاح أو الرسم (تمرير/نقر/لوحة مفاتيح). المحتوى كامل دون JS.
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll("[data-sv-donut]").forEach(function (w) {
    var items = [].slice.call(w.querySelectorAll(".sv-lg")), segs = w.querySelectorAll(".sv-seg");
    var num = w.querySelector("[data-c-num]"), cap = w.querySelector("[data-c-cap]"), live = w.querySelector("[data-live]");
    var pinned = w.getAttribute("data-active") || null;
    function txt(it, sel) { return it.querySelector(sel).textContent; }
    function show(k, say) {
      var cur = null;
      w.classList.toggle("has-active", !!k);
      segs.forEach(function (s) { s.classList.toggle("on", s.getAttribute("data-k") === k); });
      items.forEach(function (it) {
        var on = it.getAttribute("data-k") === k;
        it.classList.toggle("on", on);
        it.setAttribute("aria-pressed", String(!!pinned && it.getAttribute("data-k") === pinned));
        if (on) cur = it;
      });
      var l = cur && txt(cur, ".lbl");
      num.textContent = cur ? txt(cur, "b") : w.dataset.total;
      cap.textContent = cur ? txt(cur, ".pct") + " · " + (l.length > 14 ? l.slice(0, 13) + "…" : l) : w.dataset.cap;
      if (say && cur) live.textContent = l + ": " + txt(cur, "b") + " (" + txt(cur, ".pct") + " من " + w.dataset.unit + ")";
    }
    function keyOf(ev) { var t = ev.target.closest && ev.target.closest("[data-k]"); return t && w.contains(t) ? t.getAttribute("data-k") : null; }
    items.forEach(function (it, i) { it.setAttribute("role", "button"); it.tabIndex = i ? -1 : 0; });
    w.addEventListener("mouseover", function (ev) { var k = keyOf(ev); if (k) show(k); });
    w.addEventListener("mouseleave", function () { show(pinned); });
    w.addEventListener("focusin", function (ev) { var k = keyOf(ev); if (k) show(k, true); });
    w.addEventListener("focusout", function (ev) { if (!w.contains(ev.relatedTarget)) show(pinned); });
    w.addEventListener("click", function (ev) {
      var k = keyOf(ev); if (!k) return;
      pinned = pinned === k ? null : k; show(pinned || k, true);
    });
    w.addEventListener("keydown", function (ev) {
      var i = items.indexOf(ev.target); if (i < 0) return;
      var step = { ArrowDown: 1, ArrowLeft: 1, ArrowUp: -1, ArrowRight: -1 }[ev.key]; // RTL: اليسار = التالي
      var j = step ? (i + step + items.length) % items.length : ev.key === "Home" ? 0 : ev.key === "End" ? items.length - 1 : -1;
      if (j >= 0) { ev.preventDefault(); items[i].tabIndex = -1; items[j].tabIndex = 0; items[j].focus(); }
      else if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.target.click(); }
      else if (ev.key === "Escape") { pinned = null; show(null); live.textContent = "أُلغي الإبراز"; }
    });
    show(pinned);
  });
});

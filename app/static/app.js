// تفاعلات بسيطة دون مكتبات خارجية
(function () {
  "use strict";
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
    } else if (!ev.target.closest("#sidebar")) {
      var s = document.getElementById("sidebar");
      if (s && s.classList.contains("open")) s.classList.remove("open");
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
    if (s && s.classList.contains("open")) { s.classList.remove("open"); var b = document.querySelector("[data-menu]"); if (b) { b.setAttribute("aria-expanded", "false"); b.focus(); } }
  });

  // تأكيد قبل الإجراءات الحساسة + إلزام السبب
  document.addEventListener("submit", function (ev) {
    var f = ev.target;
    var msg = f.getAttribute("data-confirm");
    var sub = ev.submitter;
    if (sub && sub.getAttribute("data-confirm")) msg = sub.getAttribute("data-confirm");
    if (sub && sub.hasAttribute("data-need-note")) {
      var note = f.querySelector('[name="note"]');
      if (note && !note.value.trim()) {
        var v = window.prompt("اذكر السبب:");
        if (!v || !v.trim()) { ev.preventDefault(); return; }
        note.value = v.trim();
      }
    }
    if (msg && !window.confirm(msg)) ev.preventDefault();
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
})();

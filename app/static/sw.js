/* عامل الخدمة لنظام إتمام: يستقبل إشعارات الأجهزة ويعرضها كتطبيق، ويفتح الصفحة المرتبطة عند الضغط.
   لا يخزّن صفحات النظام أو بياناته (حفاظاً على السرية)؛ يعرض صفحة «غير متصل» فقط عند انقطاع الشبكة. */
const OFFLINE = "/static/offline.html";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open("itmam-v1").then((c) => c.addAll([OFFLINE, "/static/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== "itmam-v1").map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "إتمام", body: e.data ? e.data.text() : "" }; }
  const title = d.title || "إشعار جديد — إتمام";
  const opts = {
    body: d.body || "",
    icon: "/static/icon-192.png",
    badge: "/static/badge-96.png",
    dir: "rtl",
    lang: "ar",
    tag: d.tag || undefined,
    data: { url: d.url || "/messages" },
  };
  const jobs = [self.registration.showNotification(title, opts)];
  if (typeof d.badge === "number" && self.navigator && "setAppBadge" in self.navigator) {
    jobs.push(d.badge > 0 ? self.navigator.setAppBadge(d.badge).catch(() => {}) : self.navigator.clearAppBadge().catch(() => {}));
  }
  e.waitUntil(Promise.all(jobs));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.location.origin) && "focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});

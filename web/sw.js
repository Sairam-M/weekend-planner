// Service worker: offline shell + Web Share Target (screenshots) + push.
const CACHE = "wp-shell-v3"; // bump this whenever you want to force old caches to be dropped
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./planner.js", "./config.js",
  "./manifest.webmanifest", "./data/places.json", "./icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Share target: Android posts the shared image here.
  if (e.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith(
      (async () => {
        const form = await e.request.formData();
        const file = form.get("screenshot");
        const cache = await caches.open("wp-shared");
        if (file && file.size) {
          await cache.put("shared-image", new Response(file, { headers: { "Content-Type": file.type } }));
        }
        const meta = { title: form.get("title") || "", text: form.get("text") || "", url: form.get("url") || "" };
        await cache.put("shared-meta", new Response(JSON.stringify(meta)));
        return Response.redirect("./?view=add&shared=1", 303);
      })()
    );
    return;
  }

  if (e.request.method !== "GET") return;

  // Weather and other cross-origin calls: network only.
  if (url.origin !== location.origin) return;

  // Data files: network first, fall back to cache (keeps plans fresh).
  if (url.pathname.includes("/data/")) {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // App shell: network first (revalidate, so updates show up), cache only as offline fallback.
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener("push", (e) => {
  let data = { title: "Weekend Planner", body: "Your weekend picks are ready." };
  try { data = { ...data, ...e.data.json() }; } catch (_) {}
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "icons/icon-192.png" }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow("./"));
});

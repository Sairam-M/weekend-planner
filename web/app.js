import { planDay, stretchPick, weatherCtx } from "./planner.js";

// ---- Config (edit after deploying the Worker) -------------------------------
const CONFIG = {
  workerUrl: "",          // e.g. https://weekend-worker.<you>.workers.dev
  // The Worker token is NOT stored here. Paste it once in the Add tab (kept on your phone only).
  lat: 13.0827, lon: 80.2707, // Chennai
};

// ---- Strings (English / Tamil) ----------------------------------------------
const T = {
  en: {
    weekend: "This weekend", library: "Library", add: "Add", lang: "தமிழ்",
    rain: "Rain likely", verify: "Verify hours before you go.", open: "Open in Maps",
    also: "Stretch pick (outside your usual taste)", saturday: "Saturday", sunday: "Sunday",
    been: "Been", want: "Want", skip: "Skip", nothing: "Nothing fits. Add places in Library.",
    libEmpty: "You have gone through every place. More will appear after the monthly refresh.",
    addTitle: "Add from screenshot", extract: "Read screenshot", save: "Save event",
    saved: "Saved on this phone.", noWorker: "Screenshot reading is not set up yet. Fill the card by hand.",
    noShared: "Share an image to this app from your gallery, or fill the card by hand.",
    events: "Saved events",
  },
  ta: {
    weekend: "இந்த வார இறுதி", library: "நூலகம்", add: "சேர்", lang: "English",
    rain: "மழை வாய்ப்பு", verify: "செல்லும் முன் நேரத்தை சரிபார்க்கவும்.", open: "வரைபடத்தில் திற",
    also: "புதிய முயற்சி (வழக்கத்துக்கு வெளியே)", saturday: "சனி", sunday: "ஞாயிறு",
    been: "போயிருக்கேன்", want: "போகணும்", skip: "வேண்டாம்", nothing: "பொருத்தமாக எதுவும் இல்லை.",
    libEmpty: "எல்லா இடங்களும் பார்த்துவிட்டீர்கள். மாதாந்திர புதுப்பிப்புக்குப் பின் புதியவை வரும்.",
    addTitle: "ஸ்கிரீன்ஷாட்டிலிருந்து சேர்", extract: "ஸ்கிரீன்ஷாட்டைப் படி", save: "நிகழ்வைச் சேமி",
    saved: "இந்த தொலைபேசியில் சேமிக்கப்பட்டது.", noWorker: "ஸ்கிரீன்ஷாட் வாசிப்பு இன்னும் அமைக்கப்படவில்லை. கையால் நிரப்பவும்.",
    noShared: "கேலரியிலிருந்து படத்தைப் பகிரவும், அல்லது கையால் நிரப்பவும்.",
    events: "சேமித்த நிகழ்வுகள்",
  },
};

// ---- State (localStorage; wrapped because it can throw) ---------------------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const getToken = () => store.get("workerToken", "");
let lang = store.get("lang", "en");
let state = store.get("state", { status: {}, weights: {} });
let events = store.get("events", []);
let places = [];
let weather = [];
let view = new URLSearchParams(location.search).get("view") || "weekend";

const $ = (s) => document.querySelector(s);
const t = (k) => T[lang][k];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---- Data -------------------------------------------------------------------
async function loadPlaces() {
  const r = await fetch("data/places.json");
  places = (await r.json()).places;
}

async function loadWeather() {
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${CONFIG.lat}&longitude=${CONFIG.lon}` +
      `&daily=precipitation_probability_max,temperature_2m_max&timezone=Asia%2FKolkata&forecast_days=7`;
    const j = await (await fetch(u)).json();
    weather = j.daily.time.map((d, i) => {
      const date = new Date(d + "T00:00:00");
      return { date: d, dow: date.getDay(), month: date.getMonth() + 1,
        rain: j.daily.precipitation_probability_max[i], temp: Math.round(j.daily.temperature_2m_max[i]) };
    });
    store.set("weather", weather);
  } catch {
    weather = store.get("weather", []);
  }
}

// Next Saturday and Sunday (today counts if it is already the weekend).
function weekendDays() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 8 && out.length < 2; i++) {
    const d = new Date(now); d.setDate(now.getDate() + i);
    if (d.getDay() === 6 || d.getDay() === 0) out.push(d);
  }
  return out.map((d) => ({ dow: d.getDay(), month: d.getMonth() + 1, date: d }));
}

// ---- Views ------------------------------------------------------------------
function pickCard(p, extra = "") {
  const flags = (p.flags || []).map((f) => `<span class="flag">${esc(f)}</span>`).join("");
  return `<div class="card ${extra}">
    <h3>${esc(p.name)}</h3>
    <div class="meta">${esc(p.area)} · ${esc(p.category)} · about ${p.duration_min} min</div>
    <p>${esc(p.note)}</p>
    <div class="meta">${esc(p.hours)}</div>
    <div class="flags">${flags}</div>
    <div class="verify">${t("verify")}</div>
    <p><a href="${esc(p.maps_url)}" target="_blank" rel="noopener">${t("open")}</a></p>
  </div>`;
}

function renderWeekend() {
  const days = weekendDays();
  const used = new Set();
  let html = "";
  const plans = days.map((day) => {
    const w = weatherCtx(weather, day.dow);
    const ctx = { state, rainy: w.rainy };
    const plan = planDay(places, day, ctx);
    plan.stops.forEach((s) => used.add(s.id));
    return { day, w, ctx, plan };
  });
  for (const { day, w, plan } of plans) {
    const name = day.dow === 6 ? t("saturday") : t("sunday");
    html += `<h2>${name}</h2>`;
    if (w.temp !== null) {
      html += `<div class="banner">${w.rain >= 50 ? t("rain") + " · " : ""}${w.rain}% · ${w.temp}°C</div>`;
    }
    html += plan.stops.length ? plan.stops.map((p) => pickCard(p)).join("") : `<div class="empty">${t("nothing")}</div>`;
  }
  const first = plans[0];
  const stretch = first && stretchPick(places, first.day, first.ctx, used);
  if (stretch) html += `<h2>${t("also")}</h2>${pickCard(stretch, "stretch")}`;
  $("#view").innerHTML = html;
}

function nextUnswiped() {
  return places.find((p) => !state.status[p.id]);
}

function renderLibrary() {
  const p = nextUnswiped();
  if (!p) {
    const rows = places.map((pl) => `<div class="card"><h3>${esc(pl.name)}</h3>
      <div class="meta">${t(state.status[pl.id])}</div>
      <div class="actions"><button data-undo="${esc(pl.id)}">Undo</button></div></div>`).join("");
    $("#view").innerHTML = `<div class="empty">${t("libEmpty")}</div>${rows}
      <div class="actions"><button class="btn" id="reset">Reset all swipes</button></div>`;
    document.querySelectorAll("[data-undo]").forEach((b) =>
      b.addEventListener("click", () => undoSwipe(places.find((x) => x.id === b.dataset.undo))));
    $("#reset").addEventListener("click", resetSwipes);
    return;
  }
  $("#view").innerHTML = `${pickCard(p)}
    <div class="actions">
      <button class="skip" data-s="skip">${t("skip")}</button>
      <button class="been" data-s="been">${t("been")}</button>
      <button class="want" data-s="want">${t("want")}</button>
    </div>`;
  document.querySelectorAll(".actions button").forEach((b) =>
    b.addEventListener("click", () => swipe(p, b.dataset.s)));
}

const DELTA = { want: 0.3, skip: -0.3, been: 0.1 }; // taste weights learn from swipes

function undoSwipe(p) {
  const s = state.status[p.id];
  if (!s) return;
  for (const tag of p.tags) state.weights[tag] = (state.weights[tag] ?? 0) - DELTA[s];
  delete state.status[p.id];
  store.set("state", state);
  syncTaste();
  renderLibrary();
}

function resetSwipes() {
  state = { status: {}, weights: {} };
  store.set("state", state);
  syncTaste();
  renderLibrary();
}

function swipe(p, s) {
  state.status[p.id] = s;
  for (const tag of p.tags) state.weights[tag] = (state.weights[tag] ?? 0) + DELTA[s];
  store.set("state", state);
  syncTaste();
  renderLibrary();
}

// Push swipes to the Worker so the Thursday job can read them. Silent if not configured.
function syncTaste() {
  if (!CONFIG.workerUrl) return;
  fetch(CONFIG.workerUrl + "/taste", {
    method: "PUT",
    headers: { Authorization: "Bearer " + getToken(), "Content-Type": "application/json" },
    body: JSON.stringify(state),
  }).catch(() => {});
}

async function renderAdd() {
  let img = "";
  if (new URLSearchParams(location.search).get("shared")) {
    try {
      const c = await caches.open("wp-shared");
      const r = await c.match("shared-image");
      if (r) img = `<img class="shared" src="${URL.createObjectURL(await r.blob())}" alt="shared screenshot">`;
    } catch {}
  }
  const list = events.map((e) => `<div class="card"><h3>${esc(e.title)}</h3>
    <div class="meta">${esc(e.date)} · ${esc(e.venue)} · ${esc(e.price)}</div></div>`).join("");
  $("#view").innerHTML = `<h2>${t("addTitle")}</h2>${img || `<p class="meta">${t("noShared")}</p>`}
    ${img ? `<button class="btn primary" id="extract">${t("extract")}</button><p class="meta" id="xmsg"></p>` : ""}
    <label>Title</label><input id="f-title">
    <label>Date and time</label><input id="f-date">
    <label>Venue</label><input id="f-venue">
    <label>Price</label><input id="f-price">
    <div class="actions"><button class="btn primary" id="save">${t("save")}</button></div>
    <p class="meta" id="smsg"></p>
    ${list ? `<h2>${t("events")}</h2>${list}` : ""}
    <h2>Settings</h2>
    <label>Worker token (stored on this phone only)</label>
    <input id="f-token" type="password" autocomplete="off" value="${esc(getToken())}">
    <div class="actions"><button class="btn" id="save-token">Save token</button></div>`;

  $("#save-token").addEventListener("click", () => {
    store.set("workerToken", $("#f-token").value.trim());
    $("#smsg").textContent = t("saved");
  });

  $("#save").addEventListener("click", () => {
    events.unshift({ title: $("#f-title").value, date: $("#f-date").value,
      venue: $("#f-venue").value, price: $("#f-price").value });
    store.set("events", events);
    $("#smsg").textContent = t("saved");
    renderAdd();
  });
  if (img) $("#extract").addEventListener("click", extractShared);
}

async function extractShared() {
  if (!CONFIG.workerUrl) { $("#xmsg").textContent = t("noWorker"); return; }
  try {
    const c = await caches.open("wp-shared");
    const blob = await (await c.match("shared-image")).blob();
    const r = await fetch(CONFIG.workerUrl + "/extract", {
      method: "POST", headers: { Authorization: "Bearer " + getToken(), "Content-Type": blob.type }, body: blob,
    });
    const j = await r.json();
    $("#f-title").value = j.title || ""; $("#f-date").value = j.date || "";
    $("#f-venue").value = j.venue || ""; $("#f-price").value = j.price || "";
    $("#xmsg").textContent = "Check the card, then save.";
  } catch (e) {
    $("#xmsg").textContent = "Could not read the screenshot: " + e.message;
  }
}

// ---- Shell ------------------------------------------------------------------
function render() {
  $("#title").textContent = t(view);
  $("#lang").textContent = t("lang");
  document.querySelectorAll(".tabs button").forEach((b) => {
    b.classList.toggle("on", b.dataset.view === view);
    b.textContent = t(b.dataset.view);
  });
  if (view === "weekend") renderWeekend();
  else if (view === "library") renderLibrary();
  else renderAdd();
}

document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => { view = b.dataset.view; render(); }));
$("#lang").addEventListener("click", () => { lang = lang === "en" ? "ta" : "en"; store.set("lang", lang); render(); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

await loadPlaces();
await loadWeather();
render();
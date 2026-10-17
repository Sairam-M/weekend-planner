import {
  planDay, stretchPick, weatherCtx, SLOT_START, toMinutes, clashes, groupEvents,
} from "./planner.js";
import { CONFIG } from "./config.js";

// ---- Strings ----------------------------------------------------------------
const T = {
  weekend: "This weekend", library: "Library", add: "Add",
  rain: "Rain likely", verify: "Verify hours before you go.", open: "Open in Maps",
  verifyEvent: "Confirm the date and venue on the original poster.",
  also: "Stretch pick (outside your usual taste)", saturday: "Saturday", sunday: "Sunday",
  been: "Been", want: "Want", skip: "Skip", nothing: "Nothing fits. Add places in Library.",
  libEmpty: "You have gone through every place. More will appear after the monthly refresh.",
  addTitle: "Save from a screenshot", extract: "Read screenshot", saveEvent: "Save event", savePlace: "Save place",
  typeEvent: "Event (has a date)", typePlace: "Place (any time)",
  noWorker: "Screenshot reading is not set up yet. Fill the card by hand.",
  noShared: "Share an image to this app from your gallery, or fill the card by hand.",
  needTitle: "Give it a title first.",
  savedEvent: "Event saved.", savedPlace: "Saved. It can now show up in your weekend plans.",
  tokenSaved: "Token saved.",
  upcoming: "Upcoming events", past: "Past events", undated: "Needs a date", myPlaces: "Places you saved",
  comingUp: "Coming up", fixed: "Event", notes: "Notes", delete: "Delete",
  date: "Date", time: "Time", venue: "Venue / area", price: "Price", title: "Title",
  indoor: "Indoor or covered (so it works on rainy days)",
  confirmDelete: "Delete this?", noSaved: "Nothing saved yet.",
};
const t = (k) => T[k] ?? k;

// ---- Small helpers ----------------------------------------------------------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const getToken = () => store.get("workerToken", "");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isoOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const mapsUrl = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q + " Chennai")}`;

// ---- Screenshot copies: IndexedDB (localStorage is far too small for images) -
function idbOpen() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("wp", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("images");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function imgPut(id, blob) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").put(blob, id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function imgGet(id) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const q = db.transaction("images").objectStore("images").get(id);
    q.onsuccess = () => resolve(q.result || null);
    q.onerror = () => reject(q.error);
  });
}
async function imgDel(id) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Shrink a screenshot to about 1280px JPEG so a copy costs ~100-300 KB, not several MB.
async function compress(blob, max = 1280) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.8));
    return out && out.size < blob.size ? out : blob;
  } catch {
    return blob;
  }
}

// Lazy-load a saved screenshot when its <details> is opened.
function wireShots() {
  document.querySelectorAll("details[data-img]").forEach((d) =>
    d.addEventListener("toggle", async () => {
      if (!d.open) return;
      const box = d.querySelector(".shot");
      if (!box || box.dataset.loaded) return;
      box.dataset.loaded = "1";
      try {
        const b = await imgGet(d.dataset.img);
        if (b) box.innerHTML = `<img class="shared" alt="saved screenshot" src="${URL.createObjectURL(b)}">`;
      } catch {}
    }));
}

// ---- State ------------------------------------------------------------------
let state = store.get("state", { status: {}, weights: {} });
let places = [];                                // seed places + places you saved yourself
let myPlaces = store.get("myplaces", []);       // evergreen, saved from screenshots (no date)
let weather = [];
let sharedBlob = null;                          // compressed screenshot waiting to be saved
let addType = "event";                          // what the Add form is currently saving
let view = new URLSearchParams(location.search).get("view") || "weekend";

// Events are dated one-offs. Older saves (title/date/venue/price only) are migrated:
// the free-text date moves into notes and the event lands under "Needs a date".
let events = store.get("events", []).map((e) =>
  e.id ? e : {
    id: uid(), title: e.title || "", date: "", time: "", venue: e.venue || "", price: e.price || "",
    notes: e.date ? `Date on poster: ${e.date}` : "", hasImage: false, created: Date.now(),
  });
store.set("events", events);

// ---- Data -------------------------------------------------------------------
async function loadPlaces() {
  const r = await fetch("data/places.json");
  places = [...(await r.json()).places, ...myPlaces];
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
  return out.map((d) => ({ dow: d.getDay(), month: d.getMonth() + 1, date: d, iso: isoOf(d) }));
}

// ---- Cards ------------------------------------------------------------------
function pickCard(p, extra = "") {
  const flags = (p.flags || []).map((f) => `<span class="flag">${esc(f)}</span>`).join("");
  const shot = p.hasImage
    ? `<details class="shotbox" data-img="${esc(p.id)}"><summary>Screenshot</summary><div class="shot"></div></details>` : "";
  return `<div class="card ${extra}">
    <h3>${esc(p.name)}</h3>
    <div class="meta">${esc(p.area)}${p.area ? " · " : ""}${esc(p.category)} · about ${p.duration_min} min</div>
    ${p.note ? `<p>${esc(p.note)}</p>` : ""}
    <div class="meta">${esc(p.hours)}</div>
    <div class="flags">${flags}</div>
    <div class="verify">${t("verify")}</div>
    ${shot}
    <p><a href="${esc(p.maps_url)}" target="_blank" rel="noopener">${t("open")}</a></p>
  </div>`;
}

// An event in the plan: fixed date and time, so it is a badge plus a time, not a suggestion.
function eventCard(e, showDate = false) {
  const when = [showDate ? e.date : "", e.time].filter(Boolean).join(" ");
  const shot = e.hasImage
    ? `<details class="shotbox" data-img="${esc(e.id)}"><summary>Screenshot</summary><div class="shot"></div></details>` : "";
  return `<div class="card event">
    <span class="badge">${t("fixed")}</span>${when ? ` <span class="time">${esc(when)}</span>` : ""}
    <h3>${esc(e.title)}</h3>
    <div class="meta">${esc(e.venue)}${e.price ? " · " + esc(e.price) : ""}</div>
    ${e.notes ? `<p>${esc(e.notes)}</p>` : ""}
    <div class="verify">${t("verifyEvent")}</div>
    ${shot}
  </div>`;
}

// ---- This weekend -----------------------------------------------------------
function renderWeekend() {
  const days = weekendDays();
  const used = new Set();
  let html = "";
  const plans = days.map((day) => {
    const w = weatherCtx(weather, day.dow);
    const ctx = { state, rainy: w.rainy };
    const dayEvents = events.filter((e) => e.date === day.iso);
    // Places are planned around events: drop any place whose visit would overlap one.
    const stops = planDay(places, day, ctx).stops.filter((p) => !clashes(p, dayEvents));
    stops.forEach((s) => used.add(s.id));
    const items = [
      ...dayEvents.map((e) => ({ at: toMinutes(e.time) ?? -1, html: eventCard(e) })),
      ...stops.map((p) => ({ at: SLOT_START[p.slot] ?? 720, html: pickCard(p) })),
    ].sort((a, b) => a.at - b.at);
    return { day, w, ctx, items };
  });

  for (const { day, w, items } of plans) {
    html += `<h2>${day.dow === 6 ? t("saturday") : t("sunday")}</h2>`;
    if (w.temp !== null) {
      html += `<div class="banner">${w.rain >= 50 ? t("rain") + " · " : ""}${w.rain}% · ${w.temp}°C</div>`;
    }
    html += items.length ? items.map((i) => i.html).join("") : `<div class="empty">${t("nothing")}</div>`;
  }

  const first = plans[0];
  const stretch = first && stretchPick(places, first.day, first.ctx, used);
  if (stretch) html += `<h2>${t("also")}</h2>${pickCard(stretch, "stretch")}`;

  // Events that are not on this weekend but are still ahead.
  const weekendIso = new Set(days.map((d) => d.iso));
  const ahead = groupEvents(events, isoOf(new Date())).up.filter((e) => !weekendIso.has(e.date)).slice(0, 5);
  if (ahead.length) html += `<h2>${t("comingUp")}</h2>${ahead.map((e) => eventCard(e, true)).join("")}`;

  $("#view").innerHTML = html;
  wireShots();
}

// ---- Library (places: no date, visit any time) ------------------------------
const DELTA = { want: 0.3, skip: -0.3, been: 0.1 }; // taste weights learn from swipes

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
  wireShots();
}

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
  // Places you saved yourself stay wanted: resetting the deck should not hide them again.
  for (const p of myPlaces) state.status[p.id] = "want";
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

// ---- Add (save from a screenshot as an event or a place) --------------------
function eventItem(e) {
  const when = [e.date, e.time].filter(Boolean).join(" ");
  return `<details class="card ev" data-id="${esc(e.id)}"${e.hasImage ? ` data-img="${esc(e.id)}"` : ""}>
    <summary><strong>${esc(e.title)}</strong>
      <div class="meta">${esc(when || t("undated"))}${e.venue ? " · " + esc(e.venue) : ""}</div></summary>
    ${e.price ? `<div class="meta">${esc(e.price)}</div>` : ""}
    ${e.notes ? `<p>${esc(e.notes)}</p>` : ""}
    ${e.hasImage ? `<div class="shot"></div>` : ""}
    ${e.venue ? `<p><a href="${esc(mapsUrl(e.venue))}" target="_blank" rel="noopener">${t("open")}</a></p>` : ""}
    <div class="actions"><button data-del="${esc(e.id)}">${t("delete")}</button></div>
  </details>`;
}

function placeItem(p) {
  const been = state.status[p.id] === "been";
  return `<details class="card ev" data-id="${esc(p.id)}"${p.hasImage ? ` data-img="${esc(p.id)}"` : ""}>
    <summary><strong>${esc(p.name)}</strong>
      <div class="meta">${esc(p.area)}${p.area ? " · " : ""}${been ? t("been") : t("want")}</div></summary>
    ${p.price ? `<div class="meta">${esc(p.price)}</div>` : ""}
    ${p.note ? `<p>${esc(p.note)}</p>` : ""}
    ${p.hasImage ? `<div class="shot"></div>` : ""}
    <p><a href="${esc(p.maps_url)}" target="_blank" rel="noopener">${t("open")}</a></p>
    <div class="actions">
      <button data-been="${esc(p.id)}">${been ? t("want") : t("been")}</button>
      <button data-delplace="${esc(p.id)}">${t("delete")}</button>
    </div>
  </details>`;
}

async function loadShared() {
  if (sharedBlob || !new URLSearchParams(location.search).get("shared")) return;
  try {
    const c = await caches.open("wp-shared");
    const r = await c.match("shared-image");
    if (r) sharedBlob = await compress(await r.blob());
  } catch {}
}

function setType(type) {
  addType = type;
  $("#ty-event").classList.toggle("on", type === "event");
  $("#ty-place").classList.toggle("on", type === "place");
  $("#grp-event").hidden = type !== "event";
  $("#grp-place").hidden = type !== "place";
  $("#save").textContent = type === "event" ? t("saveEvent") : t("savePlace");
}

async function renderAdd() {
  await loadShared();
  const { up, undated, past } = groupEvents(events, isoOf(new Date()));
  const img = sharedBlob
    ? `<img class="shared" src="${URL.createObjectURL(sharedBlob)}" alt="shared screenshot">` : "";
  const list = (arr) => arr.map(eventItem).join("");

  $("#view").innerHTML = `<h2>${t("addTitle")}</h2>
    ${img || `<p class="meta">${t("noShared")}</p>`}
    ${img ? `<button class="btn primary" id="extract">${t("extract")}</button><p class="meta" id="xmsg"></p>` : ""}
    <div class="seg">
      <button class="chip" id="ty-event">${t("typeEvent")}</button>
      <button class="chip" id="ty-place">${t("typePlace")}</button>
    </div>
    <label>${t("title")}</label><input id="f-title">
    <div id="grp-event">
      <label>${t("date")}</label><input id="f-date" type="date">
      <label>${t("time")}</label><input id="f-time" type="time">
    </div>
    <label>${t("venue")}</label><input id="f-venue">
    <div id="grp-place"><label class="check"><input id="f-indoor" type="checkbox"> ${t("indoor")}</label></div>
    <label>${t("price")}</label><input id="f-price">
    <label>${t("notes")}</label><textarea id="f-notes" rows="3"></textarea>
    <div class="actions"><button class="btn primary" id="save"></button></div>
    <p class="meta" id="smsg"></p>

    ${up.length ? `<h2>${t("upcoming")}</h2>${list(up)}` : ""}
    ${undated.length ? `<h2>${t("undated")}</h2>${list(undated)}` : ""}
    ${past.length ? `<details class="past"><summary>${t("past")} (${past.length})</summary>${list(past)}</details>` : ""}
    <h2>${t("myPlaces")}</h2>
    ${myPlaces.length ? myPlaces.map(placeItem).join("") : `<p class="meta">${t("noSaved")}</p>`}

    <h2>Settings</h2>
    <label>Worker token (stored on this phone only)</label>
    <input id="f-token" type="password" autocomplete="off" value="${esc(getToken())}">
    <div class="actions"><button class="btn" id="save-token">Save token</button></div>`;

  setType(addType);
  $("#ty-event").addEventListener("click", () => setType("event"));
  $("#ty-place").addEventListener("click", () => setType("place"));
  $("#save").addEventListener("click", saveItem);
  $("#save-token").addEventListener("click", () => {
    store.set("workerToken", $("#f-token").value.trim());
    $("#smsg").textContent = t("tokenSaved");
  });
  if (sharedBlob) $("#extract").addEventListener("click", extractShared);
  wireShots();

  document.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm(t("confirmDelete"))) return;
      const id = b.dataset.del;
      try { await imgDel(id); } catch {}
      events = events.filter((e) => e.id !== id);
      store.set("events", events);
      renderAdd();
    }));

  document.querySelectorAll("[data-delplace]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm(t("confirmDelete"))) return;
      const id = b.dataset.delplace;
      try { await imgDel(id); } catch {}
      myPlaces = myPlaces.filter((p) => p.id !== id);
      places = places.filter((p) => p.id !== id);
      delete state.status[id];
      store.set("myplaces", myPlaces);
      store.set("state", state);
      syncTaste();
      renderAdd();
    }));

  document.querySelectorAll("[data-been]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.been;
      state.status[id] = state.status[id] === "been" ? "want" : "been";
      store.set("state", state);
      syncTaste();
      renderAdd();
    }));
}

async function saveItem() {
  const title = $("#f-title").value.trim();
  if (!title) { $("#smsg").textContent = t("needTitle"); return; }
  const venue = $("#f-venue").value.trim();
  const price = $("#f-price").value.trim();
  const notes = $("#f-notes").value.trim();
  const isPlace = addType === "place";
  const id = (isPlace ? "u-" : "") + uid();

  let hasImage = false;
  if (sharedBlob) {
    try { await imgPut(id, sharedBlob); hasImage = true; } catch {}
  }

  if (!isPlace) {
    events.unshift({
      id, title, date: $("#f-date").value, time: $("#f-time").value,
      venue, price, notes, hasImage, created: Date.now(),
    });
    store.set("events", events);
  } else {
    // A place you saved yourself: evergreen, no date. It joins the planner pool and is marked
    // "want" so it is not shown again in the swipe deck. Fields the screenshot cannot tell us
    // (noise, crowd, hours) get neutral defaults and an honest "not checked" note.
    const place = {
      id, user: true, name: title, area: venue, category: "saved by you", tags: [],
      indoor: $("#f-indoor").checked, noise: 2, crowd: 2, fame: 3, duration_min: 90,
      slot: "afternoon", open_days: null,
      hours: "Hours not checked. Saved from a screenshot.",
      maps_url: mapsUrl(venue || title), note: notes, price, flags: ["saved by you"],
      repeatable: false, season: null, hasImage, created: Date.now(),
    };
    myPlaces.unshift(place);
    places.push(place);
    state.status[id] = "want";
    store.set("myplaces", myPlaces);
    store.set("state", state);
    syncTaste();
  }

  // The shared image has been saved, so clear it to avoid saving a duplicate.
  sharedBlob = null;
  try { await caches.delete("wp-shared"); } catch {}
  history.replaceState(null, "", location.pathname + "?view=add");
  await renderAdd();
  $("#smsg").textContent = isPlace ? t("savedPlace") : t("savedEvent");
}

async function extractShared() {
  if (!CONFIG.workerUrl) { $("#xmsg").textContent = t("noWorker"); return; }
  $("#xmsg").textContent = "…";
  try {
    const r = await fetch(CONFIG.workerUrl + "/extract", {
      method: "POST",
      headers: { Authorization: "Bearer " + getToken(), "Content-Type": sharedBlob.type || "image/jpeg" },
      body: sharedBlob,
    });
    const j = await r.json();
    if (j.error) { $("#xmsg").textContent = "Could not read the screenshot: " + j.error; return; }
    const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(j.date_iso || "");
    $("#f-title").value = j.title || "";
    $("#f-date").value = hasDate ? j.date_iso : "";
    $("#f-time").value = /^\d{1,2}:\d{2}$/.test(j.time || "") ? j.time.padStart(5, "0") : "";
    $("#f-venue").value = j.venue || "";
    $("#f-price").value = j.price || "";
    setType(hasDate ? "event" : "place"); // a date means an event; no date means a place. You can flip it.
    $("#xmsg").textContent = `Looks like ${hasDate ? "an event" : "a place"}. Check the card, add notes, then save.`;
  } catch (e) {
    $("#xmsg").textContent = "Could not read the screenshot: " + e.message;
  }
}

// ---- Shell ------------------------------------------------------------------
function render() {
  $("#title").textContent = t(view);
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

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

await loadPlaces();
await loadWeather();
render();

// Plain-code planner: filtering, scoring, clustering. No AI involved.
// Runs in the browser (Slice 1) and is mirrored in scripts/plan_week.py later.

export const BASE_WEIGHTS = {
  quiet: 1.0, food: 1.0, books: 1.0, music: 1.0, crafts: 1.0, kids: 0.8,
  learning: 0.8, tamil: 0.8, culture: 0.8, history: 0.6, nature: 0.6,
  cafe: 0.6, traditional: 0.5, "social-good": 0.8, pottery: 0.6,
};

const SLOT_ORDER = { morning: 0, lunch: 1, afternoon: 2, evening: 3, "full-day": 1 };

export function tasteFit(place, weights) {
  const w = { ...BASE_WEIGHTS, ...weights };
  return place.tags.reduce((s, t) => s + (w[t] ?? 0), 0);
}

export function isOpen(place, dow) {
  return place.open_days == null || place.open_days.includes(dow);
}

export function inSeason(place, month) {
  return !place.season || place.season.includes(month);
}

// state: { status: {placeId: 'been'|'want'|'skip'}, weights: {tag: delta} }
export function scorePlace(place, ctx) {
  const { state, rainy } = ctx;
  const status = state.status[place.id];
  if (status === "skip") return -Infinity;
  let s = 2 * tasteFit(place, state.weights) + place.fame;
  s -= 2 * place.noise + 1.5 * place.crowd; // explicit noise/crowd penalty
  if (status === "want") s += 4;
  if (place.user) s += 6; // places you saved yourself from a screenshot: you chose them, so lift them
  if (status === "been" && !place.repeatable) s -= 6; // novelty
  if (rainy && !place.indoor) s -= 100; // rain filter
  return s;
}

function candidates(places, day, ctx) {
  return places.filter(
    (p) => isOpen(p, day.dow) && inSeason(p, day.month) && scorePlace(p, ctx) > -50
  );
}

// Build one day: best pick first, then fill with picks from the same area.
export function planDay(places, day, ctx) {
  const pool = candidates(places, day, ctx).sort(
    (a, b) => scorePlace(b, ctx) - scorePlace(a, ctx)
  );
  if (!pool.length) return { day, stops: [], note: "Nothing fits. Add places in Library." };
  const first = pool[0];
  const stops = [first];
  if (first.slot !== "full-day") {
    for (const p of pool.slice(1)) {
      if (stops.length >= 3) break;
      if (p.slot === "full-day") continue;
      if (p.area === first.area || stops.length === 1) {
        if (!stops.some((s) => s.slot === p.slot)) stops.push(p);
      }
    }
  }
  stops.sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]);
  return { day, stops };
}

// One stretch pick: best-scoring place whose taste fit is weakest (outside profile).
export function stretchPick(places, day, ctx, usedIds) {
  // Saved-by-you places have no taste tags, so they would always look "outside your taste". Skip them here.
  const pool = candidates(places, day, ctx).filter((p) => !usedIds.has(p.id) && !p.user);
  pool.sort((a, b) => tasteFit(a, ctx.state.weights) - tasteFit(b, ctx.state.weights));
  return pool[0] || null;
}

// ---- Events (dated, one-off) vs places (evergreen) --------------------------
// A place can be visited any time. An event happens once, on a date and time, and
// expires. Events are fixed anchors in a day: places are planned around them.

// Approximate start minute for each place slot, so events and places can share one timeline.
export const SLOT_START = { morning: 540, lunch: 720, afternoon: 900, evening: 1080, "full-day": 600 };

export function toMinutes(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatMinutes(min) {
  return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
}

// Does a place's visit overlap an event? Assumes an event lasts about 2.5 hours and
// leaves a 30 minute buffer before it. An event with no time only blocks full-day places.
export function clashes(place, dayEvents) {
  const start = SLOT_START[place.slot] ?? 720;
  const end = start + (place.slot === "full-day" ? 600 : place.duration_min);
  return dayEvents.some((e) => {
    const es = toMinutes(e.time);
    if (es === null) return place.slot === "full-day";
    return start < es + 150 && end > es - 30;
  });
}

// Split saved events into upcoming (soonest first), undated, and past (latest first).
export function groupEvents(events, todayIso) {
  const key = (e) => e.date + (e.time || "");
  const up = events.filter((e) => e.date && e.date >= todayIso).sort((a, b) => key(a).localeCompare(key(b)));
  const undated = events.filter((e) => !e.date);
  const past = events.filter((e) => e.date && e.date < todayIso).sort((a, b) => key(b).localeCompare(key(a)));
  return { up, undated, past };
}

export function weatherCtx(weather, dow) {
  const d = weather.find((w) => w.dow === dow);
  return { rain: d ? d.rain : 0, temp: d ? d.temp : null, rainy: d ? d.rain >= 50 : false };
}

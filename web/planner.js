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
  const pool = candidates(places, day, ctx).filter((p) => !usedIds.has(p.id));
  pool.sort((a, b) => tasteFit(a, ctx.state.weights) - tasteFit(b, ctx.state.weights));
  return pool[0] || null;
}

export function weatherCtx(weather, dow) {
  const d = weather.find((w) => w.dow === dow);
  return { rain: d ? d.rain : 0, temp: d ? d.temp : null, rainy: d ? d.rain >= 50 : false };
}

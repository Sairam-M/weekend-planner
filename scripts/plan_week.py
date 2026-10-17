#!/usr/bin/env python3
"""Thursday planner (scaffold).

Mirrors web/planner.js: filter by open day, season and rain, score on taste fit,
fame, noise/crowd penalty and novelty, then write web/data/picks.json.
Taste state (swipes) is read from the Worker if WORKER_URL and WORKER_TOKEN are set.

TODO: LLM "why this" blurbs, verifier pass on every link/hours, Web Push send.
"""
import json
import os
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLACES = ROOT / "web" / "data" / "places.json"
OUT = ROOT / "web" / "data" / "picks.json"
LAT, LON = 13.0827, 80.2707

BASE = {"quiet": 1.0, "food": 1.0, "books": 1.0, "music": 1.0, "crafts": 1.0, "kids": 0.8,
        "learning": 0.8, "tamil": 0.8, "culture": 0.8, "history": 0.6, "nature": 0.6,
        "cafe": 0.6, "traditional": 0.5, "social-good": 0.8, "pottery": 0.6}


def get_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def weekend():
    today = date.today()
    return [today + timedelta(days=i) for i in range(8) if (today + timedelta(days=i)).weekday() in (5, 6)][:2]


def forecast():
    u = (f"https://api.open-meteo.com/v1/forecast?latitude={LAT}&longitude={LON}"
         "&daily=precipitation_probability_max,temperature_2m_max&timezone=Asia%2FKolkata&forecast_days=7")
    d = get_json(u)["daily"]
    return {t: {"rain": r, "temp": round(m)} for t, r, m in
            zip(d["time"], d["precipitation_probability_max"], d["temperature_2m_max"])}


def taste_state():
    url, token = os.environ.get("WORKER_URL"), os.environ.get("WORKER_TOKEN")
    if not url:
        return {"status": {}, "weights": {}}
    try:
        return get_json(url + "/taste", {"Authorization": f"Bearer {token}"})
    except Exception:
        return {"status": {}, "weights": {}}


def fit(p, w):
    merged = {**BASE, **w}
    return sum(merged.get(t, 0) for t in p["tags"])


def score(p, state, rainy):
    st = state["status"].get(p["id"])
    if st == "skip":
        return float("-inf")
    s = 2 * fit(p, state["weights"]) + p["fame"] - 2 * p["noise"] - 1.5 * p["crowd"]
    if st == "want":
        s += 4
    if st == "been" and not p["repeatable"]:
        s -= 6
    if rainy and not p["indoor"]:
        s -= 100
    return s


def main():
    places = json.loads(PLACES.read_text())["places"]
    wx, state = forecast(), taste_state()
    days_out, used = [], set()
    for d in weekend():
        dow = (d.weekday() + 1) % 7  # JS convention: Sun=0
        w = wx.get(d.isoformat(), {"rain": 0, "temp": None})
        rainy = w["rain"] >= 50
        pool = [p for p in places
                if (p["open_days"] is None or dow in p["open_days"])
                and (not p["season"] or d.month in p["season"])
                and score(p, state, rainy) > -50]
        pool.sort(key=lambda p: -score(p, state, rainy))
        stops = pool[:3]
        used.update(p["id"] for p in stops)
        days_out.append({"date": d.isoformat(), "weather": w, "picks": [p["id"] for p in stops]})
    rest = [p for p in places if p["id"] not in used]
    rest.sort(key=lambda p: fit(p, state["weights"]))
    OUT.write_text(json.dumps({
        "generated": date.today().isoformat(),
        "days": days_out,
        "stretch": rest[0]["id"] if rest else None,
    }, indent=2))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()

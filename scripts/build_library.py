#!/usr/bin/env python3
"""Monthly library builder (scaffold).

Queries Google Places API (New) Text Search by category and neighbourhood and
writes candidate places to web/data/candidates.json for the user to swipe.

Cost and terms guardrails:
- Hard call budget (MAX_CALLS, default 120) so a bug cannot run up a bill.
- Narrow field mask. Asking for reviews or atmosphere fields bills at a higher
  SKU with a lower free cap, so we only request id, name, address, location.
- The repo is public: we store only the place id, name, area and our own tags.
  Ratings, hours and reviews are fetched live (or kept in private storage),
  because Google restricts storing and redistributing that content.
  Check the current Places terms before changing this.

Usage:
  GOOGLE_PLACES_KEY=... python3 scripts/build_library.py
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

KEY = os.environ.get("GOOGLE_PLACES_KEY")
MAX_CALLS = int(os.environ.get("MAX_CALLS", "120"))
OUT = Path(__file__).resolve().parent.parent / "web" / "data" / "candidates.json"

# Categories derived from the taste profile, not from named places.
CATEGORIES = {
    "museum": ["museum", "heritage house"],
    "crafts": ["pottery studio", "craft store", "handloom"],
    "food": ["traditional mess", "iconic old restaurant", "filter coffee"],
    "music": ["vinyl cafe", "music store"],
    "books": ["book cafe", "independent bookstore"],
    "games": ["board game cafe"],
    "nature": ["bird sanctuary", "park", "nature trail"],
    "quiet": ["quiet cafe", "library"],
}
AREAS = ["Mylapore", "Adyar", "Alwarpet", "Triplicane", "Kilpauk", "Nungambakkam",
         "Besant Nagar", "ECR Chennai"]
TAGS = {"museum": ["learning", "quiet"], "crafts": ["crafts"], "food": ["food"],
        "music": ["music"], "books": ["books", "quiet"], "games": ["games"],
        "nature": ["nature", "quiet"], "quiet": ["quiet"]}


def search(query: str) -> list[dict]:
    body = json.dumps({"textQuery": query, "maxResultCount": 10}).encode()
    req = urllib.request.Request(
        "https://places.googleapis.com/v1/places:searchText",
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": KEY,
            "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get("places", [])


def main() -> int:
    if not KEY:
        print("Set GOOGLE_PLACES_KEY", file=sys.stderr)
        return 1
    seen: dict[str, dict] = {}
    calls = 0
    for cat, terms in CATEGORIES.items():
        for term in terms:
            for area in AREAS:
                if calls >= MAX_CALLS:
                    break
                calls += 1
                try:
                    results = search(f"{term} in {area}, Chennai")
                except Exception as e:  # keep going; one failure should not kill the run
                    print(f"query failed: {term} / {area}: {e}", file=sys.stderr)
                    continue
                for p in results:
                    pid = p["id"]
                    if pid in seen:
                        continue
                    seen[pid] = {
                        "place_id": pid,
                        "name": p.get("displayName", {}).get("text", ""),
                        "area": area,
                        "category": cat,
                        "tags": TAGS[cat],
                        "maps_url": f"https://www.google.com/maps/place/?q=place_id:{pid}",
                        "status": "candidate",
                    }
    OUT.write_text(json.dumps({"calls_used": calls, "places": list(seen.values())}, indent=2, ensure_ascii=False))
    print(f"{len(seen)} candidates from {calls} calls -> {OUT}")
    # TODO: enrichment step (fame signals from allowlisted articles, noise estimate),
    # merge into places.json with source + fetch date, flag conflicts.
    return 0


if __name__ == "__main__":
    sys.exit(main())

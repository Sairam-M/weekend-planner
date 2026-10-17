# Weekend Planner: project memory

Paste this file at the start of any new AI chat (Claude, ChatGPT, Copilot) so it has full context.
This repo is public, so personal details are kept out. The full private brief lives outside the repo.

## Goal
A personal PWA for one user in Chennai that answers "what do I do this weekend?". The user is picky and tends to
wait for something good, so the app surfaces picks proactively and always has a fallback.

## Taste profile (summary)
- Likes: quiet, food (famous mess/signature items by bus or metro), movies, Tamil culture, books, music listening,
  crafts, kids' learning/NGO work, game nights, small discussion events.
- Dislikes: noise, traffic, crowds. Noise and crowd are explicit ranking penalties.
- Android phone, comfortable with bus, metro and overnight buses.
- Does not want an Instagram-saved-list app. Instagram is one input only.

## Product rules
- No pick without a source link and hours/date. Every pick shows a "verify hours" note.
- Each Thursday evening: 3 picks plus 1 stretch pick outside his profile, with a rain fallback.
- Swipe library: been / want / skip. Swipes update taste weights.
- Screenshot intake via Android share sheet; a vision model extracts title/date/venue/price; user confirms.
- Do not scrape Instagram or booking sites. Official APIs, search results and link-outs only.
- Plain code does filtering, scoring, clustering. AI only reads articles/screenshots and writes blurbs.

## Architecture
- `web/`: static PWA on GitHub Pages (this week view, swipe library, add-from-screenshot, share target, service worker).
- `worker/`: Cloudflare Worker. `/extract` (OpenAI vision proxy with monthly cap) and `/taste` (KV store for swipes).
- `scripts/`: `build_library.py` (Places candidates, monthly), `plan_week.py` (Thursday picks).
- `.github/workflows/`: deploy Pages, weekly plan, monthly library.

## Data source status (tested 17 Oct 2026)
- Google Places (New): works, strong. Free caps are per SKU per month; set quotas and budget alert.
- Article fame signals: works for famous places, many stale prices.
- Open-Meteo weather: works, no key.
- Event discovery by web search: weak. Plan: fetch known listing pages directly plus user screenshots (untested).
- Transit/directions times: untested. Do not trust routing yet.
- YouTube API: not tested. Tamil-language search: skipped.

## Known data conflicts (shown as flags in the app)
- Valluvar Kottam: hours (daily vs closed Fridays), fee (free vs Rs 10).
- Kalathi rose milk: price Rs 15 vs Rs 20.

## Status
- Done: scaffold of PWA, planner (client-side), swipe library, share target, Worker, scripts, workflows.
- Not done: Places keys and library enrichment, Web Push, taste sync from phone to Worker, events, overnight trips,
  Tamil strings review, design polish.
- All hours/prices in `web/data/places.json` are unverified seed data.

## Next steps
1. Deploy Pages, install on phone, check share target.
2. Deploy Worker, set secrets, wire `workerUrl` and `workerToken` in `web/app.js`.
3. Add Google Places key as a repo secret with quotas, run the library workflow, review candidates.
4. Test fetching event listing pages directly; test a Directions API.
5. Web Push for Thursday and Saturday nudges.

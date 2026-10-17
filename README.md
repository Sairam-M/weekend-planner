# Weekend Planner

A quiet, picky weekend planner for Chennai. Installable Android web app (PWA) on GitHub Pages, with a small
Cloudflare Worker and scheduled GitHub Actions behind it. See `PROJECT.md` for the product brief and status.

## Run it locally

```bash
cd web
python3 -m http.server 8080
# open http://localhost:8080  (localhost counts as secure, so the service worker works)
```

## Setup checklist

### 1. Put it on GitHub Pages (do this first)
1. Create a **public** repo (free Pages needs public), push this folder.
2. Repo Settings > Pages > Source: **GitHub Actions**.
3. Push to `main`. The `Deploy PWA to GitHub Pages` workflow publishes `web/`.
4. On your Android phone, open the Pages URL in Chrome > menu > **Install app**.
5. Open any image in Gallery > Share > **Weekend Planner** to test the share target.

### 2. Worker (screenshot reading + taste sync)
```bash
cd worker
npx wrangler login
npx wrangler kv namespace create STORE      # paste the id into wrangler.toml
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put APP_TOKEN           # any long random string
npx wrangler deploy
```
Then set `workerUrl` and `workerToken` in `CONFIG` at the top of `web/app.js`.
Set a hard monthly spend limit on your OpenAI account. The Worker also stops after `EXTRACT_MONTHLY_CAP` calls.

Note: a token in a public repo's JS is visible to anyone. For one user this is a low risk because the Worker caps
usage, but do not reuse the token anywhere else. A later improvement is an in-app settings field that keeps it in
localStorage instead of the source.

### 3. Google Places (library builder)
1. Google Cloud: create a project, enable **Places API (New)**, create an API key restricted to that API.
2. Set per-API daily quotas in the console and a budget alert (about Rs 100).
3. Repo Settings > Secrets > add `GOOGLE_PLACES_KEY`, `WORKER_URL`, `WORKER_TOKEN`.
4. Run `Monthly library refresh` from the Actions tab. Review `web/data/candidates.json`.

## Layout
```
web/        PWA (index.html, app.js, planner.js, sw.js, manifest, data/)
worker/     Cloudflare Worker (/extract, /taste)
scripts/    build_library.py, plan_week.py
.github/    workflows: pages, weekly-plan, monthly-library
PROJECT.md  shared memory for AI chats
```

## What works today vs what is a stub
Works: weekend view with live weather and rain filter, noise/crowd penalty, stretch pick, swipe library with
taste-weight updates, Tamil/English toggle, offline shell, share target storing the shared image, manual event card.
Stub: Places enrichment, Thursday Web Push, LLM blurbs, verifier, taste sync to the Worker, events, overnight trips.

// Cloudflare Worker: screenshot proxy (keeps the OpenAI key off the phone)
// and tiny taste-state store (so the Thursday job can read your swipes).
//
// Secrets (wrangler secret put): OPENAI_API_KEY, APP_TOKEN
// Vars (wrangler.toml): ALLOWED_ORIGIN, OPENAI_MODEL, EXTRACT_MONTHLY_CAP
// KV binding: STORE

const PROMPT =
  "Extract event details from this poster or screenshot. Reply with JSON only: " +
  '{"title":"","date":"","venue":"","price":""}. Use an empty string for anything not visible. ' +
  "Do not guess. Copy dates exactly as shown.";

function cors(env, extra = {}) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    ...extra,
  };
}

const json = (env, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors(env, { "Content-Type": "application/json" }) });

function toBase64(buf) {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function extract(request, env) {
  // Monthly spend guard: stop calling OpenAI once the cap is reached.
  const key = "extract:" + new Date().toISOString().slice(0, 7);
  const used = parseInt((await env.STORE.get(key)) || "0", 10);
  const cap = parseInt(env.EXTRACT_MONTHLY_CAP || "100", 10);
  if (used >= cap) return json(env, { error: "monthly cap reached" }, 429);

  const buf = await request.arrayBuffer();
  if (buf.byteLength > 6_000_000) return json(env, { error: "image too large" }, 413);
  const type = request.headers.get("Content-Type") || "image/jpeg";

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      max_tokens: 300,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: `data:${type};base64,${toBase64(buf)}`, detail: "low" } },
        ],
      }],
    }),
  });
  if (!r.ok) return json(env, { error: "model call failed", status: r.status }, 502);
  const data = await r.json();
  await env.STORE.put(key, String(used + 1));
  try {
    return json(env, JSON.parse(data.choices[0].message.content));
  } catch {
    return json(env, { error: "could not parse model output" }, 502);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(env) });
    if (request.headers.get("Authorization") !== `Bearer ${env.APP_TOKEN}`) {
      return json(env, { error: "unauthorized" }, 401);
    }
    const { pathname } = new URL(request.url);

    if (pathname === "/extract" && request.method === "POST") return extract(request, env);

    if (pathname === "/taste") {
      if (request.method === "GET") {
        return json(env, JSON.parse((await env.STORE.get("taste")) || '{"status":{},"weights":{}}'));
      }
      if (request.method === "PUT") {
        await env.STORE.put("taste", JSON.stringify(await request.json()));
        return json(env, { ok: true });
      }
    }
    return json(env, { error: "not found" }, 404);
  },
};

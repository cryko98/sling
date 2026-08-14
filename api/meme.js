/* =========================================================
   /api/meme — The Retarded Bull meme forge (fal.ai + nano-banana)

   GET  /api/meme                 -> { enabled, left, ipLeft, resetIn, cooldown }
   POST /api/meme  { prompt }     -> { requestId, left, ipLeft }
   GET  /api/meme?id=<requestId>  -> { status, images?, error? }

   The fal key never reaches the browser. We use fal's QUEUE api rather
   than the synchronous one so every function call returns in well under
   a second — image edits take 10-25s, which would blow past the
   serverless timeout if we waited inline.

   Generation costs real money, so the spend is fenced in on five sides:
   a global daily cap, a per-IP daily cap, a per-IP burst window, a
   global in-flight limit, and a same-origin check that keeps the
   endpoint from being scripted from elsewhere. See "THE CREDIT FENCE".
   ========================================================= */

// queue namespace is the app id WITHOUT the trailing route segment
const FAL_APP = 'fal-ai/nano-banana';
const FAL_ENDPOINT = 'fal-ai/nano-banana/edit';

const MAX_PROMPT = 180;

/* =========================================================
   THE CREDIT FENCE

   Every number here is an env var, so the budget can be tightened or
   loosened from the Vercel dashboard without touching this file.

     MEME_ENABLED      "0" / "off" / "false" kills the forge instantly
     MEME_DAILY_LIMIT  images per UTC day, everyone combined   (60)
     MEME_IP_DAILY     images per UTC day, per visitor          (6)
     MEME_BURST        images per BURST_MIN minutes, per visitor(2)
     MEME_BURST_MIN    length of that burst window in minutes   (3)
     MEME_INFLIGHT     jobs allowed to be running at once       (4)
     MEME_IMAGES       images asked of fal per generation       (1)

   At the defaults, nano-banana's ~$0.04 an image puts the ceiling at
   roughly $2.40 a day even if the site is being hammered.
   ========================================================= */
const envInt = (name, def, lo, hi) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

const ENABLED = !/^(0|off|false|no)$/i.test(process.env.MEME_ENABLED || '1');
const DAILY_LIMIT = envInt('MEME_DAILY_LIMIT', 60, 0, 5000);
const IP_DAILY = envInt('MEME_IP_DAILY', 6, 1, 200);
const BURST_MAX = envInt('MEME_BURST', 2, 1, 50);
const BURST_MIN = envInt('MEME_BURST_MIN', 3, 1, 240);
const MAX_INFLIGHT = envInt('MEME_INFLIGHT', 4, 1, 32);
const IMAGES = envInt('MEME_IMAGES', 1, 1, 4);

const BURST_MS = BURST_MIN * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/* ---------------------------------------------------------
   WHO HE IS

   Two reference images go with every request: the logo, which is the
   canon for his face, and a full-body meme, which is the canon for his
   build and colouring. The description below is transcribed from the
   existing archive, so a forged meme drops into the gallery without
   looking like a different bull.

   Every "never" is a failure worth naming: nano-banana likes to soften
   the linework, quietly drop the visor when the scene is dark, swap the
   beanie for whatever headgear the setting suggests, and slide towards
   photorealism. Naming each one is what stops it. If he ever starts
   drifting, these strings are the knob.
   --------------------------------------------------------- */
const REF_IMAGES = (process.env.MEME_REF_IMAGES || 'assets/logo.jpg,assets/stadium.jpg')
  .split(',').map((s) => s.trim()).filter(Boolean);

const CHARACTER_LOCK = [
  'You are drawing a NEW meme illustration starring an existing character.',
  'You are given reference images of him: the first is the canonical close-up of his face,',
  'the second shows his build, colouring and art style. Use them ONLY as reference for the',
  'character — ignore their backgrounds and their poses completely.',
  'He must be instantly recognisable as the same character in every picture.',
  '',
  'He is SLING, the Retarded Bull: a hugely muscular anthropomorphic bull, drawn as a bold',
  'comic-book / anime-poster illustration with heavy black linework and saturated colour.',
  '',
  'HEAD — this part is fixed and must match the reference exactly:',
  '- a broad off-white bull face with a darker grey muzzle patch around two large nostrils;',
  '- the mouth thrown wide open in a full roar, showing a bright pink-red tongue,',
  '  pointed white teeth and a dark open throat;',
  '- two big curved horns, pale cream with heavy black outlines, sweeping up and outward',
  '  from under the hat;',
  '- a tight knitted beanie on the crown of his head, striped in black with yellow-white',
  '  vertical stripes, pulled down between the horns;',
  '- wraparound visor sunglasses: one wide single lens in diagonal rainbow stripes',
  '  (red, orange, yellow, green, blue) across his eyes;',
  '- one large glossy blue teardrop-shaped earring hanging from each ear,',
  '  each with a white highlight;',
  '- short red warpaint streaks running down his cheeks from under the visor;',
  '- small drooping white cow ears either side, below the horns.',
  '',
  'BODY:',
  '- a towering bodybuilder physique with broad shoulders, thick arms, a heavy chest and',
  '  visible abs, in the same pale off-white to light-grey hide as his face;',
  '- five-fingered hands.',
  '',
  'Never remove or replace the striped beanie, the rainbow visor, the blue teardrop earrings,',
  'the red cheek streaks or the wide open roaring mouth — they stay even if the scene would',
  'suggest other headgear, and even at night or underwater. Never close his mouth.',
  'Never make him photorealistic, 3D-rendered or painterly. Never make him a normal bull on',
  'four legs, a human, or any other animal. Never slim him down.',
  '',
  'You MAY change his pose, the camera angle and distance, and dress him for the scene',
  '(armour, a suit, a jacket, a uniform — anything that fits). Put him in this scene:'
].join(' ');

const STYLE_TAIL = [
  'Render the whole thing as one bold comic-book meme poster: heavy black linework,',
  'saturated colours, strong dramatic lighting, high contrast, a rich detailed background',
  'and a confident poster composition with the bull as the clear subject, filling the frame.',
  'Absolutely no text anywhere in the image — no words, letters, numbers, captions,',
  'speech bubbles, signatures, logos or watermarks.'
].join(' ');

/* ---------------------------------------------------------
   Counters.

   In-memory is per warm instance, so on its own it under-counts when
   Vercel spins up several. If a Redis REST store is wired up (Vercel KV
   or Upstash — either set of env vars works) the two global counters
   move there and become real. Without it the memory counters still hold
   the line on any single instance, which is enough for a meme site.
   --------------------------------------------------------- */
function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

async function kvCmd(parts) {
  const cfg = kvConfig();
  if (!cfg) return null;
  try {
    const path = parts.map(encodeURIComponent).join('/');
    const r = await fetch(`${cfg.url}/${path}`, {
      headers: { Authorization: `Bearer ${cfg.token}` }
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j && 'result' in j ? j.result : null;
  } catch {
    return null;   // never let the store break the feature
  }
}

/* local fallbacks, and the burst window which always lives in memory */
const mem = { day: '', used: 0, ip: new Map(), inflight: new Map() };

/* A job holds its slot from submit until a poll reports it finished, or
   until it ages out — a browser that closes mid-generation must not pin
   a slot forever. */
const INFLIGHT_TTL = 90 * 1000;

function inflightCount(now) {
  for (const [k, t] of mem.inflight) if (now - t > INFLIGHT_TTL) mem.inflight.delete(k);
  return mem.inflight.size;
}

const utcDay = () => new Date().toISOString().slice(0, 10);
const msUntilUtcMidnight = () => {
  const now = Date.now();
  return DAY_MS - (now % DAY_MS);
};

function rollDay() {
  const d = utcDay();
  if (mem.day !== d) { mem.day = d; mem.used = 0; mem.ip.clear(); }
  return d;
}

function ipState(ip) {
  let s = mem.ip.get(ip);
  if (!s) { s = { day: 0, burst: [] }; mem.ip.set(ip, s); }
  return s;
}

function sweep(now) {
  if (mem.ip.size <= 800) return;
  for (const [k, v] of mem.ip) {
    const last = v.burst.length ? v.burst[v.burst.length - 1] : 0;
    if (!v.day && now - last > BURST_MS) mem.ip.delete(k);
  }
}

/* Reads the counters without spending anything — for the quota badge. */
async function readQuota(ip) {
  const day = rollDay();
  const now = Date.now();
  const s = ipState(ip);
  const burst = s.burst.filter((t) => now - t < BURST_MS);

  let used = mem.used;
  const kv = await kvCmd(['get', `meme:day:${day}`]);
  if (kv !== null) used = Math.max(used, parseInt(kv, 10) || 0);

  let ipUsed = s.day;
  const kvIp = await kvCmd(['get', `meme:ip:${day}:${ip}`]);
  if (kvIp !== null) ipUsed = Math.max(ipUsed, parseInt(kvIp, 10) || 0);

  return {
    left: Math.max(0, DAILY_LIMIT - used),
    ipLeft: Math.max(0, IP_DAILY - ipUsed),
    burstLeft: Math.max(0, BURST_MAX - burst.length),
    nextBurstMs: burst.length >= BURST_MAX ? Math.max(0, BURST_MS - (now - burst[0])) : 0
  };
}

/* Spends one slot, or explains why it cannot.

   A rejection always leaves the counters exactly as it found them —
   each early exit undoes whatever it had already claimed. The only
   thing that survives a `spend` is a successful one, and only that can
   be handed back later with refund(). */
async function spend(ip) {
  const day = rollDay();
  const now = Date.now();
  const s = ipState(ip);
  const ttl = String(Math.ceil(msUntilUtcMidnight() / 1000));

  s.burst = s.burst.filter((t) => now - t < BURST_MS);
  if (s.burst.length >= BURST_MAX) {
    const wait = Math.ceil((BURST_MS - (now - s.burst[0])) / 1000);
    return { ok: false, code: 429, error: `Easy, degen. The forge is cooling down — ${wait}s.` };
  }

  if (inflightCount(now) >= MAX_INFLIGHT) {
    return { ok: false, code: 503, error: 'The forge is full right now. Give it a few seconds.' };
  }

  /* --- per-visitor day --- */
  const ipKey = `meme:ip:${day}:${ip}`;
  const ipN = await kvCmd(['incr', ipKey]);
  const keys = { ip: ipN !== null ? ipKey : null, day: null };
  if (ipN !== null) {
    if (ipN === 1) kvCmd(['expire', ipKey, ttl]);
    s.day = Math.max(s.day + 1, ipN);
  } else {
    s.day += 1;
  }
  if (s.day > IP_DAILY) {
    s.day -= 1;
    if (keys.ip) kvCmd(['decr', keys.ip]);
    return {
      ok: false, code: 429,
      error: `That is your ${IP_DAILY} memes for today. The forge reloads at 00:00 UTC.`
    };
  }

  /* --- everyone's day --- */
  const dayKey = `meme:day:${day}`;
  const n = await kvCmd(['incr', dayKey]);
  if (n !== null) {
    keys.day = dayKey;
    if (n === 1) kvCmd(['expire', dayKey, ttl]);
    mem.used = Math.max(mem.used + 1, n);
  } else {
    mem.used += 1;
  }
  if (mem.used > DAILY_LIMIT) {
    mem.used -= 1;
    s.day -= 1;
    if (keys.day) kvCmd(['decr', keys.day]);
    if (keys.ip) kvCmd(['decr', keys.ip]);
    return {
      ok: false, code: 429,
      error: 'The forge burned through today\'s fuel. It reloads at 00:00 UTC.'
    };
  }

  s.burst.push(now);
  sweep(now);

  return {
    ok: true,
    keys,
    left: Math.max(0, DAILY_LIMIT - mem.used),
    ipLeft: Math.max(0, IP_DAILY - s.day)
  };
}

/* Nothing was generated after all — hand a spent slot back. Only ever
   called on the result of a spend() that returned ok. */
function refund(ip, keys) {
  const s = ipState(ip);
  s.day = Math.max(0, s.day - 1);
  mem.used = Math.max(0, mem.used - 1);
  s.burst.pop();
  if (keys?.ip) kvCmd(['decr', keys.ip]);
  if (keys?.day) kvCmd(['decr', keys.day]);
}

/* Only our own pages may spend the budget.

   Browsers always send Origin on a POST, so a real visitor sails
   through; a curl loop or someone else's page embedding our endpoint
   does not. Header spoofing beats this trivially — it is a filter for
   casual abuse, not a lock. Set MEME_STRICT_ORIGIN=0 to drop it. */
const STRICT_ORIGIN = !/^(0|off|false|no)$/i.test(process.env.MEME_STRICT_ORIGIN || '1');

function sameSite(req) {
  if (!STRICT_ORIGIN) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return true;
  const src = req.headers.origin || req.headers.referer;
  if (!src) return false;
  try { return new URL(src).host === host; } catch { return false; }
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/* fal fetches these itself, so they have to be publicly reachable */
function refImageUrls(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const origin = process.env.MEME_BASE_ORIGIN || `${proto}://${host}`;
  return REF_IMAGES.map((p) => (/^https?:\/\//i.test(p) ? p : `${origin}/${p.replace(/^\/+/, '')}`));
}

function falHeaders(key) {
  return { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const key = process.env.FAL_KEY;
  if (!key) {
    return res.status(500).json({
      error: 'The forge is not wired up yet — FAL_KEY is missing on the server.'
    });
  }

  try {
    if (req.method === 'GET') {
      const id = typeof req.query?.id === 'string' ? req.query.id.trim() : '';
      return id ? await poll(req, res, key, id) : await quota(req, res);
    }
    if (req.method === 'POST') return await submit(req, res, key);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('[meme]', err);
    return res.status(502).json({ error: 'The forge is unreachable. Try again in a moment.' });
  }
};

/* ---------------------------------------------------------
   GET (no id) — how much fuel is left, so the UI can say so
   --------------------------------------------------------- */
async function quota(req, res) {
  const q = await readQuota(clientIp(req));
  return res.status(200).json({
    enabled: ENABLED,
    dailyLimit: DAILY_LIMIT,
    ipDaily: IP_DAILY,
    left: q.left,
    ipLeft: q.ipLeft,
    burstLeft: q.burstLeft,
    nextBurstMs: q.nextBurstMs,
    resetIn: msUntilUtcMidnight()
  });
}

/* ---------------------------------------------------------
   POST — hand the job to fal, return the request id
   --------------------------------------------------------- */
async function submit(req, res, key) {
  if (!ENABLED) {
    return res.status(503).json({ error: 'The forge is closed for maintenance. Back soon.' });
  }
  if (!sameSite(req)) {
    return res.status(403).json({ error: 'The forge only takes orders from theslingbull.fun.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const raw = typeof body?.prompt === 'string' ? body.prompt : '';
  const prompt = raw.replace(/\s+/g, ' ').trim();

  if (!prompt) return res.status(400).json({ error: 'Tell the bull where to go first.' });
  if (prompt.length > MAX_PROMPT) {
    return res.status(400).json({ error: `Keep it under ${MAX_PROMPT} characters.` });
  }

  const ip = clientIp(req);
  const gate = await spend(ip);
  if (!gate.ok) {
    const q = await readQuota(ip);
    return res.status(gate.code).json({ error: gate.error, left: q.left, ipLeft: q.ipLeft });
  }

  const falRes = await fetch(`https://queue.fal.run/${FAL_ENDPOINT}`, {
    method: 'POST',
    headers: falHeaders(key),
    body: JSON.stringify({
      prompt: `${CHARACTER_LOCK} ${prompt}. ${STYLE_TAIL}`,
      image_urls: refImageUrls(req),
      num_images: IMAGES,
      output_format: 'jpeg'
    })
  }).catch((e) => { console.error('[meme] submit threw', e); return null; });

  const data = falRes ? await falRes.json().catch(() => ({})) : {};

  if (!falRes || !falRes.ok) {
    console.error('[meme] submit failed', falRes?.status, data);
    refund(ip, gate.keys);
    const msg = falRes && (falRes.status === 401 || falRes.status === 403)
      ? 'The forge key was rejected.'
      : 'The forge refused that one. Try different wording.';
    return res.status(502).json({ error: msg });
  }

  if (!data.request_id) {
    console.error('[meme] no request_id', data);
    refund(ip, gate.keys);
    return res.status(502).json({ error: 'Got an unexpected answer from the forge.' });
  }

  // the job now holds one of the concurrent-generation slots
  mem.inflight.set(data.request_id, Date.now());

  return res.status(202).json({
    requestId: data.request_id,
    left: gate.left,
    ipLeft: gate.ipLeft
  });
}

/* ---------------------------------------------------------
   GET ?id= — check the job; when it is done, inline the image so the
   browser never has to talk to fal's CDN (no CORS, and the download
   button just works)
   --------------------------------------------------------- */
async function poll(req, res, key, id) {
  if (!/^[A-Za-z0-9-]{6,80}$/.test(id)) {
    return res.status(400).json({ error: 'Bad request id.' });
  }

  const statusRes = await fetch(
    `https://queue.fal.run/${FAL_APP}/requests/${id}/status`,
    { headers: falHeaders(key) }
  );

  if (statusRes.status === 404) {
    mem.inflight.delete(id);
    return res.status(404).json({ status: 'ERROR', error: 'That job has expired.' });
  }
  if (!statusRes.ok) {
    console.error('[meme] status failed', statusRes.status);
    return res.status(502).json({ status: 'ERROR', error: 'Lost track of that one. Try again.' });
  }

  const status = await statusRes.json();

  if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') {
    return res.status(200).json({ status: status.status });
  }

  mem.inflight.delete(id);   // terminal either way — release the slot

  if (status.status !== 'COMPLETED') {
    return res.status(200).json({ status: 'ERROR', error: 'That one did not survive the forge. Try again.' });
  }

  const resultRes = await fetch(
    `https://queue.fal.run/${FAL_APP}/requests/${id}`,
    { headers: falHeaders(key) }
  );
  const result = await resultRes.json().catch(() => ({}));

  const urls = (result?.images || []).map((i) => i && i.url).filter(Boolean);
  if (!resultRes.ok || !urls.length) {
    console.error('[meme] result missing image', resultRes.status, result);
    return res.status(502).json({ status: 'ERROR', error: 'It came back empty. Try again.' });
  }

  const images = await Promise.all(urls.map(async (url) => {
    try {
      const imgRes = await fetch(url);
      if (!imgRes.ok) return url;
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const mime = imgRes.headers.get('content-type') || 'image/jpeg';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return url;
    }
  }));

  return res.status(200).json({ status: 'COMPLETED', images });
}

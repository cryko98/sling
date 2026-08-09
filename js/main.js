/* =========================================================
   $SLING — The Retarded Bull
   Vanilla JS. No dependencies. No roadmap.
   ========================================================= */
(() => {
'use strict';

const $  = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp  = (a, b, t) => a + (b - a) * t;
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CONFIG = {
  ca: 'EeB76LHyVZPMRvTpLcxJqqfSz4gg9f9XgsUmFybcpump',
  api: 'https://api.dexscreener.com/latest/dex/tokens/EeB76LHyVZPMRvTpLcxJqqfSz4gg9f9XgsUmFybcpump',
  pollMs: 15000
};

/* =========================================================
   FORMATTERS
   ========================================================= */
const fmtPrice = n => {
  if (!isFinite(n) || n <= 0) return '$0.00';
  if (n >= 1)    return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 0.01) return '$' + n.toFixed(4);
  // find first significant digit, keep 4 of them
  const exp = Math.floor(Math.log10(n));
  return '$' + n.toFixed(Math.min(12, Math.abs(exp) + 3));
};
const fmtCompact = n => {
  if (!isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
};
const fmtInt = n => isFinite(n) ? n.toLocaleString('en-US') : '—';
const fmtPct = n => (n >= 0 ? '+' : '') + n.toFixed(n > 1000 ? 0 : 2) + '%';

/* =========================================================
   PRELOADER
   ========================================================= */
const preloader = $('#preloader');
(function boot() {
  const fill  = $('#preloaderFill');
  const pctEl = $('#preloaderPct');
  const label = $('#preloaderLabel');
  const lines = ['LOADING CONVICTION', 'DENYING THE TOP', 'CHARGING HORNS', 'BULL RUN AGAIN'];
  let pct = 0, li = 0;

  const labelTimer = setInterval(() => {
    li = (li + 1) % lines.length;
    label.textContent = lines[li];
  }, 700);

  const tick = setInterval(() => {
    pct = Math.min(100, pct + Math.random() * 13 + 4);
    fill.style.width = pct + '%';
    pctEl.textContent = String(Math.floor(pct)).padStart(2, '0');
    if (pct >= 100) {
      clearInterval(tick);
      clearInterval(labelTimer);
      label.textContent = 'BULL RUN AGAIN';
      setTimeout(finish, 320);
    }
  }, REDUCED ? 30 : 130);

  function finish() {
    preloader.classList.add('is-done');
    document.body.classList.remove('is-locked');
    setTimeout(() => { preloader.style.display = 'none'; }, 1000);
    startReveals();
  }

  document.body.classList.add('is-locked');

  /* backstop: never leave the page stuck behind the curtain */
  setTimeout(() => {
    if (!preloader.classList.contains('is-done')) finish();
  }, 6000);
})();

/* =========================================================
   CUSTOM CURSOR
   ========================================================= */
if (!REDUCED && matchMedia('(hover:hover) and (pointer:fine)').matches) {
  const cur  = $('#cursor');
  const dot  = $('.cursor__dot', cur);
  const ring = $('.cursor__ring', cur);
  let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my;

  addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; }, { passive: true });

  (function loop() {
    rx = lerp(rx, mx, 0.16);
    ry = lerp(ry, my, 0.16);
    dot.style.transform  = `translate(${mx}px,${my}px) translate(-50%,-50%)`;
    ring.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`;
    requestAnimationFrame(loop);
  })();

  const HOT = 'a,button,[data-tilt],.gitem,.ca__box,input,summary';
  document.addEventListener('mouseover', e => {
    if (e.target.closest(HOT)) cur.classList.add('is-hot');
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest(HOT)) cur.classList.remove('is-hot');
  });
}

/* =========================================================
   SCROLL PROGRESS + NAV
   ========================================================= */
const nav = $('#nav');
const scrollBar = $('#scrollBar');
let lastY = 0;

function onScroll() {
  const y = scrollY;
  const max = document.documentElement.scrollHeight - innerHeight;
  scrollBar.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';

  nav.classList.toggle('is-stuck', y > 40);
  if (y > 400 && y > lastY + 6) nav.classList.add('is-hidden');
  else if (y < lastY - 6) nav.classList.remove('is-hidden');
  lastY = y;
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* nav active link */
const navLinks = $$('.nav__links a');
const sections = navLinks.map(a => $(a.getAttribute('href'))).filter(Boolean);
if (sections.length) {
  const spy = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      navLinks.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + en.target.id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach(s => spy.observe(s));
}

/* mobile menu */
const burger = $('#burger');
const mobilemenu = $('#mobilemenu');
burger.addEventListener('click', () => {
  const open = burger.getAttribute('aria-expanded') === 'true';
  burger.setAttribute('aria-expanded', String(!open));
  mobilemenu.classList.toggle('is-open', !open);
  document.body.classList.toggle('is-locked', !open);
});
$$('#mobilemenu a').forEach(a => a.addEventListener('click', () => {
  burger.setAttribute('aria-expanded', 'false');
  mobilemenu.classList.remove('is-open');
  document.body.classList.remove('is-locked');
}));

/* =========================================================
   REVEAL ON SCROLL
   ========================================================= */
let revealObs = null;
let revealsStarted = false;
function startReveals() {
  if (revealsStarted) return;
  revealsStarted = true;
  const items = $$('.reveal');
  if (!('IntersectionObserver' in window)) { items.forEach(i => i.classList.add('is-in')); return; }
  revealObs = new IntersectionObserver((entries, obs) => {
    entries.forEach((en, i) => {
      if (!en.isIntersecting) return;
      setTimeout(() => en.target.classList.add('is-in'), i * 70);
      obs.unobserve(en.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  items.forEach(i => revealObs.observe(i));
}

/* =========================================================
   MAGNETIC BUTTONS
   ========================================================= */
if (!REDUCED && matchMedia('(hover:hover)').matches) {
  $$('.magnetic').forEach(el => {
    el.addEventListener('mousemove', e => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * 0.28;
      const y = (e.clientY - r.top - r.height / 2) * 0.38;
      el.style.transform = `translate(${x}px, ${y}px)`;
    });
    el.addEventListener('mouseleave', () => { el.style.transform = ''; });
  });
}

/* =========================================================
   3D TILT
   ========================================================= */
if (!REDUCED && matchMedia('(hover:hover)').matches) {
  $$('[data-tilt]').forEach(el => {
    const strength = el.classList.contains('bullframe__card') ? 12 : 6;
    el.addEventListener('mousemove', e => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width  - 0.5;
      const py = (e.clientY - r.top)  / r.height - 0.5;
      el.style.transform = `perspective(900px) rotateY(${px * strength}deg) rotateX(${-py * strength}deg) translateZ(0)`;
    });
    el.addEventListener('mouseleave', () => { el.style.transform = ''; });
  });
}

/* =========================================================
   TEXT SCRAMBLE (nav)
   ========================================================= */
const GLYPHS = '█▓▒░#@$%&*/\\<>ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function scramble(el) {
  const final = el.dataset.final || (el.dataset.final = el.textContent);
  let frame = 0;
  const total = 14;
  clearInterval(el._sc);
  el._sc = setInterval(() => {
    frame++;
    el.textContent = final.split('').map((ch, i) => {
      if (ch === ' ') return ' ';
      return i < (frame / total) * final.length ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }).join('');
    if (frame >= total) { clearInterval(el._sc); el.textContent = final; }
  }, 26);
}
if (!REDUCED) $$('[data-scramble]').forEach(el => el.addEventListener('mouseenter', () => scramble(el)));

/* =========================================================
   PARALLAX (hero bull + kinetic type)
   ========================================================= */
const bullframe = $('#bullframe');
if (!REDUCED && bullframe) {
  let raf = null;
  const run = () => {
    const y = scrollY;
    if (y < innerHeight * 1.4) {
      bullframe.style.transform = `translateY(${y * 0.14}px)`;
    }
    raf = null;
  };
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(run); }, { passive: true });
}

/* =========================================================
   HERO CANVAS — "it only goes up"
   ========================================================= */
(function heroCanvas() {
  const cv = $('#heroCanvas');
  if (!cv || REDUCED) return;
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, t = 0;

  const particles = [];
  const lines = [
    { speed: 0.00028, amp: 0.10, base: 0.72, color: 'rgba(255,229,0,',   width: 2.2, glow: 22 },
    { speed: 0.00021, amp: 0.07, base: 0.80, color: 'rgba(59,107,255,',  width: 1.6, glow: 16 },
    { speed: 0.00035, amp: 0.05, base: 0.64, color: 'rgba(245,243,236,', width: 1,   glow: 8  }
  ];

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    particles.length = 0;
    const count = Math.min(90, Math.round(W * H / 16000));
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.9 + 0.4,
        vy: -(Math.random() * 0.35 + 0.08),
        vx: (Math.random() - 0.5) * 0.14,
        a: Math.random() * 0.45 + 0.08
      });
    }
  }

  /* pseudo-random but stable wave — a chart that trends up */
  function waveY(x, cfg, time) {
    const n = x / W;
    const drift = -n * cfg.amp * 1.9;                       // the "up only" trend
    const w1 = Math.sin(n * 7.5 + time * cfg.speed * 1000) * cfg.amp * 0.42;
    const w2 = Math.sin(n * 17.3 - time * cfg.speed * 1600) * cfg.amp * 0.20;
    const w3 = Math.sin(n * 34.1 + time * cfg.speed * 900)  * cfg.amp * 0.09;
    return H * (cfg.base + drift + w1 + w2 + w3);
  }

  function draw() {
    t += 16;
    ctx.clearRect(0, 0, W, H);

    /* grid */
    ctx.strokeStyle = 'rgba(245,243,236,0.045)';
    ctx.lineWidth = 1;
    const gap = 68;
    const off = (t * 0.012) % gap;
    ctx.beginPath();
    for (let x = -gap + off; x < W + gap; x += gap) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = -gap + off; y < H + gap; y += gap) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    /* particles */
    particles.forEach(p => {
      p.y += p.vy; p.x += p.vx;
      if (p.y < -8) { p.y = H + 8; p.x = Math.random() * W; }
      if (p.x < -8) p.x = W + 8;
      if (p.x > W + 8) p.x = -8;
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,229,0,${p.a})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });

    /* rising lines + area */
    lines.forEach((cfg, li) => {
      const step = 12;
      ctx.beginPath();
      for (let x = 0; x <= W + step; x += step) {
        const y = waveY(x, cfg, t);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      if (li === 0) {
        const path = ctx.getLineDash();       // keep state tidy
        ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
        const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
        g.addColorStop(0, 'rgba(255,229,0,0.10)');
        g.addColorStop(1, 'rgba(255,229,0,0)');
        ctx.fillStyle = g; ctx.fill();
        ctx.setLineDash(path);

        ctx.beginPath();
        for (let x = 0; x <= W + step; x += step) {
          const y = waveY(x, cfg, t);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = cfg.color + '0.55)';
      ctx.lineWidth = cfg.width;
      ctx.shadowColor = cfg.color + '0.6)';
      ctx.shadowBlur = cfg.glow;
      ctx.stroke();
      ctx.shadowBlur = 0;
    });

    requestAnimationFrame(draw);
  }

  resize();
  addEventListener('resize', resize);
  draw();
})();

/* =========================================================
   LORE — sticky image swap
   ========================================================= */
(function lore() {
  const chapters = $$('.chapter');
  const imgs = $$('#loreStack img');
  if (!chapters.length) return;

  const obs = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const i = +en.target.dataset.i;
      chapters.forEach(c => c.classList.toggle('is-active', c === en.target));
      imgs.forEach(im => im.classList.toggle('is-on', +im.dataset.i === i));
    });
  }, { rootMargin: '-40% 0px -40% 0px' });

  chapters.forEach(c => obs.observe(c));
  chapters[0].classList.add('is-active');
})();

/* =========================================================
   GALLERY LIGHTBOX
   ========================================================= */
(function lightbox() {
  const items = $$('.gitem');
  const lb = $('#lightbox'), img = $('#lbImg'), count = $('#lbCount');
  if (!items.length) return;
  let idx = 0;

  const open = i => {
    idx = (i + items.length) % items.length;
    img.src = items[idx].dataset.src;
    img.alt = $('img', items[idx]).alt;
    count.textContent = `${idx + 1} / ${items.length}`;
    lb.hidden = false;
    document.body.classList.add('is-locked');
  };
  const close = () => { lb.hidden = true; document.body.classList.remove('is-locked'); };

  items.forEach((it, i) => it.addEventListener('click', () => open(i)));
  $('#lbClose').addEventListener('click', close);
  $('#lbPrev').addEventListener('click', e => { e.stopPropagation(); open(idx - 1); });
  $('#lbNext').addEventListener('click', e => { e.stopPropagation(); open(idx + 1); });
  lb.addEventListener('click', e => { if (e.target === lb) close(); });
  addEventListener('keydown', e => {
    if (lb.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') open(idx - 1);
    if (e.key === 'ArrowRight') open(idx + 1);
  });
})();

/* =========================================================
   COPY TO CLIPBOARD + TOAST
   ========================================================= */
const toastEl = $('#toast');
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2200);
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove();
  }
  toast('CONTRACT COPIED 🐂');
}
$('#caBox').addEventListener('click', () => copyText(CONFIG.ca));
$$('[data-copy]').forEach(b => b.addEventListener('click', () => copyText(b.dataset.copy)));

/* =========================================================
   MARKET ENGINE
   ========================================================= */
const M = {
  pair: null,
  tf: 'h24',
  logScale: true,
  ticks: [],          // real observed prices while the page is open
  lastPrice: null,
  chartPts: [],       // rendered pixel points for hover
  hoverIdx: -1
};

const TF_LABEL = { m5: '5M', h1: '1H', h6: '6H', h24: '24H' };
const TF_MS    = { m5: 5 * 6e4, h1: 36e5, h6: 6 * 36e5, h24: 24 * 36e5 };

/* ---- fetch ---- */
async function fetchMarket() {
  const status = $('#feedStatus');
  try {
    const res = await fetch(CONFIG.api, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const pairs = (data.pairs || []).filter(p => p.chainId === 'solana');
    if (!pairs.length) throw new Error('no pairs');

    // deepest liquidity wins
    pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    M.pair = pairs[0];

    const price = parseFloat(M.pair.priceUsd);
    if (isFinite(price)) {
      M.ticks.push({ t: Date.now(), p: price });
      if (M.ticks.length > 240) M.ticks.shift();
    }

    status.className = 'terminal__status is-live';
    status.innerHTML = '<em></em>LIVE';
    $('#dexName').textContent = M.pair.dexId || 'dex';

    render();
  } catch (err) {
    status.className = 'terminal__status is-err';
    status.innerHTML = '<em></em>FEED OFFLINE';
    if (!M.pair) {
      $('#bigPrice').textContent = '—';
      $('#bigDelta').textContent = 'could not reach dexscreener';
    }
  }
}

/* ---- animated number ---- */
function animateNum(el, to, formatter, dur = 700) {
  const from = parseFloat(el.dataset.raw || '0');
  el.dataset.raw = String(to);
  // rAF is paused in hidden tabs — snap, or the value freezes mid-interpolation
  if (!isFinite(from) || from === 0 || REDUCED || document.hidden) {
    el.textContent = formatter(to);
    return;
  }
  const t0 = performance.now();
  (function step(now) {
    const k = clamp((now - t0) / dur, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = formatter(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}

/* ---- render everything ---- */
function render() {
  const p = M.pair;
  if (!p) return;
  const price  = parseFloat(p.priceUsd);
  const change = p.priceChange || {};
  const tf = M.tf;

  /* hero + nav */
  $('#hsPrice').textContent = fmtPrice(price);
  $('#hsMcap').textContent  = fmtCompact(p.marketCap ?? p.fdv);
  const h24 = change.h24 ?? 0;
  const hsc = $('#hsChange');
  hsc.textContent = fmtPct(h24);
  hsc.className = 'hstat__v ' + (h24 >= 0 ? 'up' : 'dn');

  const navVal = $('#navPriceVal');
  navVal.textContent = fmtPrice(price);
  const navBox = $('#navPrice');
  if (M.lastPrice !== null && price !== M.lastPrice) {
    const cls = price > M.lastPrice ? 'flash-up' : 'flash-dn';
    navBox.classList.add(cls);
    setTimeout(() => navBox.classList.remove(cls), 1200);
  }

  /* big price */
  const bp = $('#bigPrice');
  bp.textContent = fmtPrice(price);
  if (M.lastPrice !== null && price !== M.lastPrice) {
    const cls = price > M.lastPrice ? 'flash-up' : 'flash-dn';
    bp.classList.add(cls);
    setTimeout(() => bp.classList.remove(cls), 1400);
  }
  M.lastPrice = price;

  const d = change[tf] ?? 0;
  const bd = $('#bigDelta');
  bd.textContent = `${fmtPct(d)} · ${TF_LABEL[tf]}`;
  bd.className = 'priceblock__delta ' + (d >= 0 ? 'up' : 'dn');

  /* stats */
  animateNum($('#stMcap'), p.marketCap ?? p.fdv ?? 0, fmtCompact);
  animateNum($('#stVol'),  p.volume?.[tf] ?? p.volume?.h24 ?? 0, fmtCompact);
  animateNum($('#stLiq'),  p.liquidity?.usd ?? 0, fmtCompact);

  const tx = p.txns?.[tf] || { buys: 0, sells: 0 };
  animateNum($('#stTxns'), (tx.buys + tx.sells), v => fmtInt(Math.round(v)));
  $('#txnTf').textContent = TF_LABEL[tf];

  /* pressure */
  const total = tx.buys + tx.sells || 1;
  const bpct = (tx.buys / total) * 100;
  $('#pressBuy').style.width  = bpct + '%';
  $('#pressSell').style.width = (100 - bpct) + '%';
  $('#pressBuyN').textContent  = fmtInt(tx.buys);
  $('#pressSellN').textContent = fmtInt(tx.sells);
  $('#pressTf').textContent = TF_LABEL[tf];
  const verdict = $('#pressVerdict');
  if (bpct >= 60)      { verdict.textContent = 'BULLS IN CONTROL — DENIAL WORKING'; verdict.style.color = 'var(--green)'; }
  else if (bpct >= 52) { verdict.textContent = 'BUY SIDE LEANING GREEN';            verdict.style.color = 'var(--yellow)'; }
  else if (bpct >= 48) { verdict.textContent = 'BALANCED — NOBODY BLINKING';        verdict.style.color = 'var(--yellow)'; }
  else if (bpct >= 40) { verdict.textContent = 'SELL PRESSURE BUILDING';            verdict.style.color = 'var(--red)'; }
  else                 { verdict.textContent = 'PAPER HANDS DETECTED — BUY IT';     verdict.style.color = 'var(--red)'; }

  /* tape */
  renderTape();
  drawChart();
  drawTicks();
}

/* ---- price anchors reconstructed from deltas ---- */
function buildSeries() {
  const p = M.pair;
  if (!p) return [];
  const now = Date.now();
  const price = parseFloat(p.priceUsd);
  const c = p.priceChange || {};
  const anchors = [];
  const push = (msAgo, pct, label) => {
    if (typeof pct !== 'number') return;
    const v = price / (1 + pct / 100);
    if (isFinite(v) && v > 0) anchors.push({ t: now - msAgo, p: v, label, anchor: true });
  };
  push(TF_MS.h24, c.h24, '-24h');
  push(TF_MS.h6,  c.h6,  '-6h');
  push(TF_MS.h1,  c.h1,  '-1h');
  push(TF_MS.m5,  c.m5,  '-5m');

  const window = TF_MS[M.tf];
  const cutoff = now - window;

  let pts = anchors.filter(a => a.t >= cutoff - 1);
  // always give the curve a left edge
  if (!pts.length) {
    const pct = c[M.tf] ?? 0;
    pts.push({ t: cutoff, p: price / (1 + pct / 100), label: '-' + TF_LABEL[M.tf].toLowerCase(), anchor: true });
  }
  // merge real observed ticks
  M.ticks.forEach(tk => { if (tk.t >= cutoff) pts.push({ t: tk.t, p: tk.p, label: 'live', live: true }); });
  pts.push({ t: now, p: price, label: 'now', anchor: true });

  pts.sort((a, b) => a.t - b.t);
  return pts;
}

/* ---- main chart ---- */
const chartCv = $('#priceChart');
const chartCtx = chartCv.getContext('2d');
const chartTip = $('#chartTip');

function sizeCanvas(cv, ctx) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr || cv.height !== h * dpr) {
    cv.width = w * dpr; cv.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}

function drawChart() {
  const { w, h } = sizeCanvas(chartCv, chartCtx);
  const ctx = chartCtx;
  ctx.clearRect(0, 0, w, h);

  const series = buildSeries();
  if (series.length < 2) return;

  const padL = 8, padR = 58, padT = 22, padB = 30;
  const iw = w - padL - padR, ih = h - padT - padB;

  const prices = series.map(s => s.p);
  let min = Math.min(...prices), max = Math.max(...prices);
  const useLog = M.logScale && min > 0 && max / min > 3;
  const tv = v => useLog ? Math.log10(v) : v;
  let lo = tv(min), hi = tv(max);
  const padRange = (hi - lo) * 0.14 || Math.abs(hi) * 0.05 || 1;
  lo -= padRange; hi += padRange;

  const t0 = series[0].t, t1 = series[series.length - 1].t;
  const X = t => padL + ((t - t0) / (t1 - t0 || 1)) * iw;
  const Y = v => padT + ih - ((tv(v) - lo) / (hi - lo || 1)) * ih;

  /* grid + right axis labels */
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = padT + (ih / 4) * i;
    ctx.strokeStyle = 'rgba(245,243,236,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + iw, y); ctx.stroke();

    const val = useLog
      ? Math.pow(10, hi - ((hi - lo) / 4) * i)
      : hi - ((hi - lo) / 4) * i;
    ctx.fillStyle = 'rgba(245,243,236,0.34)';
    ctx.textAlign = 'left';
    ctx.fillText(fmtPrice(val).replace('$', ''), padL + iw + 8, y);
  }

  /* build pixel points */
  const pts = series.map(s => ({ x: X(s.t), y: Y(s.p), ...s }));
  M.chartPts = pts;

  /* smooth path helper */
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      ctx.quadraticCurveTo(a.x, a.y, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  };

  /* area fill */
  trace();
  ctx.lineTo(pts[pts.length - 1].x, padT + ih);
  ctx.lineTo(pts[0].x, padT + ih);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
  grad.addColorStop(0, 'rgba(255,229,0,0.30)');
  grad.addColorStop(0.55, 'rgba(255,200,0,0.10)');
  grad.addColorStop(1, 'rgba(255,229,0,0)');
  ctx.fillStyle = grad;
  ctx.fill();

  /* line */
  trace();
  const lineGrad = ctx.createLinearGradient(padL, 0, padL + iw, 0);
  lineGrad.addColorStop(0, '#FF8A00');
  lineGrad.addColorStop(0.5, '#FFE500');
  lineGrad.addColorStop(1, '#39D353');
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 2.6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(255,229,0,0.55)';
  ctx.shadowBlur = 16;
  ctx.stroke();
  ctx.shadowBlur = 0;

  /* anchor dots */
  pts.forEach(pt => {
    if (!pt.anchor) return;
    ctx.beginPath();
    ctx.fillStyle = '#0A0A0C';
    ctx.strokeStyle = '#FFE500';
    ctx.lineWidth = 2;
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  });

  /* last point pulse */
  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.fillStyle = '#FFE500';
  ctx.shadowColor = '#FFE500'; ctx.shadowBlur = 18;
  ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  /* x labels for anchors */
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(245,243,236,0.34)';
  pts.forEach(pt => {
    if (!pt.anchor) return;
    ctx.fillText(pt.label, clamp(pt.x, 18, padL + iw - 12), padT + ih + 15);
  });

  /* crosshair */
  if (M.hoverIdx >= 0 && pts[M.hoverIdx]) {
    const hp = pts[M.hoverIdx];
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(255,229,0,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hp.x, padT); ctx.lineTo(hp.x, padT + ih); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padL, hp.y); ctx.lineTo(padL + iw, hp.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.fillStyle = '#FFE500';
    ctx.arc(hp.x, hp.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  /* scale badge */
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(245,243,236,0.28)';
  ctx.fillText(useLog ? 'LOG' : 'LINEAR', w - 8, 12);
}

/* chart hover */
function chartHover(clientX) {
  if (!M.chartPts.length) return;
  const r = chartCv.getBoundingClientRect();
  const x = clientX - r.left;
  let best = 0, bd = Infinity;
  M.chartPts.forEach((pt, i) => {
    const d = Math.abs(pt.x - x);
    if (d < bd) { bd = d; best = i; }
  });
  M.hoverIdx = best;
  const pt = M.chartPts[best];
  const ago = Math.max(0, Date.now() - pt.t);
  const agoTxt = ago < 9e4 ? 'just now'
    : ago < 36e5 ? Math.round(ago / 6e4) + 'm ago'
    : (ago / 36e5).toFixed(1) + 'h ago';
  chartTip.hidden = false;
  chartTip.innerHTML = `<b>${fmtPrice(pt.p)}</b><br>${agoTxt}${pt.live ? ' · live tick' : ''}`;
  chartTip.style.left = clamp(pt.x, 60, chartCv.clientWidth - 60) + 'px';
  chartTip.style.top = pt.y + 'px';
  drawChart();
}
chartCv.addEventListener('mousemove', e => chartHover(e.clientX));
chartCv.addEventListener('mouseleave', () => { M.hoverIdx = -1; chartTip.hidden = true; drawChart(); });
chartCv.addEventListener('touchmove', e => {
  if (e.touches[0]) chartHover(e.touches[0].clientX);
}, { passive: true });
chartCv.addEventListener('touchend', () => { M.hoverIdx = -1; chartTip.hidden = true; drawChart(); });

/* ---- live tick sparkline ---- */
const tickCv = $('#tickChart');
const tickCtx = tickCv.getContext('2d');
function drawTicks() {
  const { w, h } = sizeCanvas(tickCv, tickCtx);
  const ctx = tickCtx;
  ctx.clearRect(0, 0, w, h);
  const ts = M.ticks;
  if (ts.length < 2) {
    ctx.fillStyle = 'rgba(245,243,236,0.22)';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('collecting live ticks…', w / 2, h / 2);
    return;
  }
  const ps = ts.map(t => t.p);
  const min = Math.min(...ps), max = Math.max(...ps);
  const span = (max - min) || max * 0.001 || 1;
  const X = i => (i / (ts.length - 1)) * (w - 4) + 2;
  const Y = p => h - 6 - ((p - min) / span) * (h - 14);

  ctx.beginPath();
  ts.forEach((t, i) => i ? ctx.lineTo(X(i), Y(t.p)) : ctx.moveTo(X(i), Y(t.p)));
  ctx.lineTo(X(ts.length - 1), h); ctx.lineTo(X(0), h); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  const rising = ts[ts.length - 1].p >= ts[0].p;
  g.addColorStop(0, rising ? 'rgba(18,214,124,0.30)' : 'rgba(232,35,42,0.30)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fill();

  ctx.beginPath();
  ts.forEach((t, i) => i ? ctx.lineTo(X(i), Y(t.p)) : ctx.moveTo(X(i), Y(t.p)));
  ctx.strokeStyle = rising ? '#12D67C' : '#E8232A';
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.beginPath();
  ctx.fillStyle = rising ? '#12D67C' : '#E8232A';
  ctx.arc(X(ts.length - 1), Y(ts[ts.length - 1].p), 3, 0, Math.PI * 2);
  ctx.fill();
}

/* ---- tape log ---- */
function renderTape() {
  const log = $('#tapeLog');
  const ts = M.ticks;
  if (!ts.length) return;
  const rows = ts.slice(-4).reverse().map((t, i, arr) => {
    const prev = ts[ts.length - 1 - i - 1];
    const dir = prev ? (t.p > prev.p ? 'up' : t.p < prev.p ? 'dn' : 'muted') : 'muted';
    const arrow = dir === 'up' ? '▲' : dir === 'dn' ? '▼' : '·';
    const time = new Date(t.t).toLocaleTimeString('en-GB', { hour12: false });
    return `<li><span class="${dir}">${arrow} ${fmtPrice(t.p)}</span><span>${time}</span></li>`;
  }).join('');
  log.innerHTML = rows;
}

/* ---- controls ---- */
$$('.tf__btn').forEach(btn => btn.addEventListener('click', () => {
  $$('.tf__btn').forEach(b => { b.classList.remove('is-on'); b.removeAttribute('aria-selected'); });
  btn.classList.add('is-on');
  btn.setAttribute('aria-selected', 'true');
  M.tf = btn.dataset.tf;
  M.hoverIdx = -1;
  chartTip.hidden = true;
  render();
}));

$('#scaleToggle').addEventListener('click', function () {
  M.logScale = !M.logScale;
  this.innerHTML = 'SCALE: <b>' + (M.logScale ? 'LOG' : 'LINEAR') + '</b>';
  drawChart();
});

/* ---- dexscreener embed (lazy) ---- */
$('#loadChart').addEventListener('click', function () {
  const frame = $('#dexFrame');
  if (frame.dataset.loaded) {
    const showing = !frame.hidden;
    frame.hidden = showing;
    this.childNodes[this.childNodes.length - 1].nodeValue = showing
      ? ' OPEN FULL DEXSCREENER CHART' : ' HIDE FULL CHART';
    return;
  }
  const addr = M.pair?.pairAddress || CONFIG.ca;
  frame.innerHTML = `<iframe src="https://dexscreener.com/solana/${addr}?embed=1&loadChartSettings=0&theme=dark&chartTheme=dark&info=0" title="DexScreener $SLING chart" loading="lazy" allow="clipboard-write"></iframe>`;
  frame.dataset.loaded = '1';
  frame.hidden = false;
  this.childNodes[this.childNodes.length - 1].nodeValue = ' HIDE FULL CHART';
});

/* ---- resize redraw ---- */
let rsTimer;
addEventListener('resize', () => {
  clearTimeout(rsTimer);
  rsTimer = setTimeout(() => { drawChart(); drawTicks(); }, 120);
});

/* ---- go ---- */
fetchMarket();
setInterval(fetchMarket, CONFIG.pollMs);

/* coming back to the tab: repaint canvases + resync numbers immediately */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { render(); fetchMarket(); }
});

/* year */
$('#year').textContent = new Date().getFullYear();

})();

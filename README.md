# $SLING — The Retarded Bull

Official site for **$SLING**, the community-owned Solana meme coin.

> “you're retarded if you think no bull run again.”

**Live contract:** `EeB76LHyVZPMRvTpLcxJqqfSz4gg9f9XgsUmFybcpump`

- X / Twitter — [@theslingbull](https://x.com/theslingbull)
- Telegram — [t.me/theslingbull](https://t.me/theslingbull)

---

## What's in here

A single-page static site. **No build step, no dependencies, no framework** — just HTML, CSS and vanilla JS, so it deploys anywhere instantly.

```
index.html          markup
css/style.css       all styling + animation
js/main.js          effects + live market engine
assets/             logo, favicons, meme archive
vercel.json         caching + security headers
```

## Live market data

The market terminal pulls real on-chain data from the public
[DexScreener API](https://docs.dexscreener.com/api/reference) every 15 seconds.
No API key, no backend — the call runs straight from the browser.

- The **deepest-liquidity pair** is selected automatically each poll, so the site
  keeps working if liquidity migrates to a different DEX.
- The price curve is **reconstructed from the live 5m / 1h / 6h / 24h deltas**
  (the API exposes deltas, not OHLC history) and is labelled as such in the UI.
  Real observed prices are appended as live ticks while the page stays open.
- Log / linear scale toggle, because a +6000% 24h candle is unreadable on a
  linear axis.
- If the feed is unreachable the terminal shows `FEED OFFLINE` rather than
  stale or invented numbers.

## Local preview

Any static server works. With Python:

```bash
python -m http.server 8087
```

Then open `http://localhost:8087`.

> Opening `index.html` directly via `file://` mostly works, but serving over
> HTTP is closer to production.

## Deploying to Vercel

Import the repo at [vercel.com/new](https://vercel.com/new) and deploy — there
is nothing to configure:

- **Framework preset:** Other
- **Build command:** *(leave empty)*
- **Output directory:** *(leave empty — the repo root is the site)*

`vercel.json` sets long-lived caching for `assets/` and sensible security
headers. `index.html` is served uncached so updates go live immediately.

## Accessibility & performance notes

- Honours `prefers-reduced-motion` — the canvas, grain, scanlines and scroll
  animations all stand down.
- Works with JavaScript disabled: a `<noscript>` block drops the preloader and
  reveals all content.
- Gallery images are lazy-loaded; the DexScreener chart iframe is only fetched
  when the visitor asks for it.

---

$SLING is a meme coin with no intrinsic value and no expectation of financial
return. Nothing here is financial advice. Culture is the treasury. 🐂

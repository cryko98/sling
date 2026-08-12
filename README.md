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
js/game.js          The Retarded Bull Run (endless runner)
assets/             logo, favicons, meme archive
vercel.json         caching + security headers
```

## The Retarded Bull Run

A three-lane endless runner built into the page — canvas only, no engine, no
sprite sheets. The bull is **drawn procedurally** (horns, striped beanie,
rainbow visor, blue teardrop earrings, yellow tank top) so it can actually
animate a run cycle, jump and slide; the meme JPGs have no alpha channel to cut
a sprite from.

Controls: `← →` lane, `↑`/`Space` jump, `↓` slide, `P` pause. Touch: swipe to
steer, tap to jump. Runs at a fixed 1280×720 internal resolution and is
CSS-scaled, which keeps every coordinate in one predictable space.

Obstacles map to the lore: **DIP** (hop it), **FUD** gantry (slide under),
**BEAR** / **PAPER HANDS** (solid — change lane). Power-ups: visor
(invincibility), magnet, 2×.

### Fairness is enforced, not assumed

Wave spacing is measured in **milliseconds, not distance**. A fixed distance gap
silently shrinks the reaction window as speed climbs — at top speed waves landed
~558ms apart while a jump locks the bull airborne for 633ms, making two
jump-gates in a row literally unclearable. Spacing now has an 860ms floor, and a
gate never follows a gate.

Two further rules exist so deaths always read as the player's mistake:

- A lane change into something already alongside you is **refused** (with a
  bounce and a thud) instead of killing you.
- Train segments are spaced 100 units so their hit windows are contiguous —
  otherwise the visual gaps between carriages looked passable but weren't.

Validated with an auto-player stepping the real game logic: **14/14 runs survive
5 minutes at maximum speed**. Append `?debug=1` to expose `window.__BULLRUN`
(state plus `update`/`draw`/`start`) to re-run that kind of simulation; it is
absent otherwise.

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

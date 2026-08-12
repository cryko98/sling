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
index.html          the site — no game code ships here
css/style.css       site styling + animation
js/main.js          site effects + live market engine
assets/             logo, favicons, meme archive
vercel.json         caching + security headers
serve.cmd           double-click for a local preview server
tools/serve.ps1     the server itself (pure PowerShell, nothing to install)

game.html           UNFINISHED, unlinked — see below
css/game.css
js/game3d.js
```

The site is dependency-free vanilla HTML/CSS/JS.

## Local preview

`game.html` uses ES modules, and browsers **block ES modules on `file://`** — so
double-clicking the HTML will never start the game (WebGL is not the problem).
Double-click **`serve.cmd`** instead; it starts a tiny PowerShell HTTP server on
`http://localhost:8080` and opens a browser. Nothing to install.

`index.html` alone does work from `file://`, since it uses classic scripts.

## The Retarded Bull Run

Linked from the site header and the hero (`game.html`). A full-screen 3D
endless runner: seven obstacle kinds over three learnable dodge profiles
(jump / slide / switch lane), authored chunk spawning with time-based gaps,
distance-based densification, input buffering, missions, upgrades bank,
procedural chiptune music, and a screen-space camera guard that corrects the
view from the projected result every frame.

The game page pulls Three.js via an import map from jsDelivr — the only
third-party runtime dependency anywhere in the repo, and it never loads for
normal site visitors. Post-processing (bloom) is off by default for GPU
stability; `?bloom=1` re-enables it.

The character, buildings and the obstacle train are professional **CC0
(public-domain) models** by Quaternius and Kenney — see
`assets/game/LICENSES.md` for the full manifest. The character is a rigged,
animated GLTF driven by an AnimationMixer (Run / Roll / Death clips; the jump
is posed on the bones directly, the pack ships no jump clip), with the meme
bull head — horns, striped beanie, rainbow visor, teardrop earrings, painted
bellowing face — mounted on the Head bone like a mascot suit, and the human
head shrunk away inside it.

### What is built

A full-screen 3D endless runner on its own page (`game.html`), rendered with
**Three.js / WebGL** and a chase camera behind the bull.

The bull is a **jointed rig**, not a static model: pelvis → torso → head plus
hip/knee/ankle and shoulder/elbow joints, so the run cycle is driven by real
joint rotations (knees that only bend one way, counter-rotating torso, a head
that stabilises against the twist, swinging tail). Run, jump and slide are
separate poses blended with weights, so transitions read as motion rather than
snapping.

Controls: `← →` lane, `↑`/`Space` jump, `↓` slide, `P` pause. Touch: swipe to
steer, tap to jump. Renders at the real viewport size and reframes for portrait.

Obstacles map to the lore: **DIP** (hop it), **FUD** gantry (slide under),
**BEAR** / **PAPER HANDS** (solid — change lane). Power-ups: visor
(invincibility), magnet, 2×.

### Progression

- **Coin bank** persists between runs; spend it in the upgrade desk on magnet /
  visor / 2× duration, a head start, or extra revives.
- **Missions** — three at a time, each paying out coins; completed ones reroll.
- **Zones** — every 800m the world shifts palette, sky, skyline and fog.
- **Combo** — chain coins without missing to build up to x5.
- **Near miss** — clearing an obstacle in your own lane pays a bonus.
- **Second wind** — revive on the spot if you own one.
- **Leaderboard** — your five best runs, stored on the device.

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

Gameplay still runs in the original validated "world units"; a single scale
factor converts them to metres for the 3D scene, so every balance figure that
was proven by simulation still holds. Re-verified after the 3D port with an
auto-player stepping the real game logic: **12/12 runs survive 5 minutes at
maximum speed**, and all seven obstacle/pose collision rules behave. Append
`?debug=1` to expose `window.__BULLRUN` for that kind of simulation; it is
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

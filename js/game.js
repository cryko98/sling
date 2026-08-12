/* =========================================================
   THE RETARDED BULL RUN
   Three-lane endless runner. Vanilla canvas, no dependencies.
   Fixed 1280x720 internal resolution, CSS-scaled — keeps every
   coordinate in one predictable space.
   ========================================================= */
(() => {
'use strict';

const cv = document.getElementById('gameCanvas');
if (!cv) return;
const ctx = cv.getContext('2d');

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------------------------------------------------------
   WORLD CONSTANTS
   --------------------------------------------------------- */
const W = 1280, H = 720;
const CX = W / 2;
const HORIZON = 214;
const GY = 690;                 // ground screen-y at z = 0
const FOCAL = 560;              // perspective focal length
const LANE_W = 190;             // world units between lane centres
const ROAD_HALF = 350;          // road half-width in world units
const LANES = [-LANE_W, 0, LANE_W];

const Z_SPAWN = 2600;
const Z_GONE  = -180;
const HIT_Z   = 52;             // depth tolerance for collisions
const DIP_H   = 52;             // world height of a DIP block
const DIP_CLR = 40;             // hooves must be this high to clear it
const FUD_TOP = 108;            // underside of a FUD gantry

const GRAVITY = 0.00218;        // world units / ms²
const JUMP_V  = 0.708;          // world units / ms  → ~650ms, ~115u apex
const SLIDE_MS = 620;
const BULL_H = 200;             // bull height in world units at scale 1

const SPEED_START = 0.62;       // world units / ms
const SPEED_MAX   = 1.42;       // beyond this the jump window drops under
const SPEED_RAMP  = 0.0000055;  // human reaction time — see DIP_CLR maths

/* ---------------------------------------------------------
   PALETTE — straight off the logo
   --------------------------------------------------------- */
const C = {
  ink:'#0A0A0C', yellow:'#FFE500', deepYellow:'#FFC800',
  skin:'#EDE9DE', skinDark:'#C6C0B1', skinShade:'#A8A294',
  horn:'#FAF7EF', navy:'#131C43', navyDark:'#0B1130',
  blue:'#1B3FE8', blueLit:'#5C86FF',
  red:'#E8232A', redDark:'#8F1519', green:'#12D67C',
  road:'#15151B', roadLit:'#1E1E27'
};
const RAINBOW = ['#FF2D2D','#FF8A00','#FFE500','#39D353','#00C2FF','#4B4BFF','#B537F2'];

/* ---------------------------------------------------------
   STATE
   --------------------------------------------------------- */
const G = {
  state: 'idle',                // idle | playing | paused | over
  t: 0, last: 0, raf: null,
  speed: SPEED_START,
  dist: 0, score: 0, coins: 0, mult: 1,
  best: +(localStorage.getItem('sling_run_best') || 0),
  bestCoins: +(localStorage.getItem('sling_run_coins') || 0),
  sound: localStorage.getItem('sling_run_sound') !== 'off',
  shake: 0, flash: 0, hitFlash: 0,
  roadPhase: 0, bgScroll: 0,
  obstacles: [], pickups: [], sparks: [],
  spawnZ: 900,
  player: {
    lane: 1, x: 0, targetX: 0,
    y: 0, vy: 0, air: false,
    slide: 0, phase: 0, nudge: 0,
    inv: 0, magnet: 0, x2: 0,
    hurt: 0
  }
};

/* ---------------------------------------------------------
   AUDIO — tiny WebAudio blips, no assets
   --------------------------------------------------------- */
let AC = null;
function blip(freq, dur = 0.08, type = 'square', gain = 0.05) {
  if (!G.sound) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime + dur);
  } catch {}
}
const sfx = {
  coin:  () => blip(1180, 0.07, 'square', 0.035),
  jump:  () => blip(420, 0.10, 'sine', 0.05),
  slide: () => blip(240, 0.12, 'sawtooth', 0.035),
  power: () => { blip(700, 0.09, 'square', 0.05); setTimeout(() => blip(1050, 0.11, 'square', 0.05), 90); },
  hit:   () => blip(110, 0.28, 'sawtooth', 0.07),
  over:  () => { blip(300, 0.16, 'square', 0.06); setTimeout(() => blip(190, 0.30, 'square', 0.06), 150); }
};

/* ---------------------------------------------------------
   PROJECTION
   --------------------------------------------------------- */
const scaleAt = z => FOCAL / (FOCAL + Math.max(z, -FOCAL + 40));
const sx = (worldX, s) => CX + worldX * s;
const sy = (worldY, s) => HORIZON + (GY - HORIZON) * s - worldY * s;

/* =========================================================
   CHARACTER — the retarded bull, seen from behind
   Drawn in a local space: y = 0 at the hooves, up is negative.
   ========================================================= */
function capsule(x1, y1, x2, y2, w, fill) {
  ctx.strokeStyle = fill;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.stroke();
}
function outlineCapsule(x1, y1, x2, y2, w) {
  capsule(x1, y1, x2, y2, w + 6, C.ink);
}

function drawBull(px, py, s, pose, phase, hurtT) {
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(s, s);

  if (hurtT > 0 && Math.floor(hurtT / 60) % 2 === 0) ctx.globalAlpha = 0.45;

  // ---- pose rig ----
  let bob = 0, lean = 0, legA = 0, legB = 0, armA = 0, armB = 0, crouch = 0;
  if (pose === 'run') {
    legA = Math.sin(phase);
    legB = Math.sin(phase + Math.PI);
    armA = -legA; armB = -legB;
    bob = Math.abs(Math.sin(phase)) * -6;
    lean = 0.06;
  } else if (pose === 'jump') {
    legA = 0.9; legB = 0.35;
    armA = -1.1; armB = -0.9;
    bob = -4; lean = 0.14;
  } else if (pose === 'slide') {
    crouch = 74; lean = 0.85;
    legA = 0.7; legB = -0.2;
    armA = 0.5; armB = 0.8;
  }

  ctx.translate(0, -crouch + bob);
  ctx.rotate(-lean * 0.14);

  const hipY  = -96;
  const shldY = -158;
  const headY = -196;

  /* ---- tail (behind everything) ---- */
  const tailSwing = Math.sin(phase * 0.9) * 16;
  ctx.strokeStyle = C.skinDark; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, hipY + 4);
  ctx.quadraticCurveTo(18 + tailSwing * 0.4, hipY + 34, 26 + tailSwing, hipY + 62);
  ctx.stroke();
  ctx.fillStyle = C.ink;
  ctx.beginPath(); ctx.ellipse(26 + tailSwing, hipY + 66, 6, 9, 0, 0, 7); ctx.fill();

  /* ---- far leg then near leg ---- */
  const drawLeg = (swing, side, dark) => {
    const kneeX = side * 20 + swing * 26;
    const kneeY = hipY + 46;
    const footX = side * 22 + swing * 46;
    const footY = -Math.max(0, swing) * 26;
    const skin = dark ? C.skinShade : C.skin;
    const short = dark ? C.navyDark : C.navy;
    // thigh + shin
    outlineCapsule(side * 16, hipY + 6, kneeX, kneeY, 26);
    outlineCapsule(kneeX, kneeY, footX, footY - 10, 20);
    capsule(side * 16, hipY + 6, kneeX, kneeY, 26, skin);
    capsule(kneeX, kneeY, footX, footY - 10, 20, skin);
    // shorts leg
    capsule(side * 16, hipY + 2, side * 18 + swing * 12, hipY + 30, 32, short);
    // hoof
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.ellipse(footX, footY - 4, 17, 11, swing * 0.2, 0, 7);
    ctx.fill();
    ctx.fillStyle = dark ? '#2A2A33' : '#3A3A45';
    ctx.beginPath();
    ctx.ellipse(footX, footY - 7, 13, 6, swing * 0.2, 0, 7);
    ctx.fill();
  };
  drawLeg(legB, -1, true);
  drawLeg(legA, 1, false);

  /* ---- shorts / hips ---- */
  ctx.fillStyle = C.ink;
  roundRect(-44, hipY - 20, 88, 46, 14); ctx.fill();
  ctx.fillStyle = C.navy;
  roundRect(-40, hipY - 16, 80, 40, 12); ctx.fill();
  ctx.fillStyle = 'rgba(255,229,0,.55)';
  roundRect(-40, hipY - 16, 80, 6, 3); ctx.fill();

  /* ---- torso: broad muscular back ---- */
  ctx.fillStyle = C.ink;
  ctx.beginPath();
  ctx.moveTo(-46, hipY - 6);
  ctx.quadraticCurveTo(-66, shldY + 34, -58, shldY);
  ctx.quadraticCurveTo(0, shldY - 20, 58, shldY);
  ctx.quadraticCurveTo(66, shldY + 34, 46, hipY - 6);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = C.skin;
  ctx.beginPath();
  ctx.moveTo(-42, hipY - 8);
  ctx.quadraticCurveTo(-61, shldY + 34, -53, shldY + 3);
  ctx.quadraticCurveTo(0, shldY - 15, 53, shldY + 3);
  ctx.quadraticCurveTo(61, shldY + 34, 42, hipY - 8);
  ctx.closePath(); ctx.fill();

  // lat shading + spine
  ctx.fillStyle = 'rgba(0,0,0,.10)';
  ctx.beginPath(); ctx.ellipse(-30, shldY + 40, 15, 30, .25, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(30, shldY + 40, 15, 30, -.25, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, shldY + 12); ctx.lineTo(0, hipY - 14); ctx.stroke();

  /* ---- yellow tank top ---- */
  ctx.fillStyle = C.yellow;
  ctx.beginPath();
  ctx.moveTo(-38, hipY - 10);
  ctx.quadraticCurveTo(-46, shldY + 40, -34, shldY + 16);
  ctx.lineTo(-18, shldY + 10);
  ctx.quadraticCurveTo(0, shldY + 22, 18, shldY + 10);
  ctx.lineTo(34, shldY + 16);
  ctx.quadraticCurveTo(46, shldY + 40, 38, hipY - 10);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2.5; ctx.stroke();
  // straps over the traps
  capsule(-26, shldY + 14, -20, shldY - 6, 11, C.yellow);
  capsule(26, shldY + 14, 20, shldY - 6, 11, C.yellow);

  /* ---- arms ---- */
  const drawArm = (swing, side, dark) => {
    const skin = dark ? C.skinShade : C.skin;
    const elbowX = side * 56 + swing * 16;
    const elbowY = shldY + 46 - Math.abs(swing) * 8;
    const handX = side * 50 + swing * 40;
    const handY = shldY + 74 - swing * 34;
    outlineCapsule(side * 46, shldY + 10, elbowX, elbowY, 24);
    outlineCapsule(elbowX, elbowY, handX, handY, 19);
    capsule(side * 46, shldY + 10, elbowX, elbowY, 24, skin);
    capsule(elbowX, elbowY, handX, handY, 19, skin);
    // fist
    ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.arc(handX, handY, 13, 0, 7); ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(handX, handY, 10, 0, 7); ctx.fill();
    // delt cap
    ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.arc(side * 46, shldY + 8, 22, 0, 7); ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(side * 46, shldY + 8, 18, 0, 7); ctx.fill();
  };
  drawArm(armB, -1, true);
  drawArm(armA, 1, false);

  /* ---- neck ---- */
  capsule(0, shldY + 6, 0, headY + 26, 40, C.ink);
  capsule(0, shldY + 4, 0, headY + 26, 32, C.skin);

  /* ---- head (back of the skull) ---- */
  ctx.fillStyle = C.ink;
  roundRect(-46, headY - 30, 92, 74, 30); ctx.fill();
  ctx.fillStyle = C.skin;
  roundRect(-42, headY - 26, 84, 66, 27); ctx.fill();
  // subtle skull shading
  ctx.fillStyle = 'rgba(0,0,0,.07)';
  roundRect(-42, headY + 4, 84, 36, 18); ctx.fill();

  /* ---- ears ---- */
  [-1, 1].forEach(side => {
    ctx.save();
    ctx.translate(side * 44, headY + 4);
    ctx.rotate(side * 0.5);
    ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.ellipse(0, 0, 20, 12, 0, 0, 7); ctx.fill();
    ctx.fillStyle = C.skin;
    ctx.beginPath(); ctx.ellipse(0, 0, 16, 8.5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(232,35,42,.30)';
    ctx.beginPath(); ctx.ellipse(2, 0, 9, 4.5, 0, 0, 7); ctx.fill();
    ctx.restore();
  });

  /* ---- blue teardrop earrings ---- */
  [-1, 1].forEach(side => {
    const ex = side * 50, ey = headY + 24;
    ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.ellipse(ex, ey, 12, 15, 0, 0, 7); ctx.fill();
    const g = ctx.createRadialGradient(ex - 4, ey - 5, 1, ex, ey, 14);
    g.addColorStop(0, C.blueLit); g.addColorStop(1, C.blue);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(ex, ey, 9.5, 12.5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.beginPath(); ctx.ellipse(ex - 3, ey - 5, 3, 4, 0, 0, 7); ctx.fill();
  });

  /* ---- rainbow visor strap wrapping the skull ---- */
  const vy = headY - 6;
  ctx.save();
  roundRect(-44, vy - 9, 88, 18, 8); ctx.clip();
  RAINBOW.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(-44 + (88 / RAINBOW.length) * i, vy - 9, 88 / RAINBOW.length + 1, 18);
  });
  ctx.restore();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 3.5;
  roundRect(-44, vy - 9, 88, 18, 8); ctx.stroke();

  /* ---- beanie: black cap with yellow stripes ---- */
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-45, headY - 8);
  ctx.quadraticCurveTo(-48, headY - 44, 0, headY - 46);
  ctx.quadraticCurveTo(48, headY - 44, 45, headY - 8);
  ctx.closePath();
  ctx.fillStyle = C.ink; ctx.fill();
  ctx.clip();
  ctx.fillStyle = C.deepYellow;
  for (let i = -5; i <= 5; i++) ctx.fillRect(i * 11 - 3, headY - 50, 5, 26);
  ctx.restore();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-45, headY - 8);
  ctx.quadraticCurveTo(-48, headY - 44, 0, headY - 46);
  ctx.quadraticCurveTo(48, headY - 44, 45, headY - 8);
  ctx.closePath(); ctx.stroke();
  // brim
  ctx.fillStyle = C.ink;
  roundRect(-47, headY - 14, 94, 12, 6); ctx.fill();

  /* ---- horns ---- */
  [-1, 1].forEach(side => {
    ctx.save();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 17; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(side * 34, headY - 26);
    ctx.quadraticCurveTo(side * 62, headY - 44, side * 60, headY - 74);
    ctx.stroke();
    ctx.strokeStyle = C.horn; ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(side * 34, headY - 26);
    ctx.quadraticCurveTo(side * 62, headY - 44, side * 60, headY - 74);
    ctx.stroke();
    ctx.restore();
  });

  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* =========================================================
   WORLD RENDER
   ========================================================= */
function drawBackdrop() {
  // sky
  const g = ctx.createLinearGradient(0, 0, 0, HORIZON + 40);
  g.addColorStop(0, '#07070A');
  g.addColorStop(0.55, '#0E1330');
  g.addColorStop(1, '#241C3B');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, HORIZON + 40);

  // glow on the horizon — the sun of the next bull run
  const sun = ctx.createRadialGradient(CX, HORIZON, 8, CX, HORIZON, 300);
  sun.addColorStop(0, 'rgba(255,229,0,.42)');
  sun.addColorStop(0.4, 'rgba(255,138,0,.16)');
  sun.addColorStop(1, 'rgba(255,138,0,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, HORIZON + 60);

  // skyline of green candles, parallax scrolled
  const off = (G.bgScroll * 0.06) % 150;
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (let i = -1; i < 11; i++) {
    const bx = i * 150 - off;
    const seed = Math.abs(Math.sin((i + Math.floor(G.bgScroll / 150 * 0.06)) * 12.9898) * 43758.5453) % 1;
    const bh = 40 + seed * 110;
    ctx.fillStyle = seed > 0.5 ? 'rgba(18,214,124,.30)' : 'rgba(27,63,232,.26)';
    ctx.fillRect(bx, HORIZON - bh, 96, bh);
    ctx.fillStyle = 'rgba(255,229,0,.10)';
    for (let wy = 0; wy < bh - 14; wy += 18)
      for (let wx = 0; wx < 3; wx++) ctx.fillRect(bx + 14 + wx * 26, HORIZON - bh + 10 + wy, 12, 8);
  }
  ctx.restore();

  // ground
  ctx.fillStyle = '#0C0C11';
  ctx.fillRect(0, HORIZON, W, H - HORIZON);
}

function drawRoad() {
  // road trapezoid
  const sFar = scaleAt(Z_SPAWN), sNear = scaleAt(0);
  const xFarL = sx(-ROAD_HALF, sFar), xFarR = sx(ROAD_HALF, sFar);
  const yFar = sy(0, sFar);
  const xNearL = sx(-ROAD_HALF, sNear), xNearR = sx(ROAD_HALF, sNear);
  const yNear = sy(0, sNear);

  const g = ctx.createLinearGradient(0, yFar, 0, yNear);
  g.addColorStop(0, C.road);
  g.addColorStop(1, C.roadLit);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(xFarL, yFar); ctx.lineTo(xFarR, yFar);
  ctx.lineTo(xNearR, yNear); ctx.lineTo(xNearL, yNear);
  ctx.closePath(); ctx.fill();

  // scrolling rungs — reads as speed
  const RUNG = 190;
  const base = G.roadPhase % RUNG;
  for (let z = Z_SPAWN; z > Z_GONE; z -= RUNG) {
    const zz = z - base;
    if (zz < Z_GONE) continue;
    const s = scaleAt(zz);
    const y = sy(0, s);
    ctx.fillStyle = `rgba(255,229,0,${0.05 + 0.05 * s})`;
    ctx.fillRect(sx(-ROAD_HALF, s), y, (ROAD_HALF * 2) * s, Math.max(1, 5 * s));
  }

  // lane dividers
  [-LANE_W / 2, LANE_W / 2].forEach(lx => {
    for (let z = Z_SPAWN; z > Z_GONE; z -= 150) {
      const zz = z - (G.roadPhase % 150);
      if (zz < Z_GONE) continue;
      const s1 = scaleAt(zz), s2 = scaleAt(zz + 72);
      ctx.fillStyle = `rgba(245,243,236,${0.05 + 0.16 * s1})`;
      ctx.beginPath();
      ctx.moveTo(sx(lx - 4, s1), sy(0, s1));
      ctx.lineTo(sx(lx + 4, s1), sy(0, s1));
      ctx.lineTo(sx(lx + 3, s2), sy(0, s2));
      ctx.lineTo(sx(lx - 3, s2), sy(0, s2));
      ctx.closePath(); ctx.fill();
    }
  });

  // side rails: yellow / black hazard ticker
  [-1, 1].forEach(side => {
    for (let z = Z_SPAWN; z > Z_GONE; z -= 130) {
      const zz = z - (G.roadPhase % 130);
      if (zz < Z_GONE) continue;
      const s1 = scaleAt(zz), s2 = scaleAt(zz + 65);
      const x = side * (ROAD_HALF + 16);
      const on = Math.floor((zz + G.roadPhase) / 130) % 2 === 0;
      ctx.fillStyle = on ? `rgba(255,229,0,${0.22 + 0.5 * s1})` : `rgba(10,10,12,${0.5 + 0.4 * s1})`;
      ctx.beginPath();
      ctx.moveTo(sx(x, s1), sy(0, s1));
      ctx.lineTo(sx(x, s1), sy(30, s1));
      ctx.lineTo(sx(x, s2), sy(30, s2));
      ctx.lineTo(sx(x, s2), sy(0, s2));
      ctx.closePath(); ctx.fill();
    }
  });
}

/* =========================================================
   ENTITIES
   ========================================================= */
const OB = {
  DIP:  'dip',    // low  → jump
  FUD:  'fud',    // high → slide
  BEAR: 'bear',   // wall → switch lane
  HANDS:'hands'   // long wall → switch lane
};

function drawObstacle(o) {
  const s = scaleAt(o.z);
  if (s <= 0.02) return;
  const x = sx(LANES[o.lane], s);
  const yBase = sy(0, s);

  ctx.save();
  if (o.kind === OB.DIP) {
    // stubby red candle you hop over — height matches DIP_H exactly
    const w = 150 * s, h = DIP_H * s;
    ctx.fillStyle = C.ink;
    roundRect(x - w / 2 - 3 * s, yBase - h - 3 * s, w + 6 * s, h + 6 * s, 8 * s); ctx.fill();
    const g = ctx.createLinearGradient(0, yBase - h, 0, yBase);
    g.addColorStop(0, '#FF4A50'); g.addColorStop(1, C.redDark);
    ctx.fillStyle = g;
    roundRect(x - w / 2, yBase - h, w, h, 6 * s); ctx.fill();
    // wick
    ctx.strokeStyle = C.red; ctx.lineWidth = 4 * s;
    ctx.beginPath(); ctx.moveTo(x, yBase - h); ctx.lineTo(x, yBase - h - 30 * s); ctx.stroke();
    label('DIP', x, yBase - h / 2, s, '#fff', 20);

  } else if (o.kind === OB.FUD) {
    // overhead gantry you slide under
    const w = 190 * s, top = FUD_TOP * s, thick = 52 * s;
    ctx.fillStyle = C.ink;
    ctx.fillRect(x - w / 2 - 3 * s, yBase - top - thick, w + 6 * s, thick + 6 * s);
    const g = ctx.createLinearGradient(0, yBase - top - thick, 0, yBase - top);
    g.addColorStop(0, '#3A2B6E'); g.addColorStop(1, '#221646');
    ctx.fillStyle = g;
    ctx.fillRect(x - w / 2, yBase - top - thick + 3 * s, w, thick);
    // legs
    ctx.fillStyle = '#191033';
    ctx.fillRect(x - w / 2, yBase - top, 12 * s, top);
    ctx.fillRect(x + w / 2 - 12 * s, yBase - top, 12 * s, top);
    label('FUD', x, yBase - top - thick / 2, s, C.yellow, 26);
    // warning stripes
    ctx.fillStyle = 'rgba(255,229,0,.55)';
    for (let i = 0; i < 6; i++) ctx.fillRect(x - w / 2 + i * (w / 6), yBase - top - 6 * s, w / 12, 5 * s);

  } else if (o.kind === OB.BEAR) {
    const w = 168 * s, h = 210 * s;
    ctx.fillStyle = C.ink;
    roundRect(x - w / 2 - 3 * s, yBase - h - 3 * s, w + 6 * s, h + 6 * s, 10 * s); ctx.fill();
    const g = ctx.createLinearGradient(0, yBase - h, 0, yBase);
    g.addColorStop(0, '#6E1216'); g.addColorStop(1, '#2A0709');
    ctx.fillStyle = g;
    roundRect(x - w / 2, yBase - h, w, h, 8 * s); ctx.fill();
    ctx.fillStyle = C.red;
    for (let i = 0; i < 4; i++)
      ctx.fillRect(x - w / 2 + 8 * s, yBase - h + (12 + i * 26) * s, w - 16 * s, 8 * s);
    label('BEAR', x, yBase - h / 2, s, '#fff', 28);

  } else if (o.kind === OB.HANDS) {
    const w = 176 * s, h = 168 * s;
    ctx.fillStyle = C.ink;
    roundRect(x - w / 2 - 3 * s, yBase - h - 3 * s, w + 6 * s, h + 6 * s, 12 * s); ctx.fill();
    const g = ctx.createLinearGradient(0, yBase - h, 0, yBase);
    g.addColorStop(0, '#D8D2C4'); g.addColorStop(1, '#8B8579');
    ctx.fillStyle = g;
    roundRect(x - w / 2, yBase - h, w, h, 10 * s); ctx.fill();
    ctx.fillStyle = 'rgba(10,10,12,.85)';
    roundRect(x - w / 2 + 10 * s, yBase - h + 14 * s, w - 20 * s, 54 * s, 6 * s); ctx.fill();
    label('PAPER', x, yBase - h + 41 * s, s, C.yellow, 22);
    label('HANDS', x, yBase - h / 2 + 44 * s, s, C.ink, 24);
  }
  ctx.restore();
}

function label(txt, x, y, s, col, size) {
  const fs = size * s;
  if (fs < 6) return;
  ctx.font = `700 ${fs}px "Archivo Black", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = col;
  ctx.fillText(txt, x, y);
}

function drawPickup(p) {
  const s = scaleAt(p.z);
  if (s <= 0.02) return;
  const x = sx(p.x !== undefined ? p.x : LANES[p.lane], s);
  const y = sy(p.y, s);
  const spin = Math.sin(G.t / 220 + p.seed) * 0.9;

  if (p.kind === 'coin') {
    const r = 26 * s;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(Math.max(0.25, Math.abs(Math.cos(spin))), 1);
    ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.arc(0, 0, r + 3 * s, 0, 7); ctx.fill();
    const g = ctx.createRadialGradient(-r * .3, -r * .3, r * .1, 0, 0, r);
    g.addColorStop(0, '#FFF27A'); g.addColorStop(.6, C.yellow); g.addColorStop(1, C.deepYellow);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    if (r > 9) {
      ctx.font = `700 ${r * 1.15}px "Archivo Black", Impact, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = C.ink;
      ctx.fillText('$', 0, r * 0.06);
    }
    ctx.restore();
    // glow
    ctx.fillStyle = `rgba(255,229,0,${0.10 * s})`;
    ctx.beginPath(); ctx.arc(x, y, r * 1.9, 0, 7); ctx.fill();
    return;
  }

  // power-ups
  const r = 30 * s;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin * 0.18);
  ctx.fillStyle = C.ink;
  roundRect(-r - 3 * s, -r - 3 * s, (r + 3 * s) * 2, (r + 3 * s) * 2, 10 * s); ctx.fill();

  if (p.kind === 'visor') {
    ctx.save();
    roundRect(-r, -r, r * 2, r * 2, 8 * s); ctx.clip();
    RAINBOW.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(-r, -r + (r * 2 / RAINBOW.length) * i, r * 2, r * 2 / RAINBOW.length + 1);
    });
    ctx.restore();
  } else if (p.kind === 'magnet') {
    ctx.fillStyle = '#F5F3EC';
    roundRect(-r, -r, r * 2, r * 2, 8 * s); ctx.fill();
    ctx.strokeStyle = C.red; ctx.lineWidth = 9 * s; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.arc(0, r * .28, r * .58, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = C.blue;
    ctx.fillRect(-r * .86, r * .22, r * .34, r * .5);
    ctx.fillRect(r * .52, r * .22, r * .34, r * .5);
  } else {
    ctx.fillStyle = C.green;
    roundRect(-r, -r, r * 2, r * 2, 8 * s); ctx.fill();
    if (r > 10) {
      ctx.font = `700 ${r * 1.05}px "Archivo Black", Impact, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = C.ink;
      ctx.fillText('2X', 0, r * .06);
    }
  }
  ctx.restore();
  ctx.fillStyle = `rgba(255,255,255,${0.09 * s})`;
  ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, 7); ctx.fill();
}

/* =========================================================
   SPAWNING — hand-tuned so every pattern is survivable
   ========================================================= */
function spawnWave() {
  const free = Math.floor(Math.random() * 3);        // guaranteed clear lane
  // A gate forces a jump/slide, which locks the bull for ~630ms. Two in a row
  // is unclearable however wide the gap, so never follow a gate with a gate.
  const roll = G.lastGate ? Math.random() * 0.58 : Math.random();
  G.lastGate = false;

  if (roll < 0.30) {
    // single obstacle + coin trail in a clear lane
    const lane = (free + 1 + Math.floor(Math.random() * 2)) % 3;
    G.obstacles.push(mkOb(lane, pickKind()));
    coinTrail(free, 5);

  } else if (roll < 0.58) {
    // two lanes blocked, one clear
    const kinds = [pickKind(), pickKind()];
    let k = 0;
    for (let l = 0; l < 3; l++) if (l !== free) G.obstacles.push(mkOb(l, kinds[k++]));
    coinTrail(free, 6);

  } else if (roll < 0.76) {
    // a jump-or-slide gate across every lane — same action, all three
    const kind = Math.random() < 0.5 ? OB.DIP : OB.FUD;
    G.lastGate = true;
    for (let l = 0; l < 3; l++) G.obstacles.push(mkOb(l, kind));
    // reward: coins floating where you'll be mid-manoeuvre
    const y = kind === OB.DIP ? 90 : 24;
    for (let i = 0; i < 3; i++)
      G.pickups.push(mkPick(free, 'coin', G.spawnZ + 130 + i * 90, y));

  } else if (roll < 0.90) {
    // long paper-hands train — 100 spacing keeps the hit windows contiguous
    // (HIT_Z*2 = 104), so the lane reads and behaves as one solid object
    const lane = (free + 1 + Math.floor(Math.random() * 2)) % 3;
    for (let i = 0; i < 3; i++) G.obstacles.push(mkOb(lane, OB.HANDS, G.spawnZ + i * 100));
    coinTrail(free, 7);

  } else {
    // breather + power-up
    const kinds = ['visor', 'magnet', 'x2'];
    G.pickups.push(mkPick(free, kinds[Math.floor(Math.random() * 3)], G.spawnZ + 120, 52));
    coinTrail((free + 1) % 3, 4);
  }

  /* Space waves by TIME, not distance. The player reacts in milliseconds, so a
     fixed distance gap silently shrinks the reaction window as speed climbs.
     Floor of 860ms clears a 633ms jump plus ~95ms of lead with margin. */
  const gapMs = clamp(1480 - (G.speed - SPEED_START) * 780, 860, 1480);
  G.spawnZ += gapMs * G.speed + Math.random() * 180;
}

const pickKind = () => {
  const r = Math.random();
  return r < 0.34 ? OB.DIP : r < 0.64 ? OB.FUD : OB.BEAR;
};
const mkOb = (lane, kind, z) => ({ lane, kind, z: z !== undefined ? z : G.spawnZ, dead: false });
const mkPick = (lane, kind, z, y) => ({
  lane, kind, z, y: y || 34, seed: Math.random() * 6, dead: false,
  x: undefined, vx: 0
});
function coinTrail(lane, n) {
  for (let i = 0; i < n; i++)
    G.pickups.push(mkPick(lane, 'coin', G.spawnZ + 40 + i * 78, 34));
}

/* =========================================================
   SPARKS
   ========================================================= */
function burst(x, y, col, n = 12, spread = 3) {
  for (let i = 0; i < n; i++) {
    G.sparks.push({
      x, y,
      vx: (Math.random() - 0.5) * spread * 2.4,
      vy: -Math.random() * spread * 2.2 - 0.6,
      life: 1, col, r: Math.random() * 4 + 2
    });
  }
}
function drawSparks(dt) {
  for (let i = G.sparks.length - 1; i >= 0; i--) {
    const p = G.sparks[i];
    p.x += p.vx * dt * 0.06;
    p.y += p.vy * dt * 0.06;
    p.vy += dt * 0.012;
    p.life -= dt * 0.0022;
    if (p.life <= 0) { G.sparks.splice(i, 1); continue; }
    ctx.globalAlpha = clamp(p.life, 0, 1);
    ctx.fillStyle = p.col;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* =========================================================
   INPUT
   ========================================================= */
/* Single source of truth for "does this thing hurt me in my current pose?" —
   used both for real collisions and for vetting a lane change. */
function wouldHit(kind, p) {
  if (kind === OB.DIP) return p.y < DIP_CLR;
  if (kind === OB.FUD) return !(p.slide > 0) && p.y < FUD_TOP;
  return true;                                   // solid wall
}

function move(dir) {
  const p = G.player;
  const next = clamp(p.lane + dir, 0, 2);
  if (next === p.lane) return;

  /* Refuse to swerve into something already alongside us. Without this the
     player gets side-swiped by train segments they never ran into, which
     reads as a bug rather than a mistake. */
  const blocked = G.obstacles.some(o =>
    !o.dead && o.lane === next && o.z > -112 && o.z < 142 && wouldHit(o.kind, p)
  );
  if (blocked) {
    p.nudge = dir * 30;
    blip(140, 0.06, 'square', 0.03);
    return;
  }

  p.lane = next;
  blip(dir > 0 ? 560 : 500, 0.05, 'sine', 0.03);
}
function jump() {
  const p = G.player;
  if (p.air || p.slide > 0) return;
  p.vy = JUMP_V; p.air = true;
  sfx.jump();
}
function slide() {
  const p = G.player;
  if (p.slide > 0) return;
  if (p.air) { p.vy = -JUMP_V * 0.85; }   // slam down, then slide
  p.slide = SLIDE_MS;
  sfx.slide();
}

const KEYS = {
  ArrowLeft: () => move(-1), a: () => move(-1), A: () => move(-1),
  ArrowRight: () => move(1), d: () => move(1), D: () => move(1),
  ArrowUp: jump, w: jump, W: jump, ' ': jump,
  ArrowDown: slide, s: slide, S: slide
};

addEventListener('keydown', e => {
  if (G.state === 'over' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); start(); return; }
  if (G.state !== 'playing' && G.state !== 'paused') return;

  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    e.preventDefault();
    G.state === 'playing' ? pause() : resume();
    return;
  }
  if (G.state !== 'playing') return;
  const fn = KEYS[e.key];
  if (fn) { e.preventDefault(); fn(); }
});

/* touch: swipe to steer, tap to jump */
let tStart = null;
cv.addEventListener('touchstart', e => {
  if (G.state !== 'playing') return;
  tStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() };
}, { passive: true });

cv.addEventListener('touchend', e => {
  if (G.state !== 'playing' || !tStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - tStart.x, dy = t.clientY - tStart.y;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx < 26 && ady < 26) jump();                      // tap
  else if (adx > ady) move(dx > 0 ? 1 : -1);
  else dy > 0 ? slide() : jump();
  tStart = null;
}, { passive: true });

// only swallow page scroll while actually playing
cv.addEventListener('touchmove', e => { if (G.state === 'playing') e.preventDefault(); }, { passive: false });

/* =========================================================
   LIFECYCLE
   ========================================================= */
function start() {
  Object.assign(G, {
    state: 'playing', speed: SPEED_START,
    dist: 0, score: 0, coins: 0, mult: 1,
    obstacles: [], pickups: [], sparks: [],
    spawnZ: 900, shake: 0, flash: 0, hitFlash: 0, lastGate: false
  });
  Object.assign(G.player, {
    lane: 1, x: 0, targetX: 0, y: 0, vy: 0, air: false,
    slide: 0, phase: 0, nudge: 0, inv: 0, magnet: 0, x2: 0, hurt: 0
  });
  $('gStart').hidden = true;
  $('gOver').hidden = true;
  $('gPause').hidden = true;
  $('ghud').hidden = false;
  cv.classList.add('is-playing');
  G.last = performance.now();
  if (!G.raf) G.raf = requestAnimationFrame(loop);
}

function pause() {
  if (G.state !== 'playing') return;
  G.state = 'paused';
  $('gPause').hidden = false;
  cv.classList.remove('is-playing');
}
function resume() {
  if (G.state !== 'paused') return;
  G.state = 'playing';
  $('gPause').hidden = true;
  cv.classList.add('is-playing');
  G.last = performance.now();
  if (!G.raf) G.raf = requestAnimationFrame(loop);
}

function gameOver() {
  G.state = 'over';
  cv.classList.remove('is-playing');
  sfx.over();
  const dist = Math.floor(G.dist / 10);
  const score = Math.floor(G.score);
  const isBest = score > G.best;
  if (isBest) { G.best = score; localStorage.setItem('sling_run_best', String(score)); }
  if (G.coins > G.bestCoins) { G.bestCoins = G.coins; localStorage.setItem('sling_run_coins', String(G.coins)); }

  $('goScore').textContent = score.toLocaleString('en-US');
  $('goCoins').textContent = G.coins.toLocaleString('en-US');
  $('goDist').textContent = dist.toLocaleString('en-US') + 'm';
  $('goBest').textContent = G.best.toLocaleString('en-US');
  $('goBadge').hidden = !isBest;
  $('goRank').textContent = rankFor(score);
  const share = `I ran ${dist.toLocaleString('en-US')}m as The Retarded Bull and bagged ${G.coins} $SLING 🐂\n\nbull run again.`;
  $('goShare').href = 'https://x.com/intent/tweet?text=' + encodeURIComponent(share) +
    '&url=' + encodeURIComponent(location.origin + location.pathname);
  $('gOver').hidden = false;
  $('ghud').hidden = true;
}

function rankFor(s) {
  if (s < 800)   return 'PAPER HANDED TOURIST';
  if (s < 2500)  return 'NERVOUS HOLDER';
  if (s < 6000)  return 'CONVICTION BUILDING';
  if (s < 12000) return 'CERTIFIED RETARDED BULL';
  if (s < 22000) return 'DENIAL GRANDMASTER';
  return 'SLINGOR HIMSELF 🐂';
}

/* =========================================================
   UPDATE
   ========================================================= */
function update(dt) {
  const p = G.player;

  G.speed = Math.min(SPEED_MAX, G.speed + SPEED_RAMP * dt);
  const travel = G.speed * dt;
  G.dist += travel;
  G.roadPhase += travel;
  G.bgScroll += travel;
  G.score += travel * 0.05 * G.mult;

  // lane glide + "that lane is occupied" bounce-back
  p.targetX = LANES[p.lane];
  p.x = lerp(p.x, p.targetX, 1 - Math.pow(0.0016, dt / 16.67));
  p.nudge = lerp(p.nudge, 0, 1 - Math.pow(0.00005, dt / 16.67));

  // vertical
  if (p.air) {
    p.vy -= GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) {
      p.y = 0; p.vy = 0; p.air = false;
      burst(sx(p.x, 1), GY, 'rgba(255,229,0,.8)', 8, 2);
    }
  }
  if (p.slide > 0) p.slide -= dt;

  // run cycle — faster legs at higher speed
  if (!p.air) p.phase += dt * 0.019 * (G.speed / SPEED_START);

  // timers
  p.inv = Math.max(0, p.inv - dt);
  p.magnet = Math.max(0, p.magnet - dt);
  p.x2 = Math.max(0, p.x2 - dt);
  p.hurt = Math.max(0, p.hurt - dt);
  G.mult = p.x2 > 0 ? 2 : 1;
  G.shake = Math.max(0, G.shake - dt * 0.03);
  G.flash = Math.max(0, G.flash - dt * 0.004);
  G.hitFlash = Math.max(0, G.hitFlash - dt * 0.003);

  // spawn ahead
  G.spawnZ -= travel;
  while (G.spawnZ < Z_SPAWN) spawnWave();

  /* ---- obstacles ---- */
  for (let i = G.obstacles.length - 1; i >= 0; i--) {
    const o = G.obstacles[i];
    o.z -= travel;
    if (o.z < Z_GONE) { G.obstacles.splice(i, 1); continue; }
    if (o.dead || Math.abs(o.z) > HIT_Z) continue;
    if (o.lane !== p.lane) continue;

    if (wouldHit(o.kind, p)) {
      o.dead = true;
      if (p.inv > 0) {
        burst(sx(p.x, 1), GY - 90, RAINBOW[Math.floor(Math.random() * 7)], 18, 4);
        G.flash = 0.5;
        blip(880, 0.08, 'square', 0.05);
      } else {
        sfx.hit();
        G.shake = 26; G.hitFlash = 1;
        burst(sx(p.x, 1), GY - 90, C.red, 26, 5);
        gameOver();
        return;
      }
    }
  }

  /* ---- pickups ---- */
  const magnetOn = p.magnet > 0;
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const k = G.pickups[i];
    k.z -= travel;
    if (k.z < Z_GONE) { G.pickups.splice(i, 1); continue; }

    // magnet drags coins into the player's lane
    if (magnetOn && k.kind === 'coin' && k.z < 900) {
      if (k.x === undefined) k.x = LANES[k.lane];
      k.x = lerp(k.x, p.x, 1 - Math.pow(0.004, dt / 16.67));
      k.y = lerp(k.y, Math.max(34, p.y + 40), 1 - Math.pow(0.02, dt / 16.67));
    }

    const kx = k.x !== undefined ? k.x : LANES[k.lane];
    const near = Math.abs(k.z) < 70;
    const sameLane = magnetOn && k.kind === 'coin'
      ? Math.abs(kx - p.x) < 120
      : k.lane === p.lane;
    const pTop = p.y + (p.slide > 0 ? 70 : BULL_H);
    const vertical = k.y >= p.y - 30 && k.y <= pTop + 20;

    if (near && sameLane && vertical) {
      G.pickups.splice(i, 1);
      const px = sx(kx, 1), py = sy(k.y, 1);
      if (k.kind === 'coin') {
        G.coins++;
        G.score += 12 * G.mult;
        sfx.coin();
        burst(px, py, C.yellow, 7, 2.4);
      } else {
        sfx.power();
        G.flash = 0.7;
        if (k.kind === 'visor')  { p.inv = 6500;  burst(px, py, RAINBOW[Math.floor(Math.random() * 7)], 22, 4); }
        if (k.kind === 'magnet') { p.magnet = 8500; burst(px, py, C.blueLit, 22, 4); }
        if (k.kind === 'x2')     { p.x2 = 9000;  burst(px, py, C.green, 22, 4); }
      }
    }
  }
}

/* =========================================================
   DRAW
   ========================================================= */
function draw(dt) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);

  ctx.save();
  if (G.shake > 0) {
    ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
  }

  drawBackdrop();
  drawRoad();

  const p = G.player;

  // far → near so nearer things paint over farther ones
  const all = [
    ...G.obstacles.map(o => ({ z: o.z, o })),
    ...G.pickups.map(k => ({ z: k.z, k }))
  ].sort((a, b) => b.z - a.z);

  all.forEach(e => e.o ? drawObstacle(e.o) : drawPickup(e.k));

  /* ---- the bull ---- */
  const pose = p.slide > 0 ? 'slide' : p.air ? 'jump' : 'run';
  const bx = sx(p.x, 1) + p.nudge;
  const by = sy(p.y, 1);

  // shadow shrinks with altitude
  const shk = clamp(1 - p.y / 200, 0.3, 1);
  ctx.fillStyle = `rgba(0,0,0,${0.42 * shk})`;
  ctx.beginPath();
  ctx.ellipse(bx, GY + 6, 62 * shk, 15 * shk, 0, 0, 7);
  ctx.fill();

  // invincibility aura
  if (p.inv > 0) {
    const pulse = 0.55 + Math.sin(G.t / 90) * 0.2;
    const g = ctx.createRadialGradient(bx, by - 100, 10, bx, by - 100, 150);
    g.addColorStop(0, `rgba(255,229,0,${0.20 * pulse})`);
    RAINBOW.forEach((c, i) => g.addColorStop(0.3 + i * 0.1, hexA(c, 0.10 * pulse)));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bx, by - 100, 150, 0, 7); ctx.fill();
  }
  // magnet field
  if (p.magnet > 0) {
    ctx.strokeStyle = `rgba(92,134,255,${0.30 + Math.sin(G.t / 110) * 0.14})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(bx, by - 90, 130, 60, 0, 0, 7); ctx.stroke();
  }

  drawBull(bx, by, 1, pose, p.phase, p.hurt);

  // speed streaks
  if (G.speed > SPEED_START * 1.25) {
    const n = Math.floor((G.speed - SPEED_START) * 14);
    ctx.strokeStyle = 'rgba(255,229,0,.16)';
    ctx.lineWidth = 2;
    for (let i = 0; i < n; i++) {
      const yy = HORIZON + 60 + ((G.roadPhase * 2.4 + i * 233) % (H - HORIZON - 60));
      const xx = (i * 397) % W;
      ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy + 34); ctx.stroke();
    }
  }

  drawSparks(dt);
  ctx.restore();

  // vignette
  const vg = ctx.createRadialGradient(CX, H * 0.52, H * 0.32, CX, H * 0.52, H * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,.62)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  if (G.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${G.flash * 0.30})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (G.hitFlash > 0) {
    ctx.fillStyle = `rgba(232,35,42,${G.hitFlash * 0.42})`;
    ctx.fillRect(0, 0, W, H);
  }
}

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
};

/* =========================================================
   HUD
   ========================================================= */
let hudT = 0;
function drawHud(dt) {
  hudT += dt;
  if (hudT < 90) return;
  hudT = 0;
  $('gScore').textContent = Math.floor(G.score).toLocaleString('en-US');
  $('gCoins').textContent = G.coins;
  $('gDist').textContent = Math.floor(G.dist / 10).toLocaleString('en-US') + 'm';
  $('gBestLive').textContent = Math.max(G.best, Math.floor(G.score)).toLocaleString('en-US');

  const p = G.player;
  const chips = [];
  if (p.inv > 0)    chips.push(`<i class="gp gp--visor">VISOR ${(p.inv / 1000).toFixed(1)}s</i>`);
  if (p.magnet > 0) chips.push(`<i class="gp gp--magnet">MAGNET ${(p.magnet / 1000).toFixed(1)}s</i>`);
  if (p.x2 > 0)     chips.push(`<i class="gp gp--x2">2X ${(p.x2 / 1000).toFixed(1)}s</i>`);
  $('gPower').innerHTML = chips.join('');
}

/* =========================================================
   LOOP
   ========================================================= */
function loop(now) {
  G.raf = null;
  const raw = now - G.last;
  G.last = now;
  // clamp: a backgrounded tab must not teleport the bull into an obstacle
  const dt = clamp(raw, 0, 48);
  G.t += dt;

  if (G.state === 'playing') {
    update(dt);
    if (G.state === 'playing') { draw(dt); drawHud(dt); }
  }

  if (G.state === 'playing') G.raf = requestAnimationFrame(loop);
}

/* =========================================================
   IDLE ATTRACT FRAME — a static poster before you press play
   ========================================================= */
function drawIdle() {
  G.player.phase = 1.1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawBackdrop();
  drawRoad();
  // a couple of props so the poster reads as a game
  drawObstacle({ lane: 0, kind: OB.BEAR, z: 700 });
  drawObstacle({ lane: 2, kind: OB.FUD, z: 1150 });
  [0, 1, 2].forEach(i => drawPickup({ lane: 1, kind: 'coin', z: 380 + i * 260, y: 34, seed: i }));
  ctx.fillStyle = 'rgba(0,0,0,.4)';
  ctx.beginPath(); ctx.ellipse(CX, GY + 6, 62, 15, 0, 0, 7); ctx.fill();
  drawBull(CX, GY, 1, 'run', 1.1, 0);
  const vg = ctx.createRadialGradient(CX, H * .52, H * .32, CX, H * .52, H * .95);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.66)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
}

/* =========================================================
   WIRING
   ========================================================= */
$('gPlay').addEventListener('click', start);
$('gAgain').addEventListener('click', start);
$('gResume').addEventListener('click', resume);
$('gPauseBtn').addEventListener('click', () => G.state === 'playing' ? pause() : resume());

const soundBtn = $('gSound');
function syncSound() {
  soundBtn.textContent = G.sound ? '🔊 SOUND ON' : '🔇 SOUND OFF';
  soundBtn.setAttribute('aria-pressed', String(G.sound));
}
soundBtn.addEventListener('click', () => {
  G.sound = !G.sound;
  localStorage.setItem('sling_run_sound', G.sound ? 'on' : 'off');
  syncSound();
  if (G.sound) blip(760, 0.07, 'square', 0.04);
});
syncSound();

// on-screen controls for touch
$('gcLeft').addEventListener('click', () => G.state === 'playing' && move(-1));
$('gcRight').addEventListener('click', () => G.state === 'playing' && move(1));
$('gcJump').addEventListener('click', () => G.state === 'playing' && jump());
$('gcSlide').addEventListener('click', () => G.state === 'playing' && slide());

$('gBest').textContent = G.best.toLocaleString('en-US');

/* pause when the player scrolls away or leaves the tab */
if ('IntersectionObserver' in window) {
  new IntersectionObserver(es => {
    es.forEach(en => { if (!en.isIntersecting && G.state === 'playing') pause(); });
  }, { threshold: 0.35 }).observe(cv);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

drawIdle();

/* Opt-in test handle (…/?debug=1) so the simulation can be stepped without
   relying on requestAnimationFrame. Off by default — no production surface. */
if (/(\?|&)debug=1\b/.test(location.search)) {
  window.__BULLRUN = { G, start, pause, resume, gameOver, update, draw, spawnWave,
                       move, jump, slide, LANES, OB, BULL_H, HIT_Z, Z_SPAWN };
}

})();

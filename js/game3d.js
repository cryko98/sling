/* =========================================================
   THE RETARDED BULL RUN — 3D
   WebGL / Three.js. Chase camera behind a jointed low-poly bull.

   Gameplay runs in the original "world units" so every balance figure
   that was validated by simulation still holds; S converts those units
   into metres for the 3D scene.
   ========================================================= */
import * as THREE from 'three';

const cv = document.getElementById('gameCanvas');
if (!cv) throw new Error('no canvas');

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const fmt = n => Math.floor(n).toLocaleString('en-US');
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt / 1000));

/* =========================================================
   GAMEPLAY CONSTANTS (world units — validated, do not retune blindly)
   ========================================================= */
const LANE_W = 245, ROAD_HALF = 440;
const LANES = [-LANE_W, 0, LANE_W];
const Z_SPAWN = 2600, Z_FAR = 1900, Z_GONE = -260;
const HIT_Z = 52, DIP_H = 52, DIP_CLR = 44, FUD_TOP = 132;
const GRAVITY = 0.00218, JUMP_V = 0.708;      // ~633ms airtime, ~109u apex
const SLIDE_MS = 620, BULL_H = 230;
const SPEED_START = 0.62, SPEED_MAX = 1.42, SPEED_RAMP = 0.0000055;
const ZONE_M = 800;

const S = 1 / 110;                             // world units → metres

/* =========================================================
   ZONES
   ========================================================= */
const ZONES = [
  { name:'NIGHT CITY',     skyTop:0x05060F, skyBot:0x2A2044, fog:0x141A38, sun:0xFFE500,
    bldA:0x12D67C, bldB:0x1B3FE8, road:0x1B1B24, rim:0x3B6BFF },
  { name:'BEAR MARKET',    skyTop:0x0A0406, skyBot:0x4A1418, fog:0x2A1014, sun:0xFF4A50,
    bldA:0x8F1519, bldB:0x4A1020, road:0x211618, rim:0xE8232A },
  { name:'LIQUIDITY POOL', skyTop:0x02080C, skyBot:0x0B4A5E, fog:0x08303E, sun:0x00C2FF,
    bldA:0x00C2FF, bldB:0x12D67C, road:0x152026, rim:0x00C2FF },
  { name:'RAINBOW RUN',    skyTop:0x0A0414, skyBot:0x5A1C7A, fog:0x2C1044, sun:0xB537F2,
    bldA:0xB537F2, bldB:0xFF2D2D, road:0x1E1628, rim:0xB537F2 },
  { name:'GOLDEN HOUR',    skyTop:0x140A02, skyBot:0x8A4E0A, fog:0x4A2A08, sun:0xFFC800,
    bldA:0xFFC800, bldB:0xFF8A00, road:0x241C12, rim:0xFFC800 },
  { name:'THE MOON',       skyTop:0x01020A, skyBot:0x141E5A, fog:0x0A1030, sun:0xF5F3EC,
    bldA:0x4B4BFF, bldB:0xB537F2, road:0x171A2A, rim:0x8FA8FF }
];
const zone = () => ZONES[G.zone % ZONES.length];

/* =========================================================
   PERSISTENCE
   ========================================================= */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const UPGRADES = [
  { key:'magnet', name:'MAGNET COIL',   icon:'M', cls:'magnet', desc:'Longer coin magnet.',              max:5 },
  { key:'visor',  name:'RAINBOW VISOR', icon:'V', cls:'visor',  desc:'Longer invincibility.',            max:5 },
  { key:'x2',     name:'DENIAL ENGINE', icon:'2X', cls:'x2',     desc:'Longer 2x score window.',          max:5 },
  { key:'head',   name:'HEAD START',    icon:'GO', cls:'head',   desc:'Begin each run already invincible.', max:4 },
  { key:'life',   name:'SECOND WIND',   icon:'+1', cls:'life',   desc:'Extra revive after a crash.',      max:3 }
];
const UP_COST = [200, 400, 700, 1100, 1600];
const save = {
  bank: LS.get('sling_bank', 0), best: LS.get('sling_run_best', 0),
  lb: LS.get('sling_lb', []), ups: LS.get('sling_ups', {}),
  sound: LS.get('sling_sound', true), missions: LS.get('sling_missions', null)
};
const upLvl = k => save.ups[k] || 0;
function persist() {
  LS.set('sling_bank', save.bank); LS.set('sling_run_best', save.best);
  LS.set('sling_lb', save.lb); LS.set('sling_ups', save.ups);
  LS.set('sling_sound', save.sound); LS.set('sling_missions', save.missions);
}
const durMagnet = () => 8500 + upLvl('magnet') * 1600;
const durVisor  = () => 6500 + upLvl('visor')  * 1300;
const durX2     = () => 9000 + upLvl('x2')     * 1600;

/* =========================================================
   MISSIONS
   ========================================================= */
const M_DEFS = [
  { t:'coins',    text:n => `Collect ${n} $SLING in one run`, pick:() => 40 + Math.floor(Math.random()*4)*20, pay:n => n*3 },
  { t:'dist',     text:n => `Run ${n}m in one run`,           pick:() => 600 + Math.floor(Math.random()*5)*200, pay:n => Math.round(n*0.4) },
  { t:'nearmiss', text:n => `Clear ${n} obstacles cleanly`,   pick:() => 8 + Math.floor(Math.random()*4)*4, pay:n => n*14 },
  { t:'power',    text:n => `Grab ${n} power-ups`,            pick:() => 3 + Math.floor(Math.random()*3), pay:n => n*50 },
  { t:'combo',    text:n => `Reach a x${n} combo`,            pick:() => 3 + Math.floor(Math.random()*3), pay:n => n*60 },
  { t:'jumps',    text:n => `Jump ${n} times`,                pick:() => 20 + Math.floor(Math.random()*4)*10, pay:n => n*5 }
];
/* `avoid` keeps the three active missions on distinct objectives — rolling
   "Jump 30 times / Jump 40 times / Jump 40 times" is a 1-in-36 accident that
   looks like a bug and gives the player nothing to vary their play for. */
function newMission(avoid = []) {
  const pool = M_DEFS.filter(d => !avoid.includes(d.t));
  const defs = pool.length ? pool : M_DEFS;
  const d = defs[Math.floor(Math.random() * defs.length)];
  const target = d.pick();
  return { t:d.t, target, prog:0, reward:d.pay(target), text:d.text(target), done:false };
}
function freshMissionSet() {
  const out = [];
  for (let i = 0; i < 3; i++) out.push(newMission(out.map(m => m.t)));
  return out;
}
if (!Array.isArray(save.missions) || save.missions.length !== 3 ||
    new Set(save.missions.map(m => m && m.t)).size !== 3) {
  save.missions = freshMissionSet();
  persist();
}

/* =========================================================
   STATE
   ========================================================= */
const G = {
  state:'idle', t:0, last:0, raf:null,
  speed:SPEED_START, dist:0, score:0, coins:0, mult:1,
  zone:0, nextZoneM:ZONE_M,
  streak:0, combo:1, lastCoinT:-1e9,
  nearMiss:0, jumps:0, powers:0, revives:0,
  shake:0, flash:0, hitFlash:0, landT:0,
  travelled:0, spawnZ:900, lastGate:false,
  obstacles:[], pickups:[],
  player:{ lane:1, x:0, y:0, vy:0, air:false, slide:0, phase:0,
           nudge:0, inv:0, magnet:0, x2:0 },
  // animation blend weights
  wJump:0, wSlide:0
};

/* =========================================================
   AUDIO
   ========================================================= */
let AC = null;
function blip(freq, dur = 0.08, type = 'square', gain = 0.05) {
  if (!save.sound) return;
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
  coin:c => blip(980 + Math.min(c,5)*110, .07, 'square', .035),
  jump: () => blip(420, .10, 'sine', .05),
  slide:() => blip(240, .12, 'sawtooth', .035),
  power:() => { blip(700,.09,'square',.05); setTimeout(()=>blip(1050,.11,'square',.05),90); },
  near: () => blip(1320, .05, 'sine', .028),
  hit:  () => blip(110, .28, 'sawtooth', .07),
  cash: () => { blip(880,.07,'square',.05); setTimeout(()=>blip(1320,.10,'square',.05),80); },
  zone: () => { blip(520,.10,'square',.05); setTimeout(()=>blip(780,.14,'square',.05),100); },
  over: () => { blip(300,.16,'square',.06); setTimeout(()=>blip(190,.30,'square',.06),150); }
};

/* =========================================================
   RENDERER / SCENE
   ========================================================= */
const renderer = new THREE.WebGLRenderer({ canvas:cv, antialias:true, powerPreference:'high-performance' });
renderer.setClearColor(0x05060F, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
/* Fog has to reach past the drawn road (~24m) or the skyline is swallowed
   whole and the buildings collapse into flat silhouettes. */
scene.fog = new THREE.Fog(0x141A38, 16, 72);

const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 220);
const camRig = { x:0, y:0, shakeX:0, shakeY:0, fov:56 };

/* ---------- lights ---------- */
/* Neutral key — a warm key at high intensity turned the bone-white hide pink. */
const hemi = new THREE.HemisphereLight(0xC6D4FF, 0x1A1A26, 0.88);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xFFFBF0, 1.45);
key.position.set(-3.4, 7.0, 5.0);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
// tight ortho frustum around the play area keeps 1024px of shadow map sharp
key.shadow.camera.left = -7; key.shadow.camera.right = 7;
key.shadow.camera.top = 9;   key.shadow.camera.bottom = -9;
key.shadow.camera.near = 0.5; key.shadow.camera.far = 34;
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.022;
scene.add(key);
scene.add(key.target);
const fill = new THREE.DirectionalLight(0xCFDCFF, 0.50);
fill.position.set(4.0, 3.0, 5.5);
scene.add(fill);
const rim = new THREE.DirectionalLight(0x3B6BFF, 1.15);
rim.position.set(2.8, 2.4, -6);
scene.add(rim);
const bounce = new THREE.PointLight(0xFFE500, 0.30, 8, 2);
bounce.position.set(0, 0.5, 1.2);
scene.add(bounce);

/* =========================================================
   TEXTURE HELPERS
   ========================================================= */
function cvsTex(w, h, paint, repX = 1, repY = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX, repY);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function labelTex(text, bg, fg, w = 256, h = 128) {
  return cvsTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, h - 12, w, 12);
    g.font = `700 ${Math.round(h * 0.46)}px "Archivo Black", Impact, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = fg; g.fillText(text, w / 2, h / 2);
  });
}

/* ---------- sky dome ---------- */
const skyTex = cvsTex(8, 256, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#05060F'); grd.addColorStop(1, '#2A2044');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(110, 24, 16),
  new THREE.MeshBasicMaterial({ map:skyTex, side:THREE.BackSide, fog:false, depthWrite:false })
);
scene.add(sky);
function paintSky() {
  const Z = zone();
  const c = skyTex.image.getContext('2d');
  const grd = c.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#' + Z.skyTop.toString(16).padStart(6, '0'));
  grd.addColorStop(1, '#' + Z.skyBot.toString(16).padStart(6, '0'));
  c.fillStyle = grd; c.fillRect(0, 0, 8, 256);
  skyTex.needsUpdate = true;
}

/* ---------- stars ---------- */
{
  const N = 420, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.random() * 0.42 + 0.06;
    const r = 96;
    pos[i*3]   = Math.cos(th) * Math.sin(ph + 0.7) * r;
    pos[i*3+1] = Math.cos(ph) * r * 0.7 + 12;
    pos[i*3+2] = Math.sin(th) * Math.sin(ph + 0.7) * r;
  }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(gg, new THREE.PointsMaterial({
    color:0xffffff, size:0.42, sizeAttenuation:true, transparent:true, opacity:0.75, fog:false
  })));
}

/* ---------- sun glow ---------- */
const sunTex = cvsTex(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w/2, h/2, 2, w/2, h/2, w/2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,229,0,.55)');
  r.addColorStop(1, 'rgba(255,229,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, h);
});
const sun = new THREE.Sprite(new THREE.SpriteMaterial({
  map:sunTex, transparent:true, depthWrite:false, fog:false, blending:THREE.AdditiveBlending
}));
sun.scale.set(46, 46, 1);
sun.position.set(0, 5.5, -84);
scene.add(sun);

/* =========================================================
   ROAD
   ========================================================= */
const ROAD_W = ROAD_HALF * 2 * S;              // 8 m
const ROAD_LEN = 64;
const TILE = 2;                                 // metres per texture tile

const roadTex = cvsTex(512, 512, (g, w, h) => {
  g.fillStyle = '#33343F'; g.fillRect(0, 0, w, h);
  // subtle asphalt speckle
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random()*0.05})`;
    g.fillRect(Math.random()*w, Math.random()*h, 2, 2);
  }
  // lane dividers at ±LANE_W/2 of the road width
  const lx = (LANE_W / 2) / (ROAD_HALF * 2);
  [0.5 - lx, 0.5 + lx].forEach(fx => {
    g.fillStyle = 'rgba(245,243,236,.80)';
    for (let y = 0; y < h; y += 128) g.fillRect(fx * w - 5, y, 10, 76);
  });
  // outer edge lines
  g.fillStyle = 'rgba(245,243,236,.30)';
  g.fillRect(6, 0, 5, h); g.fillRect(w - 11, 0, 5, h);
  // yellow speed rung
  g.fillStyle = 'rgba(255,229,0,.22)';
  g.fillRect(0, h - 12, w, 9);
}, 1, ROAD_LEN / TILE);

const road = new THREE.Mesh(
  new THREE.PlaneGeometry(ROAD_W, ROAD_LEN),
  new THREE.MeshStandardMaterial({ map:roadTex, roughness:0.86, metalness:0.02 })
);
road.rotation.x = -Math.PI / 2;
road.position.set(0, 0, -ROAD_LEN / 2 + 12);
road.receiveShadow = true;
scene.add(road);

/* ground either side */
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(190, 190),
  new THREE.MeshStandardMaterial({ color:0x0C0D16, roughness:1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.03, -40);
scene.add(ground);

/* kerbs */
const kerbTex = cvsTex(64, 64, (g, w, h) => {
  g.fillStyle = '#0A0A0C'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#FFE500'; g.fillRect(0, 0, w, h / 2);
}, 1, ROAD_LEN / 1.6);
const kerbMat = new THREE.MeshStandardMaterial({ map:kerbTex, roughness:0.7, emissive:0x100d00, emissiveIntensity:0.4 });
const kerbs = [-1, 1].map(sd => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.30, ROAD_LEN), kerbMat);
  m.position.set(sd * (ROAD_W / 2 + 0.13), 0.15, road.position.z);
  scene.add(m);
  return m;
});

/* =========================================================
   BUILDINGS (recycled pool → real 3D parallax)
   ========================================================= */
const bldMatA = new THREE.MeshStandardMaterial({ color:0x12D67C, roughness:0.7, emissive:0x061a10, emissiveIntensity:1 });
const bldMatB = new THREE.MeshStandardMaterial({ color:0x1B3FE8, roughness:0.7, emissive:0x050a20, emissiveIntensity:1 });
const winTex = cvsTex(64, 128, (g, w, h) => {
  g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, w, h);
  for (let y = 8; y < h - 8; y += 16)
    for (let x = 8; x < w - 8; x += 18) {
      g.fillStyle = Math.random() > .35 ? 'rgba(255,229,0,.55)' : 'rgba(255,229,0,.10)';
      g.fillRect(x, y, 9, 8);
    }
}, 2, 6);
const buildings = [];
for (let i = 0; i < 54; i++) {
  const grp = new THREE.Group();
  const h = 5 + Math.random() * 15;
  const w = 3.0 + Math.random() * 3.4, d = 3.0 + Math.random() * 3.4;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), Math.random() > .5 ? bldMatA : bldMatB);
  body.position.y = h / 2;
  grp.add(body);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, h, d + 0.02),
    new THREE.MeshBasicMaterial({ map:winTex, transparent:true, opacity:0.85, fog:true }));
  glow.position.y = h / 2;
  grp.add(glow);
  grp.userData = { h };
  // kept well back from the kerb so the road reads as open, not a canyon
  const side = i % 2 ? 1 : -1;
  grp.position.set(side * (13 + Math.random() * 26), 0, -Math.random() * 150);
  scene.add(grp);
  buildings.push(grp);
}

/* =========================================================
   THE BULL — jointed hierarchy so the run cycle is real
   ========================================================= */
const MAT = {
  skin:   new THREE.MeshStandardMaterial({ color:0xF2EFE6, roughness:0.55, metalness:0.02 }),
  skinD:  new THREE.MeshStandardMaterial({ color:0xD8D2C4, roughness:0.6 }),
  horn:   new THREE.MeshStandardMaterial({ color:0xFCFAF3, roughness:0.35 }),
  ink:    new THREE.MeshStandardMaterial({ color:0x121216, roughness:0.5 }),
  yellow: new THREE.MeshStandardMaterial({ color:0xFFE500, roughness:0.45, emissive:0x3a3400, emissiveIntensity:1 }),
  navy:   new THREE.MeshStandardMaterial({ color:0x1B2559, roughness:0.6 }),
  blue:   new THREE.MeshStandardMaterial({ color:0x1B3FE8, roughness:0.25, emissive:0x0a1650, emissiveIntensity:1 }),
  red:    new THREE.MeshStandardMaterial({ color:0xE8232A, roughness:0.5 }),
  muzzle: new THREE.MeshStandardMaterial({ color:0x24242C, roughness:0.55 }),
  hoof:   new THREE.MeshStandardMaterial({ color:0x17171E, roughness:0.45 }),
  tongue: new THREE.MeshStandardMaterial({ color:0xE5424E, roughness:0.6 }),
  teeth:  new THREE.MeshStandardMaterial({ color:0xFFFDF6, roughness:0.35 })
};
const visorTex = cvsTex(128, 32, (g, w, h) => {
  const cols = ['#FF2D2D','#FF8A00','#FFE500','#39D353','#00C2FF','#4B4BFF','#B537F2'];
  cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * w / cols.length, 0, w / cols.length + 1, h); });
  g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(0, 0, w, h * 0.34);
});
MAT.visor = new THREE.MeshStandardMaterial({ map:visorTex, roughness:0.18, metalness:0.35,
  emissive:0xffffff, emissiveMap:visorTex, emissiveIntensity:0.45 });
const beanieTex = cvsTex(128, 64, (g, w, h) => {
  g.fillStyle = '#121216'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#FFC800';
  for (let i = 0; i < 10; i++) g.fillRect(i * w / 10 + 3, 0, w / 22, h * 0.66);
});
MAT.beanie = new THREE.MeshStandardMaterial({ map:beanieTex, roughness:0.7 });

const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cap = (r, l, m) => new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 6, 12), m);
const sph = (r, m) => new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m);
const cyl = (rt, rb, h, m, seg = 14) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);

const bull = new THREE.Group();
scene.add(bull);

const pelvis = new THREE.Group();
pelvis.position.y = 1.02;
bull.add(pelvis);

/* --- torso --- */
const torso = new THREE.Group();
pelvis.add(torso);
{
  const hips  = box(0.44, 0.26, 0.32, MAT.navy);  hips.position.y = 0.02;  torso.add(hips);
  const belt  = box(0.46, 0.06, 0.34, MAT.yellow); belt.position.y = 0.14; torso.add(belt);
  const abs   = box(0.40, 0.30, 0.30, MAT.skin);  abs.position.y = 0.32;   torso.add(abs);
  const chest = box(0.56, 0.36, 0.34, MAT.skin);  chest.position.y = 0.62; torso.add(chest);
  // tank top: narrower than the shoulders so the torso tapers to the waist
  const tank  = box(0.50, 0.54, 0.36, MAT.yellow); tank.position.y = 0.46; torso.add(tank);
  const strapL = box(0.08, 0.20, 0.10, MAT.yellow); strapL.position.set(-0.17, 0.80, -0.11); torso.add(strapL);
  const strapR = strapL.clone(); strapR.position.x = 0.17; torso.add(strapR);
  // traps + neck
  const traps = box(0.34, 0.14, 0.28, MAT.skin); traps.position.y = 0.84; torso.add(traps);
  const neck  = cyl(0.11, 0.13, 0.18, MAT.skin); neck.position.y = 0.94;  torso.add(neck);
}

/* --- head --- */
const head = new THREE.Group();
head.position.y = 1.09;
head.scale.setScalar(1.16);          // the head carries the identity — let it read
torso.add(head);
{
  const skull = box(0.50, 0.44, 0.46, MAT.skin); skull.position.y = 0.08; head.add(skull);
  // tapered muzzle toward the camera side (+Z is behind the bull, so the face is -Z)
  const snoutBase = box(0.34, 0.26, 0.20, MAT.skin); snoutBase.position.set(0, -0.06, -0.28); head.add(snoutBase);
  const muzzle = box(0.24, 0.13, 0.10, MAT.muzzle); muzzle.position.set(0, 0.02, -0.40); head.add(muzzle);
  [-1, 1].forEach(sd => {
    const nos = sph(0.022, MAT.ink); nos.position.set(sd * 0.06, 0.03, -0.45); head.add(nos);
  });
  // open bellowing mouth
  const mouth = box(0.28, 0.16, 0.12, MAT.ink); mouth.position.set(0, -0.15, -0.34); head.add(mouth);
  const tongue = box(0.13, 0.05, 0.10, MAT.tongue); tongue.position.set(0, -0.18, -0.38); head.add(tongue);
  const teethT = box(0.26, 0.04, 0.10, MAT.teeth); teethT.position.set(0, -0.09, -0.38); head.add(teethT);
  [-1, 1].forEach(sd => {
    const fang = cyl(0.001, 0.026, 0.09, MAT.teeth, 8);
    fang.position.set(sd * 0.10, -0.14, -0.38); fang.rotation.x = Math.PI; head.add(fang);
  });
  // rainbow visor wrapping the skull
  const visor = box(0.54, 0.11, 0.50, MAT.visor); visor.position.set(0, 0.13, -0.02); head.add(visor);
  // beanie
  const beanie = box(0.53, 0.22, 0.49, MAT.beanie); beanie.position.set(0, 0.30, 0); head.add(beanie);
  const brim = box(0.56, 0.07, 0.52, MAT.ink); brim.position.set(0, 0.20, 0); head.add(brim);
  /* Horns are the silhouette signature — they have to clear the beanie and
     read against the sky, so they sweep wide in two tapered segments. */
  [-1, 1].forEach(sd => {
    const hornRoot = new THREE.Group();
    hornRoot.position.set(sd * 0.24, 0.26, 0.02);
    hornRoot.rotation.z = sd * -0.80;
    hornRoot.rotation.x = -0.20;
    head.add(hornRoot);
    const seg1 = cyl(0.055, 0.085, 0.26, MAT.horn, 10);
    seg1.position.y = 0.13; hornRoot.add(seg1);
    const seg2 = cyl(0.012, 0.055, 0.24, MAT.horn, 10);
    seg2.position.set(0, 0.36, 0); seg2.rotation.z = sd * -0.42; hornRoot.add(seg2);
    // ears tuck under the horns
    const ear = box(0.15, 0.065, 0.11, MAT.skin);
    ear.position.set(sd * 0.28, 0.02, 0.05); ear.rotation.z = sd * 0.40; head.add(ear);
    // blue teardrop earring
    const er = sph(0.056, MAT.blue); er.position.set(sd * 0.30, -0.12, 0.06); head.add(er);
  });
  // red war paint
  const paint = box(0.03, 0.13, 0.02, MAT.red);
  paint.position.set(-0.14, -0.04, -0.24); paint.rotation.z = 0.2; head.add(paint);
}

/* --- limbs --- */
function makeArm(sd) {
  const shoulder = new THREE.Group();
  shoulder.position.set(sd * 0.32, 0.76, 0);
  torso.add(shoulder);
  const delt = sph(0.098, MAT.skin); shoulder.add(delt);
  const upper = cap(0.090, 0.24, sd < 0 ? MAT.skinD : MAT.skin);
  upper.position.y = -0.18; shoulder.add(upper);
  const elbow = new THREE.Group();
  elbow.position.y = -0.34;
  shoulder.add(elbow);
  const fore = cap(0.078, 0.22, sd < 0 ? MAT.skinD : MAT.skin);
  fore.position.y = -0.16; elbow.add(fore);
  const wrist = box(0.10, 0.06, 0.11, MAT.yellow);   // wristband reads the motion
  wrist.position.y = -0.27; elbow.add(wrist);
  const fist = sph(0.105, sd < 0 ? MAT.skinD : MAT.skin);
  fist.position.y = -0.34; elbow.add(fist);
  return { shoulder, elbow };
}
function makeLeg(sd) {
  const hip = new THREE.Group();
  hip.position.set(sd * 0.17, -0.06, 0);
  pelvis.add(hip);
  const thigh = cap(0.115, 0.26, sd < 0 ? MAT.skinD : MAT.skin);
  thigh.position.y = -0.20; hip.add(thigh);
  const short = box(0.28, 0.24, 0.30, sd < 0 ? MAT.navy : MAT.navy);
  short.position.y = -0.06; hip.add(short);
  const knee = new THREE.Group();
  knee.position.y = -0.40;
  hip.add(knee);
  const shin = cap(0.092, 0.26, sd < 0 ? MAT.skinD : MAT.skin);
  shin.position.y = -0.19; knee.add(shin);
  const ankle = new THREE.Group();
  ankle.position.y = -0.38;
  knee.add(ankle);
  const hoof = box(0.19, 0.11, 0.30, MAT.hoof);
  hoof.position.set(0, -0.05, -0.05); ankle.add(hoof);
  return { hip, knee, ankle };
}
const armL = makeArm(-1), armR = makeArm(1);
const legL = makeLeg(-1), legR = makeLeg(1);
// every solid part of the bull throws a real shadow
bull.traverse(o => { if (o.isMesh) o.castShadow = true; });

/* --- tail --- */
const tailRoot = new THREE.Group();
tailRoot.position.set(0, 0.02, 0.22);
pelvis.add(tailRoot);
{
  // angled back and kept high, or it dangles between the legs from behind
  const t1 = cap(0.032, 0.20, MAT.skinD); t1.position.set(0, -0.02, 0.13);
  t1.rotation.x = -1.05; tailRoot.add(t1);
  const tuft = sph(0.055, MAT.ink); tuft.position.set(0, -0.08, 0.26); tailRoot.add(tuft);
}

/* --- blob shadow --- */
const shadowTex = cvsTex(64, 64, (g, w, h) => {
  const r = g.createRadialGradient(w/2, h/2, 1, w/2, h/2, w/2);
  r.addColorStop(0, 'rgba(0,0,0,.72)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, h);
});
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0),
  new THREE.MeshBasicMaterial({ map:shadowTex, transparent:true, depthWrite:false }));
blob.rotation.x = -Math.PI / 2;
blob.position.y = 0.012;
scene.add(blob);

/* --- invincibility aura --- */
const aura = new THREE.Mesh(new THREE.SphereGeometry(1.05, 20, 14),
  new THREE.MeshBasicMaterial({ color:0xFFE500, transparent:true, opacity:0.0, wireframe:true }));
scene.add(aura);

/* =========================================================
   OBSTACLE + PICKUP POOLS
   ========================================================= */
const OB = { DIP:'dip', FUD:'fud', BEAR:'bear', HANDS:'hands' };

function buildDip() {
  const g = new THREE.Group();
  const h = DIP_H * S;
  const body = box(1.6, h, 0.5, new THREE.MeshStandardMaterial({ color:0xD8262C, roughness:0.5, emissive:0x2a0508, emissiveIntensity:1 }));
  body.position.y = h / 2; g.add(body);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.5, h * 0.8),
    new THREE.MeshBasicMaterial({ map:labelTex('DIP', '#C41F25', '#ffffff'), transparent:false }));
  face.position.set(0, h / 2, 0.26); g.add(face);
  const wick = cyl(0.03, 0.03, 0.34, MAT.red, 8); wick.position.y = h + 0.17; g.add(wick);
  return g;
}
function buildFud() {
  const g = new THREE.Group();
  const top = FUD_TOP * S;
  const beamMat = new THREE.MeshStandardMaterial({ color:0x3E2E74, roughness:0.6, emissive:0x150c2c, emissiveIntensity:1 });
  const beam = box(2.1, 0.55, 0.42, beamMat);
  beam.position.y = top + 0.27; g.add(beam);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.46),
    new THREE.MeshBasicMaterial({ map:labelTex('FUD', '#2A1C52', '#FFE500') }));
  face.position.set(0, top + 0.27, 0.22); g.add(face);
  [-1, 1].forEach(sd => {
    const post = box(0.16, top, 0.20, new THREE.MeshStandardMaterial({ color:0x181031, roughness:0.7 }));
    post.position.set(sd * 0.98, top / 2, 0); g.add(post);
  });
  return g;
}
function buildBear() {
  const g = new THREE.Group();
  const h = 232 * S;
  const body = box(1.75, h, 0.55, new THREE.MeshStandardMaterial({ color:0x5E1014, roughness:0.55 }));
  body.position.y = h / 2; g.add(body);
  // label plane matches the texture aspect, otherwise the word gets clipped
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.65, 0.83),
    new THREE.MeshBasicMaterial({ map:labelTex('BEAR', '#4A0C10', '#ffffff', 512, 256) }));
  face.position.set(0, h * 0.62, 0.29); g.add(face);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1.65, h * 0.9),
    new THREE.MeshBasicMaterial({ color:0x4A0C10 }));
  back.position.set(0, h / 2, 0.285); g.add(back);
  for (let i = 0; i < 4; i++) {
    const s = box(1.5, 0.075, 0.02, MAT.red);
    s.position.set(0, h - 0.22 - i * 0.30, 0.30); g.add(s);
  }
  return g;
}
function buildHands() {
  const g = new THREE.Group();
  const h = 190 * S;
  const body = box(1.85, h, 1.0, new THREE.MeshStandardMaterial({ color:0xBEB8AA, roughness:0.7 }));
  body.position.y = h / 2; g.add(body);
  const win = box(1.6, 0.5, 1.02, new THREE.MeshStandardMaterial({ color:0x0D0D12, roughness:0.35, metalness:0.4 }));
  win.position.y = h - 0.42; g.add(win);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.62),
    new THREE.MeshBasicMaterial({ map:labelTex('PAPER HANDS', '#9C968A', '#121216', 512, 128) }));
  face.position.set(0, h * 0.42, 0.52); g.add(face);
  return g;
}
const OB_BUILD = { [OB.DIP]:buildDip, [OB.FUD]:buildFud, [OB.BEAR]:buildBear, [OB.HANDS]:buildHands };
const obPool = { dip:[], fud:[], bear:[], hands:[] };
function obGet(kind) {
  const p = obPool[kind];
  let m = p.pop();
  if (!m) {
    m = OB_BUILD[kind]();
    m.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(m);
  }
  m.visible = true;
  return m;
}
function obFree(kind, m) { m.visible = false; obPool[kind].push(m); }

/* coins */
const coinGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.055, 20);
const coinMat = new THREE.MeshStandardMaterial({ color:0xFFD400, roughness:0.22, metalness:0.85,
  emissive:0x4a3c00, emissiveIntensity:1 });
const coinPool = [];
function coinGet() {
  let m = coinPool.pop();
  if (!m) { m = new THREE.Mesh(coinGeo, coinMat); m.rotation.x = Math.PI / 2; scene.add(m); }
  m.visible = true; return m;
}
function coinFree(m) { m.visible = false; coinPool.push(m); }

/* power-ups */
const puMats = {
  visor: new THREE.MeshStandardMaterial({ map:visorTex, roughness:0.25, emissive:0xffffff, emissiveMap:visorTex, emissiveIntensity:0.5 }),
  magnet: new THREE.MeshStandardMaterial({ color:0xF5F3EC, roughness:0.3, metalness:0.3, emissive:0x202020, emissiveIntensity:1 }),
  x2: new THREE.MeshStandardMaterial({ color:0x12D67C, roughness:0.3, emissive:0x04321d, emissiveIntensity:1 })
};
const puGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
const puPool = { visor:[], magnet:[], x2:[] };
function puGet(kind) {
  let m = puPool[kind].pop();
  if (!m) { m = new THREE.Mesh(puGeo, puMats[kind]); scene.add(m); }
  m.visible = true; return m;
}
function puFree(kind, m) { m.visible = false; puPool[kind].push(m); }

/* particles */
const pGeo = new THREE.SphereGeometry(0.06, 6, 5);
const pMat = new THREE.MeshBasicMaterial({ color:0xFFE500 });
const parts = [];
for (let i = 0; i < 90; i++) {
  const m = new THREE.Mesh(pGeo, pMat.clone());
  m.visible = false; scene.add(m);
  parts.push({ m, life:0, vx:0, vy:0, vz:0 });
}
function burst(x, y, z, color, n = 10, spread = 2.4) {
  let used = 0;
  for (const p of parts) {
    if (p.life > 0) continue;
    p.m.position.set(x, y, z);
    p.m.material.color.setHex(color);
    p.m.visible = true;
    p.life = 1;
    p.vx = (Math.random() - .5) * spread;
    p.vy = Math.random() * spread * 0.9 + 0.5;
    p.vz = (Math.random() - .5) * spread * 0.6;
    if (++used >= n) break;
  }
}

/* =========================================================
   SPAWNING (identical balance to the validated 2D build)
   ========================================================= */
const pickKind = () => {
  const r = Math.random();
  return r < 0.34 ? OB.DIP : r < 0.64 ? OB.FUD : OB.BEAR;
};
const mkOb = (lane, kind, z) => ({ lane, kind, z: z !== undefined ? z : G.spawnZ, dead:false, scored:false, mesh:null });
const mkPick = (lane, kind, z, y) => ({ lane, kind, z, y: y || 38, x:undefined, seed:Math.random()*6, mesh:null });
function coinTrail(lane, n) {
  // floated to chest height so coins read as collectibles, not road litter
  for (let i = 0; i < n; i++) G.pickups.push(mkPick(lane, 'coin', G.spawnZ + 40 + i * 78, 62));
}
function spawnWave() {
  const free = Math.floor(Math.random() * 3);
  // A gate forces jump/slide, locking the bull ~630ms. Two in a row is
  // unclearable at any gap, so never follow a gate with a gate.
  const roll = G.lastGate ? Math.random() * 0.58 : Math.random();
  G.lastGate = false;

  if (roll < 0.30) {
    G.obstacles.push(mkOb((free + 1 + Math.floor(Math.random()*2)) % 3, pickKind()));
    coinTrail(free, 5);
  } else if (roll < 0.58) {
    const kinds = [pickKind(), pickKind()]; let k = 0;
    for (let l = 0; l < 3; l++) if (l !== free) G.obstacles.push(mkOb(l, kinds[k++]));
    coinTrail(free, 6);
  } else if (roll < 0.76) {
    const kind = Math.random() < 0.5 ? OB.DIP : OB.FUD;
    G.lastGate = true;
    for (let l = 0; l < 3; l++) G.obstacles.push(mkOb(l, kind));
    const y = kind === OB.DIP ? 96 : 26;
    for (let i = 0; i < 3; i++) G.pickups.push(mkPick(free, 'coin', G.spawnZ + 130 + i * 90, y));
  } else if (roll < 0.90) {
    // train — 100 spacing keeps hit windows contiguous (HIT_Z*2 = 104) so the
    // lane behaves as one solid object with no phantom gaps to swerve into
    const lane = (free + 1 + Math.floor(Math.random()*2)) % 3;
    for (let i = 0; i < 3; i++) G.obstacles.push(mkOb(lane, OB.HANDS, G.spawnZ + i * 100));
    coinTrail(free, 7);
  } else {
    const kinds = ['visor','magnet','x2'];
    G.pickups.push(mkPick(free, kinds[Math.floor(Math.random()*3)], G.spawnZ + 120, 56));
    coinTrail((free + 1) % 3, 4);
  }

  /* Space waves by TIME, not distance. Reaction happens in milliseconds, so a
     fixed distance gap silently shrinks the window as speed climbs. The 860ms
     floor clears a 633ms jump plus ~95ms of lead with margin. */
  const gapMs = clamp(1480 - (G.speed - SPEED_START) * 780, 860, 1480);
  G.spawnZ += gapMs * G.speed + Math.random() * 180;
}

/* =========================================================
   POPUPS / BANNER
   ========================================================= */
const popLayer = $('pops');
function pop(text, worldX, worldY, cls) {
  if (!popLayer) return;
  const v = new THREE.Vector3(worldX, worldY, 0.4).project(camera);
  const el = document.createElement('div');
  el.className = 'pop' + (cls ? ' pop--' + cls : '');
  el.textContent = text;
  el.style.left = ((v.x * 0.5 + 0.5) * cv.clientWidth) + 'px';
  el.style.top  = ((-v.y * 0.5 + 0.5) * cv.clientHeight) + 'px';
  popLayer.appendChild(el);
  setTimeout(() => el.remove(), 1050);
}
let bannerT = null;
function banner(k, v) {
  const b = $('banner');
  $('bannerK').textContent = k; $('bannerV').textContent = v;
  b.classList.remove('is-on'); void b.offsetWidth; b.classList.add('is-on');
  clearTimeout(bannerT);
  bannerT = setTimeout(() => b.classList.remove('is-on'), 2500);
}

/* =========================================================
   INPUT (rules identical to the validated build)
   ========================================================= */
function wouldHit(kind, p) {
  if (kind === OB.DIP) return p.y < DIP_CLR;
  if (kind === OB.FUD) return !(p.slide > 0) && p.y < FUD_TOP;
  return true;
}
function move(dir) {
  const p = G.player;
  const next = clamp(p.lane + dir, 0, 2);
  if (next === p.lane) return;
  /* Refuse to swerve into something already alongside us — otherwise the player
     is side-swiped by things they never ran into, which reads as a bug. */
  const blocked = G.obstacles.some(o =>
    !o.dead && o.lane === next && o.z > -112 && o.z < 142 && wouldHit(o.kind, p));
  if (blocked) { p.nudge = dir * 34; blip(140, .06, 'square', .03); return; }
  p.lane = next;
  blip(dir > 0 ? 560 : 500, .05, 'sine', .03);
}
function jump() {
  const p = G.player;
  if (p.air || p.slide > 0) return;
  p.vy = JUMP_V; p.air = true; G.jumps++;
  bumpMission('jumps', 1); sfx.jump();
}
function slide() {
  const p = G.player;
  if (p.slide > 0) return;
  if (p.air) p.vy = -JUMP_V * 0.85;
  p.slide = SLIDE_MS; sfx.slide();
}
const KEYS = {
  ArrowLeft:() => move(-1), a:() => move(-1), A:() => move(-1),
  ArrowRight:() => move(1), d:() => move(1), D:() => move(1),
  ArrowUp:jump, w:jump, W:jump, ' ':jump,
  ArrowDown:slide, s:slide, S:slide
};
addEventListener('keydown', e => {
  const anyOv = !$('ovShop').hidden || !$('ovHelp').hidden || !$('ovScores').hidden;
  if (e.key === 'Escape' && anyOv) { closeAll(); return; }
  if ((G.state === 'idle' || G.state === 'over') && !anyOv && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault(); start(); return;
  }
  if (G.state !== 'playing' && G.state !== 'paused') return;
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    e.preventDefault(); G.state === 'playing' ? pause() : resume(); return;
  }
  if (G.state !== 'playing') return;
  const fn = KEYS[e.key];
  if (fn) { e.preventDefault(); fn(); }
});
let tS = null;
cv.addEventListener('touchstart', e => {
  if (G.state !== 'playing') return;
  tS = { x:e.touches[0].clientX, y:e.touches[0].clientY };
}, { passive:true });
cv.addEventListener('touchend', e => {
  if (G.state !== 'playing' || !tS) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - tS.x, dy = t.clientY - tS.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < 26 && ay < 26) jump();
  else if (ax > ay) move(dx > 0 ? 1 : -1);
  else dy > 0 ? slide() : jump();
  tS = null;
}, { passive:true });
cv.addEventListener('touchmove', e => { if (G.state === 'playing') e.preventDefault(); }, { passive:false });

/* =========================================================
   MISSIONS RUNTIME
   ========================================================= */
function bumpMission(type, n) {
  let ch = false;
  save.missions.forEach(m => {
    if (m.done || m.t !== type) return;
    m.prog = Math.min(m.target, m.prog + n); ch = true;
    if (m.prog >= m.target) {
      m.done = true; save.bank += m.reward; sfx.cash();
      pop(`MISSION +${m.reward}`, G.player.x * S, 2.4, 'green');
    }
  });
  if (ch) { renderTicker(); persist(); }
}
function setMission(type, value) {
  save.missions.forEach(m => {
    if (m.done || m.t !== type) return;
    if (value > m.prog) { m.prog = Math.min(m.target, value); if (m.prog >= m.target) bumpMission(type, 0); }
  });
  renderTicker();
}
function renderTicker() {
  const el = $('hMissions');
  if (!el) return;
  el.innerHTML = save.missions.map(m => {
    const pct = Math.round(m.prog / m.target * 100);
    return `<div class="${m.done ? 'done' : ''}">${m.done ? '✓' : ''}
      <span class="bar"><i style="width:${pct}%"></i></span>
      ${m.text} <b>${Math.min(m.prog, m.target)}/${m.target}</b></div>`;
  }).join('');
}
function rollMissions() {
  let rolled = false;
  const kept = save.missions.filter(m => !m.done).map(m => m.t);
  save.missions = save.missions.map(m => {
    if (!m.done) return m;
    rolled = true;
    const fresh = newMission(kept);
    kept.push(fresh.t);
    return fresh;
  });
  save.missions.forEach(m => { m.prog = 0; m.done = false; });
  if (rolled) persist();
  renderTicker();
}

/* =========================================================
   LIFECYCLE
   ========================================================= */
const isTouch = matchMedia('(hover:none), (pointer:coarse)').matches;
function closeAll() {
  ['ovShop','ovHelp','ovScores'].forEach(id => $(id).hidden = true);
  if (G.state === 'idle') $('ovStart').hidden = false;
  if (G.state === 'over') $('ovOver').hidden = false;
}
function clearField() {
  G.obstacles.forEach(o => { if (o.mesh) obFree(o.kind, o.mesh); });
  G.pickups.forEach(k => { if (k.mesh) k.kind === 'coin' ? coinFree(k.mesh) : puFree(k.kind, k.mesh); });
  G.obstacles = []; G.pickups = [];
}
function applyZone() {
  const Z = zone();
  paintSky();
  scene.fog.color.setHex(Z.fog);
  renderer.setClearColor(Z.skyTop, 1);
  /* material.color multiplies the texture — tinting it with the dark zone
     colour crushed the asphalt to near-black and hid the shadows, so keep it
     mostly white and let the road texture carry the tone. */
  road.material.color.setHex(Z.road).lerp(new THREE.Color(0xffffff), 0.74);
  ground.material.color.setHex(Z.road).lerp(new THREE.Color(0x2A2C3C), 0.55);
  // dimmed so the skyline stays scenery and never competes with the obstacles
  bldMatA.color.setHex(Z.bldA).multiplyScalar(0.38);
  bldMatB.color.setHex(Z.bldB).multiplyScalar(0.38);
  rim.color.setHex(Z.rim);
  sun.material.color.setHex(Z.sun);
}
function start() {
  rollMissions();
  clearField();
  Object.assign(G, {
    state:'playing', speed:SPEED_START, dist:0, score:0, coins:0, mult:1,
    zone:0, nextZoneM:ZONE_M, streak:0, combo:1, lastCoinT:-1e9,
    nearMiss:0, jumps:0, powers:0, revives:upLvl('life'),
    shake:0, flash:0, hitFlash:0, landT:0, travelled:0, spawnZ:900, lastGate:false,
    wJump:0, wSlide:0
  });
  Object.assign(G.player, {
    lane:1, x:0, y:0, vy:0, air:false, slide:0, phase:0,
    nudge:0, inv:upLvl('head') * 2000, magnet:0, x2:0
  });
  applyZone();
  ['ovStart','ovOver','ovPause','ovShop','ovHelp','ovScores'].forEach(id => $(id).hidden = true);
  $('hud').hidden = false;
  $('cornerBR').classList.add('is-hidden');
  if (isTouch) $('pad').classList.add('is-on');
  cv.classList.add('is-playing');
  renderTicker();
  $('hZone').textContent = ZONES[0].name;
  syncCombo();
  banner('ZONE 1', ZONES[0].name);
  G.last = performance.now();
  if (!G.raf) G.raf = requestAnimationFrame(loop);
}
function pause() {
  if (G.state !== 'playing') return;
  G.state = 'paused'; $('ovPause').hidden = false; cv.classList.remove('is-playing');
}
function resume() {
  if (G.state !== 'paused') return;
  G.state = 'playing'; $('ovPause').hidden = true; cv.classList.add('is-playing');
  G.last = performance.now();
  if (!G.raf) G.raf = requestAnimationFrame(loop);
}
function rankFor(s) {
  if (s < 800) return 'PAPER HANDED TOURIST';
  if (s < 2500) return 'NERVOUS HOLDER';
  if (s < 6000) return 'CONVICTION BUILDING';
  if (s < 12000) return 'CERTIFIED RETARDED BULL';
  if (s < 22000) return 'DENIAL GRANDMASTER';
  return 'SLINGOR HIMSELF 🐂';
}
function gameOver() {
  G.state = 'over';
  cv.classList.remove('is-playing');
  $('pad').classList.remove('is-on');
  $('cornerBR').classList.remove('is-hidden');
  sfx.over();
  const dist = Math.floor(G.dist / 10), score = Math.floor(G.score);
  const isBest = score > save.best;
  if (isBest) save.best = score;
  save.bank += G.coins;
  save.lb.push({ score, dist, coins:G.coins, t:Date.now() });
  save.lb.sort((a, b) => b.score - a.score);
  save.lb = save.lb.slice(0, 5);
  persist();
  $('oScore').textContent = fmt(score);
  $('oCoins').textContent = fmt(G.coins);
  $('oDist').textContent = fmt(dist) + 'm';
  $('oBest').textContent = fmt(save.best);
  $('oBadge').hidden = !isBest;
  $('oRank').textContent = rankFor(score);
  const done = save.missions.filter(m => m.done);
  $('oMissions').innerHTML = done.length
    ? `<div class="rank" style="color:var(--green)">✓ ${done.length} MISSION${done.length>1?'S':''} COMPLETE · +${done.reduce((a,m)=>a+m.reward,0)} <i class="coin"></i></div>` : '';
  $('bRevive').hidden = G.revives <= 0;
  const share = `I ran ${fmt(dist)}m as The Retarded Bull and bagged ${G.coins} $SLING 🐂\n\nbull run again.`;
  $('oShare').href = 'https://x.com/intent/tweet?text=' + encodeURIComponent(share) +
    '&url=' + encodeURIComponent(location.origin + location.pathname);
  $('hud').hidden = true;
  $('ovOver').hidden = false;
  refreshMenus();
}
function revive() {
  if (G.revives <= 0) return;
  G.revives--;
  // clear the road ahead so the player does not die again instantly
  for (let i = G.obstacles.length - 1; i >= 0; i--) {
    const o = G.obstacles[i];
    if (o.z <= 800) { if (o.mesh) obFree(o.kind, o.mesh); G.obstacles.splice(i, 1); }
  }
  const p = G.player;
  p.y = 0; p.vy = 0; p.air = false; p.slide = 0; p.inv = 2800;
  G.state = 'playing';
  $('ovOver').hidden = true; $('hud').hidden = false;
  $('cornerBR').classList.add('is-hidden');
  if (isTouch) $('pad').classList.add('is-on');
  cv.classList.add('is-playing');
  banner('SECOND WIND', 'BULL RUN AGAIN');
  sfx.power();
  G.last = performance.now();
  if (!G.raf) G.raf = requestAnimationFrame(loop);
}
function toMenu() {
  G.state = 'idle';
  ['ovOver','ovPause','ovShop','ovHelp','ovScores'].forEach(id => $(id).hidden = true);
  $('ovStart').hidden = false;
  $('hud').hidden = true;
  $('pad').classList.remove('is-on');
  $('cornerBR').classList.remove('is-hidden');
  G.zone = 0; applyZone();
  clearField();
  seedIdle();
  refreshMenus();
  if (!G.raf) G.raf = requestAnimationFrame(loop);
}

/* =========================================================
   UPDATE
   ========================================================= */
function update(dt) {
  const p = G.player;
  G.speed = Math.min(SPEED_MAX, G.speed + SPEED_RAMP * dt);
  const travel = G.speed * dt;
  G.dist += travel; G.travelled += travel;
  G.score += travel * 0.05 * G.mult;

  const metres = Math.floor(G.dist / 10);
  setMission('dist', metres);
  if (metres >= G.nextZoneM) {
    G.zone++; G.nextZoneM += ZONE_M;
    applyZone();
    banner('ZONE ' + (G.zone + 1), zone().name);
    $('hZone').textContent = zone().name;
    sfx.zone(); G.flash = 0.55;
  }

  /* Lane glide. Without this p.x never leaves 0: the logical lane changes and
     collisions follow it, but the bull and camera never move — which reads as
     the controls being dead. */
  p.x = damp(p.x, LANES[p.lane], 13, dt);
  p.nudge = damp(p.nudge, 0, 9, dt);

  if (p.air) {
    p.vy -= GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) {
      p.y = 0; p.vy = 0; p.air = false; G.landT = 160;
      burst(p.x * S, 0.06, 0.1, 0xFFE500, 8, 1.8);
    }
  }
  if (p.slide > 0) p.slide -= dt;
  if (!p.air) p.phase += dt * 0.0125 * (G.speed / SPEED_START);

  p.inv = Math.max(0, p.inv - dt);
  p.magnet = Math.max(0, p.magnet - dt);
  p.x2 = Math.max(0, p.x2 - dt);
  G.mult = p.x2 > 0 ? 2 : 1;
  G.shake = Math.max(0, G.shake - dt * 0.004);
  G.flash = Math.max(0, G.flash - dt * 0.004);
  G.hitFlash = Math.max(0, G.hitFlash - dt * 0.003);
  G.landT = Math.max(0, G.landT - dt);

  if (G.streak > 0 && G.t - G.lastCoinT > 2600) { G.streak = 0; G.combo = 1; syncCombo(); }

  G.spawnZ -= travel;
  while (G.spawnZ < Z_SPAWN) spawnWave();

  for (let i = G.obstacles.length - 1; i >= 0; i--) {
    const o = G.obstacles[i];
    o.z -= travel;
    if (o.z < Z_GONE) { if (o.mesh) obFree(o.kind, o.mesh); G.obstacles.splice(i, 1); continue; }

    if (!o.scored && !o.dead && o.z < -HIT_Z && o.lane === p.lane) {
      o.scored = true; G.nearMiss++;
      G.score += 25 * G.mult;
      bumpMission('nearmiss', 1); sfx.near();
      pop('CLEAN +' + 25 * G.mult, p.x * S, 1.9, 'green');
    }
    if (o.dead || Math.abs(o.z) > HIT_Z) continue;
    if (o.lane !== p.lane) continue;

    if (wouldHit(o.kind, p)) {
      o.dead = true;
      if (p.inv > 0) {
        burst(p.x * S, 1.0, 0, 0xFFE500, 16, 3.2);
        G.flash = 0.5; blip(880, .08, 'square', .05);
      } else {
        sfx.hit(); G.shake = 1; G.hitFlash = 1;
        burst(p.x * S, 1.0, 0, 0xE8232A, 22, 3.6);
        gameOver();
        return;
      }
    }
  }

  const magnetOn = p.magnet > 0;
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const k = G.pickups[i];
    k.z -= travel;
    if (k.z < Z_GONE) { if (k.mesh) (k.kind === 'coin' ? coinFree(k.mesh) : puFree(k.kind, k.mesh)); G.pickups.splice(i, 1); continue; }

    if (magnetOn && k.kind === 'coin' && k.z < 900) {
      if (k.x === undefined) k.x = LANES[k.lane];
      k.x = damp(k.x, p.x, 7, dt);
      k.y = damp(k.y, Math.max(38, p.y + 44), 12, dt);
    }
    const kx = k.x !== undefined ? k.x : LANES[k.lane];
    const near = Math.abs(k.z) < 70;
    const sameLane = magnetOn && k.kind === 'coin' ? Math.abs(kx - p.x) < 140 : k.lane === p.lane;
    const pTop = p.y + (p.slide > 0 ? 80 : BULL_H);
    const vert = k.y >= p.y - 30 && k.y <= pTop + 20;

    if (near && sameLane && vert) {
      if (k.mesh) (k.kind === 'coin' ? coinFree(k.mesh) : puFree(k.kind, k.mesh));
      G.pickups.splice(i, 1);
      const wx = kx * S, wy = k.y * S;
      if (k.kind === 'coin') {
        G.coins++; G.streak++; G.lastCoinT = G.t;
        const nc = clamp(1 + Math.floor(G.streak / 8), 1, 5);
        if (nc !== G.combo) { G.combo = nc; syncCombo(true); setMission('combo', G.combo); }
        G.score += 12 * G.combo * G.mult;
        bumpMission('coins', 1);
        sfx.coin(G.combo);
        burst(wx, wy, 0, 0xFFE500, 6, 1.6);
      } else {
        G.powers++; bumpMission('power', 1); sfx.power(); G.flash = 0.7;
        if (k.kind === 'visor')  { p.inv = durVisor();    burst(wx, wy, 0, 0xB537F2, 18, 3); pop('INVINCIBLE', wx, wy, 'rainbow'); }
        if (k.kind === 'magnet') { p.magnet = durMagnet(); burst(wx, wy, 0, 0x6E93FF, 18, 3); pop('MAGNET', wx, wy, 'blue'); }
        if (k.kind === 'x2')     { p.x2 = durX2();        burst(wx, wy, 0, 0x12D67C, 18, 3); pop('DOUBLE SCORE', wx, wy, 'green'); }
      }
    }
  }
}
function syncCombo(flash) {
  const el = $('hCombo');
  if (!el) return;
  el.firstChild.nodeValue = 'x' + G.combo;
  el.classList.toggle('is-on', G.combo > 1);
  if (flash && G.combo > 1) {
    el.style.transform = 'scale(1.35)';
    setTimeout(() => { el.style.transform = ''; }, 150);
  }
}

/* =========================================================
   ANIMATION — the run cycle
   ========================================================= */
function poseBull(dt) {
  const p = G.player;
  const ph = p.phase;
  const spd = G.speed / SPEED_START;

  // blend weights make transitions read as motion rather than snapping
  G.wJump  = damp(G.wJump,  p.air ? 1 : 0,      14, dt);
  G.wSlide = damp(G.wSlide, p.slide > 0 ? 1 : 0, 18, dt);
  const wR = Math.max(0, 1 - G.wJump - G.wSlide);   // run weight

  /* ---- run cycle ---- */
  const sinA = Math.sin(ph), sinB = Math.sin(ph + Math.PI);
  const rThighL = sinA * 0.92 - 0.10;
  const rThighR = sinB * 0.92 - 0.10;
  // knees only ever bend one way; peak just after the thigh passes back
  const rKneeL = -clamp(-Math.sin(ph - 0.85), 0, 1) * 1.75 - 0.10;
  const rKneeR = -clamp(-Math.sin(ph + Math.PI - 0.85), 0, 1) * 1.75 - 0.10;
  const rAnkL = clamp(Math.sin(ph + 1.2), -1, 1) * 0.34;
  const rAnkR = clamp(Math.sin(ph + Math.PI + 1.2), -1, 1) * 0.34;
  const rShL = -sinA * 0.80 + 0.18, rShR = -sinB * 0.80 + 0.18;
  const rElL = -1.05 - Math.max(0, -sinA) * 0.45;
  const rElR = -1.05 - Math.max(0, -sinB) * 0.45;
  const bob = Math.abs(Math.sin(ph)) * 0.055;
  const hipTwist = -sinA * 0.13, torsoTwist = sinA * 0.15;

  /* ---- jump pose ---- */
  const jThigh = 0.95, jThigh2 = 0.25, jKnee = -1.5, jKnee2 = -0.7;
  const jSh = -1.9, jEl = -0.5;

  /* ---- slide pose ---- */
  const sThigh = 1.35, sKnee = -0.55, sSh = 1.25, sEl = -0.35;

  const mix3 = (r, j, s) => r * wR + j * G.wJump + s * G.wSlide;

  legL.hip.rotation.x   = mix3(rThighL, jThigh,  sThigh);
  legR.hip.rotation.x   = mix3(rThighR, jThigh2, sThigh * 0.85);
  legL.knee.rotation.x  = mix3(rKneeL,  jKnee,   sKnee);
  legR.knee.rotation.x  = mix3(rKneeR,  jKnee2,  sKnee * 0.7);
  legL.ankle.rotation.x = mix3(rAnkL, 0.35, -0.30);
  legR.ankle.rotation.x = mix3(rAnkR, 0.25, -0.30);

  armL.shoulder.rotation.x = mix3(rShL, jSh, sSh);
  armR.shoulder.rotation.x = mix3(rShR, jSh * 0.86, sSh * 0.9);
  armL.elbow.rotation.x    = mix3(rElL, jEl, sEl);
  armR.elbow.rotation.x    = mix3(rElR, jEl, sEl);
  armL.shoulder.rotation.z =  0.16 + G.wSlide * 0.25;
  armR.shoulder.rotation.z = -0.16 - G.wSlide * 0.25;

  // pelvis: bob, twist, and the slide crouch
  pelvis.position.y = mix3(1.02 + bob, 1.00, 0.50);
  pelvis.rotation.y = hipTwist * wR;
  pelvis.rotation.x = mix3(0, -0.10, 0.30);

  torso.rotation.y = torsoTwist * wR;
  torso.rotation.x = mix3(0.15 + Math.abs(sinA) * 0.03, 0.34, 0.62);
  torso.rotation.z = mix3(-sinA * 0.04, 0, 0);

  // head counter-rotates so it stays level and aimed down the road
  head.rotation.y = -torso.rotation.y * 0.7;
  head.rotation.x = -torso.rotation.x * 0.72 + Math.sin(ph * 2) * 0.03;
  head.rotation.z = -torso.rotation.z * 0.6;

  tailRoot.rotation.z = Math.sin(ph * 0.9) * 0.30;
  tailRoot.rotation.x = 0.25 + Math.sin(ph * 1.8) * 0.12;

  // world placement
  const px = (p.x + p.nudge) * S;
  bull.position.x = px;
  bull.position.y = p.y * S;
  bull.rotation.z = damp(bull.rotation.z, -(p.nudge * S) * 0.9, 8, dt);
  bull.rotation.y = damp(bull.rotation.y, ((p.lane - 1) * -0.10), 6, dt);

  // squash on landing gives the jump some weight
  const land = G.landT > 0 ? Math.sin((1 - G.landT / 160) * Math.PI) : 0;
  bull.scale.set(1 + land * 0.10, 1 - land * 0.14, 1 + land * 0.10);

  // real shadow maps do the grounding now; the blob only adds contact darkening
  blob.position.set(px, 0.012, 0);
  const sc = clamp(1 - p.y * S * 0.42, 0.42, 1);
  blob.scale.set(sc * 0.8, sc * 0.8 * (G.wSlide > 0.5 ? 1.25 : 1), 1);
  blob.material.opacity = 0.22 * sc;

  aura.visible = p.inv > 0;
  if (aura.visible) {
    aura.position.set(px, 1.0 + p.y * S, 0);
    const pulse = 0.5 + Math.sin(G.t / 90) * 0.22;
    aura.material.opacity = 0.16 + pulse * 0.14;
    aura.material.color.setHSL((G.t / 900) % 1, 1, 0.6);
    aura.rotation.y += dt * 0.002;
    aura.scale.setScalar(1 + pulse * 0.06);
  }
}

/* =========================================================
   SCENE SYNC
   ========================================================= */
function syncWorld(dt) {
  const p = G.player;
  const scroll = G.travelled * S;

  roadTex.offset.y = -scroll / TILE;
  kerbTex.offset.y = -scroll / 1.6;

  // buildings recycle for genuine parallax depth
  for (const b of buildings) {
    b.position.z += G.speed * dt * S;
    if (b.position.z > 16) {
      b.position.z -= 150 + Math.random() * 30;
      b.position.x = (Math.random() > .5 ? 1 : -1) * (13 + Math.random() * 26);
    }
  }

  // obstacles
  for (const o of G.obstacles) {
    if (o.z > Z_SPAWN + 200) continue;
    if (!o.mesh) o.mesh = obGet(o.kind);
    o.mesh.position.set(LANES[o.lane] * S, 0, -o.z * S);
    o.mesh.visible = o.z < Z_FAR + 400;
  }
  // pickups
  for (const k of G.pickups) {
    if (k.z > Z_SPAWN + 200) continue;
    if (!k.mesh) k.mesh = k.kind === 'coin' ? coinGet() : puGet(k.kind);
    const kx = k.x !== undefined ? k.x : LANES[k.lane];
    k.mesh.position.set(kx * S, k.y * S, -k.z * S);
    if (k.kind === 'coin') k.mesh.rotation.z += dt * 0.006;
    else { k.mesh.rotation.y += dt * 0.0022; k.mesh.rotation.x += dt * 0.0012; }
  }

  // particles
  for (const q of parts) {
    if (q.life <= 0) continue;
    q.life -= dt * 0.0022;
    if (q.life <= 0) { q.m.visible = false; continue; }
    q.m.position.x += q.vx * dt * 0.001;
    q.m.position.y += q.vy * dt * 0.001;
    q.m.position.z += q.vz * dt * 0.001 + G.speed * dt * S;
    q.vy -= dt * 0.006;
    q.m.scale.setScalar(clamp(q.life, 0, 1));
  }

  // chase camera: lags the lane change and leans into it
  /* Chase cam sits well back and above so the road ahead — not the bull's back —
     owns the frame. It tracks the lane almost fully so the bull stays centred;
     the small shortfall plus the damping is what gives the turn its weight. */
  camRig.x = damp(camRig.x, p.x * S * 0.94, 9, dt);
  camRig.y = damp(camRig.y, 2.18 + p.y * S * 0.26 - (p.slide > 0 ? 0.20 : 0), 8, dt);
  camRig.fov = damp(camRig.fov, 58 + (G.speed - SPEED_START) * 7.5, 3, dt);
  if (G.shake > 0) {
    camRig.shakeX = (Math.random() - .5) * G.shake * 0.30;
    camRig.shakeY = (Math.random() - .5) * G.shake * 0.30;
  } else { camRig.shakeX = camRig.shakeY = 0; }

  camera.fov = camRig.fov * (aspectNarrow ? 1.24 : 1);
  camera.position.set(camRig.x + camRig.shakeX, camRig.y + camRig.shakeY, 4.75);
  camera.lookAt(camRig.x, 0.86 + p.y * S * 0.42, -8.0);
  camera.updateProjectionMatrix();

  // the shadow frustum is tight, so the key light rides along with the bull
  const px0 = p.x * S;
  key.position.set(px0 - 3.4, 7.0, 5.0);
  key.target.position.set(px0, 0, -6);
  bounce.position.set(px0, 0.6 + p.y * S, 1.0);
  sun.position.x = camRig.x * 0.4;
  sky.position.set(camera.position.x, 0, camera.position.z);

  // flashes via a DOM-free approach: tint the renderer clear + exposure
  renderer.toneMappingExposure = 1.12 + G.flash * 0.9;
  if (G.hitFlash > 0) {
    hemi.color.setHex(0xFF4444);
    hemi.intensity = 0.62 + G.hitFlash * 1.4;
  } else {
    hemi.color.setHex(0x9FB4FF);
    hemi.intensity = 0.62;
  }
}

/* =========================================================
   HUD
   ========================================================= */
let hudT = 0;
function drawHud(dt) {
  hudT += dt;
  if (hudT < 90) return;
  hudT = 0;
  $('hScore').textContent = fmt(G.score);
  $('hCoins').textContent = G.coins;
  $('hDist').textContent = fmt(G.dist / 10) + 'm';
  $('hBest').textContent = fmt(Math.max(save.best, G.score));
  const p = G.player, chips = [];
  if (p.inv > 0)    chips.push(`<i class="gp gp--visor">VISOR ${(p.inv/1000).toFixed(1)}s</i>`);
  if (p.magnet > 0) chips.push(`<i class="gp gp--magnet">MAGNET ${(p.magnet/1000).toFixed(1)}s</i>`);
  if (p.x2 > 0)     chips.push(`<i class="gp gp--x2">2X ${(p.x2/1000).toFixed(1)}s</i>`);
  $('hPowers').innerHTML = chips.join('');
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
    if (G.state !== 'playing') { G.raf = requestAnimationFrame(loop); return; }
    drawHud(dt);
  } else {
    // idle / menu: keep the world alive at a gentle pace
    G.travelled += SPEED_START * dt * 0.55;
    G.player.phase += dt * 0.010;
  }
  poseBull(dt);
  syncWorld(dt);
  renderer.render(scene, camera);
  G.raf = requestAnimationFrame(loop);
}

/* =========================================================
   IDLE SEED
   ========================================================= */
function seedIdle() {
  G.obstacles.push(mkOb(0, OB.BEAR, 900));
  G.obstacles.push(mkOb(2, OB.FUD, 1500));
  for (let i = 0; i < 6; i++) G.pickups.push(mkPick(1, 'coin', 520 + i * 150, 38));
}

/* =========================================================
   RESIZE
   ========================================================= */
let aspectNarrow = false;
function resize() {
  const w = Math.max(320, cv.clientWidth || 320);
  const h = Math.max(240, cv.clientHeight || 240);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // on portrait screens widen the view so all three lanes stay framed
  aspectNarrow = w / h < 1;
  camera.fov = camRig.fov * (aspectNarrow ? 1.24 : 1);
  camera.updateProjectionMatrix();
}

/* =========================================================
   MENUS
   ========================================================= */
function upCost(key) {
  const lvl = upLvl(key);
  const def = UPGRADES.find(u => u.key === key);
  if (lvl >= def.max) return null;
  return UP_COST[Math.min(lvl, UP_COST.length - 1)];
}
function renderShop() {
  const grid = $('shopGrid');
  grid.innerHTML = UPGRADES.map(u => {
    const lvl = upLvl(u.key), cost = upCost(u.key);
    const pips = Array.from({ length:u.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
    const label = cost === null ? 'MAXED' : (save.bank >= cost ? `BUY · ${cost} <i class="coin"></i>` : `NEED ${cost} <i class="coin"></i>`);
    return `<div class="up"><span class="up__ic up__ic--${u.cls}">${u.icon}</span>
      <div class="up__b"><div class="up__n">${u.name}</div>
      <div class="up__d">${u.desc}</div><div class="up__pips">${pips}</div>
      <button class="up__buy ${cost === null ? 'max' : ''}" data-up="${u.key}"
        ${cost === null || save.bank < cost ? 'disabled' : ''}>${label}</button></div></div>`;
  }).join('');
  grid.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.up, cost = upCost(k);
    if (cost === null || save.bank < cost) return;
    save.bank -= cost; save.ups[k] = upLvl(k) + 1;
    persist(); sfx.cash(); renderShop(); refreshMenus();
  }));
  $('shBank').textContent = fmt(save.bank);
}
function renderLb() {
  const el = $('lbList');
  if (!save.lb.length) { el.innerHTML = '<li class="lb__empty">No runs yet. The bull is waiting.</li>'; return; }
  el.innerHTML = save.lb.map((r, i) => {
    const d = new Date(r.t);
    return `<li><span class="lb__i">${i+1}</span><span class="lb__s">${fmt(r.score)}</span>
      <span class="lb__d">${fmt(r.dist)}m · ${r.coins} <i class="coin"></i></span>
      <span class="lb__d">${d.toLocaleDateString('en-GB')}</span></li>`;
  }).join('');
}
function refreshMenus() {
  $('sBank').textContent = fmt(save.bank);
  $('sBest').textContent = fmt(save.best);
  $('shBank').textContent = fmt(save.bank);
  renderTicker();
}

/* =========================================================
   WIRING
   ========================================================= */
$('bPlay').addEventListener('click', start);
$('bAgain').addEventListener('click', start);
$('bResume').addEventListener('click', resume);
$('bRevive').addEventListener('click', revive);
$('bQuit').addEventListener('click', () => { $('ovPause').hidden = true; gameOver(); });
$('bMenu').addEventListener('click', toMenu);
$('hPause').addEventListener('click', () => G.state === 'playing' ? pause() : resume());
$('bShop').addEventListener('click', () => { $('ovStart').hidden = true; renderShop(); $('ovShop').hidden = false; });
$('bShop2').addEventListener('click', () => { $('ovOver').hidden = true; renderShop(); $('ovShop').hidden = false; });
$('bShopClose').addEventListener('click', closeAll);
$('bHelp').addEventListener('click', () => { $('ovStart').hidden = true; $('ovHelp').hidden = false; });
$('bHelpClose').addEventListener('click', closeAll);
$('bScores').addEventListener('click', () => { $('ovStart').hidden = true; renderLb(); $('ovScores').hidden = false; });
$('bScoresClose').addEventListener('click', closeAll);
$('cLeft').addEventListener('click', () => G.state === 'playing' && move(-1));
$('cRight').addEventListener('click', () => G.state === 'playing' && move(1));
$('cJump').addEventListener('click', () => G.state === 'playing' && jump());
$('cSlide').addEventListener('click', () => G.state === 'playing' && slide());

const bSound = $('bSound');
function syncSound() { bSound.textContent = save.sound ? 'SOUND ON' : 'SOUND OFF'; }
bSound.addEventListener('click', () => {
  save.sound = !save.sound; persist(); syncSound();
  if (save.sound) blip(760, .07, 'square', .04);
});
syncSound();
$('bFull').addEventListener('click', () => {
  const el = document.documentElement;
  if (!document.fullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
  else (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
});
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 120));
document.addEventListener('fullscreenchange', () => setTimeout(resize, 120));
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

/* =========================================================
   BOOT
   ========================================================= */
applyZone();
seedIdle();
resize();
refreshMenus();
G.last = performance.now();
G.raf = requestAnimationFrame(loop);

if (/(\?|&)debug=1\b/.test(location.search)) {
  window.__BULLRUN = { G, save, THREE, scene, camera, renderer, bull, start, pause, resume,
    gameOver, revive, update, poseBull, syncWorld, spawnWave, move, jump, slide, resize,
    LANES, OB, BULL_H, HIT_Z, Z_SPAWN, ZONES, S,
    render: () => renderer.render(scene, camera) };
}

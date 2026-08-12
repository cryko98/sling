/* =========================================================
   THE RETARDED BULL RUN — 3D, asset edition
   Character: Quaternius "Character Animated" (CC0), driven by an
   AnimationMixer (Run / Roll / Death clips), with the meme bull head
   mounted on the Head bone. Environment: Kenney + Quaternius CC0
   buildings, Quaternius cargo wagon for the PAPER HANDS train.

   Gameplay runs in the original validated "world units"; S converts
   them to metres, so every simulated balance figure still holds.
   ========================================================= */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let Composer = null, RenderPassC = null, BloomPass = null;
try {
  ({ EffectComposer: Composer } = await import('three/addons/postprocessing/EffectComposer.js'));
  ({ RenderPass: RenderPassC }  = await import('three/addons/postprocessing/RenderPass.js'));
  ({ UnrealBloomPass: BloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js'));
} catch (e) {
  console.warn('bloom unavailable, falling back to direct render', e);
}

const cv = document.getElementById('gameCanvas');
if (!cv) throw new Error('no canvas');

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const fmt = n => Math.floor(n).toLocaleString('en-US');
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt / 1000));

/* =========================================================
   GAMEPLAY CONSTANTS (validated by simulation — do not retune blindly)
   ========================================================= */
const LANE_W = 245, ROAD_HALF = 440;
const LANES = [-LANE_W, 0, LANE_W];
const Z_SPAWN = 2600, Z_FAR = 1900, Z_GONE = -260;
const HIT_Z = 52, DIP_H = 52, DIP_CLR = 44, FUD_TOP = 132;
const GRAVITY = 0.00218, JUMP_V = 0.708;      // ~633ms airtime, ~109u apex
const SLIDE_MS = 620, BULL_H = 230;
/* Fast from the first metre. Every internal gap is expressed in TIME (the
   floor of 860ms clears the 633ms jump lock with margin at any speed), so the
   ceiling could rise beyond the old 1.42 — the auto-player simulations below
   re-validated the whole 0.92–1.55 envelope at 16/16 before this shipped. */
const SPEED_START = 0.92, SPEED_MAX = 1.55, SPEED_RAMP = 0.0000085;
const ZONE_M = 800;
const DEATH_MS = 780;

const S = 1 / 110;                             // world units → metres

/* =========================================================
   ZONES
   ========================================================= */
const ZONES = [
  { name:'NIGHT CITY',     skyTop:0x070618, skyBot:0x3A2A6E, fog:0x1A2148, sun:0xFFE500, rim:0x3B6BFF, road:0x1B1B24 },
  { name:'BEAR MARKET',    skyTop:0x0A0406, skyBot:0x4A1418, fog:0x2A1014, sun:0xFF4A50, rim:0xE8232A, road:0x211618 },
  { name:'LIQUIDITY POOL', skyTop:0x02080C, skyBot:0x0B4A5E, fog:0x08303E, sun:0x00C2FF, rim:0x00C2FF, road:0x152026 },
  { name:'RAINBOW RUN',    skyTop:0x0A0414, skyBot:0x5A1C7A, fog:0x2C1044, sun:0xB537F2, rim:0xB537F2, road:0x1E1628 },
  { name:'GOLDEN HOUR',    skyTop:0x140A02, skyBot:0x8A4E0A, fog:0x4A2A08, sun:0xFFC800, rim:0xFFC800, road:0x241C12 },
  { name:'THE MOON',       skyTop:0x01020A, skyBot:0x141E5A, fog:0x0A1030, sun:0xF5F3EC, rim:0x8FA8FF, road:0x171A2A }
];
const zone = () => ZONES[G.zone % ZONES.length];

/* =========================================================
   PERSISTENCE / UPGRADES / MISSIONS  (unchanged, validated)
   ========================================================= */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const UPGRADES = [
  { key:'magnet', name:'MAGNET COIL',   icon:'M',  cls:'magnet', desc:'Longer coin magnet.',                max:5 },
  { key:'visor',  name:'RAINBOW VISOR', icon:'V',  cls:'visor',  desc:'Longer invincibility.',              max:5 },
  { key:'x2',     name:'DENIAL ENGINE', icon:'2X', cls:'x2',     desc:'Longer 2x score window.',            max:5 },
  { key:'head',   name:'HEAD START',    icon:'GO', cls:'head',   desc:'Begin each run already invincible.', max:4 },
  { key:'life',   name:'SECOND WIND',   icon:'+1', cls:'life',   desc:'Extra revive after a crash.',        max:3 }
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

const M_DEFS = [
  { t:'coins',    text:n => `Collect ${n} $SLING in one run`, pick:() => 40 + Math.floor(Math.random()*4)*20, pay:n => n*3 },
  { t:'dist',     text:n => `Run ${n}m in one run`,           pick:() => 600 + Math.floor(Math.random()*5)*200, pay:n => Math.round(n*0.4) },
  { t:'nearmiss', text:n => `Clear ${n} obstacles cleanly`,   pick:() => 8 + Math.floor(Math.random()*4)*4, pay:n => n*14 },
  { t:'power',    text:n => `Grab ${n} power-ups`,            pick:() => 3 + Math.floor(Math.random()*3), pay:n => n*50 },
  { t:'combo',    text:n => `Reach a x${n} combo`,            pick:() => 3 + Math.floor(Math.random()*3), pay:n => n*60 },
  { t:'jumps',    text:n => `Jump ${n} times`,                pick:() => 20 + Math.floor(Math.random()*4)*10, pay:n => n*5 }
];
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
  state:'idle',                 // idle | playing | dying | paused | over
  t:0, last:0, raf:null,
  speed:SPEED_START, dist:0, score:0, coins:0, mult:1,
  zone:0, nextZoneM:ZONE_M,
  streak:0, combo:1, lastCoinT:-1e9,
  nearMiss:0, jumps:0, powers:0, revives:0,
  shake:0, flash:0, hitFlash:0, landT:0, deathT:0,
  travelled:0, spawnZ:900, lastGate:false,
  obstacles:[], pickups:[],
  player:{ lane:1, x:0, vx:0, y:0, vy:0, air:false, slide:0,
           nudge:0, inv:0, magnet:0, x2:0 },
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
   MUSIC — procedural chiptune, zero assets
   A driving A-minor-pentatonic loop: kick four-on-the-floor, offbeat
   hats, triangle bass walking A-C-D-E, square arp on top. Scheduled
   ~120ms ahead on the AudioContext clock so it never stutters.
   ========================================================= */
const MUSIC = { on:false, timer:null, step:0, nextT:0, gain:null };
const M_BPM = 132, M_STEP = 60 / M_BPM / 2;         // 8th notes
const M_SCALE = [0, 3, 5, 7, 10];                    // minor pentatonic
const M_BASS = [0,0,0,0, 3,3,3,3, 5,5,5,5, 7,7,10,7]; // semitones over A1
const mHz = n => 55 * Math.pow(2, n / 12);
function mTone(t, freq, dur, type, vol, slideTo) {
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(MUSIC.gain);
  o.start(t); o.stop(t + dur + 0.03);
}
function mHat(t, vol) {
  const len = 0.05;
  const buf = AC.createBuffer(1, Math.floor(AC.sampleRate * len), AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = AC.createBufferSource(); src.buffer = buf;
  const hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6500;
  const g = AC.createGain(); g.gain.value = vol;
  src.connect(hp); hp.connect(g); g.connect(MUSIC.gain);
  src.start(t);
}
function mSchedule() {
  if (!MUSIC.on || !AC) return;
  const ahead = AC.currentTime + 0.14;
  let guard = 0;
  while (MUSIC.nextT < ahead && guard++ < 24) {
    const t = MUSIC.nextT, s = MUSIC.step, i16 = s % 16;
    const root = M_BASS[i16];
    if (s % 4 === 0) mTone(t, 150, 0.12, 'sine', 0.85, 44);          // kick
    if (s % 2 === 1) mHat(t, 0.22);                                   // offbeat hat
    mTone(t, mHz(root), M_STEP * 0.92, 'triangle', 0.42);            // bass
    if (s % 2 === 0) mTone(t, mHz(root + 12), M_STEP * 0.4, 'square', 0.09);
    // arp lead: two 16ths per step, pattern rotates each two bars
    const rot = Math.floor(s / 32) % 3;
    const n1 = M_SCALE[(i16 + rot) % 5] + root + 24;
    const n2 = M_SCALE[(i16 + rot + 2) % 5] + root + 24;
    mTone(t, mHz(n1), M_STEP * 0.48, 'square', 0.14);
    mTone(t + M_STEP / 2, mHz(n2), M_STEP * 0.40, 'square', 0.10);
    MUSIC.nextT += M_STEP;
    MUSIC.step++;
  }
}
function musicStart() {
  if (!save.sound || MUSIC.on) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    if (!MUSIC.gain) {
      MUSIC.gain = AC.createGain();
      MUSIC.gain.gain.value = 0.12;                 // bed, not foreground
      MUSIC.gain.connect(AC.destination);
    }
    MUSIC.on = true;
    MUSIC.step = 0;
    MUSIC.nextT = AC.currentTime + 0.08;
    clearInterval(MUSIC.timer);
    MUSIC.timer = setInterval(mSchedule, 30);
  } catch {}
}
function musicStop() {
  MUSIC.on = false;
  clearInterval(MUSIC.timer);
  MUSIC.timer = null;
}

/* =========================================================
   RENDERER / SCENE / LIGHTS
   ========================================================= */
const renderer = new THREE.WebGLRenderer({ canvas:cv, antialias:true, powerPreference:'high-performance' });
renderer.setClearColor(0x05060F, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x141A38, 16, 72);

const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 220);
const camRig = { x:0, y:0, shakeX:0, shakeY:0, fov:56 };

/* Post-processing is OFF by default (?bloom=1 re-enables it). WebGL errors
   are silent: a bloom pass that corrupts on a given GPU/driver produces
   exactly the reported "picture slid sideways" image with no exception, no
   console error and no chip — the one failure mode no machine-independent
   test can catch. Stability outranks glow; the neon materials are
   full-bright emissive and carry the look on their own. */
let composer = null, bloom = null;
const WANT_BLOOM = /(\?|&)bloom=1\b/.test(location.search);
if (WANT_BLOOM && Composer && RenderPassC && BloomPass) {
  composer = new Composer(renderer);
  composer.addPass(new RenderPassC(scene, camera));
  bloom = new BloomPass(new THREE.Vector2(1, 1), 0.55, 0.62, 0.62);
  composer.addPass(bloom);
}
/* If the post chain itself is what is throwing (bloom is the most fragile
   link on weak GPUs), drop it permanently and keep rendering direct. */
const present = () => {
  if (composer) {
    try { composer.render(); return; }
    catch (e) {
      console.error('composer failed — dropping bloom, rendering direct', e);
      composer = null;
      errChip('Effekt-hiba — bloom kikapcsolva, a játék megy tovább');
    }
  }
  renderer.render(scene, camera);
};

/* On-screen error surface: console is invisible to players, and a recurring
   invisible fault is undiagnosable from screenshots without this. */
function errChip(msg) {
  let el = document.getElementById('errChip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'errChip';
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;' +
      'background:rgba(150,20,26,.92);color:#fff;font:11px/1.4 monospace;' +
      'padding:6px 9px;border-radius:4px;max-width:64ch;pointer-events:none';
    document.body.appendChild(el);
  }
  el.textContent = msg;
}

/* GPU context loss is a real, recurring cause of "the picture stopped
   following me" on integrated graphics — handle it instead of dying. */
cv.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  errChip('GPU újraindult — helyreállítás…');
});
cv.addEventListener('webglcontextrestored', () => {
  resize(); applyZone();
  errChip('GPU helyreállt');
  setTimeout(() => { const el = document.getElementById('errChip'); if (el) el.remove(); }, 2500);
});

const hemi = new THREE.HemisphereLight(0xC6D4FF, 0x1A1A26, 0.88);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xFFFBF0, 1.45);
key.position.set(-3.4, 7.0, 5.0);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
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
/* rim near horizontal: a high blue rim mixed with the warm key tints the
   road's white dashes pink */
const rim = new THREE.DirectionalLight(0x3B6BFF, 1.15);
rim.position.set(2.8, 0.5, -6);
scene.add(rim);
const bounce = new THREE.PointLight(0xFFE500, 0.30, 8, 2);
bounce.position.set(0, 0.5, 1.2);
scene.add(bounce);

/* =========================================================
   TOON PIPELINE — flat colour + ink, like the source meme
   ========================================================= */
const gradientMap = new THREE.DataTexture(new Uint8Array([95, 160, 255]), 3, 1, THREE.RedFormat);
gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
gradientMap.needsUpdate = true;
const toon = (color, opts = {}) => new THREE.MeshToonMaterial({ color, gradientMap, ...opts });
const INK = new THREE.MeshBasicMaterial({ color: 0x0A0A0C, side: THREE.BackSide });
/* Inverted hull outline for RIGID meshes (a scaled hull cannot follow bones,
   so the skinned body relies on the rim light instead). */
function inkOutline(mesh, grow = 1.05) {
  const hull = new THREE.Mesh(mesh.geometry, INK);
  hull.scale.setScalar(grow);
  hull.userData.isOutline = true;
  hull.castShadow = false;
  mesh.add(hull);
  return hull;
}
/* Swap a loaded model's materials to the shared toon look. */
function toToon(root, tint) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const olds = Array.isArray(o.material) ? o.material : [o.material];
    const news = olds.map(m => {
      const t = new THREE.MeshToonMaterial({
        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
        map: m.map || null, gradientMap
      });
      if (tint) t.color.lerp(new THREE.Color(tint.color), tint.k);
      return t;
    });
    o.material = Array.isArray(o.material) ? news : news[0];
  });
}

/* =========================================================
   CANVAS TEXTURE HELPERS
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
    g.font = `900 ${Math.round(h * 0.52)}px "Archivo Black", Impact, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = h * 0.10; g.strokeStyle = 'rgba(10,10,12,.9)'; g.lineJoin = 'round';
    g.strokeText(text, w / 2, h / 2);
    g.fillStyle = fg; g.fillText(text, w / 2, h / 2);
  });
}

/* =========================================================
   SKY / STARS / SUN
   ========================================================= */
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
const sunTex = cvsTex(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w/2, h/2, 2, w/2, h/2, w/2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,229,0,.55)');
  r.addColorStop(1, 'rgba(255,229,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-out';
  for (let y = 66; y < h; y += 13) g.fillRect(0, y, w, 3 + (y - 60) * 0.06);
});
const sun = new THREE.Sprite(new THREE.SpriteMaterial({
  map:sunTex, transparent:true, depthWrite:false, fog:false, blending:THREE.AdditiveBlending
}));
sun.scale.set(46, 46, 1);
sun.position.set(0, 5.5, -84);
scene.add(sun);

/* =========================================================
   ROAD / RAILS / KERBS / LAMPS
   ========================================================= */
const ROAD_W = ROAD_HALF * 2 * S;
const ROAD_LEN = 64;
const TILE = 2;

const roadTex = cvsTex(512, 512, (g, w, h) => {
  g.fillStyle = '#33343F'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random()*0.05})`;
    g.fillRect(Math.random()*w, Math.random()*h, 2, 2);
  }
  const lx = (LANE_W / 2) / (ROAD_HALF * 2);
  [0.5 - lx, 0.5 + lx].forEach(fx => {
    g.fillStyle = 'rgba(245,243,236,.80)';
    for (let y = 0; y < h; y += 128) g.fillRect(fx * w - 5, y, 10, 76);
  });
  g.fillStyle = 'rgba(245,243,236,.30)';
  g.fillRect(6, 0, 5, h); g.fillRect(w - 11, 0, 5, h);
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

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(190, 190),
  new THREE.MeshStandardMaterial({ color:0x0C0D16, roughness:1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.03, -40);
scene.add(ground);

/* kerbs — physically streaming segments; a moving mesh cannot get its
   direction wrong the way a UV offset can */
const kerbYellow = toon(0xFFD500);
const kerbBlack  = toon(0x111116);
const KERB_LEN = 3.4, KERB_N = 18;
const kerbGeo = new THREE.BoxGeometry(0.26, 0.30, KERB_LEN);
const kerbs = [];
for (let i = 0; i < KERB_N * 2; i++) {
  const side = i % 2 ? 1 : -1;
  const idx = Math.floor(i / 2);
  const m = new THREE.Mesh(kerbGeo, idx % 2 ? kerbYellow : kerbBlack);
  m.position.set(side * (ROAD_W / 2 + 0.13), 0.15, -idx * KERB_LEN + 12);
  scene.add(m);
  kerbs.push(m);
}

/* neon edge rails — bloom fuel */
const railMat = new THREE.MeshBasicMaterial({ color: 0xFFE500 });
[-1, 1].forEach(sd => {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, ROAD_LEN), railMat);
  rail.position.set(sd * (ROAD_W / 2 - 0.06), 0.015, road.position.z);
  scene.add(rail);
});

/* roadside lamps */
const lampGlows = [0xFFE9A0, 0x8FE8FF, 0xFF9AD5].map(c => new THREE.MeshBasicMaterial({ color:c }));
const lampPostMat = new THREE.MeshStandardMaterial({ color:0x22242E, roughness:0.6, metalness:0.4 });
const LAMP_GAP = 9;
const lamps = [];
for (let i = 0; i < 22; i++) {
  const side = i % 2 ? 1 : -1;
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 3.2, 10), lampPostMat);
  post.position.y = 1.6; g.add(post);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.08), lampPostMat);
  arm.position.set(-side * 0.34, 3.16, 0); g.add(arm);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.24),
    lampGlows[Math.floor(i / 2) % lampGlows.length]);   // warm / cyan / pink streets
  head.position.set(-side * 0.62, 3.08, 0); g.add(head);
  g.position.set(side * (ROAD_HALF * S + 0.75), 0, -Math.floor(i / 2) * LAMP_GAP);
  scene.add(g);
  lamps.push(g);
}

/* =========================================================
   ASSET LOADING
   ========================================================= */
const loader = new GLTFLoader();
const loadGlb = url => new Promise((res, rej) => loader.load(url, res, undefined, rej));

const ASSET_FILES = {
  character: 'assets/game/character.glb',
  wagon:     'assets/game/train_wagon.glb',
  bld1: 'assets/game/skyscraper_a.glb',
  bld2: 'assets/game/skyscraper_b.glb',
  bld3: 'assets/game/building_large_a.glb',
  bld4: 'assets/game/building_large_b.glb',
  bld5: 'assets/game/building_big_q.glb',
  bld6: 'assets/game/building_low.glb',
  bld7: 'assets/game/building_small_q.glb'
};
const ASSETS = {};
let assetsReady = false;

/* character rig handles, filled by setupCharacter() */
const bull = new THREE.Group();               // world wrapper: position/bank/squash
scene.add(bull);
let mixer = null;
const actions = {};                            // Idle / Run / Roll / Death
let currentAction = null;
const bones = {};                              // Head / UpperLeg.L ...
const BONE_NAMES = ['Head','UpperLegL','UpperLegR','LowerLegL','LowerLegR',
                    'UpperArmL','UpperArmR','LowerArmL','LowerArmR','Hips'];

function findClip(gltf, name) {
  return gltf.animations.find(a => a.name === name || a.name.endsWith('|' + name));
}
function playAction(name, fade = 0.14, opts = {}) {
  const next = actions[name];
  if (!next || currentAction === next) return next;
  next.reset();
  if (opts.once) { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; }
  else next.setLoop(THREE.LoopRepeat, Infinity);
  if (opts.timeScale) next.timeScale = opts.timeScale;
  next.fadeIn(fade).play();
  if (currentAction) currentAction.fadeOut(fade);
  currentAction = next;
  return next;
}

/* ---------- the meme head, mounted on the Head bone ---------- */
const visorTex = cvsTex(128, 32, (g, w, h) => {
  const cols = ['#FF2D2D','#FF8A00','#FFE500','#39D353','#00C2FF','#4B4BFF','#B537F2'];
  cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * w / cols.length, 0, w / cols.length + 1, h); });
  g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(0, 0, w, h * 0.34);
});
const beanieTex = cvsTex(128, 64, (g, w, h) => {
  g.fillStyle = '#121216'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#FFC800';
  for (let i = 0; i < 10; i++) g.fillRect(i * w / 10 + 3, 0, w / 22, h * 0.66);
});
const faceTex = cvsTex(256, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  const rr = (x, y, ww, hh, r) => { g.beginPath(); g.moveTo(x + r, y);
    g.arcTo(x + ww, y, x + ww, y + hh, r); g.arcTo(x + ww, y + hh, x, y + hh, r);
    g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + ww, y, r); g.closePath(); };
  g.strokeStyle = '#E8232A'; g.lineCap = 'round'; g.lineWidth = 11;
  g.beginPath(); g.moveTo(48, 70); g.lineTo(62, 118); g.stroke();
  g.beginPath(); g.moveTo(76, 74); g.lineTo(86, 112); g.stroke();
  g.fillStyle = '#26262E'; rr(70, 74, 116, 46, 20); g.fill();
  g.strokeStyle = '#0A0A0C'; g.lineWidth = 7; rr(70, 74, 116, 46, 20); g.stroke();
  g.fillStyle = '#06060A';
  g.beginPath(); g.ellipse(104, 98, 9, 13, 0.3, 0, 7); g.fill();
  g.beginPath(); g.ellipse(152, 98, 9, 13, -0.3, 0, 7); g.fill();
  g.fillStyle = '#20070D'; rr(52, 134, 152, 92, 38); g.fill();
  g.strokeStyle = '#0A0A0C'; g.lineWidth = 9; rr(52, 134, 152, 92, 38); g.stroke();
  g.fillStyle = '#FFFDF4'; rr(62, 138, 132, 26, 9); g.fill();
  g.strokeStyle = 'rgba(10,10,12,.5)'; g.lineWidth = 3;
  for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(62 + i * 26.4, 140); g.lineTo(62 + i * 26.4, 164); g.stroke(); }
  g.fillStyle = '#FFFDF4';
  g.beginPath(); g.moveTo(66, 160); g.lineTo(92, 160); g.lineTo(79, 198); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(164, 160); g.lineTo(190, 160); g.lineTo(177, 198); g.closePath(); g.fill();
  g.fillStyle = '#E5424E';
  g.beginPath(); g.ellipse(128, 216, 40, 26, 0, Math.PI, Math.PI * 2, false); g.closePath(); g.fill();
  g.strokeStyle = '#AE2130'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(128, 196); g.lineTo(128, 224); g.stroke();
});
const MAT = {
  skin: toon(0xF0ECDF), horn: toon(0xFBF8EE), ink: toon(0x15151A),
  blue: toon(0x1B3FE8, { emissive:0x0A1650, emissiveIntensity:0.8 })
};
MAT.visor = new THREE.MeshToonMaterial({ map:visorTex, gradientMap,
  emissive:0xffffff, emissiveMap:visorTex, emissiveIntensity:0.22 });
MAT.beanie = new THREE.MeshToonMaterial({ map:beanieTex, gradientMap });

function buildBullHead() {
  const head = new THREE.Group();
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const sph = (r, m) => new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m);
  const cyl = (rt, rb, ht, m, seg = 10) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, ht, seg), m);

  const skull = box(0.50, 0.44, 0.46, MAT.skin); skull.position.y = 0.08; head.add(skull);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.42),
    new THREE.MeshToonMaterial({ map:faceTex, gradientMap, transparent:true }));
  plate.position.set(0, -0.04, -0.236);
  plate.rotation.y = Math.PI;
  plate.userData.noOutline = true;
  head.add(plate);
  // visor + beanie
  const visor = box(0.54, 0.11, 0.50, MAT.visor); visor.position.set(0, 0.13, -0.02); head.add(visor);
  const crown = box(0.53, 0.22, 0.49, MAT.beanie); crown.position.set(0, 0.30, 0); head.add(crown);
  const brim = box(0.56, 0.07, 0.52, MAT.ink); brim.position.set(0, 0.20, 0); head.add(brim);
  // horns / ears / earrings
  [-1, 1].forEach(sd => {
    const hornRoot = new THREE.Group();
    hornRoot.position.set(sd * 0.24, 0.26, 0.02);
    hornRoot.rotation.z = sd * -0.80;
    hornRoot.rotation.x = -0.20;
    head.add(hornRoot);
    const seg1 = cyl(0.068, 0.10, 0.30, MAT.horn); seg1.position.y = 0.15; hornRoot.add(seg1);
    const seg2 = cyl(0.014, 0.068, 0.28, MAT.horn);
    seg2.position.set(0, 0.42, 0); seg2.rotation.z = sd * -0.42; hornRoot.add(seg2);
    const ear = box(0.15, 0.065, 0.11, MAT.skin);
    ear.position.set(sd * 0.28, 0.02, 0.05); ear.rotation.z = sd * 0.40; head.add(ear);
    const er = sph(0.056, MAT.blue); er.position.set(sd * 0.30, -0.12, 0.06);
    er.scale.set(1, 1.4, 1);
    head.add(er);
  });
  // ink + shadows on the rigid head unit
  const meshes = [];
  head.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    if (m.userData.isOutline || m.userData.noOutline || m.material.transparent) continue;
    m.castShadow = true;
    inkOutline(m, m.geometry.type === 'BoxGeometry' ? 1.045 : 1.06);
  }
  return head;
}

function setupCharacter(gltf) {
  const model = gltf.scene;

  /* normalise: measure, then scale to a short, stocky build */
  const bbox = new THREE.Box3().setFromObject(model);
  const rawH = bbox.max.y - bbox.min.y;
  const s = 1.85 / rawH;                        // target height before widening
  const rig = new THREE.Group();
  rig.add(model);
  /* GLTF characters are authored facing +Z — straight at the chase camera.
     Flip the model so it faces down the road; the player sees its back. */
  model.rotation.y = Math.PI;
  rig.scale.set(s * 1.22, s * 0.88, s * 1.22);  // wider + shorter = gym bull
  model.position.y = -bbox.min.y;
  bull.add(rig);

  /* $SLING palette by material name; hide the human hair/eyes — the bull
     head encases the whole human head like a mascot suit */
  const TINT = {
    Skin:'#F0ECDF', Shirt:'#FFDF00', UnderShirt:'#FFDF00',
    Pants:'#1D2660', Boots:'#191920', Body:'#F0ECDF'
  };
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;                    // skinned mesh + offset bones
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const swapped = mats.map(m => {
      const hex = TINT[m.name];
      return new THREE.MeshToonMaterial({
        color: hex ? new THREE.Color(hex) : (m.color ? m.color.clone() : new THREE.Color(0xF0ECDF)),
        gradientMap
      });
    });
    o.material = Array.isArray(o.material) ? swapped : swapped[0];
    if (/Hair|Eye|Pupil/i.test(o.name)) o.visible = false;
  });

  for (const n of BONE_NAMES) bones[n] = model.getObjectByName(n) || null;

  /* mount the meme head on the Head bone, sized in world terms */
  if (bones.Head) {
    const headUnit = buildBullHead();
    /* shrink the human head FIRST, then measure: the unit is a child of this
       bone, so its compensation scale must include the shrink too */
    bones.Head.scale.setScalar(0.55);
    bones.Head.updateWorldMatrix(true, false);
    const scl = new THREE.Vector3();
    bones.Head.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scl);
    const inv = 1 / (scl.y || 1);
    headUnit.scale.setScalar(inv * 0.85);       // the meme head is HUGE
    headUnit.position.set(0, 0.12 * inv, 0.02 * inv);
    headUnit.rotation.y = Math.PI;              // face down the road, with the body
    bones.Head.add(headUnit);
  }

  /* animations */
  mixer = new THREE.AnimationMixer(model);
  for (const name of ['Idle', 'Walk', 'Run', 'Roll', 'Death']) {
    const clip = findClip(gltf, name);
    if (clip) actions[name] = mixer.clipAction(clip);
  }
  playAction('Idle', 0);
}

/* jump has no clip — pose the bones directly on top of the mixer output */
function applyJumpPose(w) {
  if (!bones.UpperLegL) return;
  const add = (b, x) => { if (bones[b]) bones[b].rotation.x += x * w; };
  add('UpperLegL', -0.95); add('LowerLegL', 1.15);
  add('UpperLegR', -0.40); add('LowerLegR', 0.85);
  add('UpperArmL', -1.30); add('UpperArmR', -1.30);
  add('LowerArmL', -0.40); add('LowerArmR', -0.40);
}

/* =========================================================
   BUILDINGS — professional CC0 models, streamed + recycled
   ========================================================= */
const buildings = [];
/* every block gets its own neon accent so the street reads as a lit city,
   not a monochrome canyon */
const ACCENTS = [0x7C4DFF, 0x00C2B8, 0xFF5FA2, 0x3D7BFF, 0xFFB03A, 0x21D07A];
function setupBuildings() {
  const keys = ['bld1','bld2','bld3','bld4','bld5','bld6','bld7'];
  const templates = keys.map(k => {
    const t = ASSETS[k].scene;
    toToon(t, { color: 0x181B2E, k: 0.18 });    // gentle night pull only
    const bb = new THREE.Box3().setFromObject(t);
    return { obj: t, h: bb.max.y - bb.min.y, w: bb.max.x - bb.min.x, minY: bb.min.y };
  });
  for (let i = 0; i < 40; i++) {
    const tpl = templates[Math.floor(Math.random() * templates.length)];
    const inst = tpl.obj.clone();
    const accent = new THREE.Color(ACCENTS[i % ACCENTS.length]);
    inst.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const tinted = mats.map(m => { const c = m.clone(); c.color.lerp(accent, 0.24); return c; });
      o.material = Array.isArray(o.material) ? tinted : tinted[0];
    });
    const targetH = 7 + Math.random() * 20;
    const s = targetH / tpl.h;
    inst.scale.setScalar(s);
    inst.position.y = -tpl.minY * s;
    const grp = new THREE.Group();
    grp.add(inst);
    const side = i % 2 ? 1 : -1;
    const halfW = (tpl.w * s) / 2;
    grp.userData.halfW = halfW;
    grp.position.set(side * (6.8 + halfW + Math.random() * 14), 0, -Math.random() * 150);
    grp.rotation.y = Math.floor(Math.random() * 4) * Math.PI / 2;
    scene.add(grp);
    buildings.push(grp);
  }
}

/* =========================================================
   OBSTACLES
   ========================================================= */
/* Eight obstacle kinds over three dodge profiles, so the reads stay learnable:
   jump  — DIP (short candle), RUG (rug-pull plate)
   slide — FUD (gantry), SEC (barrier with strobes)
   solid — BEAR (the bear), DUMP (candle tower), HANDS (wagon train),
           HANDS (wagon train), DUMP (candle tower) */
const OB = { DIP:'dip', FUD:'fud', BEAR:'bear', HANDS:'hands',
             RUG:'rug', SEC:'sec', DUMP:'dump' };

function buildDip() {
  const g = new THREE.Group();
  const h = DIP_H * S;
  /* a proper red candle: cylinder body, glowing wick */
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, h, 18), toon(0xE03038));
  body.position.y = h / 2; g.add(body);
  inkOutline(body, 1.04);
  const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8),
    new THREE.MeshBasicMaterial({ color: 0xFF6B6F }));
  wick.position.y = h + 0.21; g.add(wick);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.0, h * 0.62),
    new THREE.MeshBasicMaterial({ map:labelTex('DIP', '#C41F25', '#ffffff') }));
  face.position.set(0, h / 2, 0.63); g.add(face);
  return g;
}
function buildFud() {
  const g = new THREE.Group();
  const top = FUD_TOP * S;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.55, 0.42), toon(0x5A3FA6));
  beam.position.y = top + 0.27; g.add(beam);
  inkOutline(beam, 1.03);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.46),
    new THREE.MeshBasicMaterial({ map:labelTex('FUD', '#2A1C52', '#FFE500') }));
  face.position.set(0, top + 0.27, 0.22); g.add(face);
  // warning chevrons under the beam
  const chevTex = cvsTex(128, 32, (gg, w, h) => {
    gg.fillStyle = '#FFE500'; gg.fillRect(0, 0, w, h);
    gg.fillStyle = '#0A0A0C';
    for (let x = -h; x < w; x += 32) {
      gg.beginPath(); gg.moveTo(x, h); gg.lineTo(x + 16, 0); gg.lineTo(x + 32, h);
      gg.closePath(); gg.fill();
    }
  }, 3, 1);
  const chev = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.12),
    new THREE.MeshBasicMaterial({ map:chevTex }));
  chev.position.set(0, top - 0.06, 0.22); g.add(chev);
  [-1, 1].forEach(sd => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, top, 0.20), toon(0x221741));
    post.position.set(sd * 0.98, top / 2, 0); g.add(post);
    inkOutline(post, 1.04);
  });
  return g;
}
function buildBear() {
  /* An actual bear rearing up in the lane — the bear market itself — not a
     painted wall. Faces +Z (the player). Solid hitbox height unchanged. */
  const g = new THREE.Group();
  const H = 232 * S;                               // ≈2.1m validated solid
  const fur  = toon(0x8F1B22);
  const furD = toon(0x5E1014);
  const claw = toon(0xF5F0E2);
  const sph = (r, m) => new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m);
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

  // stubby legs
  [-1, 1].forEach(sd => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.24, 0.55, 12), furD);
    leg.position.set(sd * 0.34, 0.28, 0); g.add(leg);
  });
  // body — big rounded mass with a darker belly patch
  const body = sph(0.62, fur);
  body.scale.set(1.05, 1.25, 0.82);
  body.position.y = 1.08; g.add(body);
  inkOutline(body, 1.045);
  const bellyP = sph(0.40, furD);
  bellyP.scale.set(0.95, 1.1, 0.5);
  bellyP.position.set(0, 1.02, 0.36); g.add(bellyP);
  // arms thrown up-and-out, ready to maul
  [-1, 1].forEach(sd => {
    const arm = new THREE.Group();
    arm.position.set(sd * 0.60, 1.62, 0);
    arm.rotation.z = sd * 2.25;
    arm.rotation.x = -0.25;
    g.add(arm);
    const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.42, 6, 12), fur);
    limb.position.y = -0.30; arm.add(limb);
    inkOutline(limb, 1.06);
    const paw = sph(0.20, furD); paw.position.y = -0.62; arm.add(paw);
    for (let c = -1; c <= 1; c++) {
      const nail = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.20, 8), claw);
      nail.position.set(c * 0.10, -0.80, 0.02);
      nail.rotation.x = Math.PI;
      arm.add(nail);
    }
  });
  // head
  const head = sph(0.40, fur);
  head.position.y = 1.86; g.add(head);
  inkOutline(head, 1.05);
  [-1, 1].forEach(sd => {
    const ear = sph(0.13, furD); ear.position.set(sd * 0.28, 2.16, -0.02); g.add(ear);
  });
  const snout = box(0.30, 0.20, 0.22, furD);
  snout.position.set(0, 1.78, 0.36); g.add(snout);
  const nose = sph(0.06, toon(0x0A0A0C)); nose.position.set(0, 1.83, 0.48); g.add(nose);
  // angry eyes — tilted white slabs with pupils
  [-1, 1].forEach(sd => {
    const eye = box(0.14, 0.07, 0.03, claw);
    eye.position.set(sd * 0.15, 1.95, 0.375);
    eye.rotation.z = sd * -0.42;
    g.add(eye);
    const pup = box(0.05, 0.05, 0.032, toon(0x0A0A0C));
    pup.position.set(sd * 0.12, 1.93, 0.378);
    g.add(pup);
  });
  // open snarl with teeth
  const mouth = box(0.26, 0.10, 0.05, toon(0x20070D));
  mouth.position.set(0, 1.70, 0.42); g.add(mouth);
  const teeth = box(0.22, 0.03, 0.052, claw);
  teeth.position.set(0, 1.735, 0.421); g.add(teeth);

  // scale the whole bear so the ears top out at the validated hitbox height
  const s = H / 2.29;
  g.children.forEach(c => { c.position.multiplyScalar(s); c.scale.multiplyScalar(s); });
  return g;
}
let wagonTpl = null;
function buildHands() {
  const g = new THREE.Group();
  const h = 190 * S;
  if (wagonTpl) {
    const w = wagonTpl.obj.clone();
    w.scale.setScalar(wagonTpl.s);
    w.position.y = wagonTpl.y;
    g.add(w);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, h, 1.0), toon(0xCFC8B8));
    body.position.y = h / 2; g.add(body);
    inkOutline(body, 1.03);
  }
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.62),
    new THREE.MeshBasicMaterial({ map:labelTex('PAPER HANDS', '#9C968A', '#121216', 512, 128), transparent:false }));
  face.position.set(0, h * 0.55, 0.98); g.add(face);
  return g;
}
function setupWagon() {
  const t = ASSETS.wagon.scene;
  toToon(t, { color: 0xCFC8B8, k: 0.35 });
  const bb = new THREE.Box3().setFromObject(t);
  const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y;
  const targetH = 190 * S;                       // matches the solid hitbox
  const s = targetH / h;
  wagonTpl = { obj:t, s, y: -bb.min.y * s };
  // rotate so its length runs down the lane if it is a long model
  const d = (bb.max.z - bb.min.z);
  if (w > d) t.rotation.y = Math.PI / 2;
}

function buildRug() {
  /* rug pull: a flat dark plate with a rolled front edge — hop it */
  const g = new THREE.Group();
  const h = DIP_H * S;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.7, h * 0.55, 1.1), toon(0x4A2C6E));
  plate.position.set(0, h * 0.28, 0); g.add(plate);
  inkOutline(plate, 1.04);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.42, h * 0.42, 1.7, 14), toon(0x6E42A8));
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, h * 0.5, 0.55); g.add(roll);
  inkOutline(roll, 1.05);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.30),
    new THREE.MeshBasicMaterial({ map:labelTex('RUG', '#3A2158', '#FFB03A') }));
  face.position.set(0, h * 0.52, 0.99); g.add(face);
  return g;
}
function buildSec() {
  /* regulator barrier: plank at slide height with strobing lights */
  const g = new THREE.Group();
  const top = FUD_TOP * S;
  const plank = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.42, 0.30), toon(0x1E3A8A));
  plank.position.y = top + 0.21; g.add(plank);
  inkOutline(plank, 1.035);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.36),
    new THREE.MeshBasicMaterial({ map:labelTex('SEC', '#16295F', '#F5F3EC') }));
  face.position.set(0, top + 0.21, 0.16); g.add(face);
  [-1, 1].forEach(sd => {
    // A-frame legs
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, top + 0.05, 0.16), toon(0x101A3E));
    leg.position.set(sd * 0.92, (top + 0.05) / 2, 0);
    leg.rotation.z = sd * -0.08;
    g.add(leg);
    inkOutline(leg, 1.05);
    // strobes — pure bloom bait
    const strobe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.12),
      new THREE.MeshBasicMaterial({ color: sd < 0 ? 0xFF4A50 : 0x4FA8FF }));
    strobe.position.set(sd * 0.8, top + 0.50, 0);
    g.add(strobe);
  });
  return g;
}
function buildDump() {
  /* a tower of stacked red candles — too tall to jump, go around */
  const g = new THREE.Group();
  const H = 232 * S;
  const seg = H / 3;
  for (let i = 0; i < 3; i++) {
    const r = 0.52 - i * 0.07;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.05, seg * 0.94, 16),
      toon(i % 2 ? 0xC22730 : 0x8F1B22));
    c.position.y = seg * (i + 0.5); g.add(c);
    inkOutline(c, 1.045);
  }
  const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8),
    new THREE.MeshBasicMaterial({ color: 0xFF6B6F }));
  wick.position.y = H + 0.2; g.add(wick);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.34),
    new THREE.MeshBasicMaterial({ map:labelTex('DUMP', '#7A1016', '#ffffff') }));
  face.position.set(0, H * 0.55, 0.56); g.add(face);
  return g;
}


const OB_BUILD = { [OB.DIP]:buildDip, [OB.FUD]:buildFud, [OB.BEAR]:buildBear, [OB.HANDS]:buildHands,
                   [OB.RUG]:buildRug, [OB.SEC]:buildSec, [OB.DUMP]:buildDump };
const obPool = { dip:[], fud:[], bear:[], hands:[], rug:[], sec:[], dump:[] };
function obGet(kind) {
  const p = obPool[kind];
  let m = p.pop();
  if (!m) {
    m = OB_BUILD[kind]();
    m.traverse(o => { if (o.isMesh && !o.userData.isOutline) o.castShadow = true; });
    scene.add(m);
  }
  m.visible = true;
  return m;
}
function obFree(kind, m) { m.visible = false; obPool[kind].push(m); }

/* coins + power-ups */
const coinGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.055, 20);
const coinMat = toon(0xFFD400, { emissive:0x574400, emissiveIntensity:0.6 });
const coinPool = [];
function coinGet() {
  let m = coinPool.pop();
  if (!m) {
    m = new THREE.Mesh(coinGeo, coinMat);
    m.rotation.x = Math.PI / 2;
    inkOutline(m, 1.09);
    scene.add(m);
  }
  m.visible = true; return m;
}
function coinFree(m) { m.visible = false; coinPool.push(m); }

const puMats = {
  visor: new THREE.MeshToonMaterial({ map:visorTex, gradientMap, emissive:0xffffff, emissiveMap:visorTex, emissiveIntensity:0.35 }),
  magnet: toon(0xF5F3EC),
  x2: toon(0x12D67C, { emissive:0x04321d, emissiveIntensity:0.8 })
};
const puGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
const puPool = { visor:[], magnet:[], x2:[] };
function puGet(kind) {
  let m = puPool[kind].pop();
  if (!m) { m = new THREE.Mesh(puGeo, puMats[kind]); inkOutline(m, 1.06); scene.add(m); }
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

/* blob contact shadow + aura */
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
const aura = new THREE.Mesh(new THREE.SphereGeometry(1.05, 20, 14),
  new THREE.MeshBasicMaterial({ color:0xFFE500, transparent:true, opacity:0.0, wireframe:true }));
scene.add(aura);

/* =========================================================
   CHUNK LIBRARY + SPAWNING (validated — verbatim)
   ========================================================= */
/* same three reaction profiles as before, spread over more looks —
   bears headline the show */
const pickKind = () => {
  const r = Math.random();
  if (r < 0.18) return OB.DIP;
  if (r < 0.28) return OB.RUG;
  if (r < 0.46) return OB.FUD;
  if (r < 0.56) return OB.SEC;
  if (r < 0.87) return OB.BEAR;
  return OB.DUMP;
};
const solidKind = () => Math.random() < 0.78 ? OB.BEAR : OB.DUMP;
const mkOb = (lane, kind, z) => ({ lane, kind, z: z !== undefined ? z : G.spawnZ,
  dead:false, scored:false, mesh:null });
const mkPick = (lane, kind, z, y) => ({ lane, kind, z, y: y || 38, x:undefined, seed:Math.random()*6, mesh:null });

const COIN_MS = 118;
const JUMP_LOCK_MS = 900;
const rnd3 = () => Math.floor(Math.random() * 3);
const other = free => (free + 1 + Math.floor(Math.random() * 2)) % 3;
function coinLine(lane, at, n, y) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ lane, kind:'coin', at: at + i * COIN_MS, y: y || 62 });
  return out;
}
const CHUNKS = [
  { id:'breather', cost:0, gate:false, build(free) {
      const kinds = ['visor','magnet','x2'];
      return { obs:[], pick:[{ lane:free, kind:kinds[rnd3()], at:180, y:56 },
                             ...coinLine((free + 1) % 3, 0, 4)], len:300 };
  }},
  { id:'single', cost:1, gate:false, build(free) {
      return { obs:[{ lane:other(free), kind:pickKind(), at:0 }],
               pick:coinLine(free, 0, 5), len:0 };
  }},
  { id:'pinch', cost:1, gate:false, build(free) {
      return { obs:[{ lane:0, kind:solidKind(), at:0 }, { lane:2, kind:solidKind(), at:0 }],
               pick:coinLine(1, 0, 6), len:0 };
  }},
  { id:'double', cost:2, gate:false, build(free) {
      const obs = [];
      for (let l = 0; l < 3; l++) if (l !== free) obs.push({ lane:l, kind:pickKind(), at:0 });
      return { obs, pick:coinLine(free, 0, 6), len:0 };
  }},
  { id:'train', cost:2, gate:false, build(free) {
      // 100-unit spacing keeps hit windows contiguous (HIT_Z*2=104): one solid object
      const lane = other(free), obs = [];
      for (let i = 0; i < 3; i++) obs.push({ lane, kind:OB.HANDS, atZ: i * 100 });
      return { obs, pick:coinLine(free, 0, 7), lenZ:260 };
  }},
  { id:'gate-jump', cost:2, gate:true, build(free) {
      const obs = [];
      for (let l = 0; l < 3; l++) obs.push({ lane:l, kind:OB.DIP, at:0 });
      return { obs, pick:coinLine(free, 150, 3, 96), len:0 };
  }},
  { id:'gate-slide', cost:2, gate:true, build(free) {
      const obs = [];
      for (let l = 0; l < 3; l++) obs.push({ lane:l, kind:OB.FUD, at:0 });
      return { obs, pick:coinLine(free, 150, 3, 26), len:0 };
  }},
  { id:'slalom', cost:3, gate:false, build(free) {
      const a = rnd3(), b = (a + 1 + Math.floor(Math.random() * 2)) % 3, c = a;
      return { obs:[{ lane:a, kind:solidKind(), at:0 },
                    { lane:b, kind:solidKind(), at:460 },
                    { lane:c, kind:solidKind(), at:920 }],
               pick:[...coinLine((a + 1) % 3, 120, 3), ...coinLine((b + 1) % 3, 580, 3)],
               len:920 };
  }},
  { id:'stairs', cost:3, gate:true, build(free) {
      const obs = [], pick = [];
      for (let i = 0; i < 3; i++) {
        const l = (free + i) % 3;
        obs.push({ lane:l, kind:OB.DIP, at: i * JUMP_LOCK_MS });
        pick.push({ lane:l, kind:'coin', at: i * JUMP_LOCK_MS + 60, y:96 });
      }
      return { obs, pick, len: 2 * JUMP_LOCK_MS };
  }},
  { id:'duck-run', cost:3, gate:true, build(free) {
      const obs = [];
      for (let l = 0; l < 3; l++) obs.push({ lane:l, kind:OB.FUD, at:0 });
      obs.push({ lane:other(free), kind:OB.BEAR, at:1050 });
      return { obs, pick:coinLine(free, 120, 5, 26), len:1050 };
  }}
];
function spawnWave() {
  const metres = G.dist / 10;
  const band = metres < 260 ? 1 : metres < 750 ? 2 : 3;
  let pool = CHUNKS.filter(c => c.cost <= band && !(G.lastGate && c.gate));
  if (!pool.length) pool = CHUNKS.filter(c => !c.gate && c.cost <= 1);
  let chunk = pool[Math.floor(Math.random() * pool.length)];
  /* deep runs bias toward the denser authored chunks: draw twice, keep the
     costlier — obstacle COUNT climbs with distance, not just speed */
  if (metres > 900) {
    const alt = pool[Math.floor(Math.random() * pool.length)];
    if (alt.cost > chunk.cost) chunk = alt;
  }
  const free = rnd3();
  const built = chunk.build(free);
  const base = G.spawnZ;
  const spd = G.speed;
  built.obs.forEach(o => G.obstacles.push(
    mkOb(o.lane, o.kind, base + (o.atZ !== undefined ? o.atZ : o.at * spd))));
  built.pick.forEach(k => G.pickups.push(
    mkPick(k.lane, k.kind, base + (k.atZ !== undefined ? k.atZ : k.at * spd), k.y)));
  G.lastGate = chunk.gate;
  /* Space chunks by TIME, not distance. Distance also DENSIFIES the run: up
     to 240ms is shaved off the gap by ~2km. The hard floor protects the
     633ms jump lock — after a gate chunk the full 860ms stays; free chunks
     may pack down to 760ms (633 + 95 lead + margin). */
  const densify = Math.min(240, metres * 0.12);
  const gapMs = clamp(1480 - (spd - SPEED_START) * 780 - densify,
                      chunk.gate ? 860 : 760, 1480);
  const chunkZ = (built.lenZ || 0) + (built.len || 0) * spd;
  G.spawnZ = base + chunkZ + gapMs * spd + Math.random() * 180;
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
   INPUT — buffered, validated rules (verbatim)
   ========================================================= */
const BUFFER_MS = 130;
const buf = { jump: -1e9, slide: -1e9 };

function wouldHit(kind, p) {
  if (kind === OB.DIP || kind === OB.RUG) return p.y < DIP_CLR;
  if (kind === OB.FUD || kind === OB.SEC) return !(p.slide > 0) && p.y < FUD_TOP;
  return true;
}
function move(dir) {
  const p = G.player;
  const next = clamp(p.lane + dir, 0, 2);
  if (next === p.lane) return false;
  const blocked = G.obstacles.some(o =>
    !o.dead && o.lane === next && o.z > -112 && o.z < 142 && wouldHit(o.kind, p));
  if (blocked) {
    p.nudge = dir * 34;
    blip(140, .06, 'square', .03);
    return false;
  }
  p.lane = next;
  blip(dir > 0 ? 560 : 500, .05, 'sine', .03);
  return true;
}
function canJump() { const p = G.player; return !p.air && p.slide <= 0; }
function jump(buffered) {
  const p = G.player;
  if (!canJump()) { if (!buffered) buf.jump = G.t; return false; }
  p.vy = JUMP_V; p.air = true; G.jumps++;
  buf.jump = -1e9;
  bumpMission('jumps', 1); sfx.jump();
  return true;
}
function slide(buffered) {
  const p = G.player;
  if (p.slide > 0) { if (!buffered) buf.slide = G.t; return false; }
  if (p.air) p.vy = -JUMP_V * 0.85;
  p.slide = SLIDE_MS;
  buf.slide = -1e9;
  if (actions.Roll) {
    const a = actions.Roll;
    a.timeScale = a.getClip().duration / (SLIDE_MS / 1000);
    playAction('Roll', 0.08, { once:true, timeScale:a.timeScale });
  }
  sfx.slide();
  return true;
}
function drainBuffer() {
  if (G.t - buf.jump < BUFFER_MS && canJump()) jump(true);
  else if (G.t - buf.jump >= BUFFER_MS) buf.jump = -1e9;
  if (G.t - buf.slide < BUFFER_MS && G.player.slide <= 0) slide(true);
  else if (G.t - buf.slide >= BUFFER_MS) buf.slide = -1e9;
}

const KEYS = {
  ArrowLeft:() => move(-1), a:() => move(-1), A:() => move(-1),
  ArrowRight:() => move(1), d:() => move(1), D:() => move(1),
  ArrowUp:() => jump(), w:() => jump(), W:() => jump(), ' ':() => jump(),
  ArrowDown:() => slide(), s:() => slide(), S:() => slide()
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
   MISSIONS RUNTIME (verbatim)
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
  road.material.color.setHex(Z.road).lerp(new THREE.Color(0xffffff), 0.74);
  ground.material.color.setHex(Z.road).lerp(new THREE.Color(0x2A2C3C), 0.55);
  rim.color.setHex(Z.rim);
  sun.material.color.setHex(Z.sun);
  railMat.color.setHex(Z.sun);
}
function start() {
  if (!assetsReady) return;
  rollMissions();
  clearField();
  Object.assign(G, {
    state:'playing', speed:SPEED_START, dist:0, score:0, coins:0, mult:1,
    zone:0, nextZoneM:ZONE_M, streak:0, combo:1, lastCoinT:-1e9,
    nearMiss:0, jumps:0, powers:0, revives:upLvl('life'),
    shake:0, flash:0, hitFlash:0, landT:0, deathT:0,
    travelled:0, spawnZ:900, lastGate:false,
    wJump:0, wSlide:0
  });
  Object.assign(G.player, {
    lane:1, x:0, vx:0, y:0, vy:0, air:false, slide:0,
    nudge:0, inv:upLvl('head') * 2000, magnet:0, x2:0
  });
  buf.jump = buf.slide = -1e9;
  applyZone();
  playAction('Run', 0.2);
  musicStart();
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
  musicStop();
}
function resume() {
  if (G.state !== 'paused') return;
  G.state = 'playing'; $('ovPause').hidden = true; cv.classList.add('is-playing');
  musicStart();
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
/* crash → short dying beat with the Death clip, then the overlay */
function beginDeath() {
  musicStop();
  G.state = 'dying';
  G.deathT = DEATH_MS;
  playAction('Death', 0.10, { once:true });
  sfx.hit();
  G.shake = 1; G.hitFlash = 1;
  burst(G.player.x * S, 1.0, 0, 0xE8232A, 22, 3.6);
  cv.classList.remove('is-playing');
}
function gameOver() {
  G.state = 'over';
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
  /* share template as specified by the project owner — the link lives inside
     the text, so no separate url= param (X would append it twice) */
  const share = `Loving The Retarded Bull 🤡 🐂\n\n` +
    `Just bagged ${G.coins} in-game $sling coins in a ${fmt(dist)}m run. ` +
    `Game points only for now - P2E coming in future upgrades.\n\n` +
    `Think you can beat it?\n\n` +
    `Play Bull Run again: https://www.theslingbull.fun/game`;
  $('oShare').href = 'https://x.com/intent/tweet?text=' + encodeURIComponent(share);
  $('hud').hidden = true;
  $('ovOver').hidden = false;
  refreshMenus();
}
function revive() {
  if (G.revives <= 0) return;
  G.revives--;
  for (let i = G.obstacles.length - 1; i >= 0; i--) {
    const o = G.obstacles[i];
    if (o.z <= 800) { if (o.mesh) obFree(o.kind, o.mesh); G.obstacles.splice(i, 1); }
  }
  const p = G.player;
  p.y = 0; p.vy = 0; p.air = false; p.slide = 0; p.inv = 2800;
  G.state = 'playing';
  playAction('Run', 0.2);
  musicStart();
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
  musicStop();
  G.state = 'idle';
  ['ovOver','ovPause','ovShop','ovHelp','ovScores'].forEach(id => $(id).hidden = true);
  $('ovStart').hidden = false;
  $('hud').hidden = true;
  $('pad').classList.remove('is-on');
  $('cornerBR').classList.remove('is-hidden');
  G.zone = 0; applyZone();
  clearField();
  seedIdle();
  playAction('Run', 0.3);
  refreshMenus();
  if (!G.raf) G.raf = requestAnimationFrame(loop);
}

/* =========================================================
   UPDATE (validated core — verbatim except the dying branch)
   ========================================================= */
function update(dt) {
  const p = G.player;

  if (G.state === 'dying') {
    G.deathT -= dt;
    G.hitFlash = Math.max(0, G.hitFlash - dt * 0.003);
    G.shake = Math.max(0, G.shake - dt * 0.004);
    if (G.deathT <= 0) gameOver();
    return;
  }

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

  drainBuffer();

  const prevX = p.x;
  p.x = damp(p.x, LANES[p.lane], 15, dt);   // snappier strafe
  p.vx = dt > 0 ? (p.x - prevX) / dt : 0;
  p.nudge = damp(p.nudge, 0, 9, dt);

  if (p.air) {
    p.vy -= GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) {
      p.y = 0; p.vy = 0; p.air = false; G.landT = 160;
      burst(p.x * S, 0.06, 0.1, 0xFFE500, 8, 1.8);
    }
  }
  if (p.slide > 0) {
    p.slide -= dt;
    if (p.slide <= 0 && G.state === 'playing') playAction('Run', 0.16);
  }

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
        beginDeath();
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
   CHARACTER ANIMATION DRIVER
   ========================================================= */
function poseBull(dt) {
  const p = G.player;

  G.wJump  = damp(G.wJump,  p.air ? 1 : 0,      14, dt);
  G.wSlide = damp(G.wSlide, p.slide > 0 ? 1 : 0, 18, dt);

  if (mixer) {
    // run cadence follows ground speed so the feet never skate
    if (actions.Run && currentAction === actions.Run)
      actions.Run.timeScale = 1.42 * (G.speed / SPEED_START);   // sprint, not jog
    mixer.update(dt / 1000);
    // manual jump pose layered over the mixer (the pack has no jump clip)
    if (G.wJump > 0.02) applyJumpPose(G.wJump);
  }

  /* world placement — bank INTO the move, face INTO the move.
     rotation.y sign: the bull faces -Z, Ry(θ) sends that heading to
     x = -sinθ, so facing the travel direction needs θ = -strafe·k. */
  const strafe = G.state === 'playing' ? clamp((p.vx || 0) * 1.05, -1, 1) : 0;
  const px = (p.x + p.nudge) * S;
  bull.position.x = px;
  bull.position.y = p.y * S;
  bull.rotation.z = damp(bull.rotation.z, -strafe * 0.26 - (p.nudge * S) * 0.5, 12, dt);
  bull.rotation.y = damp(bull.rotation.y, -strafe * 0.40, 11, dt);

  // squash on landing, stretch on take-off
  let sq = 0;
  if (G.landT > 0) sq = -Math.sin((1 - G.landT / 160) * Math.PI) * 0.12;
  else if (p.air && p.vy > 0.35) sq = 0.08;
  bull.scale.set(1 - sq * 0.6, 1 + sq, 1 - sq * 0.6);

  blob.position.set(px, 0.012, 0);
  const sc = clamp(1 - p.y * S * 0.42, 0.42, 1);
  blob.scale.set(sc * 0.8, sc * 0.8 * (G.wSlide > 0.5 ? 1.25 : 1), 1);
  blob.material.opacity = 0.22 * sc;

  aura.visible = p.inv > 0;
  if (aura.visible) {
    aura.position.set(px, 0.9 + p.y * S, 0);
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

  /* The world-streaming half is fenced SEPARATELY from the camera: the
     recurring "picture slid sideways" screenshots show a live HUD with a
     stale camera, which is exactly what a fault repeating inside this
     section produces — it must never be able to starve the camera update
     or the present() call that follow it. */
  try {
    syncStream(dt);
  } catch (e) {
    if (!frameErrLogged) {
      frameErrLogged = true;
      console.error('world-stream error (game continues):', e);
      errChip('Játékhiba elnyelve: ' + (e && e.message ? e.message : e));
    }
  }

  /* chase cam: STATELESS lateral follow — computed fresh from the player
     every frame, so there is no persistent value that can strand. The turn's
     weight comes from the character banking, not from camera lag. */
  camRig.x = isFinite(p.x) ? p.x * S : 0;
  camRig.y = damp(camRig.y, 3.05 + p.y * S * 0.24 - (p.slide > 0 ? 0.26 : 0), 8, dt);
  camRig.fov = damp(camRig.fov, 58 + (G.speed - SPEED_START) * 11, 3, dt);  // speed reads in the lens
  if (G.shake > 0) {
    camRig.shakeX = (Math.random() - .5) * G.shake * 0.30;
    camRig.shakeY = (Math.random() - .5) * G.shake * 0.30;
  } else { camRig.shakeX = camRig.shakeY = 0; }

  camera.fov = camRig.fov * (aspectNarrow ? 1.24 : 1);
  camera.position.set(camRig.x + camRig.shakeX, camRig.y + camRig.shakeY, 5.15);
  camera.lookAt(camRig.x, 0.50 + p.y * S * 0.40, -9.5);
  camera.updateProjectionMatrix();

  const px0 = p.x * S;
  key.position.set(px0 - 3.4, 7.0, 5.0);
  key.target.position.set(px0, 0, -6);
  bounce.position.set(px0, 0.6 + p.y * S, 1.0);
  sun.position.x = camRig.x * 0.4;
  sky.position.set(camera.position.x, 0, camera.position.z);

  renderer.toneMappingExposure = 0.98 + G.flash * 0.9;
  if (G.hitFlash > 0) {
    hemi.color.setHex(0xFF4444);
    hemi.intensity = 0.88 + G.hitFlash * 1.2;
  } else {
    hemi.color.setHex(0xC6D4FF);
    hemi.intensity = 0.88;
  }
}

function syncStream(dt) {
  const p = G.player;
  const scroll = G.travelled * S;

  /* road streams TOWARD the camera — same +z direction as the world */
  roadTex.offset.y = (scroll / TILE) % 1;

  const kerbSpan = KERB_LEN * KERB_N;
  for (const k of kerbs) {
    k.position.z += G.speed * dt * S * (G.state === 'playing' ? 1 : 0.55);
    if (k.position.z > 12 + KERB_LEN) k.position.z -= kerbSpan;
  }
  const lampSpan = LAMP_GAP * (lamps.length / 2);
  for (const L of lamps) {
    L.position.z += G.speed * dt * S * (G.state === 'playing' ? 1 : 0.55);
    if (L.position.z > 8) L.position.z -= lampSpan;
  }
  for (const b of buildings) {
    b.position.z += G.speed * dt * S * (G.state === 'playing' ? 1 : 0.55);
    if (b.position.z > 16) {
      b.position.z -= 150 + Math.random() * 30;
      b.position.x = (Math.random() > .5 ? 1 : -1) * (6.8 + (b.userData.halfW || 2) + Math.random() * 14);
    }
  }

  for (const o of G.obstacles) {
    if (o.z > Z_SPAWN + 200) continue;
    if (!o.mesh) o.mesh = obGet(o.kind);
    o.mesh.position.set(LANES[o.lane] * S, 0, -o.z * S);
    o.mesh.visible = o.z < Z_FAR + 400;
  }
  for (const k of G.pickups) {
    if (k.z > Z_SPAWN + 200) continue;
    if (!k.mesh) k.mesh = k.kind === 'coin' ? coinGet() : puGet(k.kind);
    const kx = k.x !== undefined ? k.x : LANES[k.lane];
    k.mesh.position.set(kx * S, k.y * S, -k.z * S);
    if (k.kind === 'coin') k.mesh.rotation.z += dt * 0.006;
    else { k.mesh.rotation.y += dt * 0.0022; k.mesh.rotation.x += dt * 0.0012; }
  }

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
/* The next frame is scheduled BEFORE the body runs and the body is fenced:
   if any single frame throws, the game must keep running — a dead loop leaves
   the canvas frozen on whatever frame happened to be up (often mid lane
   change, player half off-screen) while the DOM HUD stays alive, which reads
   as "the picture slid sideways and nothing works". */
let frameErrLogged = false;
const guardV = new THREE.Vector3();
let guardHits = 0;
function loop(now) {
  G.raf = requestAnimationFrame(loop);
  try {
    const raw = now - G.last;
    G.last = now;
    const dt = clamp(raw, 0, 48);  // backgrounded tab must not teleport the bull
    G.t += dt;

    if (G.state === 'playing' || G.state === 'dying') {
      update(dt);
      if (G.state === 'playing' || G.state === 'dying') drawHud(dt);
    } else {
      G.travelled += SPEED_START * dt * 0.55;
    }
    poseBull(dt);
    syncWorld(dt);

    /* Screen-space guard: verify the RESULT, not the intermediate state.
       If the player's projected position ever leaves the middle band, snap
       the camera onto the lane before presenting — whatever the cause, a
       slid view can never survive a single frame. Repeated hits surface a
       diagnostic chip so the next screenshot identifies the root cause. */
    guardV.set(bull.position.x, 1.0, 0).project(camera);
    if (!isFinite(guardV.x) || Math.abs(guardV.x) > 0.6) {
      camRig.x = isFinite(G.player.x) ? G.player.x * S : 0;
      camera.position.set(camRig.x, camRig.y || 3.05, 5.15);
      camera.lookAt(camRig.x, 0.5, -9.5);
      camera.updateProjectionMatrix();
      if (++guardHits === 40) errChip('Nézet-őr aktív · ' +
        [cv.width, cv.height, cv.clientWidth, cv.clientHeight,
         (window.devicePixelRatio || 1).toFixed(2)].join(' / '));
    }

    present();
  } catch (err) {
    if (!frameErrLogged) {
      frameErrLogged = true;
      console.error('frame error (game continues):', err);
      errChip('Játékhiba elnyelve: ' + (err && err.message ? err.message : err));
    }
  }
}

/* =========================================================
   IDLE SEED / RESIZE
   ========================================================= */
function seedIdle() {
  G.obstacles.push(mkOb(0, OB.BEAR, 900));
  G.obstacles.push(mkOb(2, OB.FUD, 1500));
  for (let i = 0; i < 6; i++) G.pickups.push(mkPick(1, 'coin', 520 + i * 150, 62));
}
let aspectNarrow = false;
function resize() {
  const w = Math.max(320, cv.clientWidth || 320);
  const h = Math.max(240, cv.clientHeight || 240);
  renderer.setPixelRatio(Math.min(composer ? 1.6 : 2, window.devicePixelRatio || 1));
  renderer.setSize(w, h, false);
  if (composer) composer.setSize(w, h);
  camera.aspect = w / h;
  aspectNarrow = w / h < 1;
  camera.fov = camRig.fov * (aspectNarrow ? 1.24 : 1);
  camera.updateProjectionMatrix();
}

/* =========================================================
   MENUS (verbatim)
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
  if (!save.sound) musicStop();
  else { blip(760, .07, 'square', .04); if (G.state === 'playing') musicStart(); }
});
syncSound();
$('bFull').addEventListener('click', () => {
  const el = document.documentElement;
  if (!document.fullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
  else (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
});
addEventListener('resize', resize);
/* window 'resize' misses layout-only size changes (browser zoom edge cases,
   panel drags, DPI switches) — observe the canvas box itself */
if ('ResizeObserver' in window) new ResizeObserver(() => resize()).observe(cv);
addEventListener('orientationchange', () => setTimeout(resize, 120));
document.addEventListener('fullscreenchange', () => setTimeout(resize, 120));
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

/* =========================================================
   BOOT — gate Play on the asset load
   ========================================================= */
const bPlay = $('bPlay');
bPlay.disabled = true;
const playLabel = bPlay.textContent;
bPlay.textContent = 'LOADING…';

applyZone();
seedIdle();
resize();
refreshMenus();
G.last = performance.now();
G.raf = requestAnimationFrame(loop);

(async () => {
  try {
    const entries = Object.entries(ASSET_FILES);
    const results = await Promise.all(entries.map(([, url]) => loadGlb(url)));
    entries.forEach(([k], i) => { ASSETS[k] = results[i]; });
    setupCharacter(ASSETS.character);
    setupWagon();
    setupBuildings();
    assetsReady = true;
    bPlay.disabled = false;
    bPlay.textContent = playLabel;
  } catch (err) {
    console.error('asset load failed', err);
    document.querySelectorAll('.ov').forEach(o => o.hidden = true);
    const ft = $('failTitle'), fm = $('failMsg');
    if (ft && fm) {
      ft.innerHTML = 'ASSETS <span class="ov__red">FAILED</span>';
      fm.textContent = 'The 3D models could not load. Check the connection and reload.';
      $('ovFail').hidden = false;
    }
  }
})();

if (/(\?|&)debug=1\b/.test(location.search)) {
  window.__BULLRUN = { G, save, THREE, scene, camera, renderer, bull, bones, actions,
    get mixer() { return mixer; },
    start, pause, resume, gameOver, revive, update, poseBull, syncWorld, spawnWave,
    move, jump, slide, resize, LANES, OB, BULL_H, HIT_Z, Z_SPAWN, ZONES, S, DEATH_MS,
    ready: () => assetsReady,
    MUSIC, musicStart, musicStop,
    render: () => present() };
}

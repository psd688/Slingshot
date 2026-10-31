// Slingshot Paintball Wall - TV Display Engine
const socket = io();

const wallCanvas = document.getElementById('wallCanvas');
const wallCtx = wallCanvas.getContext('2d');
const fxCanvas = document.getElementById('fxCanvas');
const fxCtx = fxCanvas.getContext('2d');

const aimReticle = document.getElementById('aimReticle');
const reticleLabel = document.getElementById('reticleLabel');
const laserBadge = document.getElementById('laserBadge');
const laserText = document.getElementById('laserText');
const laserTestBtn = document.getElementById('laserTestBtn');
const splatCountEl = document.getElementById('splatCount');
const connStatus = document.getElementById('connStatus');
const connText = document.getElementById('connText');
const screenFlash = document.getElementById('screenFlash');
const idleQr = document.getElementById('tvQrCode');
const idleUrl = document.getElementById('tvConnectUrl');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const clearBtn = document.getElementById('clearBtn');

let width = window.innerWidth;
let height = window.innerHeight;
let splatCount = 0;

// Aim Reticle Position Tracking with Smooth Interpolation
let reticlePos = {
  x: width / 2,
  y: height / 2,
  targetX: width / 2,
  targetY: height / 2,
  active: false
};
let reticleTimeout = null;

// Photo Collection & Grid State
// Every splash creates a photo item that stays featured for 6.5s, then glides to its grid slot
const photoGallery = [];
const FEATURED_DURATION_MS = 6500; // 6.5 seconds

// Audio Synthesizer (Web Audio API - 100% offline)
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Sound: Whoosh
function playWhooshSound() {
  initAudio();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();

  osc.type = 'sawtooth';
  filter.type = 'lowpass';
  osc.frequency.setValueAtTime(140, now);
  osc.frequency.exponentialRampToValueAtTime(550, now + 0.35);

  filter.frequency.setValueAtTime(300, now);
  filter.frequency.exponentialRampToValueAtTime(1800, now + 0.3);

  gain.gain.setValueAtTime(0.01, now);
  gain.gain.linearRampToValueAtTime(0.25, now + 0.15);
  gain.gain.linearRampToValueAtTime(0.001, now + 0.45);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + 0.5);
}

// Sound: Paintball Splat
function playSplatSound() {
  initAudio();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;

  // Sub impact thump
  const subOsc = audioCtx.createOscillator();
  const subGain = audioCtx.createGain();
  subOsc.type = 'sine';
  subOsc.frequency.setValueAtTime(180, now);
  subOsc.frequency.exponentialRampToValueAtTime(28, now + 0.28);

  subGain.gain.setValueAtTime(0.7, now);
  subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  subOsc.connect(subGain);
  subGain.connect(audioCtx.destination);
  subOsc.start(now);
  subOsc.stop(now + 0.32);

  // Noise squish
  const bufferSize = audioCtx.sampleRate * 0.3;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1200, now);
  filter.frequency.exponentialRampToValueAtTime(350, now + 0.25);
  filter.Q.value = 3;

  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.55, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.28);

  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(audioCtx.destination);

  noise.start(now);
  noise.stop(now + 0.3);
}

// Sound: Card glide whoosh when joining the grid
function playCardGlideSound() {
  initAudio();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(750, now + 0.25);

  gain.gain.setValueAtTime(0.01, now);
  gain.gain.linearRampToValueAtTime(0.08, now + 0.1);
  gain.gain.linearRampToValueAtTime(0.001, now + 0.3);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.35);
}

// Resize Canvases
function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  wallCanvas.width = width;
  wallCanvas.height = height;
  fxCanvas.width = width;
  fxCanvas.height = height;
  recalculateGridSlots();
  initBackgroundParticles();
}

window.addEventListener('resize', resize);
window.addEventListener('click', initAudio);

// -------------------------------------------------------------
// Live Background System: Blue Orb Gradient & Slow Particle Flow
// -------------------------------------------------------------
const MOLECULE_COUNT = 24;
const floatingMolecules = [];
const moleculeImg = new Image();
let moleculeLoaded = false;
moleculeImg.onload = () => {
  moleculeLoaded = true;
  for (let i = 0; i < floatingMolecules.length; i++) {
    floatingMolecules[i].updateDimensions();
  }
};
moleculeImg.src = 'assets/Molecule.png';

// Pre-load Innovation System Tricolour with Leaf Frame
const tricolourFrameImg = new Image();
let tricolourFrameLoaded = false;
tricolourFrameImg.onload = () => { tricolourFrameLoaded = true; };
tricolourFrameImg.src = 'assets/Innovation system tricolour with leaf.png';

// Large soft floating ambient bokeh light orbs for cinematic depth
const bgEnergyOrbs = [
  { relX: 0.28, relY: 0.32, radius: 220, color: 'rgba(30, 90, 245, 0.16)', speedX: 0.00028, speedY: 0.00035, phase: 0 },
  { relX: 0.74, relY: 0.65, radius: 260, color: 'rgba(56, 140, 255, 0.14)', speedX: -0.00022, speedY: 0.00030, phase: 2.1 },
  { relX: 0.52, relY: 0.48, radius: 240, color: 'rgba(96, 165, 250, 0.18)', speedX: 0.00035, speedY: -0.00025, phase: 4.2 }
];

class FloatingMolecule {
  constructor(initRandom = true) {
    this.reset(initRandom);
  }

  reset(initRandom = false) {
    // 3D Depth Layer (0 = distant background, 1 = near foreground)
    this.depth = Math.random();

    // Parallax velocity based on 3D depth: distant molecules drift slower, near ones drift faster
    const baseSpeed = 0.10 + this.depth * 0.26; // 0.10 to 0.36 px/frame (slow, calming flow)
    const driftAngle = -0.72 + (Math.random() - 0.5) * 0.38; // Upward & rightward along the satin blue highlight
    this.vx = Math.cos(driftAngle) * baseSpeed;
    this.vy = Math.sin(driftAngle) * baseSpeed;

    // Organic harmonic swaying motion
    this.swaySpeed = 0.0007 + Math.random() * 0.0005;
    this.swayPhase = Math.random() * Math.PI * 2;
    this.swayAmp = 0.22 + Math.random() * 0.28;

    // Responsive 3D Sizing:
    // Scale proportionally to viewport dimensions
    this.updateDimensions();

    // Initial positioning with generous margin for seamless wraparound
    const spawnMargin = this.baseWidth * 0.8;
    this.x = initRandom ? Math.random() * width : (Math.random() < 0.4 ? -spawnMargin : Math.random() * width);
    this.y = initRandom ? Math.random() * height : (this.x === -spawnMargin ? Math.random() * height : height + spawnMargin);

    // Transparency & Depth-of-Field Blur based on distance
    this.alpha = 0.20 + this.depth * 0.55; // Far: soft ghostly (0.20), Near: crisp (0.75)
    this.blur = this.depth < 0.30 ? 2.2 : (this.depth < 0.55 ? 1.0 : 0);

    // Instance Variation 1: Color Hue Shift & Harmonious Tints
    // Shifts produce electric cyan, deep cobalt, sapphire, teal, or violet hues
    const hueOptions = [-38, -20, 0, 18, 35, 52];
    this.hueShift = hueOptions[Math.floor(Math.random() * hueOptions.length)] + (Math.random() - 0.5) * 8;
    this.brightness = (0.88 + Math.random() * 0.32).toFixed(2);
    this.contrast = (0.95 + Math.random() * 0.22).toFixed(2);

    // Instance Variation 2: Asymmetric 4-way Orientation flip
    this.flipX = Math.random() < 0.5 ? -1 : 1;
    this.flipY = Math.random() < 0.5 ? -1 : 1;

    // Instance Variation 3: 3D Tumbling & In-plane Rotation speeds
    this.rot2D = Math.random() * Math.PI * 2;
    this.rot2DSpeed = (Math.random() - 0.5) * 0.0028; // Very slow, majestic rotation
    this.yaw = Math.random() * Math.PI * 2;
    this.yawSpeed = (Math.random() - 0.5) * 0.0042; // Yaw rotation around Y-axis
    this.pitch = Math.random() * Math.PI * 2;
    this.pitchSpeed = (Math.random() - 0.5) * 0.0035; // Pitch rotation around X-axis

    // Instance Variation 4: Atmospheric Backlight Glow
    const glowColors = [
      'rgba(56, 189, 248, 0.4)',  // Cyan highlight
      'rgba(96, 165, 250, 0.35)', // Cobalt sheen
      'rgba(129, 140, 248, 0.3)'  // Violet glow
    ];
    this.glowColor = glowColors[Math.floor(Math.random() * glowColors.length)];
  }

  updateDimensions() {
    const screenBase = Math.min(width, height) * 0.22;
    this.baseWidth = Math.max(90, screenBase * (0.40 + this.depth * 0.75));
    const aspect = (moleculeImg.naturalWidth && moleculeImg.naturalHeight)
      ? (moleculeImg.naturalHeight / moleculeImg.naturalWidth)
      : (740 / 540);
    this.baseHeight = this.baseWidth * aspect;
  }

  update(now) {
    // Gentle sine sway for fluid organic drift
    const sway = Math.sin(now * this.swaySpeed + this.swayPhase) * this.swayAmp;
    this.x += this.vx + sway;
    this.y += this.vy;

    // Continuous 3D rotation & tumbling
    this.rot2D += this.rot2DSpeed;
    this.yaw += this.yawSpeed;
    this.pitch += this.pitchSpeed;

    // Seamless edge wrapping with margin
    const margin = this.baseWidth * 1.2;
    if (this.x < -margin) this.x = width + margin * 0.4;
    if (this.x > width + margin) this.x = -margin * 0.4;
    if (this.y < -margin) this.y = height + margin * 0.4;
    if (this.y > height + margin) this.y = -margin * 0.4;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);

    // 1. In-plane rotation
    ctx.rotate(this.rot2D);

    // 2. Simulated 3D Tumbling via cosine scaling along both axes
    const cosYaw = Math.cos(this.yaw);
    const cosPitch = Math.cos(this.pitch);
    const scaleX = (Math.abs(cosYaw) * 0.68 + 0.32) * Math.sign(cosYaw) * this.flipX;
    const scaleY = (Math.abs(cosPitch) * 0.68 + 0.32) * Math.sign(cosPitch) * this.flipY;
    ctx.scale(scaleX, scaleY);

    // 3. Opacity based on 3D depth
    ctx.globalAlpha = Math.max(0.12, Math.min(0.85, this.alpha));

    // 4. Atmospheric soft depth glow
    ctx.shadowColor = this.glowColor;
    ctx.shadowBlur = 18 * this.depth;

    if (moleculeLoaded) {
      // Instance-specific filter for color shift, brightness & depth-of-field blur
      let filterStr = `hue-rotate(${this.hueShift}deg) brightness(${this.brightness}) contrast(${this.contrast})`;
      if (this.blur > 0) {
        filterStr += ` blur(${this.blur}px)`;
      }
      ctx.filter = filterStr;

      // 5. Draw 3D molecule centered
      ctx.drawImage(
        moleculeImg,
        -this.baseWidth / 2,
        -this.baseHeight / 2,
        this.baseWidth,
        this.baseHeight
      );
    } else {
      // 5b. Procedural 3D glowing molecular cluster fallback
      this.drawProceduralMolecule(ctx);
    }

    ctx.restore();
  }

  drawProceduralMolecule(ctx) {
    const r = this.baseWidth * 0.14;
    const nodes = [
      { x: 0, y: 0, rad: r * 1.25, col: '#38bdf8' },
      { x: -r * 1.6, y: -r * 1.1, rad: r * 0.9, col: '#f43f5e' },
      { x: r * 1.6, y: -r * 0.9, rad: r * 0.85, col: '#a855f7' },
      { x: r * 1.1, y: r * 1.6, rad: r * 0.95, col: '#10b981' },
      { x: -r * 1.1, y: r * 1.5, rad: r * 0.8, col: '#fbbf24' }
    ];

    ctx.lineWidth = Math.max(2, r * 0.22);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    for (let i = 1; i < nodes.length; i++) {
      ctx.beginPath();
      ctx.moveTo(nodes[0].x, nodes[0].y);
      ctx.lineTo(nodes[i].x, nodes[i].y);
      ctx.stroke();
    }

    for (const node of nodes) {
      const grad = ctx.createRadialGradient(node.x - node.rad * 0.3, node.y - node.rad * 0.3, 1, node.x, node.y, node.rad);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.4, node.col);
      grad.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function initBackgroundParticles() {
  floatingMolecules.length = 0;
  for (let i = 0; i < MOLECULE_COUNT; i++) {
    floatingMolecules.push(new FloatingMolecule(true));
  }
  // Sort once by depth so distant molecules render behind near ones
  floatingMolecules.sort((a, b) => a.depth - b.depth);
}

// Live Dynamic Blue Orb Gradient & Particle Flow Wall Background
function drawDynamicWallBackground(now) {
  wallCtx.clearRect(0, 0, width, height);

  // 1. PRIMARY ANGLED CYLINDRICAL SATIN BLUE GRADIENT
  // Matches the client's blue sphere reference: diagonal electric blue sheen over royal cobalt & deep midnight navy
  const startX = 0;
  const startY = height * 0.98;
  const endX = width;
  const endY = height * 0.02;

  // Gentle breathing shimmer on the highlight position (slow 12-second cycle)
  const shimmer = Math.sin(now * 0.0005) * 0.025;

  const grad = wallCtx.createLinearGradient(startX, startY, endX, endY);
  // Deep dark royal midnight base
  grad.addColorStop(0.00, '#010a24');
  grad.addColorStop(0.16, '#031448');
  grad.addColorStop(0.32, '#06267e');
  grad.addColorStop(0.44, '#0c3ec8');
  // Vibrant electric cobalt transition
  grad.addColorStop(Math.max(0.46, 0.51 + shimmer), '#1a64f5');
  // Brilliant luminous cyan-blue specular sheen (the bright diagonal band on the reference ball)
  grad.addColorStop(Math.min(0.64, 0.58 + shimmer), '#388bfd');
  // Deepening royal cobalt
  grad.addColorStop(0.68, '#1455eb');
  grad.addColorStop(0.80, '#072b8c');
  grad.addColorStop(0.90, '#03164d');
  grad.addColorStop(1.00, '#01081e');

  wallCtx.fillStyle = grad;
  wallCtx.fillRect(0, 0, width, height);

  // 2. SECONDARY RADIAL SATIN ILLUMINATION & SPHERICAL VIGNETTE
  // Emulates the spherical 3D surface depth and curvature of the ball
  const cx = width * 0.54 + Math.sin(now * 0.0004) * 35;
  const cy = height * 0.46 + Math.cos(now * 0.0004) * 25;
  const maxR = Math.max(width, height) * 0.85;

  const radialSphere = wallCtx.createRadialGradient(cx, cy, width * 0.06, width * 0.5, height * 0.5, maxR);
  radialSphere.addColorStop(0.0, 'rgba(56, 189, 248, 0.22)');
  radialSphere.addColorStop(0.35, 'rgba(26, 100, 245, 0.12)');
  radialSphere.addColorStop(0.70, 'rgba(2, 10, 36, 0.28)');
  radialSphere.addColorStop(1.0, 'rgba(0, 4, 16, 0.65)'); // Deep corner vignette

  wallCtx.fillStyle = radialSphere;
  wallCtx.fillRect(0, 0, width, height);

  // 3. FLOATING AMBIENT ENERGY ORBS (Soft luminous bokeh drifting in the background)
  for (const orb of bgEnergyOrbs) {
    const orbX = width * orb.relX + Math.sin(now * orb.speedX + orb.phase) * (width * 0.08);
    const orbY = height * orb.relY + Math.cos(now * orb.speedY + orb.phase) * (height * 0.06);

    const orbGrad = wallCtx.createRadialGradient(orbX, orbY, 0, orbX, orbY, orb.radius);
    orbGrad.addColorStop(0.0, orb.color);
    orbGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');

    wallCtx.fillStyle = orbGrad;
    wallCtx.beginPath();
    wallCtx.arc(orbX, orbY, orb.radius, 0, Math.PI * 2);
    wallCtx.fill();
  }

  // 4. DRAW 3D FLOWING FLOATING MOLECULES
  for (let i = 0; i < floatingMolecules.length; i++) {
    const m = floatingMolecules[i];
    m.update(now);
    m.draw(wallCtx);
  }
}

// Active Projectiles & Particles in Flight
const activeProjectiles = [];
const activeParticles = [];

class Projectile {
  constructor(targetX, targetY, color, payload) {
    this.startX = width / 2;
    this.startY = height + 60;
    this.targetX = targetX;
    this.targetY = targetY;
    this.color = color;
    this.payload = payload;

    this.progress = 0;
    this.speed = 0.048; // Flight takes ~350ms
    this.peakArcY = Math.min(this.targetY, this.startY) - 150;
    this.dead = false;
  }

  update() {
    this.progress += this.speed;
    if (this.progress >= 1) {
      this.progress = 1;
      this.dead = true;
      triggerImpact(this.targetX, this.targetY, this.color, this.payload);
    }
  }

  draw(ctx) {
    const t = this.progress;
    const currX = (1 - t) * (1 - t) * this.startX + 2 * (1 - t) * t * ((this.startX + this.targetX) / 2) + t * t * this.targetX;
    const currY = (1 - t) * (1 - t) * this.startY + 2 * (1 - t) * t * this.peakArcY + t * t * this.targetY;
    const radius = 34 * (1 - t * 0.45);

    if (Math.random() > 0.25) {
      const energySmoke = ['#38bdf8', '#60a5fa', '#ffffff', '#93c5fd'];
      const smokeCol = energySmoke[Math.floor(Math.random() * energySmoke.length)];
      activeParticles.push(new SmokeParticle(currX, currY, smokeCol));
    }

    ctx.save();
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 25;

    const ballGrad = ctx.createRadialGradient(currX - radius * 0.3, currY - radius * 0.3, radius * 0.1, currX, currY, radius);
    ballGrad.addColorStop(0, '#ffffff');
    ballGrad.addColorStop(0.35, '#38bdf8');
    ballGrad.addColorStop(0.75, '#1d4ed8');
    ballGrad.addColorStop(1, '#031448');

    ctx.beginPath();
    ctx.arc(currX, currY, radius, 0, Math.PI * 2);
    ctx.fillStyle = ballGrad;
    ctx.fill();
    ctx.restore();
  }
}

class SmokeParticle {
  constructor(x, y, color) {
    this.x = x + (Math.random() - 0.5) * 10;
    this.y = y + (Math.random() - 0.5) * 10;
    this.vx = (Math.random() - 0.5) * 1.5;
    this.vy = (Math.random() - 0.5) * 1.5;
    this.radius = Math.random() * 8 + 4;
    this.color = color;
    this.alpha = 0.6;
    this.dead = false;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.radius *= 0.94;
    this.alpha -= 0.03;
    if (this.alpha <= 0) this.dead = true;
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.alpha);
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class SplashBurstParticle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 15 + 4;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.radius = Math.random() * 9 + 3;
    const sparkCols = ['#38bdf8', '#60a5fa', '#ffffff', '#93c5fd', '#00ffaa'];
    this.color = sparkCols[Math.floor(Math.random() * sparkCols.length)];
    this.alpha = 1;
    this.gravity = 0.35;
    this.dead = false;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += this.gravity;
    this.vx *= 0.96;
    this.vy *= 0.96;
    this.alpha -= 0.007; // Lingers as paint specks for ~2.5 seconds
    if (this.alpha <= 0) this.dead = true;
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.alpha);
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// -------------------------------------------------------------
// Photo Entity System: Featured for 6.5s ➔ Smooth Animation into Grid
// -------------------------------------------------------------
class SplatPhoto {
  constructor(x, y, color, payload, isHistorical = false) {
    this.id = (payload && payload.id) ? payload.id : ('photo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
    this.splatX = x;
    this.splatY = y;
    this.currentX = x;
    this.currentY = y;
    this.color = color;
    this.name = payload.name || payload.text || 'VIP Guest';
    this.company = payload.company || '';
    this.message = payload.message || '';
    this.text = this.name;
    this.birthTime = isHistorical ? Date.now() - 10000 : Date.now();
    this.hasPlayedGlideSound = isHistorical;

    // Rolling Stream Fade & Life
    this.opacity = 1.0;
    this.departing = false;
    this.dead = false;

    // Scale & Rotation
    this.featuredScale = 1.35;
    this.gridScale = 0.68;
    this.currentScale = isHistorical ? this.gridScale : 0.2; // pops in from 0.2
    this.currentAngle = (Math.random() - 0.5) * 0.18;
    this.targetAngle = this.currentAngle;

    // State: 'featured' -> 'migrating' -> 'in_grid' -> 'departing'
    this.state = isHistorical ? 'in_grid' : 'featured';

    this.gridX = x;
    this.gridY = y;

    // Load Image
    this.img = null;
    this.imgLoaded = false;
    if (payload.image) {
      this.img = new Image();
      this.img.onload = () => { this.imgLoaded = true; };
      this.img.src = payload.image;
    }
  }

  depart() {
    if (this.departing) return;
    this.departing = true;
    this.state = 'departing';
  }

  update(now, slotIndex) {
    if (this.state === 'departing') {
      this.opacity -= 0.025; // Smooth ~40-frame fade out (~0.65s)
      this.currentScale += (0.20 - this.currentScale) * 0.08;
      if (this.opacity <= 0) {
        this.opacity = 0;
        this.dead = true;
      }
      return;
    }

    const age = now - this.birthTime;

    if (this.state === 'featured') {
      // Pop-in scale bounce
      this.currentScale += (this.featuredScale - this.currentScale) * 0.2;

      // Check if 6.5 seconds elapsed -> transition to grid!
      if (age >= FEATURED_DURATION_MS) {
        this.state = 'migrating';
        if (!this.hasPlayedGlideSound) {
          playCardGlideSound();
          this.hasPlayedGlideSound = true;
        }
      }
    } else if (this.state === 'migrating' || this.state === 'in_grid') {
      // Smooth spring lerp towards assigned grid slot
      const slot = getGridSlotPosition(slotIndex);
      this.gridX = slot.x;
      this.gridY = slot.y;

      const ease = 0.07; // Smooth animation speed
      this.currentX += (this.gridX - this.currentX) * ease;
      this.currentY += (this.gridY - this.currentY) * ease;
      this.currentScale += (this.gridScale - this.currentScale) * ease;
      this.currentAngle += (0 - this.currentAngle) * ease; // straighten up in grid

      const dist = Math.hypot(this.gridX - this.currentX, this.gridY - this.currentY);
      if (dist < 1.5 && Math.abs(this.currentScale - this.gridScale) < 0.02) {
        this.state = 'in_grid';
        this.currentX = this.gridX;
        this.currentY = this.gridY;
        this.currentScale = this.gridScale;
        this.currentAngle = 0;
      }
    }
  }

  draw(ctx, now) {
    if (!this.imgLoaded && this.img) return;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, this.opacity));
    ctx.translate(this.currentX, this.currentY);
    ctx.rotate(this.currentAngle);
    ctx.scale(this.currentScale, this.currentScale);

    // Glowing cyan/blue aura when featured on impact
    if (this.state === 'featured') {
      const pulse = 1 + Math.sin((now - this.birthTime) * 0.008) * 0.04;
      ctx.scale(pulse, pulse);
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 45;
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.65)';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 6;
    }

    // Geometry parameters:
    const frameW = 245;
    const frameH = frameW * (1117 / 1160); // ~236px
    const frameCenterY = -40;
    const photoR = 54; // Diameter 108px, centered in the tricolour atom aperture

    // 1. Draw the Innovation System Tricolour with Leaf Frame FIRST (BEHIND THE IMAGE)
    if (tricolourFrameLoaded) {
      ctx.save();
      ctx.drawImage(
        tricolourFrameImg,
        -frameW / 2,
        frameCenterY - frameH / 2,
        frameW,
        frameH
      );
      ctx.restore();
    }

    // 2. White backing disc in center aperture for photo
    ctx.beginPath();
    ctx.arc(0, frameCenterY, photoR + 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // 3. Draw User's Image ON TOP of the frame
    if (this.img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, frameCenterY, photoR, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(this.img, -photoR, frameCenterY - photoR, photoR * 2, photoR * 2);
      ctx.restore();
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, frameCenterY, photoR, 0, Math.PI * 2);
      ctx.fillStyle = '#FF671F';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((this.name && this.name[0]) ? this.name[0].toUpperCase() : '★', 0, frameCenterY);
      ctx.restore();
    }

    // 4. Double Gold/Tricolour Accent Rim around photo
    ctx.beginPath();
    ctx.arc(0, frameCenterY, photoR, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, frameCenterY, photoR - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 5. Sleek Floating Plaque with User Details (Name, Firm, Short Message)
    const cardW = 216;
    const cardH = 74;
    const cardY = frameCenterY + frameH / 2 - 25;

    ctx.save();
    // Glassmorphism dark card (NO big white box!)
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(-cardW / 2, cardY, cardW, cardH, 14);
    } else {
      ctx.rect(-cardW / 2, cardY, cardW, cardH);
    }
    ctx.fillStyle = 'rgba(3, 14, 46, 0.90)';
    ctx.fill();

    // Sleek border on the details badge
    const badgeBorderGrad = ctx.createLinearGradient(-cardW / 2, cardY, cardW / 2, cardY + cardH);
    badgeBorderGrad.addColorStop(0.0, '#38bdf8');
    badgeBorderGrad.addColorStop(0.5, '#FFFFFF');
    badgeBorderGrad.addColorStop(1.0, '#2563eb');
    ctx.strokeStyle = badgeBorderGrad;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Line 1: Name (Bold, Prominent White)
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 14px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 6;
    ctx.fillText((this.name || 'VIP GUEST').toUpperCase(), 0, cardY + 20, cardW - 16);

    // Line 2: Firm / Company Name (Saffron/Gold Tag)
    ctx.fillStyle = '#FFB020';
    ctx.font = '700 11px "Outfit", sans-serif';
    const compText = this.company ? this.company.toUpperCase() : 'PI INNOVATION PARTNER';
    ctx.fillText(compText, 0, cardY + 38, cardW - 16);

    // Line 3: Short Message (Clean italicized quote)
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '600 italic 11px "Outfit", sans-serif';
    const msgText = this.message ? `"${this.message}"` : '“An Innovation from India, to the World”';
    ctx.fillText(msgText, 0, cardY + 55, cardW - 18);

    ctx.restore();

    ctx.restore();
  }
}

// Calculate Maximum Visible Grid Slots (Always 2 Rows of up to 8 Cards = 16 Slots)
function getMaxGridSlots() {
  const cardW = 145;
  const marginX = 22;
  const availableWidth = width - 120;
  const cols = Math.min(8, Math.max(3, Math.floor(availableWidth / (cardW + marginX))));
  return cols * 2;
}

// Calculate Grid Slot Position for Array of Photos
function getGridSlotPosition(index) {
  const cardW = 145;
  const cardH = 175;
  const marginX = 22;
  const marginY = 20;

  // Header bottom boundary: top logos end around 21.5% of screen height
  // We start the grid cleanly below them at 26% height (min 245px)
  const topOffset = Math.max(245, height * 0.26);

  // Lower shelf begins comfortably below the center headline
  const lowerShelfOffset = Math.max(topOffset + cardH + 50, height * 0.58);

  const availableWidth = width - 120;
  const cols = Math.min(8, Math.max(3, Math.floor(availableWidth / (cardW + marginX))));

  const col = index % cols;
  const row = Math.floor(index / cols);

  const startX = (width - (cols * (cardW + marginX) - marginX)) / 2 + cardW / 2;

  // Row 0 sits cleanly below the top logos and above center text
  // Row 1+ sit in the lower area below the center headline
  let slotY;
  if (row === 0) {
    slotY = topOffset + cardH / 2;
  } else {
    slotY = lowerShelfOffset + cardH / 2 + (row - 1) * (cardH + marginY);
  }

  return {
    x: startX + col * (cardW + marginX),
    y: slotY
  };
}

function recalculateGridSlots() {
  let slotIdx = 0;
  photoGallery.forEach((photo) => {
    if (photo.state === 'in_grid') {
      const slot = getGridSlotPosition(slotIdx);
      photo.gridX = slot.x;
      photo.gridY = slot.y;
      slotIdx++;
    }
  });
}

// Dynamic Paint Splatter Decals (Active for 6s, then fade out smoothly)
const activeSplatters = [];

class SplatterDecal {
  constructor(x, y, color, splatStyle, birthTime = Date.now()) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.splatStyle = splatStyle;
    this.birthTime = birthTime;
    this.alpha = 1.0;
    this.dead = false;
    this.baseRadius = 230; // Huge, epic 460px+ splatter!
    this.currentScale = 0.2; // Starts small and blooms outward explosively

    // Pre-calculate dramatic organic starburst points
    this.points = [];
    const count = 22;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      // High variation for spiky, explosive liquid edges
      const spike = Math.sin(i * 3 + splatStyle) * 0.45;
      const r = this.baseRadius * (0.85 + spike + Math.random() * 0.35);
      this.points.push({
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r
      });
    }

    // Pre-calculate big juicy satellite paint droplets
    this.satellites = [];
    for (let s = 0; s < 20; s++) {
      const satAngle = Math.random() * Math.PI * 2;
      const satDist = this.baseRadius * (1.15 + Math.random() * 1.05);
      const satR = Math.random() * 26 + 8; // Big visible dots
      this.satellites.push({
        x: Math.cos(satAngle) * satDist,
        y: Math.sin(satAngle) * satDist,
        r: satR
      });
    }

    // Pre-calculate long fluid drips running down the wall
    this.drips = [];
    for (let d = 0; d < 6; d++) {
      const dripX = (Math.random() - 0.5) * this.baseRadius * 1.3;
      const dripLen = Math.random() * 130 + 50;
      const dripW = Math.random() * 14 + 6;
      this.drips.push({
        x: dripX,
        len: dripLen,
        w: dripW
      });
    }
  }

  update(now) {
    const age = now - this.birthTime;

    // Explosive spring bloom in the first 250ms
    if (this.currentScale < 1.0) {
      this.currentScale += (1.0 - this.currentScale) * 0.35;
      if (this.currentScale > 0.98) this.currentScale = 1.0;
    }

    // Full 100% solid opacity for 6.5 seconds, then slowly and gently fades out over 4.5 seconds!
    if (age > 6500) {
      const fadeProgress = (age - 6500) / 4500;
      this.alpha = Math.max(0, 1.0 - fadeProgress);
      if (this.alpha <= 0) {
        this.dead = true;
      }
    } else {
      this.alpha = 1.0;
    }
  }

  draw(ctx) {
    if (this.alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(this.x, this.y);
    ctx.scale(this.currentScale, this.currentScale);

    // Authentic Indian Tricolour Gradient (Saffron -> White -> India Green)
    const tricolorSplash = ctx.createLinearGradient(0, -this.baseRadius, 0, this.baseRadius * 1.15);
    tricolorSplash.addColorStop(0.00, '#FF671F'); // Deep Indian Saffron
    tricolorSplash.addColorStop(0.30, '#FF9933'); // Kesari Saffron
    tricolorSplash.addColorStop(0.45, '#FFFFFF'); // Clean White
    tricolorSplash.addColorStop(0.55, '#FFFFFF'); // Clean White
    tricolorSplash.addColorStop(0.70, '#138808'); // India Green
    tricolorSplash.addColorStop(1.00, '#046A38'); // Deep Emerald Green

    ctx.fillStyle = tricolorSplash;
    ctx.shadowColor = 'rgba(255, 103, 31, 0.65)';
    ctx.shadowBlur = 40 * this.alpha;

    // Organic starburst liquid splash blob
    ctx.beginPath();
    for (let i = 0; i < this.points.length; i++) {
      if (i === 0) ctx.moveTo(this.points[i].x, this.points[i].y);
      else ctx.lineTo(this.points[i].x, this.points[i].y);
    }
    ctx.closePath();
    ctx.fill();

    // Satellite droplets with matching Tricolour colors
    for (const sat of this.satellites) {
      ctx.beginPath();
      ctx.arc(sat.x, sat.y, sat.r, 0, Math.PI * 2);
      if (sat.y < -this.baseRadius * 0.25) {
        ctx.fillStyle = '#FF671F'; // Top droplets: Saffron
      } else if (sat.y > this.baseRadius * 0.25) {
        ctx.fillStyle = '#138808'; // Bottom droplets: India Green
      } else {
        ctx.fillStyle = '#FFFFFF'; // Middle droplets: White
      }
      ctx.fill();
    }

    // Liquid paint drips running down the wall (India Green with emerald glow)
    for (const drip of this.drips) {
      ctx.fillStyle = '#138808';
      ctx.beginPath();
      ctx.moveTo(drip.x - drip.w / 2, this.baseRadius * 0.45);
      ctx.lineTo(drip.x, this.baseRadius * 0.45 + drip.len);
      ctx.lineTo(drip.x + drip.w / 2, this.baseRadius * 0.45);
      ctx.fill();

      // Droplet bead at bottom of drip
      ctx.beginPath();
      ctx.arc(drip.x, this.baseRadius * 0.45 + drip.len + 6, drip.w * 0.95, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

// Impact Trigger
function triggerImpact(x, y, color, payload) {
  // Guard against duplicate impact triggers for the same photo ID
  if (payload && payload.id && photoGallery.some(p => p.id === payload.id)) {
    return;
  }

  // Flash effect
  screenFlash.classList.add('active');
  setTimeout(() => screenFlash.classList.remove('active'), 100);

  // Sound
  playSplatSound();

  // Burst Particles
  for (let i = 0; i < 50; i++) {
    activeParticles.push(new SplashBurstParticle(x, y, color));
  }

  // 1. Add New Photo to Dynamic Collection (starts featured, moves to grid after 6.5s)
  const newPhoto = new SplatPhoto(x, y, color, payload);
  photoGallery.push(newPhoto);

  splatCount = photoGallery.length;
  if (splatCountEl) splatCountEl.textContent = splatCount;
}

// Main 60 FPS FX Animation Loop
function animate() {
  const now = Date.now();

  // 0. Update & Draw Live Blue Orb Gradient & Slow Particle Flow on wallCanvas
  drawDynamicWallBackground(now);

  fxCtx.clearRect(0, 0, width, height);

  // 1. Update & Draw Dynamic Paint Splatters (smoothly fades away after 6s)
  for (let i = activeSplatters.length - 1; i >= 0; i--) {
    const s = activeSplatters[i];
    s.update(now);
    s.draw(fxCtx);
    if (s.dead) activeSplatters.splice(i, 1);
  }

  // 2. Update & Draw Dynamic Photo Gallery (Featured Photo + Animated Rolling Stream Grid)
  const maxSlots = getMaxGridSlots();

  // If active non-departing grid/migrating photos exceed capacity, depart the oldest
  const activeGridPhotos = photoGallery.filter(p => !p.departing && p.state !== 'featured');
  if (activeGridPhotos.length > maxSlots) {
    const excess = activeGridPhotos.length - maxSlots;
    for (let e = 0; e < excess; e++) {
      if (activeGridPhotos[e]) {
        activeGridPhotos[e].depart();
      }
    }
  }

  // Remove fully departed dead photos
  for (let i = photoGallery.length - 1; i >= 0; i--) {
    if (photoGallery[i].dead) {
      photoGallery.splice(i, 1);
    }
  }

  // Assign sequential slot indexes for non-departing, non-featured photos
  let currentGridSlot = 0;
  for (let i = 0; i < photoGallery.length; i++) {
    const photo = photoGallery[i];
    if (photo.state === 'featured' || photo.state === 'departing') {
      photo.update(now, 0);
    } else {
      photo.update(now, currentGridSlot);
      currentGridSlot++;
    }
    photo.draw(fxCtx, now);
  }

  // 3. Draw Smoke & Splash Explosion Particles (Overlays the photos!)
  for (let i = activeParticles.length - 1; i >= 0; i--) {
    const p = activeParticles[i];
    p.update();
    p.draw(fxCtx);
    if (p.dead) activeParticles.splice(i, 1);
  }

  // 4. Update & Draw Flying Paintball Projectiles
  for (let i = activeProjectiles.length - 1; i >= 0; i--) {
    const proj = activeProjectiles[i];
    proj.update();
    proj.draw(fxCtx);
    if (proj.dead) activeProjectiles.splice(i, 1);
  }

  // 5. Smooth Live Red Dot Laser Sight & Trajectory Guide
  if (reticlePos.active) {
    reticlePos.x += (reticlePos.targetX - reticlePos.x) * 0.18;
    reticlePos.y += (reticlePos.targetY - reticlePos.y) * 0.18;
    aimReticle.style.left = `${reticlePos.x}px`;
    aimReticle.style.top = `${reticlePos.y}px`;

    // Slingshot physical origin (bottom center of LED screen)
    const originX = width / 2;
    const originY = height;

    fxCtx.save();

    // Subtle Animated Red Laser Tracer Line
    const dashOffset = -((now * 0.04) % 24);

    // Outer Laser Beam Glow
    fxCtx.strokeStyle = 'rgba(255, 0, 51, 0.22)';
    fxCtx.lineWidth = 6;
    fxCtx.setLineDash([12, 8]);
    fxCtx.lineDashOffset = dashOffset;
    fxCtx.beginPath();
    fxCtx.moveTo(originX, originY);
    fxCtx.lineTo(reticlePos.x, reticlePos.y);
    fxCtx.stroke();

    // Inner Crisp Red Laser Beam Core
    fxCtx.strokeStyle = 'rgba(255, 100, 130, 0.65)';
    fxCtx.lineWidth = 2;
    fxCtx.setLineDash([12, 8]);
    fxCtx.lineDashOffset = dashOffset;
    fxCtx.beginPath();
    fxCtx.moveTo(originX, originY);
    fxCtx.lineTo(reticlePos.x, reticlePos.y);
    fxCtx.stroke();

    // Dynamic Wall Illumination Halo underneath the red dot
    const bloom = fxCtx.createRadialGradient(reticlePos.x, reticlePos.y, 4, reticlePos.x, reticlePos.y, 55);
    bloom.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    bloom.addColorStop(0.2, 'rgba(255, 0, 51, 0.6)');
    bloom.addColorStop(0.6, 'rgba(255, 0, 51, 0.15)');
    bloom.addColorStop(1, 'rgba(255, 0, 51, 0)');
    fxCtx.fillStyle = bloom;
    fxCtx.beginPath();
    fxCtx.arc(reticlePos.x, reticlePos.y, 55, 0, Math.PI * 2);
    fxCtx.fill();

    // Slingshot Base Emitter Glow at screen bottom
    const baseGlow = fxCtx.createRadialGradient(originX, originY, 0, originX, originY, 40);
    baseGlow.addColorStop(0, 'rgba(255, 0, 51, 0.5)');
    baseGlow.addColorStop(1, 'rgba(255, 0, 51, 0)');
    fxCtx.fillStyle = baseGlow;
    fxCtx.beginPath();
    fxCtx.arc(originX, originY, 40, 0, Math.PI * 2);
    fxCtx.fill();

    fxCtx.restore();
  }

  requestAnimationFrame(animate);
}

// Laser State Manager
function setLaserActive(active) {
  reticlePos.active = active;
  if (active) {
    aimReticle.classList.add('active');
    if (laserBadge) laserBadge.classList.add('active');
    if (laserText) laserText.textContent = 'LIVE AIMING';
  } else {
    aimReticle.classList.remove('active');
    if (laserBadge) laserBadge.classList.remove('active');
    if (laserText) laserText.textContent = 'STANDBY';
  }
}

// Operator Red Dot Test Mode
let isTestLaserActive = false;

function toggleTestLaser() {
  isTestLaserActive = !isTestLaserActive;
  if (isTestLaserActive) {
    setLaserActive(true);
    if (laserText) laserText.textContent = 'TEST MODE';
    if (laserTestBtn) {
      laserTestBtn.style.background = 'rgba(255, 0, 51, 0.4)';
      laserTestBtn.style.borderColor = '#ff0033';
    }
  } else {
    setLaserActive(false);
    if (laserTestBtn) {
      laserTestBtn.style.background = '';
      laserTestBtn.style.borderColor = '';
    }
  }
}

if (laserTestBtn) {
  laserTestBtn.addEventListener('click', () => {
    initAudio();
    toggleTestLaser();
  });
}

// Press 'L' to toggle live red dot test mode on TV
window.addEventListener('keydown', (e) => {
  if (e.key === 'l' || e.key === 'L') {
    initAudio();
    toggleTestLaser();
  }
});

// Mouse movement on TV in test mode tracks red dot
window.addEventListener('mousemove', (e) => {
  if (isTestLaserActive) {
    reticlePos.targetX = Math.max(50, Math.min(width - 50, e.clientX));
    reticlePos.targetY = Math.max(height * 0.22, Math.min(height - 50, e.clientY));
  }
});

// Socket Event Handlers
socket.on('connect', () => {
  if (connStatus) connStatus.querySelector('.status-dot')?.classList.add('online');
  if (connText) connText.textContent = 'ONLINE';
});

socket.on('disconnect', () => {
  if (connStatus) connStatus.querySelector('.status-dot')?.classList.remove('online');
  if (connText) connText.textContent = 'OFFLINE';
  setLaserActive(false);
});

// Real-time Aim Updates from Slingshot Phone
socket.on('aim_update', (data) => {
  setLaserActive(true);

  // Convert normalized [0..1] coordinates to screen pixels with upper ceiling limit
  if (typeof data.x === 'number' && typeof data.y === 'number') {
    const minY = height * 0.22; // Upper ceiling limit: stops aim from entering header/logos
    const maxY = height - 50;
    reticlePos.targetX = Math.max(50, Math.min(width - 50, data.x * width));
    reticlePos.targetY = Math.max(minY, Math.min(maxY, data.y * height));
  }

  if (laserText) laserText.textContent = 'LIVE AIMING';

  clearTimeout(reticleTimeout);
  reticleTimeout = setTimeout(() => {
    if (!isTestLaserActive) {
      setLaserActive(false);
    }
  }, 3500);
});

// Phone State Updates (armed vs idle/fired)
socket.on('phone_state_update', (state) => {
  if (state === 'armed') {
    setLaserActive(true);
    if (laserText) laserText.textContent = 'ARMED & AIMING';
  } else if (state === 'idle' || state === 'fired') {
    if (!isTestLaserActive) {
      setTimeout(() => {
        setLaserActive(false);
      }, 400);
    }
  }
});

socket.on('aim_calibrate', () => {
  reticlePos.targetX = width / 2;
  reticlePos.targetY = height * 0.70;
  if (reticleLabel) {
    reticleLabel.textContent = '🎯 RE-CENTERED';
    setTimeout(() => {
      reticleLabel.textContent = '🔴 LIVE SLINGSHOT AIM';
    }, 1200);
  }
});

// Impact / Launch Event
socket.on('splash_hit', (splashData) => {
  initAudio();
  playWhooshSound();

  const minY = height * 0.22; // Upper ceiling limit
  const maxY = height - 50;
  const targetPixelX = Math.max(50, Math.min(width - 50, splashData.targetX * width));
  const targetPixelY = Math.max(minY, Math.min(maxY, splashData.targetY * height));

  activeProjectiles.push(new Projectile(targetPixelX, targetPixelY, splashData.color, splashData));
});

// Restore previous history on page reload (loads latest visible capacity, keeps total counter)
socket.on('init_history', (historyList) => {
  if (Array.isArray(historyList) && historyList.length > 0) {
    const maxSlots = getMaxGridSlots();
    splatCount = historyList.length;
    if (splatCountEl) splatCountEl.textContent = splatCount;

    // Load only the most recent maxSlots photos into the visible grid
    const recentHistory = historyList.slice(-maxSlots);
    const existingIds = new Set(photoGallery.map(p => p.id));

    recentHistory.forEach((item) => {
      if (!item) return;
      const itemId = item.id;
      if (itemId && existingIds.has(itemId)) {
        return; // Already in gallery! Skip duplicate
      }
      photoGallery.push(new SplatPhoto(item.targetX * width, item.targetY * height, item.color, item, true));
      if (itemId) existingIds.add(itemId);
    });

    recalculateGridSlots();
  }
});

socket.on('board_cleared', () => {
  splatCount = 0;
  if (splatCountEl) splatCountEl.textContent = '0';
  photoGallery.length = 0;
  activeSplatters.length = 0;
});

// Fullscreen & Controls
function toggleFullscreen() {
  initAudio();
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => { });
  } else {
    document.exitFullscreen().catch(() => { });
  }
}

if (fullscreenBtn) {
  fullscreenBtn.addEventListener('click', toggleFullscreen);
}

if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    if (confirm('Clear the entire paintball wall?')) {
      socket.emit('clear_board');
    }
  });
}

// Global hotkeys for operator convenience:
// 'F' -> Fullscreen, 'C' -> Clear wall, 'L' -> Test laser
window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    toggleFullscreen();
  } else if (e.key === 'c' || e.key === 'C') {
    if (confirm('Clear the entire paintball wall?')) {
      socket.emit('clear_board');
    }
  }
});

// Double-click anywhere on the display to toggle fullscreen
window.addEventListener('dblclick', toggleFullscreen);

// Fetch Connection Info & QR Code
async function fetchInfo() {
  try {
    const res = await fetch('/api/info');
    const data = await res.json();
    if (idleQr && data.qrDataUrl) {
      idleQr.src = data.qrDataUrl;
    }
    if (idleUrl) {
      idleUrl.textContent = data.phoneHttpsUrl;
    }
  } catch (e) {
    console.error('Failed to load connection info', e);
  }
}

// Initialize
resize();
animate();
fetchInfo();

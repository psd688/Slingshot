// Slingshot Phone Controller Engine
const socket = io();

// DOM Elements
const phoneConnStatus = document.getElementById('phoneConnStatus');
const phoneConnText = document.getElementById('phoneConnText');

const stepPhoto = document.getElementById('stepPhoto');
const stepCustomize = document.getElementById('stepCustomize');
const stepArmed = document.getElementById('stepArmed');
const stepFired = document.getElementById('stepFired');

const cameraVideo = document.getElementById('cameraVideo');
const photoCaptured = document.getElementById('photoCaptured');
const photoCanvas = document.getElementById('photoCanvas');
const snapBtn = document.getElementById('snapBtn');
const retakeBtn = document.getElementById('retakeBtn');
const fileInput = document.getElementById('fileInput');
const nextToStep2Btn = document.getElementById('nextToStep2Btn');

const nameInput = document.getElementById('nameInput');
const companyInput = document.getElementById('companyInput');
const messageInput = document.getElementById('messageInput');
const tagInput = document.getElementById('tagInput'); // Fallback if present
const colorPalette = document.getElementById('colorPalette');
const backToStep1Btn = document.getElementById('backToStep1Btn');
const readyToSlingshotBtn = document.getElementById('readyToSlingshotBtn');

const slingshotPellet = document.getElementById('slingshotPellet');
const pelletPhoto = document.getElementById('pelletPhoto');
const gForceVal = document.getElementById('gForceVal');
const meterFill = document.getElementById('meterFill');
const thresholdMarker = document.getElementById('thresholdMarker');
const sensorTipText = document.getElementById('sensorTipText');
const permBtn = document.getElementById('permBtn');
const calibrateBtn = document.getElementById('calibrateBtn');
const manualFireBtn = document.getElementById('manualFireBtn');
const shootAgainBtn = document.getElementById('shootAgainBtn');

// State Variables
let currentStep = 'photo';
let capturedImageBase64 = null;
let selectedColor = '#38bdf8'; // Electric Cyan Energy
let currentName = '';
let currentCompany = '';
let currentMessage = '';
let currentTag = '';

// Check HTTP vs HTTPS
const httpWarningBanner = document.getElementById('httpWarningBanner');
const switchToHttpsLink = document.getElementById('switchToHttpsLink');
if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
  if (httpWarningBanner) httpWarningBanner.classList.remove('hidden');
  if (switchToHttpsLink) {
    switchToHttpsLink.href = `https://${window.location.hostname}:3443/phone.html`;
  }
}

// Motion Sensor State
let isArmed = false;
let hasFired = false;
let stream = null;

let prevAcc = 0;
let armTimestamp = 0;
let shockThreshold = 1.35; // Default: triggers on a slight jerk
const SENSITIVITIES = {
  low: { threshold: 2.5, marker: '65%' },
  mid: { threshold: 1.8, marker: '45%' },
  high: { threshold: 0.5, marker: '25%' }
};

// ─── Gyro Aiming State ───────────────────────────────────────────────────────
// The phone is held upright, aimed at the TV.
//   gamma  = roll/lean  left↔right  (-90 → +90°)
//   beta   = pitch up↔down           (0 → 180° when held upright toward screen)
//
// Calibration: snapshot gamma & beta when the user first holds the phone in
// aiming posture. All deltas are relative to that snapshot.
//
// Axis conventions (default, no inversion):
//   lean right (gamma ↑) → reticle moves RIGHT  (aimX ↑)
//   tilt up    (beta ↓)  → reticle moves UP      (aimY ↓)
// ─────────────────────────────────────────────────────────────────────────────

let refBeta = 75;   // calibration baseline for pitch (beta)
let refGamma = 0;    // calibration baseline for roll  (gamma)
let hasCalibrated = false;

// How many degrees of tilt = full screen travel (edge to edge).
// 50° horizontal, 60° vertical → comfortable natural range for wall targeting.
let aimDegX = 50;   // full-screen horizontal sweep in degrees
let aimDegY = 60;   // full-screen vertical   sweep in degrees

// Inversion flags (toggled by UI buttons)
let invertX = false;  // false = lean right → aim right
let invertY = false;   // true  = tilt up    → aim up   (natural for standing users)

// Vertical rest offset: 0.0 = screen center; positive moves rest point down.
let aimYOffset = 0.15;

// Output aim coords (0–1 normalised screen position)
let currentAimX = 0.5;
let currentAimY = 0.5 + 0.15; // = 0.65

// ─── Screen Aim Boundary Limits ──────────────────────────────────────────────
// MIN_AIM_Y puts an upper ceiling limit on how high the aim can travel.
// 0.22 means the reticle stops at 22% from top, keeping it cleanly below
// the top branding logos and center headline, preventing aiming off-screen.
const MIN_AIM_Y = 0.22; // Upper limit: max height is 22% from the top
const MAX_AIM_Y = 0.92; // Lower limit: bottom boundary
const MIN_AIM_X = 0.05; // Left boundary
const MAX_AIM_X = 0.95; // Right boundary

// Network throttle
let lastAimSendTime = 0;
let lastSentAimX = 0.5;
let lastSentAimY = currentAimY;

// ─── EMA smoothing (single-pass, no buffer, no deadzone) ─────────────────────
// α = 0.20 → snappy but smooth; increase toward 0.30 if it feels laggy,
//             decrease toward 0.12 if it still jitters on your device.
const AIM_EMA = 0.20;

// Sound FX for Phone
let audioCtx = null;
function initPhoneAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playTwang() {
  initPhoneAudio();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(320, now);
  osc.frequency.exponentialRampToValueAtTime(70, now + 0.2);

  gain.gain.setValueAtTime(0.4, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.25);
}

// Socket Connection Status
socket.on('connect', () => {
  phoneConnStatus.querySelector('.status-indicator').classList.add('online');
  phoneConnText.textContent = 'ONLINE';
});

socket.on('disconnect', () => {
  phoneConnStatus.querySelector('.status-indicator').classList.remove('online');
  phoneConnText.textContent = 'OFFLINE';
});

// 1. STEP NAVIGATION
function showStep(stepName) {
  currentStep = stepName;
  [stepPhoto, stepCustomize, stepArmed, stepFired].forEach(el => el.classList.remove('active'));

  if (stepName === 'photo') {
    stepPhoto.classList.add('active');
    startCamera();
  } else if (stepName === 'customize') {
    stepCustomize.classList.add('active');
    stopCamera();
  } else if (stepName === 'armed') {
    stepArmed.classList.add('active');
    stopCamera();
    armSlingshot();
  } else if (stepName === 'fired') {
    stepFired.classList.add('active');
    disarmSlingshot();
  }
}

// 2. CAMERA HANDLING
async function startCamera() {
  if (stream) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 640 }
      },
      audio: false
    });
    cameraVideo.srcObject = stream;
    cameraVideo.classList.remove('hidden');
    photoCaptured.classList.add('hidden');
    snapBtn.classList.remove('hidden');
    retakeBtn.classList.add('hidden');
    nextToStep2Btn.classList.add('hidden');
  } catch (err) {
    console.warn('Live camera stream not available, file picker available as fallback', err);
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
}

// Snap Photo
snapBtn.addEventListener('click', () => {
  initPhoneAudio();
  if (navigator.vibrate) navigator.vibrate(50);

  const size = 480;
  photoCanvas.width = size;
  photoCanvas.height = size;
  const ctx = photoCanvas.getContext('2d');

  // Mirror selfie horizontally to match preview
  ctx.translate(size, 0);
  ctx.scale(-1, 1);

  if (cameraVideo.videoWidth > 0) {
    // Crop center square
    const vw = cameraVideo.videoWidth;
    const vh = cameraVideo.videoHeight;
    const minDim = Math.min(vw, vh);
    const sx = (vw - minDim) / 2;
    const sy = (vh - minDim) / 2;
    ctx.drawImage(cameraVideo, sx, sy, minDim, minDim, 0, 0, size, size);
  } else {
    // Fallback placeholder selfie
    ctx.fillStyle = '#ff007f';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PLAYER 1', size / 2, size / 2);
  }

  capturedImageBase64 = photoCanvas.toDataURL('image/jpeg', 0.85);
  photoCaptured.src = capturedImageBase64;

  cameraVideo.classList.add('hidden');
  photoCaptured.classList.remove('hidden');
  snapBtn.classList.add('hidden');
  retakeBtn.classList.remove('hidden');
  nextToStep2Btn.classList.remove('hidden');
});

// Retake Photo
retakeBtn.addEventListener('click', () => {
  capturedImageBase64 = null;
  photoCaptured.classList.add('hidden');
  cameraVideo.classList.remove('hidden');
  snapBtn.classList.remove('hidden');
  retakeBtn.classList.add('hidden');
  nextToStep2Btn.classList.add('hidden');
  startCamera();
});

// File Upload Fallback
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      const size = 480;
      photoCanvas.width = size;
      photoCanvas.height = size;
      const ctx = photoCanvas.getContext('2d');
      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

      capturedImageBase64 = photoCanvas.toDataURL('image/jpeg', 0.85);
      photoCaptured.src = capturedImageBase64;

      cameraVideo.classList.add('hidden');
      photoCaptured.classList.remove('hidden');
      snapBtn.classList.add('hidden');
      retakeBtn.classList.remove('hidden');
      nextToStep2Btn.classList.remove('hidden');
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
});

nextToStep2Btn.addEventListener('click', () => {
  showStep('customize');
});

// 3. STEP 2: USER DETAILS & COLOR
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (messageInput) {
      messageInput.value = chip.dataset.text;
    } else if (tagInput) {
      tagInput.value = chip.dataset.text;
    }
  });
});

if (colorPalette) {
  colorPalette.addEventListener('click', (e) => {
    const swatch = e.target.closest('.color-swatch');
    if (!swatch) return;
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    selectedColor = swatch.dataset.color;
  });
}

backToStep1Btn.addEventListener('click', () => {
  showStep('photo');
});

readyToSlingshotBtn.addEventListener('click', async () => {
  currentName = nameInput ? nameInput.value.trim() : '';
  currentCompany = companyInput ? companyInput.value.trim() : '';
  currentMessage = messageInput ? messageInput.value.trim() : '';
  currentTag = currentName ? `${currentName}${currentCompany ? ' • ' + currentCompany : ''}` : (currentMessage || 'VIP GUEST');

  // On iOS, request motion permission inside this direct click gesture
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const res = await DeviceMotionEvent.requestPermission();
      if (res === 'granted' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        await DeviceOrientationEvent.requestPermission();
      }
    } catch (e) {
      console.warn('iOS motion permission error:', e);
    }
  }

  initMotionListeners();
  showStep('armed');
});

let aimInterval = null;

// 4. STEP 3: ARMED & MOTION SENSORS
function armSlingshot() {
  isArmed = true;
  hasFired = false;
  armTimestamp = Date.now();
  prevAcc = 0;
  slingshotPellet.style.borderColor = selectedColor;
  slingshotPellet.style.boxShadow = `0 0 35px ${selectedColor}`;
  if (capturedImageBase64) {
    pelletPhoto.src = capturedImageBase64;
  }

  initPhoneAudio();
  initMotionListeners();

  // Show manual permission button if iOS hasn't granted yet
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    permBtn.classList.remove('hidden');
  }

  socket.emit('phone_state', 'armed');
  currentAimX = 0.5;
  currentAimY = Math.max(MIN_AIM_Y, Math.min(MAX_AIM_Y, 0.5 + aimYOffset));
  rawAimX = 0.5;
  rawAimY = currentAimY;
  refBeta = 75;
  refGamma = 0;
  hasCalibrated = false;
  updateRadarVisual();
  sendAimSocket(true);

  if (aimInterval) clearInterval(aimInterval);
  aimInterval = setInterval(() => {
    if (isArmed && !hasFired) {
      sendAimSocket();
    }
  }, 40);
}

function disarmSlingshot() {
  isArmed = false;
  if (aimInterval) {
    clearInterval(aimInterval);
    aimInterval = null;
  }
  socket.emit('phone_state', 'idle');
}

permBtn.addEventListener('click', async () => {
  try {
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      const motionPerm = await DeviceMotionEvent.requestPermission();
      if (motionPerm === 'granted') {
        permBtn.classList.add('hidden');
      }
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      await DeviceOrientationEvent.requestPermission();
    }
    initMotionListeners();
  } catch (err) {
    console.error('Permission error', err);
  }
});

function initMotionListeners() {
  window.addEventListener('devicemotion', handleMotion, { passive: true });
  window.addEventListener('deviceorientation', handleOrientation, { passive: true });
}

let motionSampleCount = 0;

// Accelerometer Motion Shockwave Detection
function handleMotion(event) {
  if (!isArmed || hasFired) return;
  // Ignore motion during the first 350ms of arming to ignore button press tap
  if (Date.now() - armTimestamp < 350) return;

  let ax = null, ay = null, az = null;
  let hasLinearAcc = false;

  // Check linear acceleration first (most responsive & isolates hand jerk from gravity)
  if (event.acceleration && typeof event.acceleration.x === 'number') {
    ax = event.acceleration.x;
    ay = event.acceleration.y;
    az = event.acceleration.z;
    hasLinearAcc = true;
  }
  // Fallback to acceleration with gravity (supported by 100% of smartphones)
  if ((ax === null || isNaN(ax)) && event.accelerationIncludingGravity && typeof event.accelerationIncludingGravity.x === 'number') {
    ax = event.accelerationIncludingGravity.x;
    ay = event.accelerationIncludingGravity.y;
    az = event.accelerationIncludingGravity.z;
    hasLinearAcc = false;
  }

  // If both are unavailable or null
  if (ax === null || isNaN(ax)) return;

  motionSampleCount++;

  // Total instantaneous acceleration magnitude in Gs (1G ~ 9.8m/s^2)
  const totalAcc = Math.sqrt(ax * ax + ay * ay + az * az) / 9.8;

  // Rate of change between consecutive sensor samples
  const delta = prevAcc === 0 ? 0 : Math.abs(totalAcc - prevAcc);
  prevAcc = totalAcc;

  // For linear acceleration, either a sudden spike or a fast delta indicates a jerk
  const shock = hasLinearAcc ? Math.max(totalAcc, delta) : delta;

  // Update visual G-force meter
  const meterPercent = Math.min(100, (shock / 3.5) * 100);
  meterFill.style.width = `${meterPercent}%`;
  gForceVal.textContent = `${shock.toFixed(1)} G`;

  // Update status tip text
  sensorTipText.textContent = `Live: ${shock.toFixed(1)}G (Needed: ${shockThreshold}G) • Slight Jerk Enabled 🎯`;

  // Check if shockwave exceeded sensitivity threshold!
  if (shock >= shockThreshold) {
    triggerLaunch(Math.max(3.5, shock * 2.2));
  }
}

// Aim Elements
const radarScreen = document.getElementById('radarScreen');
const radarDot = document.getElementById('radarDot');
const aimTouchPad = document.getElementById('aimTouchPad');

let rawAimX = 0.5;
let rawAimY = 0.5;
let isTouchAiming = false;

function updateRadarVisual() {
  if (radarDot) {
    radarDot.style.left = `${(currentAimX * 100).toFixed(1)}%`;
    radarDot.style.top = `${(currentAimY * 100).toFixed(1)}%`;
  }
}

function sendAimSocket(force = false) {
  const now = Date.now();
  const moved = Math.abs(currentAimX - lastSentAimX) > 0.003
    || Math.abs(currentAimY - lastSentAimY) > 0.003;

  if (force || (now - lastAimSendTime > 20 && moved)) {
    lastAimSendTime = now;
    lastSentAimX = currentAimX;
    lastSentAimY = currentAimY;
    socket.emit('aim', {
      x: currentAimX,
      y: currentAimY,
      state: isArmed ? 'armed' : 'aiming'
    });
  }
}

// Touch Drag Aiming on Radar Screen or Slingshot Touchpad
function handleTouchAim(e, targetEl = radarScreen) {
  const el = targetEl || radarScreen;
  if (!el) return;
  isTouchAiming = true;
  const rect = el.getBoundingClientRect();
  const touch = e.touches ? e.touches[0] : e;
  const nx = Math.max(MIN_AIM_X, Math.min(MAX_AIM_X, (touch.clientX - rect.left) / rect.width));
  const ny = Math.max(MIN_AIM_Y, Math.min(MAX_AIM_Y, (touch.clientY - rect.top) / rect.height));

  currentAimX = nx;
  currentAimY = ny;
  rawAimX = nx;
  rawAimY = ny;

  updateRadarVisual();
  sendAimSocket(true);

  // Reset touch override after 2s of inactivity
  clearTimeout(isTouchAiming);
  isTouchAiming = setTimeout(() => { isTouchAiming = false; }, 2000);
}

if (radarScreen) {
  radarScreen.addEventListener('pointerdown', (e) => handleTouchAim(e, radarScreen));
  radarScreen.addEventListener('pointermove', (e) => {
    if (e.buttons > 0) handleTouchAim(e, radarScreen);
  });
  radarScreen.addEventListener('touchstart', (e) => handleTouchAim(e, radarScreen), { passive: true });
  radarScreen.addEventListener('touchmove', (e) => handleTouchAim(e, radarScreen), { passive: true });
}

if (aimTouchPad) {
  aimTouchPad.addEventListener('pointerdown', (e) => handleTouchAim(e, aimTouchPad));
  aimTouchPad.addEventListener('pointermove', (e) => {
    if (e.buttons > 0) handleTouchAim(e, aimTouchPad);
  });
  aimTouchPad.addEventListener('touchstart', (e) => handleTouchAim(e, aimTouchPad), { passive: true });
  aimTouchPad.addEventListener('touchmove', (e) => handleTouchAim(e, aimTouchPad), { passive: true });
}

// ─── Gyroscope Aiming ────────────────────────────────────────────────────────
// Clean single-pass design:
//   1. Auto-calibrate once when phone is in valid aiming posture (beta 50–100°)
//   2. Compute normalised deltas from calibration reference
//   3. Apply single EMA (α=0.20) — smooth without perceptible lag
//   No trimmed-mean buffer, no deadzone. Simple and predictable.
// ─────────────────────────────────────────────────────────────────────────────
function handleOrientation(event) {
  if (!isArmed || hasFired || isTouchAiming) return;

  const beta = event.beta;   // pitch: ~0–180° when phone held upright facing user
  const gamma = event.gamma;  // roll:  -90 to +90°, 0 = perfectly upright

  if (beta === null || gamma === null || isNaN(beta) || isNaN(gamma)) return;

  // ── Step 1: Auto-calibrate on first valid reading ──
  if (!hasCalibrated && beta > 50 && beta < 100) {
    refBeta = beta;
    refGamma = gamma;
    hasCalibrated = true;
  }
  if (!hasCalibrated) return;

  // ── Step 2: Delta from calibration reference ──
  const dGamma = gamma - refGamma; // degrees leaned left/right
  const dBeta = beta - refBeta;  // degrees tilted up/down

  // ── Step 3: Map to 0–1 screen space ──
  // aimDegX/Y is the FULL range (edge-to-edge), so divide by it directly.
  //   lean right → gamma ↑ → aimX ↑ (right on screen)  — unless invertX
  //   tilt up    → beta  ↓ → aimY ↓ (up on screen)     — unless invertY
  const rawX = 0.5 + (invertX ? -dGamma : dGamma) / aimDegX;
  const rawY = 0.5 + aimYOffset + (invertY ? dBeta : -dBeta) / aimDegY;

  const clampedX = Math.max(MIN_AIM_X, Math.min(MAX_AIM_X, rawX));
  const clampedY = Math.max(MIN_AIM_Y, Math.min(MAX_AIM_Y, rawY));

  // ── Step 4: Single EMA smoothing with hard ceiling clamp ──
  currentAimX += (clampedX - currentAimX) * AIM_EMA;
  currentAimY += (clampedY - currentAimY) * AIM_EMA;

  currentAimX = Math.max(MIN_AIM_X, Math.min(MAX_AIM_X, currentAimX));
  currentAimY = Math.max(MIN_AIM_Y, Math.min(MAX_AIM_Y, currentAimY));

  updateRadarVisual();
  sendAimSocket();
}

// Calibrate Center Aiming
calibrateBtn.addEventListener('click', () => {
  if (navigator.vibrate) navigator.vibrate(60);
  currentAimX = 0.5;
  currentAimY = Math.max(MIN_AIM_Y, Math.min(MAX_AIM_Y, 0.5 + aimYOffset));
  rawAimX = 0.5;
  rawAimY = currentAimY;
  updateRadarVisual();
  sendAimSocket(true);

  // Snapshot the next orientation reading as the new reference
  window.addEventListener('deviceorientation', function setRef(e) {
    if (e.beta !== null && e.gamma !== null && !isNaN(e.beta) && !isNaN(e.gamma)) {
      refBeta = Math.max(50, Math.min(100, e.beta));
      refGamma = e.gamma;
      hasCalibrated = true;
      currentAimX = 0.5;
      currentAimY = Math.max(MIN_AIM_Y, Math.min(MAX_AIM_Y, 0.5 + aimYOffset));
      updateRadarVisual();
      sendAimSocket(true);
      window.removeEventListener('deviceorientation', setRef);
    }
  }, { once: true });

  calibrateBtn.textContent = '🎯 Aim Calibrated!';
  setTimeout(() => {
    calibrateBtn.textContent = '🎯 Center Aim';
  }, 1200);
});

// Sensitivity Buttons
document.querySelectorAll('.sens-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sens-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const sensKey = btn.dataset.sens;
    shockThreshold = SENSITIVITIES[sensKey].threshold;
    thresholdMarker.style.left = SENSITIVITIES[sensKey].marker;
  });
});

// Aim Height Offset Selector Buttons
document.querySelectorAll('.aim-offset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.aim-offset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    aimYOffset = parseFloat(btn.dataset.offset) || 0.20;
    currentAimY = Math.max(MIN_AIM_Y, Math.min(MAX_AIM_Y, 0.5 + aimYOffset));
    rawAimY = currentAimY;
    updateRadarVisual();
    sendAimSocket(true);
  });
});

// Aim Motion Sweep / Sensitivity Selector Buttons
document.querySelectorAll('.aim-sens-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.aim-sens-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    aimDegX = parseFloat(btn.dataset.rangex) || 50;
    aimDegY = parseFloat(btn.dataset.rangey) || 60;
  });
});

// Invert Axis Buttons
const toggleInvertXBtn = document.getElementById('toggleInvertXBtn');
if (toggleInvertXBtn) {
  toggleInvertXBtn.addEventListener('click', () => {
    invertX = !invertX;
    toggleInvertXBtn.classList.toggle('active', invertX);
    if (navigator.vibrate) navigator.vibrate(40);
  });
}

const toggleInvertYBtn = document.getElementById('toggleInvertYBtn');
if (toggleInvertYBtn) {
  toggleInvertYBtn.addEventListener('click', () => {
    invertY = !invertY;
    toggleInvertYBtn.classList.toggle('active', invertY);
    if (navigator.vibrate) navigator.vibrate(40);
  });
}

// Launch Action Trigger
function triggerLaunch(detectedGForce = 5.0) {
  if (hasFired) return;
  hasFired = true;

  // Haptic feedback & Audio
  if (navigator.vibrate) {
    navigator.vibrate([100, 50, 200]);
  }
  playTwang();

  // Visual feedback on phone
  sensorTipText.textContent = `💥 SNAP DETECTED (${detectedGForce.toFixed(1)}G)! FIRING!`;
  sensorTipText.classList.add('snap-detected');

  // Slingshot pellet zoom-out animation
  slingshotPellet.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.25s';
  slingshotPellet.style.transform = 'translateY(-300px) scale(0.2)';
  slingshotPellet.style.opacity = '0';

  // Send Launch Payload to Server
  const payload = {
    image: capturedImageBase64,
    name: currentName || 'VIP Guest',
    company: currentCompany || '',
    message: currentMessage || '',
    text: currentTag || currentName || 'VIP GUEST',
    color: selectedColor,
    targetX: currentAimX,
    targetY: currentAimY,
    force: detectedGForce
  };

  socket.emit('launch', payload);

  // Transition to celebration screen after launch
  setTimeout(() => {
    sensorTipText.classList.remove('snap-detected');
    slingshotPellet.style.transition = '';
    slingshotPellet.style.transform = '';
    slingshotPellet.style.opacity = '';
    showStep('fired');
  }, 600);
}

// Manual Test Fire Button (Essential backup for testing or calibrating)
manualFireBtn.addEventListener('click', () => {
  triggerLaunch(5.5);
});

// Next Player / Shoot Again
shootAgainBtn.addEventListener('click', () => {
  if (nameInput) nameInput.value = '';
  if (companyInput) companyInput.value = '';
  if (messageInput) messageInput.value = '';
  currentName = '';
  currentCompany = '';
  currentMessage = '';
  currentTag = '';
  showStep('photo');
});

// Boot Controller
showStep('photo');

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MODEL_URL = new URLSearchParams(location.search).get('model') || './Dazzling_Bombul_Gold_Green.glb';
const SPIN_SECONDS = 12;
const RESUME_DELAY = 2500;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobileQuery = matchMedia('(max-width: 900px)');
const SAVE_KEY = 'vip25-viewer-custom';
const THEME_KEY = 'vip25-viewer-theme';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const retryBtn = $('retryBtn');
const loaderEl = $('loader');
const fillEl = $('fill');
const viewerEl = $('viewer');
const toastsEl = $('toasts');
const panel = $('panel');
const viewsDock = $('viewsDock');
const viewsBtn = $('viewsBtn');
const customBtn = $('customBtn');
const spinBtn = $('spinBtn');
const themeBtn = $('themeBtn');
const helpDialog = $('help');

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      return;
    }
  }
};

function fail(message) {
  statusEl.textContent = message;
  statusEl.classList.add('error');
  retryBtn.hidden = false;
}

retryBtn.addEventListener('click', () => location.reload());

function toast(message) {
  while (toastsEl.children.length >= 3) toastsEl.firstElementChild.remove();
  const element = document.createElement('div');
  element.className = 'toast';
  element.textContent = message;
  toastsEl.appendChild(element);
  requestAnimationFrame(() => element.classList.add('show'));
  setTimeout(() => {
    element.classList.remove('show');
    setTimeout(() => element.remove(), 260);
  }, 2200);
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (error) {
  fail('This browser or device cannot start WebGL, so the 3D model cannot be shown.');
  throw error;
}

renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', 'Interactive 3D logo. Drag to orbit, right drag to pan, scroll to zoom.');
viewerEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 1000);
camera.position.set(3, 2, 4);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.9;

const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
keyLight.position.set(4, 6, 5);
const greenLight = new THREE.DirectionalLight(0x65ff75, 1.1);
greenLight.position.set(-5, 2, -4);
const goldLight = new THREE.DirectionalLight(0xffb34d, 1.0);
goldLight.position.set(2, -3, 5);
const lights = new THREE.Group();
lights.add(keyLight, greenLight, goldLight);
scene.add(lights);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.screenSpacePanning = true;
controls.autoRotate = !reduceMotion;
controls.autoRotateSpeed = 60 / SPIN_SECONDS;

const home = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
let radius = 1;
let model = null;
let pivot = null;
let camTween = null;
let modelTween = null;
let wantsSpin = !reduceMotion;
let resumeTimer = 0;
let userAdjusted = false;
let lastAspect = camera.aspect;

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function scheduleResume() {
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => {
    if (wantsSpin && !camTween) {
      controls.autoRotate = true;
      setActiveView(null);
    }
  }, RESUME_DELAY);
}

controls.addEventListener('start', () => {
  userAdjusted = true;
  clearTimeout(resumeTimer);
  controls.autoRotate = false;
});

controls.addEventListener('end', scheduleResume);

function fitDistance() {
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  return (radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.08;
}

function computeHome() {
  const direction = new THREE.Vector3(0.8, 0.35, 1).normalize();
  home.target.set(0, 0, 0);
  home.pos.copy(direction).multiplyScalar(fitDistance());
}

function ensureFit() {
  if (!model) return;
  const fit = fitDistance();
  if (camTween && camTween.mode === 'spherical') {
    camTween.toRadius = Math.max(camTween.toRadius, fit);
    return;
  }
  const target = controls.target.clone();
  const offset = camera.position.clone().sub(target);
  if (offset.length() < fit) {
    camera.position.copy(target).add(offset.setLength(fit));
    controls.update();
  }
}

function flushDamping() {
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = damping;
}

function startCamTween(spec, duration) {
  clearTimeout(resumeTimer);
  controls.autoRotate = false;
  if (!camTween) flushDamping();
  controls.enabled = false;
  camTween = { ...spec, start: performance.now(), dur: reduceMotion ? 1 : duration };
}

function stopCamTween() {
  if (!camTween) return false;
  camTween = null;
  controls.enabled = true;
  return true;
}

function interruptCamTween() {
  if (stopCamTween()) {
    clearTimeout(resumeTimer);
    controls.autoRotate = false;
  }
}

addEventListener('pointerdown', (event) => {
  if (event.target === renderer.domElement) interruptCamTween();
}, { capture: true });

addEventListener('wheel', (event) => {
  if (event.target === renderer.domElement) interruptCamTween();
}, { capture: true, passive: true });

function flyToDirection(direction, target, distance, duration = 650) {
  if (!model) return;
  const fromTarget = controls.target.clone();
  const fromSpherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(fromTarget));
  const toSpherical = new THREE.Spherical().setFromVector3(direction.clone().normalize().multiplyScalar(distance));
  let thetaDelta = toSpherical.theta - fromSpherical.theta;
  thetaDelta = Math.atan2(Math.sin(thetaDelta), Math.cos(thetaDelta));
  startCamTween({
    mode: 'spherical',
    fromTarget,
    toTarget: target.clone(),
    fromRadius: fromSpherical.radius,
    toRadius: toSpherical.radius,
    fromPhi: fromSpherical.phi,
    toPhi: toSpherical.phi,
    fromTheta: fromSpherical.theta,
    toTheta: fromSpherical.theta + thetaDelta
  }, duration);
}

function updateCamTween(now) {
  if (!camTween) return false;
  const t = Math.min((now - camTween.start) / camTween.dur, 1);
  const k = easeInOutCubic(t);
  if (camTween.mode === 'linear') {
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, k);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, k);
  } else {
    const target = new THREE.Vector3().lerpVectors(camTween.fromTarget, camTween.toTarget, k);
    const spherical = new THREE.Spherical(
      THREE.MathUtils.lerp(camTween.fromRadius, camTween.toRadius, k),
      THREE.MathUtils.lerp(camTween.fromPhi, camTween.toPhi, k),
      THREE.MathUtils.lerp(camTween.fromTheta, camTween.toTheta, k)
    );
    controls.target.copy(target);
    camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(spherical));
  }
  camera.lookAt(controls.target);
  if (t >= 1) {
    camTween = null;
    controls.enabled = true;
    controls.update();
    scheduleResume();
  }
  return true;
}

const VIEWS = {
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  top: new THREE.Vector3(0, 1, 0.0001),
  bottom: new THREE.Vector3(0, -1, 0.0001),
  iso: new THREE.Vector3(0.8, 0.35, 1).normalize()
};
const VIEW_KEYS = ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso'];

function setActiveView(name) {
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.view === name));
  });
}

function showView(name) {
  if (!model || !VIEWS[name]) return;
  pauseSpin();
  userAdjusted = false;
  const distance = Math.max(camera.position.distanceTo(controls.target), fitDistance());
  flyToDirection(VIEWS[name], new THREE.Vector3(), distance, 650);
  setActiveView(name);
  if (mobileQuery.matches) closeViews();
}

function flyHome() {
  if (!model) return;
  pauseSpin();
  userAdjusted = false;
  computeHome();
  const direction = home.pos.clone().sub(home.target).normalize();
  flyToDirection(direction, home.target, home.pos.distanceTo(home.target), 750);
  setActiveView('iso');
  if (mobileQuery.matches) closeViews();
}

const AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1)
};

function rotateModel(axisName, direction) {
  if (!pivot) return;
  const axis = AXES[axisName];
  if (!axis) return;
  pauseSpin();
  const delta = new THREE.Quaternion().setFromAxisAngle(axis, (direction * Math.PI) / 2);
  const from = pivot.quaternion.clone();
  const to = delta.clone().multiply(from).normalize();
  modelTween = { from, to, start: performance.now(), dur: reduceMotion ? 1 : 480 };
  if (mobileQuery.matches) closeViews();
}

function resetModelRotation() {
  if (!pivot) return;
  pauseSpin();
  modelTween = {
    from: pivot.quaternion.clone(),
    to: new THREE.Quaternion(),
    start: performance.now(),
    dur: reduceMotion ? 1 : 480
  };
  if (mobileQuery.matches) closeViews();
}

function panView(dx, dy) {
  if (!model) return;
  userAdjusted = true;
  stopCamTween();
  clearTimeout(resumeTimer);
  controls.autoRotate = false;
  const distance = camera.position.distanceTo(controls.target);
  const step = distance * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * 0.12;
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const delta = right.multiplyScalar(dx * step).add(up.multiplyScalar(dy * step));
  const nextTarget = controls.target.clone().add(delta);
  const limit = radius * 1.3;
  if (nextTarget.length() > limit) nextTarget.setLength(limit);
  const applied = nextTarget.clone().sub(controls.target);
  controls.target.copy(nextTarget);
  camera.position.add(applied);
  controls.update();
  scheduleResume();
}

function recenterPan() {
  if (!model) return;
  userAdjusted = true;
  const fromTarget = controls.target.clone();
  if (fromTarget.lengthSq() < 1e-8) return;
  const fromPos = camera.position.clone();
  startCamTween({
    mode: 'linear',
    fromPos,
    toPos: fromPos.clone().sub(fromTarget),
    fromTarget,
    toTarget: new THREE.Vector3()
  }, 420);
}

function zoomBy(factor) {
  if (!model) return;
  userAdjusted = true;
  const target = controls.target.clone();
  const offset = camera.position.clone().sub(target);
  const distance = offset.length();
  const nextDistance = THREE.MathUtils.clamp(distance * factor, controls.minDistance, controls.maxDistance);
  if (Math.abs(nextDistance - distance) < 1e-4) return;
  flyToDirection(offset.normalize(), target, nextDistance, 320);
}

const DEFAULTS = {
  tint: '#D4AF37',
  tintAmt: 0,
  metal: null,
  rough: null,
  glow: 0,
  envInt: 0.9,
  envRot: 0,
  exposure: 1.1,
  keyInt: 1.6,
  greenCol: '#65ff75',
  greenInt: 1.1,
  goldCol: '#ffb34d',
  goldInt: 1.0,
  lightRot: 0,
  bgMode: 'theme',
  bgA: '#FFFFFF',
  bgB: '#E9F3E8'
};

const PRESETS = {
  original: {},
  gold: { tint: '#D4AF37', tintAmt: 0.85, metal: 1, rough: 0.22, envInt: 1.4, glow: 0.05 },
  emerald: { tint: '#1FAF5C', tintAmt: 0.85, metal: 0.9, rough: 0.3, envInt: 1.2, glow: 0.08, greenInt: 2 },
  chrome: { tint: '#E8EEF2', tintAmt: 1, metal: 1, rough: 0.08, envInt: 1.8, exposure: 1.0 },
  matte: { tint: '#4CAF50', tintAmt: 0.6, metal: 0.1, rough: 0.85, envInt: 0.6 },
  neon: { tint: '#2DFF6E', tintAmt: 1, metal: 0.6, rough: 0.25, envInt: 0.7, glow: 0.2, exposure: 1.1 }
};

const state = { ...DEFAULTS };
try {
  Object.assign(state, JSON.parse(store.get(SAVE_KEY) || '{}'));
} catch {
  Object.assign(state, DEFAULTS);
}

const matList = [];
let avgMetal = 0.5;
let avgRough = 0.5;
const rad = THREE.MathUtils.degToRad;
const saveState = () => store.set(SAVE_KEY, JSON.stringify(state));

function captureMaterials() {
  if (!model) return;
  const seen = new Set();
  model.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (!material || seen.has(material)) return;
      seen.add(material);
      material.userData.orig = {
        color: material.color ? material.color.clone() : null,
        metalness: material.metalness,
        roughness: material.roughness,
        emissive: material.emissive ? material.emissive.clone() : null,
        emissiveIntensity: material.emissiveIntensity
      };
      matList.push(material);
    });
  });
  const standard = matList.filter((material) => 'metalness' in material);
  if (standard.length) {
    avgMetal = standard.reduce((sum, material) => sum + material.metalness, 0) / standard.length;
    avgRough = standard.reduce((sum, material) => sum + material.roughness, 0) / standard.length;
  }
}

function applyBackground() {
  const rootStyle = document.documentElement.style;
  if (state.bgMode === 'custom') {
    rootStyle.setProperty('--bg-a', state.bgA);
    rootStyle.setProperty('--bg-b', state.bgB);
  } else {
    rootStyle.removeProperty('--bg-a');
    rootStyle.removeProperty('--bg-b');
  }
}

function applyAll() {
  scene.environmentIntensity = state.envInt;
  scene.environmentRotation.y = rad(state.envRot);
  renderer.toneMappingExposure = state.exposure;
  keyLight.intensity = state.keyInt;
  greenLight.color.set(state.greenCol);
  greenLight.intensity = state.greenInt;
  goldLight.color.set(state.goldCol);
  goldLight.intensity = state.goldInt;
  lights.rotation.y = rad(state.lightRot);

  const tint = new THREE.Color(state.tint);
  for (const material of matList) {
    const original = material.userData.orig;
    if (!original) continue;
    if (material.color && original.color) material.color.copy(original.color).lerp(tint, state.tintAmt);
    if ('metalness' in material) material.metalness = state.metal ?? original.metalness;
    if ('roughness' in material) material.roughness = state.rough ?? original.roughness;
    if (material.emissive && original.emissive) {
      if (state.glow > 0) {
        material.emissive.copy(material.color);
        material.emissiveIntensity = state.glow;
      } else {
        material.emissive.copy(original.emissive);
        material.emissiveIntensity = original.emissiveIntensity;
      }
    }
  }
  applyBackground();
}

function formatOutput(key, value) {
  if (key === 'envRot' || key === 'lightRot') return `${Math.round(value)}°`;
  return Number(value).toFixed(2);
}

function syncUI() {
  panel.querySelectorAll('[data-key]').forEach((input) => {
    const key = input.dataset.key;
    let value = state[key];
    if (key === 'metal' && value == null) value = avgMetal;
    if (key === 'rough' && value == null) value = avgRough;
    input.value = value;
    const output = panel.querySelector(`output[data-for="${key}"]`);
    if (output) output.textContent = formatOutput(key, value);
  });
}

panel.querySelectorAll('[data-key]').forEach((input) => {
  input.addEventListener('input', () => {
    const key = input.dataset.key;
    state[key] = input.type === 'range' ? parseFloat(input.value) : input.value;
    if (key === 'bgA' || key === 'bgB') state.bgMode = 'custom';
    applyAll();
    syncUI();
    saveState();
  });
});

document.querySelectorAll('[data-preset]').forEach((button) => {
  button.addEventListener('click', () => {
    const { bgMode, bgA, bgB } = state;
    Object.assign(state, DEFAULTS, PRESETS[button.dataset.preset], { bgMode, bgA, bgB });
    applyAll();
    syncUI();
    saveState();
    toast(`${button.textContent.trim()} preset applied`);
  });
});

$('bgThemeBtn').addEventListener('click', () => {
  state.bgMode = 'theme';
  applyAll();
  saveState();
  toast('Theme background applied');
});

$('resetAllBtn').addEventListener('click', () => {
  Object.assign(state, DEFAULTS);
  applyAll();
  syncUI();
  saveState();
  toast('Customization reset');
});

$('copyBtn').addEventListener('click', async () => {
  const text = JSON.stringify(state, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    toast('Settings copied to clipboard');
  } catch {
    console.log(text);
    toast('Copy failed — settings logged to console');
  }
});

function openPanel() {
  panel.classList.add('open');
  customBtn.setAttribute('aria-expanded', 'true');
  if (mobileQuery.matches) closeViews();
}

function closePanel() {
  panel.classList.remove('open');
  customBtn.setAttribute('aria-expanded', 'false');
}

function togglePanel() {
  if (panel.classList.contains('open')) closePanel();
  else openPanel();
}

customBtn.addEventListener('click', togglePanel);
$('panelClose').addEventListener('click', closePanel);

function openViews() {
  viewsDock.classList.add('open');
  viewsBtn.setAttribute('aria-expanded', 'true');
  if (mobileQuery.matches) closePanel();
}

function closeViews() {
  viewsDock.classList.remove('open');
  viewsBtn.setAttribute('aria-expanded', 'false');
}

function toggleViews() {
  if (viewsDock.classList.contains('open')) closeViews();
  else openViews();
}

viewsBtn.addEventListener('click', toggleViews);
$('dockClose').addEventListener('click', closeViews);

mobileQuery.addEventListener('change', (event) => {
  if (!event.matches) closeViews();
});

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => showView(button.dataset.view));
});

document.querySelectorAll('[data-rotate]').forEach((button) => {
  button.addEventListener('click', () => {
    const [axis, direction] = button.dataset.rotate.split(':');
    rotateModel(axis, Number(direction));
  });
});

$('resetModelBtn').addEventListener('click', resetModelRotation);

const PAN_STEPS = {
  up: [0, 1],
  down: [0, -1],
  left: [-1, 0],
  right: [1, 0]
};

document.querySelectorAll('[data-pan]').forEach((button) => {
  const direction = button.dataset.pan;
  if (direction === 'center') {
    button.addEventListener('click', recenterPan);
    return;
  }
  const [dx, dy] = PAN_STEPS[direction];
  let delay = 0;
  let repeat = 0;
  const stop = () => {
    clearTimeout(delay);
    clearInterval(repeat);
    delay = 0;
    repeat = 0;
  };
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
    }
    panView(dx, dy);
    delay = setTimeout(() => {
      repeat = setInterval(() => panView(dx, dy), 55);
    }, 260);
  });
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener('pointerleave', stop);
  button.addEventListener('lostpointercapture', stop);
  button.addEventListener('click', (event) => {
    if (event.detail === 0) panView(dx, dy);
  });
});

$('zoomIn').addEventListener('click', () => zoomBy(0.8));
$('zoomOut').addEventListener('click', () => zoomBy(1.25));

function syncSpinButton() {
  spinBtn.textContent = wantsSpin ? 'Pause spin' : 'Start spin';
  spinBtn.classList.toggle('is-on', wantsSpin);
}

function pauseSpin() {
  clearTimeout(resumeTimer);
  controls.autoRotate = false;
  if (wantsSpin) {
    wantsSpin = false;
    syncSpinButton();
  }
}

function toggleSpin() {
  wantsSpin = !wantsSpin;
  clearTimeout(resumeTimer);
  controls.autoRotate = wantsSpin && !camTween;
  if (wantsSpin) setActiveView(null);
  syncSpinButton();
}

spinBtn.addEventListener('click', toggleSpin);
$('resetBtn').addEventListener('click', flyHome);

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeBtn.textContent = theme === 'light' ? 'Dark theme' : 'Light theme';
  themeBtn.classList.toggle('is-on', theme === 'dark');
  store.set(THEME_KEY, theme);
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
}

themeBtn.addEventListener('click', toggleTheme);

const root = document.documentElement;
const fullscreenBtn = $('fullscreenBtn');

if (!root.requestFullscreen) fullscreenBtn.hidden = true;

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await root.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    console.warn('Fullscreen unavailable', error);
  }
}

fullscreenBtn.addEventListener('click', toggleFullscreen);

document.addEventListener('fullscreenchange', () => {
  fullscreenBtn.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
});

function savePNG() {
  if (!model) return;
  renderer.render(scene, camera);
  const source = renderer.domElement;
  const output = document.createElement('canvas');
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext('2d');
  if (!context) return;
  const styles = getComputedStyle(document.documentElement);
  const bgA = styles.getPropertyValue('--bg-a').trim() || '#FFFFFF';
  const bgB = styles.getPropertyValue('--bg-b').trim() || '#E9F3E8';
  const gradient = context.createRadialGradient(
    output.width * 0.5,
    output.height * 0.45,
    0,
    output.width * 0.5,
    output.height * 0.45,
    Math.max(output.width, output.height) * 0.78
  );
  gradient.addColorStop(0, bgA);
  gradient.addColorStop(0.75, bgB);
  gradient.addColorStop(1, bgB);
  context.fillStyle = gradient;
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(source, 0, 0);
  const link = document.createElement('a');
  link.download = 'vip25-logo-3d.png';
  link.href = output.toDataURL('image/png');
  link.click();
  toast('PNG saved');
}

$('shotBtn').addEventListener('click', savePNG);

$('helpBtn').addEventListener('click', () => helpDialog.showModal());
$('helpClose').addEventListener('click', () => helpDialog.close());

helpDialog.addEventListener('click', (event) => {
  if (event.target === helpDialog) helpDialog.close();
});

let pointerStart = null;

addEventListener('pointerdown', (event) => {
  if (event.target === renderer.domElement && event.button === 0) {
    pointerStart = { x: event.clientX, y: event.clientY };
  }
}, { capture: true });

addEventListener('pointermove', (event) => {
  if (!pointerStart) return;
  if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 6) {
    pointerStart = null;
    setActiveView(null);
  }
}, { capture: true });

addEventListener('pointerup', () => {
  pointerStart = null;
}, { capture: true });

addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closePanel();
    closeViews();
    return;
  }
  if (helpDialog.open) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
  const key = event.key.toLowerCase();
  if (key === ' ' || event.code === 'Space') {
    event.preventDefault();
    toggleSpin();
    return;
  }
  if (key === 'r') {
    flyHome();
    return;
  }
  if (key === 'c') {
    togglePanel();
    return;
  }
  if (key === 's') {
    savePNG();
    return;
  }
  if (key === 't') {
    toggleTheme();
    return;
  }
  if (key === 'f') {
    if (root.requestFullscreen) toggleFullscreen();
    return;
  }
  if (key === 'h' || key === '?') {
    helpDialog.showModal();
    return;
  }
  if (key === 'v') {
    if (mobileQuery.matches) toggleViews();
    return;
  }
  if (key >= '1' && key <= '7') {
    showView(VIEW_KEYS[Number(key) - 1]);
    return;
  }
  if (key === 'arrowup') {
    event.preventDefault();
    panView(0, 1);
    return;
  }
  if (key === 'arrowdown') {
    event.preventDefault();
    panView(0, -1);
    return;
  }
  if (key === 'arrowleft') {
    event.preventDefault();
    panView(-1, 0);
    return;
  }
  if (key === 'arrowright') {
    event.preventDefault();
    panView(1, 0);
    return;
  }
  if (key === '+' || key === '=') {
    zoomBy(0.82);
    return;
  }
  if (key === '-' || key === '_') {
    zoomBy(1.22);
  }
});

const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/gltf/');
const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);

loader.load(MODEL_URL, (gltf) => {
  model = gltf.scene;
  model.rotation.x = -Math.PI / 2;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  radius = bounds.getBoundingSphere(new THREE.Sphere()).radius || 1;

  camera.near = Math.max(radius / 100, 0.01);
  camera.far = radius * 100;
  camera.updateProjectionMatrix();

  controls.minDistance = radius * 0.65;
  controls.maxDistance = radius * 8;

  pivot = new THREE.Group();
  pivot.add(model);
  scene.add(pivot);

  captureMaterials();
  applyAll();
  syncUI();
  computeHome();
  camera.position.copy(home.pos);
  controls.target.copy(home.target);
  controls.update();
  setActiveView(wantsSpin ? null : 'iso');

  fillEl.style.width = '100%';
  statusEl.textContent = 'Ready';
  setTimeout(() => loaderEl.classList.add('done'), 260);
  setTimeout(() => {
    loaderEl.hidden = true;
  }, 1000);
}, (event) => {
  if (event.total) {
    const percent = Math.round((event.loaded / event.total) * 100);
    fillEl.style.width = `${percent}%`;
    statusEl.textContent = `Loading 3D model… ${percent}%`;
  }
}, (error) => {
  console.error(error);
  fail(`Could not load "${MODEL_URL}". Keep the .glb file next to this page and open the site through a local server.`);
});

addEventListener('resize', () => {
  const nextAspect = innerWidth / innerHeight;
  const majorAspectChange = Math.abs(nextAspect - lastAspect) / lastAspect > 0.15;
  lastAspect = nextAspect;
  camera.aspect = nextAspect;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  if (!userAdjusted || majorAspectChange) ensureFit();
});

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const tweening = updateCamTween(now);
  if (!tweening) controls.update();
  if (modelTween && pivot) {
    const t = Math.min((now - modelTween.start) / modelTween.dur, 1);
    pivot.quaternion.slerpQuaternions(modelTween.from, modelTween.to, easeInOutCubic(t));
    if (t >= 1) {
      pivot.quaternion.copy(modelTween.to);
      modelTween = null;
    }
  }
  renderer.render(scene, camera);
});

applyTheme(store.get(THEME_KEY) === 'dark' ? 'dark' : 'light');
applyAll();
syncUI();
syncSpinButton();
setActiveView(wantsSpin ? null : 'iso');

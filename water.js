import * as THREE from 'three';
import { createCameraRig } from './camera-rig.js';
import { createEcology } from './ecology.js';
import { createQualityController, qualitySettings } from './quality.js';
import { createWaterAudio } from './water-audio.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { createOcean } from './ocean.js';
import { createSeabed } from './seabed.js';
import { createUnderwater } from './underwater.js';
import { createCaustics } from './caustics.js';

const canvas = document.querySelector('#water');
const notice = document.querySelector('#notice');
const time = { value: 0 };
const waterTime = { value: 0 };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const mobile = matchMedia('(pointer: coarse)').matches;
const adaptiveQuality = createQualityController({ mobile });
let motion = 'calm';
let waterSpeed = .35;
// Extra rendered margins give refracted rays real scenery outside the visible
// frame. The CSS crop and expanded FOV preserve the visible 45 degree lens.
const overscan = 1.18;
let paused = reducedMotion.matches;
let renderer, camera, controls, scene, ocean, underwater, caustics, ecology, needsDraw = true, contextLost = false;
let lastFrame = 0;
let quality = 'auto';
const drawingSize = new THREE.Vector2();
const localInspection = ['localhost', '127.0.0.1'].includes(location.hostname)
  && new URLSearchParams(location.search).has('inspect');


function notify(message) {
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { notice.hidden = true; }, 5000);
}

async function init() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.info.autoReset = false;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x82b6c5);
  camera = new THREE.PerspectiveCamera(45, 1, .1, 160);
  camera.position.set(0, 6.5, 8.5);
  controls = createCameraRig(THREE, camera, canvas, {
    onChange: () => { needsDraw = true; }, reducedMotion: reducedMotion.matches,
  });

  const sunPosition = new THREE.Vector3(-.45, .78, -.43).normalize();
  createEnvironment(sunPosition);

  scene.add(new THREE.HemisphereLight(0xc3e4f5, 0x6b7665, 1.1));
  const sunlight = new THREE.DirectionalLight(0xfff4df, 1.5);
  sunlight.position.copy(sunPosition).multiplyScalar(22);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunlight.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: .5, far: 65 });
  sunlight.shadow.bias = -.0003;
  sunlight.shadow.normalBias = .025;
  sunlight.shadow.camera.updateProjectionMatrix();
  scene.add(sunlight);

  const bedTexture = await new THREE.TextureLoader().loadAsync(new URL('./assets/seabed.png', import.meta.url).href);
  bedTexture.colorSpace = THREE.SRGBColorSpace;
  bedTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  underwater = createUnderwater(THREE, renderer);
  ocean = createOcean(THREE, renderer, waterTime, underwater.uniforms);
  caustics = createCaustics(THREE, renderer, ocean.userData.waveField, waterTime, sunPosition);
  const seabed = createSeabed(THREE, bedTexture, time, caustics);
  scene.add(seabed);
  ecology = createEcology(THREE, seabed, time, { caustics });
  scene.add(ecology.group);
  ecology.update(0);
  setMotion(motion);
  ocean.material.envMap = environment.texture;
  scene.add(ocean);
  resize();
  renderer.compile(scene, camera);
  if (localInspection) installInspection();
  renderer.setAnimationLoop(frame);
}

let environment;
function createEnvironment(sunPosition = new THREE.Vector3(-.45, .78, -.43).normalize()) {
  const environmentScene = new THREE.Scene();
  const sky = new Sky();
  sky.scale.setScalar(1000);
  sky.material.uniforms.turbidity.value = 2;
  sky.material.uniforms.rayleigh.value = 1.5;
  sky.material.uniforms.mieCoefficient.value = .003;
  sky.material.uniforms.mieDirectionalG.value = .8;
  sky.material.uniforms.sunPosition.value.copy(sunPosition);
  sky.material.uniforms.showSunDisc.value = false;
  environmentScene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  environment?.dispose();
  environment = pmrem.fromScene(environmentScene, .04, .1, 2000);
  scene.environment = environment.texture;
  scene.environmentIntensity = .16;
  if (ocean) {
    ocean.material.envMap = environment.texture;
    ocean.material.needsUpdate = true;
  }
  pmrem.dispose();
  sky.geometry.dispose();
  sky.material.dispose();

}

function resize() {
  if (!renderer || !camera) return;
  const width = Math.ceil(innerWidth * overscan), height = Math.ceil(innerHeight * overscan);
  const settings = qualitySettings(quality, adaptiveQuality.tier, mobile);
  // Budget visible pixels, not the cropped-off guard band. A 1080p desktop
  // therefore keeps native detail while retina/mobile have bounded costs.
  const ratio = Math.min(devicePixelRatio || 1, settings.dpr, Math.sqrt(settings.pixels / (innerWidth * innerHeight)));
  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height, false);
  canvas.style.width = `${overscan * 100}vw`;
  canvas.style.height = `${overscan * 100}dvh`;
  camera.aspect = width / height;
  const halfVisibleFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(45 / 2)) * Math.min(1, 2.35 / camera.aspect));
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfVisibleFov) * overscan));
  camera.updateProjectionMatrix();
  renderer.getDrawingBufferSize(drawingSize);
  underwater?.resize(drawingSize.x, drawingSize.y, settings.refraction);
  ecology?.setQuality(settings.ecology);
  needsDraw = true;
}

function frame(now) {
  const elapsed = lastFrame ? (now - lastFrame) / 1000 : 0;
  const dt = Math.min(elapsed, .1);
  lastFrame = now;
  if (document.hidden || contextLost) return;
  controls.update(dt);
  if (paused && !needsDraw) return;
  if (!paused) {
    time.value += dt;
    waterSpeed += ((motion === 'calm' ? .35 : .7) - waterSpeed) * (1 - Math.exp(-dt / 1.5));
    waterTime.value += dt * waterSpeed;
    if (quality === 'auto' && adaptiveQuality.sample(elapsed)) resize();
  }
  ecology.update(paused ? 0 : dt);
  renderer.info.reset();
  // Compute the spectrum once on a small GPU surface, then sample it from
  // both the displaced mesh and optical shading at every viewing angle.
  ocean.userData.updateWaves();
  caustics.update();
  underwater.render(scene, camera, ocean);
  renderer.render(scene, camera);
  needsDraw = false;
}

init().catch(error => {
  console.error(error);
  canvas.hidden = true;
  notify('3D 화면을 불러오지 못했어요. 브라우저의 그래픽 가속을 확인해 주세요.');
});
addEventListener('resize', resize);
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  contextLost = true;
  canvas.style.visibility = 'hidden';
});
canvas.addEventListener('webglcontextrestored', () => {
  createEnvironment();
  ocean?.userData.waveField.invalidate();
  caustics?.invalidate();
  renderer.shadowMap.needsUpdate = true;
  contextLost = false;
  lastFrame = 0;
  adaptiveQuality.reset();
  needsDraw = true;
  canvas.style.visibility = '';
});

document.querySelector('#reset').addEventListener('click', () => {
  controls?.reset();
  needsDraw = true;
});

function updatePause() {
  const button = document.querySelector('#pause');
  button.setAttribute('aria-label', paused ? '장면 재생' : '장면 일시정지');
  button.title = paused ? '재생' : '일시정지';
  document.querySelector('#pause-path').setAttribute('d', paused ? 'm8 5 11 7-11 7Z' : 'M9 5v14M15 5v14');
}
document.querySelector('#pause').addEventListener('click', () => {
  paused = !paused;
  needsDraw = true;
  updatePause();
});
updatePause();

document.querySelector('#quality').addEventListener('change', event => {
  quality = event.target.value;
  adaptiveQuality.reset();
  resize();
});

function setMotion(value) {
  motion = value === 'natural' ? 'natural' : 'calm';
  ocean?.userData.setMotion(motion);
  if (caustics) caustics.receiverUniforms.causticsStrength.value = motion === 'calm' ? .30 : .58;
  needsDraw = true;
}
document.querySelector('#motion').addEventListener('change', event => setMotion(event.target.value));
reducedMotion.addEventListener('change', event => {
  controls?.setReducedMotion(event.matches);
  if (event.matches) {
    paused = true;
    setMotion('calm');
    document.querySelector('#motion').value = motion;
  }
  needsDraw = true;
  updatePause();
});

// Reproducible local visual checks; deliberately absent on the public site.
function installInspection() {
  window.__waterDebug = {
    snapshot: () => ({
      time: time.value, waterTime: waterTime.value, paused, motion, quality, qualityTier: adaptiveQuality.tier,
      ecology: ecology.snapshot(), contextLost, reducedMotion: reducedMotion.matches,
      audio: audio?.context.state ?? 'not-started', soundOn,
      viewport: [innerWidth, innerHeight], buffer: [canvas.width, canvas.height],
      frame: renderer.info.render.frame, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      textures: renderer.info.memory.textures, programs: renderer.info.programs.length,
      camera: camera.position.toArray(), target: controls.target.toArray(),
    }),
    setTime(value) {
      if (!Number.isFinite(value) || value < 0) return;
      paused = true;
      time.value = value;
      waterTime.value = value * (motion === 'calm' ? .35 : .7);
      needsDraw = true;
      updatePause();
    },
    setView(radius, polar, azimuth) {
      controls.setView(radius, polar, azimuth);
      needsDraw = true;
    },
    setSurface(enabled) {
      ocean.visible = Boolean(enabled);
      needsDraw = true;
    },
    setCaustics(enabled) {
      caustics.receiverUniforms.causticsStrength.value = enabled ? (motion === 'calm' ? .30 : .58) : 0;
      needsDraw = true;
    },
    loseContext: () => renderer.forceContextLoss(),
    restoreContext: () => renderer.forceContextRestore(),
  };
}

let idleTimer;
function showControls() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!document.querySelector('.controls').contains(document.activeElement)) document.body.classList.add('idle');
  }, 2600);
}
addEventListener('pointermove', showControls, { passive: true });
addEventListener('pointerdown', showControls, { passive: true });
addEventListener('keydown', showControls);
showControls();

document.querySelector('#fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else notify('이 브라우저는 전체 화면을 지원하지 않아요.');
  } catch { notify('전체 화면을 열 수 없어요.'); }
});

let audio, soundOn = false;
document.querySelector('#sound').addEventListener('click', async () => {
  try {
    if (!audio) audio = createWaterAudio();
    await audio.context.resume();
    soundOn = !soundOn;
    audio.setEnabled(soundOn);
    const button = document.querySelector('#sound');
    button.setAttribute('aria-pressed', String(soundOn));
    button.setAttribute('aria-label', soundOn ? '물소리 끄기' : '물소리 켜기');
  } catch { notify('이 브라우저에서는 물소리를 재생할 수 없어요.'); }
});
document.addEventListener('visibilitychange', () => {
  needsDraw = true;
  lastFrame = 0;
  adaptiveQuality.reset();
  if (audio) {
    if (document.hidden) audio.context.suspend().catch(() => {});
    else if (soundOn) audio.context.resume().catch(() => {});
  }
});

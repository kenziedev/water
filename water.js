import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { createOcean } from './ocean.js';
import { createSeabed } from './seabed.js';

const canvas = document.querySelector('#water');
const notice = document.querySelector('#notice');
const time = { value: 0 };
// Extra rendered margins give refracted rays real scenery outside the visible
// frame. The CSS crop and expanded FOV preserve the visible 45 degree lens.
const overscan = 1.4;
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
let renderer, camera, controls, scene, needsDraw = true, contextLost = false;
let lastFrame = 0;

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
  renderer.toneMappingExposure = .85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  // Refraction samples a separate rendering of the fixed seabed.
  renderer.transmissionResolutionScale = .75;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x82b6c5);
  camera = new THREE.PerspectiveCamera(45, 1, .1, 160);
  camera.position.set(0, 6.5, 8.5);
  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -.8, 0);
  controls.enableDamping = true;
  controls.dampingFactor = .07;
  controls.enablePan = false;
  controls.rotateSpeed = .48;
  controls.zoomSpeed = .7;
  controls.minDistance = 6;
  controls.maxDistance = 14;
  controls.minPolarAngle = .12;
  controls.maxPolarAngle = .90;
  controls.update();
  controls.saveState();
  controls.addEventListener('change', () => { needsDraw = true; });

  const sunPosition = new THREE.Vector3(-.45, .78, -.43).normalize();
  createEnvironment(sunPosition);

  scene.add(new THREE.HemisphereLight(0xc3e4f5, 0x6b7665, 1.1));
  const sunlight = new THREE.DirectionalLight(0xfff4df, 2);
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
  scene.add(createSeabed(THREE, bedTexture, time));
  scene.add(createOcean(THREE, time));
  resize();
  renderer.compile(scene, camera);
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
  pmrem.dispose();
  sky.geometry.dispose();
  sky.material.dispose();

}

function resize() {
  if (!renderer || !camera) return;
  const width = Math.ceil(innerWidth * overscan), height = Math.ceil(innerHeight * overscan);
  const ratio = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(2300000 / (width * height)));
  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height, false);
  canvas.style.width = `${overscan * 100}vw`;
  canvas.style.height = `${overscan * 100}dvh`;
  camera.aspect = width / height;
  const halfVisibleFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(45 / 2)) * Math.min(1, 2.35 / camera.aspect));
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfVisibleFov) * overscan));
  camera.updateProjectionMatrix();
  needsDraw = true;
}

function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000 || 0, .05);
  lastFrame = now;
  if (document.hidden || contextLost) return;
  controls.update();
  if (paused && !needsDraw) return;
  if (!paused) time.value += dt;
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
  renderer.shadowMap.needsUpdate = true;
  contextLost = false;
  needsDraw = true;
  canvas.style.visibility = '';
});

document.querySelector('#reset').addEventListener('click', () => {
  controls?.reset();
  needsDraw = true;
});

canvas.addEventListener('keydown', event => {
  if (!controls || !camera) return;
  if (event.key === 'Home') { event.preventDefault(); controls.reset(); return; }
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const offset = camera.position.clone().sub(controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  if (event.key === 'ArrowLeft') spherical.theta += .08;
  if (event.key === 'ArrowRight') spherical.theta -= .08;
  if (event.key === 'ArrowUp') spherical.phi -= .06;
  if (event.key === 'ArrowDown') spherical.phi += .06;
  if (event.key === '+' || event.key === '=') spherical.radius *= .92;
  if (event.key === '-' || event.key === '_') spherical.radius /= .92;
  spherical.phi = THREE.MathUtils.clamp(spherical.phi, controls.minPolarAngle, controls.maxPolarAngle);
  spherical.radius = THREE.MathUtils.clamp(spherical.radius, controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
  controls.update();
  needsDraw = true;
});

function updatePause() {
  const button = document.querySelector('#pause');
  button.setAttribute('aria-label', paused ? '물결 재생' : '물결 일시정지');
  button.title = paused ? '재생' : '일시정지';
  document.querySelector('#pause-path').setAttribute('d', paused ? 'm8 5 11 7-11 7Z' : 'M9 5v14M15 5v14');
}
document.querySelector('#pause').addEventListener('click', () => {
  paused = !paused;
  needsDraw = true;
  updatePause();
});
updatePause();

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

let audio, audioGain, soundOn = false;
function createWaterAudio() {
  audio = new (window.AudioContext || window.webkitAudioContext)();
  audioGain = audio.createGain();
  audioGain.gain.value = 0;
  audioGain.connect(audio.destination);
  const buffer = audio.createBuffer(2, audio.sampleRate * 8, audio.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      brown = (brown + Math.random() * .04 - .02) / 1.02;
      data[i] = brown * 4;
    }
  }
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1100;
  source.connect(filter);
  filter.connect(audioGain);
  source.start();
  const lfo = audio.createOscillator();
  lfo.frequency.value = .17;
  const modulation = audio.createGain();
  modulation.gain.value = 180;
  lfo.connect(modulation);
  modulation.connect(filter.frequency);
  lfo.start();
}
document.querySelector('#sound').addEventListener('click', async () => {
  try {
    if (!audio) createWaterAudio();
    await audio.resume();
    soundOn = !soundOn;
    audioGain.gain.setTargetAtTime(soundOn ? .42 : 0, audio.currentTime, .5);
    const button = document.querySelector('#sound');
    button.setAttribute('aria-pressed', String(soundOn));
    button.setAttribute('aria-label', soundOn ? '물소리 끄기' : '물소리 켜기');
  } catch { notify('이 브라우저에서는 물소리를 재생할 수 없어요.'); }
});
document.addEventListener('visibilitychange', () => {
  needsDraw = true;
  lastFrame = 0;
  if (audio) {
    if (document.hidden) audio.suspend();
    else if (soundOn) audio.resume().catch(() => {});
  }
});

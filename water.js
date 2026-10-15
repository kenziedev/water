const water = document.querySelector('#water');
const pauseButton = document.querySelector('#pause');
const notice = document.querySelector('#notice');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let resumeAfterVisibility = false;

function notify(message) {
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { notice.hidden = true; }, 5000);
}

function updatePause() {
  const paused = water.paused;
  pauseButton.setAttribute('aria-label', paused ? '물결 재생' : '물결 일시정지');
  pauseButton.title = paused ? '재생' : '일시정지';
  document.querySelector('#pause-path').setAttribute('d', paused ? 'm8 5 11 7-11 7Z' : 'M9 5v14M15 5v14');
}

async function playWater() {
  try {
    await water.play();
    document.body.classList.remove('needs-play');
  } catch {
    document.body.classList.add('needs-play');
  }
  updatePause();
}
water.addEventListener('play', updatePause);
water.addEventListener('pause', updatePause);
water.addEventListener('error', () => {
  document.body.classList.add('needs-play');
  notify('영상을 불러오지 못했어요. 새로고침해 주세요.');
});
pauseButton.addEventListener('click', () => {
  if (water.paused) void playWater();
  else water.pause();
});
if (reducedMotion.matches) document.body.classList.add('needs-play');
else if (document.hidden) resumeAfterVisibility = true;
else void playWater();
updatePause();
reducedMotion.addEventListener('change', event => {
  if (event.matches) {
    water.pause();
    resumeAfterVisibility = false;
    document.body.classList.add('needs-play');
  }
});

let idleTimer;
function showControls() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!document.querySelector('.controls').contains(document.activeElement)) {
      document.body.classList.add('idle');
    }
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
  } catch {
    notify('전체 화면을 열 수 없어요.');
  }
});

// Optional, locally synthesized surf ambience. The footage has no audio track.
let audio, audioGain, soundOn = false;
function createWaterAudio() {
  audio = new (window.AudioContext || window.webkitAudioContext)();
  audioGain = audio.createGain();
  audioGain.gain.value = 0;
  audioGain.connect(audio.destination);
  const buffer = audio.createBuffer(2, audio.sampleRate * 12, audio.sampleRate);
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
  lfo.frequency.value = .13;
  const modulation = audio.createGain();
  modulation.gain.value = 280;
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
  } catch {
    notify('이 브라우저에서는 물소리를 재생할 수 없어요.');
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    resumeAfterVisibility = !water.paused;
    water.pause();
    if (audio) void audio.suspend();
  } else {
    if (resumeAfterVisibility) void playWater();
    if (audio && soundOn) void audio.resume().catch(() => {});
  }
});

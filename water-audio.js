// Two quiet, differently sized beds avoid a short, obvious repeating wash.
// Generated locally after a gesture: no audio downloads or autoplay.
export function createWaterAudio() {
  const context = new (window.AudioContext || window.webkitAudioContext)();
  const output = context.createGain();
  output.gain.value = 0;
  output.connect(context.destination);
  const sources = [];
  let suspendTimer;
  for (const [duration, cutoff, rate, gain] of [[19, 780, .027, .7], [31, 1500, .019, .3]]) {
    const buffer = context.createBuffer(2, context.sampleRate * duration, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let brown = 0;
      for (let i = 0; i < data.length; i++) {
        brown = (brown + Math.random() * .04 - .02) / 1.02;
        const edge = Math.min(1, i / context.sampleRate, (data.length - 1 - i) / context.sampleRate);
        data[i] = brown * 4 * (.5 - .5 * Math.cos(Math.PI * edge));
      }
    }
    const source = context.createBufferSource();
    source.buffer = buffer; source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = cutoff;
    const layer = context.createGain(); layer.gain.value = gain;
    source.connect(filter); filter.connect(layer); layer.connect(output);
    source.start(0, duration === 19 ? 2 : 11);
    const lfo = context.createOscillator(); lfo.frequency.value = rate;
    const modulation = context.createGain(); modulation.gain.value = cutoff * .12;
    lfo.connect(modulation); modulation.connect(filter.frequency); lfo.start();
    sources.push(source, lfo);
  }
  return {
    context,
    setEnabled(enabled) {
      clearTimeout(suspendTimer);
      output.gain.setTargetAtTime(enabled ? .32 : 0, context.currentTime, .6);
      if (!enabled) suspendTimer = setTimeout(() => { context.suspend().catch(() => {}); }, 2800);
    },
    dispose() { clearTimeout(suspendTimer); sources.forEach(source => source.stop()); output.disconnect(); return context.close(); },
  };
}

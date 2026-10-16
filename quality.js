// Hysteresis on frame cadence. This is a responsiveness proxy, not GPU timing.
export function createQualityController({ mobile = false } = {}) {
  let tier = 0, samples = [], elapsed = 0, bad = 0, good = 0, cooldown = 4;
  return {
    get tier() { return tier; },
    reset() { samples = []; elapsed = bad = good = 0; cooldown = 4; },
    sample(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return false;
      // Resume gaps are reset by the caller. A persistently slow foreground
      // frame must still count, without one stall consuming a whole window.
      dt = Math.min(dt, .25);
      if (cooldown > 0) { cooldown -= dt; return false; }
      samples.push(dt); elapsed += dt;
      if (elapsed < 2) return false;
      samples.sort((a, b) => a - b);
      const p90 = samples[Math.floor((samples.length - 1) * .9)];
      samples = []; elapsed = 0;
      bad = p90 > (mobile ? .040 : .026) ? bad + 1 : 0;
      good = p90 < (mobile ? .029 : .019) ? good + 1 : 0;
      if (bad >= 3 && tier < 2) { tier++; cooldown = 8; }
      else if (good >= 10 && tier > 0) { tier--; cooldown = 30; }
      else return false;
      bad = good = 0;
      return true;
    },
  };
}

export function qualitySettings(mode, tier = 0, mobile = false) {
  if (mode === 'high') return { pixels: 5000000, dpr: 1.75, refraction: 1, ecology: 'high' };
  if (mode === 'eco') return { pixels: 1100000, dpr: 1, refraction: .7, ecology: 'low' };
  const level = Math.max(0, Math.min(2, tier));
  return {
    pixels: (mobile ? [1400000, 1000000, 700000] : [2800000, 1800000, 1100000])[level],
    dpr: mobile ? 1.4 : 1.5,
    refraction: (mobile ? [.85, .75, .65] : [1, .85, .7])[level],
    ecology: ['high', 'medium', 'low'][level],
  };
}

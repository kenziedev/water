import test from 'node:test';
import assert from 'node:assert/strict';
import { createQualityController, qualitySettings } from '../quality.js';
const run = (controller, seconds, dt) => { let changes = 0; for (let t = 0; t < seconds; t += dt) changes += Number(controller.sample(dt)); return changes; };
test('automatic quality ignores isolated stalls and sustains a tier before changing', () => {
  const c = createQualityController();
  assert.equal(run(c, 8, 1 / 60), 0);
  assert.equal(c.sample(2), false);
  assert.equal(run(c, 3, 1 / 20), 0);
  assert.equal(c.tier, 0);
  assert.equal(run(c, 6, 1 / 20), 1);
  assert.equal(c.tier, 1);
  assert.equal(run(c, 6, 1 / 20), 0);
});
test('recovery is slower than downgrade and hide/resume discards partial windows', () => {
  const c = createQualityController();
  run(c, 12, 1 / 20);
  assert.equal(c.tier, 1);
  assert.equal(run(c, 20, 1 / 60), 0);
  assert.equal(run(c, 12, 1 / 60), 1);
  assert.equal(c.tier, 0);
  c.reset();
  assert.equal(run(c, 4, 1 / 20), 0);
});
test('mobile 30 fps is stable; manual presets ignore adaptation', () => {
  const c = createQualityController({ mobile: true });
  assert.equal(run(c, 60, 1 / 30), 0);
  assert.deepEqual(qualitySettings('high', 2), qualitySettings('high', 0));
  assert.deepEqual(qualitySettings('eco', 2), qualitySettings('eco', 0));
  assert.ok(qualitySettings('auto', 2).pixels < qualitySettings('auto', 0).pixels);
});

test('sustained sub-4fps rendering still downgrades; one long stall does not', () => {
  const c = createQualityController();
  run(c, 8, 1 / 60);
  c.sample(3);
  run(c, 3, 1 / 60);
  assert.equal(c.tier, 0);
  run(c, 60, .3);
  assert.equal(c.tier, 2);
});

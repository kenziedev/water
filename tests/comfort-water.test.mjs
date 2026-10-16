import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOcean } from '../ocean.js';

function createSurface() {
  const time = { value: 123.5 };
  // Creation and mode changes must not launch GPU passes or alter this clock.
  const surface = createOcean(THREE, {}, time, {});
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  surface.material.onBeforeCompile(shader);
  return { surface, time, shader };
}

function disposeSurface(surface) {
  surface.userData.waveField.dispose();
  surface.geometry.dispose();
  surface.material.dispose();
}

test('calm is the default; motion changes preserve the live shader, wave field and shared clock', () => {
  const { surface, time, shader } = createSurface();
  const field = surface.userData.waveField;
  const geometry = surface.geometry;
  const version = surface.material.version;
  const refraction = shader.uniforms.refractionStrength;
  const offset = shader.uniforms.refractionMaxOffset;
  assert.equal(surface.userData.motion, 'calm');
  const calm = surface.userData.setMotion('calm');
  const natural = surface.userData.setMotion('natural');

  assert.ok(calm.refractionStrength < natural.refractionStrength);
  assert.ok(calm.maxOffset < natural.maxOffset);
  assert.ok(calm.roughness > natural.roughness);
  assert.ok(calm.specularIntensity < natural.specularIntensity);
  assert.equal(refraction.value, natural.refractionStrength);
  assert.equal(offset.value, natural.maxOffset);
  assert.equal(surface.material.roughness, natural.roughness);
  assert.equal(surface.material.specularIntensity, natural.specularIntensity);
  surface.userData.setMotion('calm');
  assert.equal(refraction.value, calm.refractionStrength);
  assert.equal(offset.value, calm.maxOffset);
  assert.equal(shader.uniforms.refractionStrength, refraction);
  assert.equal(surface.material.version, version, 'mode changes must not recompile the material');
  assert.equal(surface.userData.waveField, field);
  assert.equal(surface.geometry, geometry);
  assert.equal(time.value, 123.5, 'speed changes belong to the continuous caller-owned clock');
  disposeSurface(surface);
});

test('invalid motion cannot partially mutate the current rendering mode', () => {
  const { surface, shader } = createSurface();
  const initial = surface.userData.setMotion('calm');
  for (const invalid of ['', 'toString', 'rough', null]) {
    assert.throws(() => surface.userData.setMotion(invalid), RangeError);
    assert.equal(surface.userData.motion, 'calm');
    assert.equal(shader.uniforms.refractionStrength.value, initial.refractionStrength);
    assert.equal(surface.material.roughness, initial.roughness);
  }
  disposeSurface(surface);
});

// Numerical optics checks use real Three camera transforms. They complement,
// rather than replace, the browser's GLSL compilation and image checks.
function rippleDisplacement(aspect, depth, slope, preset, angle = .8) {
  const camera = new THREE.PerspectiveCamera(45, aspect, .1, 160);
  camera.position.set(0, Math.cos(angle) * 8, Math.sin(angle) * 8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);
  const incoming = origin.clone().normalize();
  const flat = new THREE.Vector3(0, 1, 0).transformDirection(camera.matrixWorldInverse);
  const normal = new THREE.Vector3(-slope, 1, slope * .3).normalize().transformDirection(camera.matrixWorldInverse);
  const perturbation = flat.clone().lerp(normal, preset.refractionStrength).normalize();
  const refract = n => {
    const eta = 1 / 1.333;
    const dot = incoming.dot(n);
    const k = 1 - eta * eta * (1 - dot * dot);
    return incoming.clone().multiplyScalar(eta).addScaledVector(n, -(eta * dot + Math.sqrt(k)));
  };
  const project = direction => origin.clone().addScaledVector(direction, depth).applyMatrix4(camera.projectionMatrix);
  const wave = project(refract(perturbation));
  const mean = project(refract(flat));
  const delta = new THREE.Vector2((wave.x - mean.x) * .5, (wave.y - mean.y) * .5);
  const length = Math.hypot(delta.x * aspect, delta.y);
  delta.multiplyScalar(preset.maxOffset / (preset.maxOffset + length));
  return Math.hypot(delta.x * aspect, delta.y);
}

test('depth-aware ripple remains anchored at zero slope and bounded across screen shapes and camera angles', () => {
  const { surface } = createSurface();
  const calm = surface.userData.setMotion('calm');
  const natural = surface.userData.setMotion('natural');
  for (const aspect of [.45, 1, 16 / 9, 32 / 9]) {
    for (const angle of [.12, .6, .9]) {
      assert.equal(rippleDisplacement(aspect, 4, 0, calm, angle), 0);
      assert.equal(rippleDisplacement(aspect, 0, .2, calm, angle), 0);
      for (const depth of [.1, 1, 4, 14]) {
        const calmShift = rippleDisplacement(aspect, depth, .12, calm, angle);
        const naturalShift = rippleDisplacement(aspect, depth, .12, natural, angle);
        assert.ok(Number.isFinite(calmShift) && calmShift < calm.maxOffset);
        assert.ok(calmShift < naturalShift && naturalShift < natural.maxOffset);
      }
    }
    assert.ok(rippleDisplacement(aspect, 1, .12, calm) < rippleDisplacement(aspect, 4, .12, calm));
    assert.ok(Math.abs(rippleDisplacement(aspect, 4, .12, calm) - rippleDisplacement(1, 4, .12, calm)) < 1e-12,
      'a wide display must not magnify the displacement in screen-height units');
  }
  disposeSurface(surface);
});

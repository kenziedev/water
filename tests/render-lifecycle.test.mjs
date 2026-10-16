import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createUnderwater } from '../underwater.js';
import { createWaveField } from '../wave-field.js';
import { createCaustics } from '../caustics.js';

// Keep Three's real targets, cameras, scenes and disposal events. Only the GPU
// boundary is replaced, so lifecycle failures can run without a browser.
function mockRenderer({ target = null, cubeFace = 0, mipLevel = 0, floatBuffers = true } = {}) {
  let currentTarget = target;
  let currentCubeFace = cubeFace;
  let currentMipLevel = mipLevel;
  return {
    extensions: { has: name => name === 'EXT_color_buffer_float' && floatBuffers },
    renderCalls: [],
    onRender: null,
    getRenderTarget: () => currentTarget,
    getActiveCubeFace: () => currentCubeFace,
    getActiveMipmapLevel: () => currentMipLevel,
    setRenderTarget(next, face = 0, level = 0) {
      currentTarget = next;
      currentCubeFace = face;
      currentMipLevel = level;
    },
    render(scene, camera) {
      const call = { scene, camera, target: currentTarget };
      this.renderCalls.push(call);
      this.onRender?.(call);
    },
  };
}

function assertTargetRestored(renderer, target, cubeFace = 0, mipLevel = 0) {
  assert.equal(renderer.getRenderTarget(), target);
  assert.equal(renderer.getActiveCubeFace(), cubeFace);
  assert.equal(renderer.getActiveMipmapLevel(), mipLevel);
}

function observeDisposal(resource) {
  let count = 0;
  resource.addEventListener('dispose', () => { count++; });
  return () => count;
}

test('underwater resize keeps sampling resolution distinct from reduced render resolution', () => {
  const renderer = mockRenderer();
  const underwater = createUnderwater(THREE, renderer);
  const scene = new THREE.Scene();
  const surface = new THREE.Object3D();
  const camera = new THREE.PerspectiveCamera();

  underwater.resize(1001, 701, .6);
  underwater.render(scene, camera, surface);
  const target = renderer.renderCalls.at(-1).target;
  assert.ok(target instanceof THREE.WebGLRenderTarget);
  assert.deepEqual([target.width, target.height], [601, 421]);
  assert.deepEqual(underwater.uniforms.surfaceResolution.value.toArray(), [1001, 701]);
  assert.equal(underwater.uniforms.underwaterColor.value, target.texture);
  assert.equal(underwater.uniforms.underwaterDepth.value, target.depthTexture);
  assert.ok(target.depthTexture instanceof THREE.DepthTexture);
  assertTargetRestored(renderer, null);

  underwater.resize(1, 1, .4);
  assert.deepEqual([target.width, target.height], [1, 1]);
  assert.deepEqual([target.texture.image.width, target.texture.image.height], [1, 1]);
  underwater.dispose();
});

test('underwater camera uniforms follow lens, aspect and clipping changes without aliasing the camera', () => {
  const renderer = mockRenderer();
  const underwater = createUnderwater(THREE, renderer);
  const camera = new THREE.PerspectiveCamera(45, 1.5, .1, 160);
  const scene = new THREE.Scene();
  const surface = new THREE.Object3D();
  underwater.render(scene, camera, surface);
  const initialProjection = underwater.uniforms.waterProjection.value.clone();

  camera.fov = 31;
  camera.aspect = .72;
  camera.near = .3;
  camera.far = 96;
  camera.updateProjectionMatrix();
  assert.deepEqual(underwater.uniforms.waterProjection.value.elements, initialProjection.elements);
  underwater.render(scene, camera, surface);

  const { waterProjection, waterProjectionInverse, waterClip } = underwater.uniforms;
  assert.notEqual(waterProjection.value, camera.projectionMatrix);
  assert.notEqual(waterProjectionInverse.value, camera.projectionMatrixInverse);
  assert.deepEqual(waterProjection.value.elements, camera.projectionMatrix.elements);
  assert.deepEqual(waterProjectionInverse.value.elements, camera.projectionMatrixInverse.elements);
  assert.deepEqual(waterClip.value.toArray(), [.3, 96]);
  const identity = waterProjection.value.clone().multiply(waterProjectionInverse.value);
  identity.elements.forEach((value, index) => {
    assert.ok(Math.abs(value - (index % 5 === 0 ? 1 : 0)) < 1e-12);
  });
  underwater.dispose();
});

test('underwater restores the original target subresource and surface visibility after success or render failure', async t => {
  for (const wasVisible of [true, false]) {
    for (const fail of [false, true]) {
      await t.test(`visible=${wasVisible}, render failure=${fail}`, () => {
        const previous = new THREE.WebGLCubeRenderTarget(32);
        const renderer = mockRenderer({ target: previous, cubeFace: 2, mipLevel: 1 });
        const underwater = createUnderwater(THREE, renderer);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();
        const surface = new THREE.Object3D();
        surface.visible = wasVisible;
        const failure = new Error('simulated GPU render failure');
        renderer.onRender = call => {
          assert.equal(surface.visible, false);
          assert.notEqual(call.target, previous);
          assert.equal(call.scene, scene);
          assert.equal(call.camera, camera);
          if (fail) throw failure;
        };

        if (fail) assert.throws(() => underwater.render(scene, camera, surface), error => error === failure);
        else underwater.render(scene, camera, surface);
        assert.equal(surface.visible, wasVisible);
        assertTargetRestored(renderer, previous, 2, 1);
        underwater.dispose();
        previous.dispose();
      });
    }
  }
});

test('underwater selects a supported colour target and releases its owned target', () => {
  for (const floatBuffers of [true, false]) {
    const renderer = mockRenderer({ floatBuffers });
    const underwater = createUnderwater(THREE, renderer);
    underwater.render(new THREE.Scene(), new THREE.PerspectiveCamera(), new THREE.Object3D());
    const target = renderer.renderCalls[0].target;
    assert.equal(target.texture.type, floatBuffers ? THREE.HalfFloatType : THREE.UnsignedByteType);
    const disposed = observeDisposal(target);
    underwater.dispose();
    assert.equal(disposed(), 1);
  }
});

test('wave and caustic passes reuse paused results, advance together, and refresh after invalidation', () => {
  const previous = new THREE.WebGLCubeRenderTarget(32);
  const renderer = mockRenderer({ target: previous, cubeFace: 3, mipLevel: 2 });
  const time = { value: 0 };
  const field = createWaveField(THREE, renderer, time, { resolution: 128 });
  const caustics = createCaustics(THREE, renderer, field, time, new THREE.Vector3(-.45, .78, -.43), { resolution: 64 });

  assert.equal(field.update(), true);
  assert.equal(caustics.update(), true);
  assertTargetRestored(renderer, previous, 3, 2);
  assert.equal(renderer.renderCalls.length, 2);
  assert.equal(renderer.renderCalls[1].scene.children[0].material.uniforms.waveField.value, field.texture);

  assert.equal(field.update(), false);
  assert.equal(caustics.update(), false);
  assert.equal(renderer.renderCalls.length, 2, 'paused redraws must not launch either GPU field pass');

  time.value = 1 / 60;
  assert.equal(field.update(), true);
  assert.equal(caustics.update(), true);
  assert.equal(renderer.renderCalls.length, 4);
  field.invalidate();
  caustics.invalidate();
  assert.equal(field.update(), true);
  assert.equal(caustics.update(), true);
  assert.equal(renderer.renderCalls.length, 6, 'context restoration must regenerate fields even while time is paused');
  assertTargetRestored(renderer, previous, 3, 2);

  caustics.dispose();
  field.dispose();
  previous.dispose();
});

for (const kind of ['waves', 'caustics']) {
  test(`${kind} restore nested target state after failure and retry the same simulation time`, () => {
    const previous = new THREE.WebGLCubeRenderTarget(32);
    const renderer = mockRenderer({ target: previous, cubeFace: 4, mipLevel: 1 });
    const time = { value: 5 };
    const field = createWaveField(THREE, renderer, time);
    const pass = kind === 'waves' ? field : createCaustics(THREE, renderer, field, time, new THREE.Vector3(0, 1, 0));
    const failure = new Error(`${kind} render failed`);
    renderer.onRender = () => { throw failure; };

    assert.throws(() => pass.update(), error => error === failure);
    assertTargetRestored(renderer, previous, 4, 1);
    renderer.onRender = null;
    assert.equal(pass.update(), true, 'a failed pass must not cache an unrendered result');
    assert.equal(pass.update(), false);
    assert.equal(renderer.renderCalls.length, 2);
    assertTargetRestored(renderer, previous, 4, 1);

    if (pass !== field) pass.dispose();
    field.dispose();
    previous.dispose();
  });
}

test('field disposal releases each owned render target, geometry and material without disposing a shared input', () => {
  const previous = new THREE.WebGLRenderTarget(8, 8);
  const renderer = mockRenderer({ target: previous });
  const time = { value: 0 };
  const field = createWaveField(THREE, renderer, time);
  const caustics = createCaustics(THREE, renderer, field, time, new THREE.Vector3(0, 1, 0));
  field.update();
  caustics.update();

  const counts = renderer.renderCalls.map(({ target, scene }) => ({
    target: observeDisposal(target),
    geometry: observeDisposal(scene.children[0].geometry),
    material: observeDisposal(scene.children[0].material),
  }));
  const inputTextureDisposed = observeDisposal(field.texture);
  const previousDisposed = observeDisposal(previous);
  caustics.dispose();
  assert.deepEqual(Object.values(counts[1]).map(count => count()), [1, 1, 1]);
  assert.deepEqual(Object.values(counts[0]).map(count => count()), [0, 0, 0]);
  assert.equal(inputTextureDisposed(), 0, 'the caustic pass borrows the wave texture');
  assert.equal(previousDisposed(), 0);

  field.dispose();
  assert.deepEqual(Object.values(counts[0]).map(count => count()), [1, 1, 1]);
  assert.equal(previousDisposed(), 0, 'caller-owned render targets must survive disposal');
  previous.dispose();
});

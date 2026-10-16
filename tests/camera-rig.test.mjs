import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCameraRig } from '../camera-rig.js';

class Events {
  listeners = new Map();
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  emit(name, values = {}) {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...values };
    for (const callback of this.listeners.get(name) || []) callback(event);
    return event;
  }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, group) => sum + group.size, 0); }
}

function fixture({ reducedMotion = false, overscan = 1.18 } = {}) {
  const host = Object.assign(new Events(), { innerWidth: 1200, innerHeight: 800 });
  const document = Object.assign(new Events(), { defaultView: host, hidden: false });
  const canvas = Object.assign(new Events(), {
    ownerDocument: document, style: { touchAction: 'pan-x' },
    clientWidth: host.innerWidth * overscan, clientHeight: host.innerHeight * overscan,
    captured: new Set(), focused: false,
    focus() { this.focused = true; },
    setPointerCapture(id) { this.captured.add(id); },
    hasPointerCapture(id) { return this.captured.has(id); },
    releasePointerCapture(id) {
      this.captured.delete(id);
      this.emit('lostpointercapture', { pointerId: id });
    },
  });
  const camera = new THREE.PerspectiveCamera(45, 1.5, .1, 160);
  let changes = 0;
  const rig = createCameraRig(THREE, camera, canvas, { reducedMotion, onChange: () => { changes++; } });
  return { camera, canvas, rig, host, document, changes: () => changes };
}

function spherical(f) { return new THREE.Spherical().setFromVector3(f.camera.position.clone().sub(f.rig.target)); }
function advance(f, seconds, hz = 60) { for (let i = 0; i < Math.round(seconds * hz); i++) f.rig.update(1 / hz); }
function near(a, b, tolerance = 1e-10) { assert.ok(Math.abs(a - b) < tolerance, `${a} should be close to ${b}`); }
function pointer(f, type, values = {}) {
  return f.canvas.emit(type, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 200, clientY: 200, ...values });
}

test('idle camera has no unsolicited movement or change notifications', () => {
  const f = fixture();
  const position = f.camera.position.clone();
  const quaternion = f.camera.quaternion.clone();
  const changes = f.changes();
  for (let i = 0; i < 1200; i++) assert.equal(f.rig.update(1 / 120), false);
  assert.deepEqual(f.camera.position.toArray(), position.toArray());
  assert.deepEqual(f.camera.quaternion.toArray(), quaternion.toArray());
  assert.equal(f.changes(), changes);
  near(position.y, 6.5);
  near(position.z, 8.5);
  f.rig.dispose();
});

test('input settling is deterministic at 60 and 120 Hz with no overshoot', () => {
  const a = fixture(), b = fixture();
  const start = spherical(a);
  for (const f of [a, b]) f.rig.setView(13, .4, .5, { immediate: false });
  advance(a, .15, 60);
  advance(b, .15, 120);
  assert.ok(a.camera.position.distanceTo(b.camera.position) < 1e-10);
  const pose = spherical(a);
  assert.ok(pose.radius > start.radius && pose.radius < 13);
  assert.ok((13 - pose.radius) / (13 - start.radius) < .025);
  advance(a, 1);
  near(spherical(a).radius, 13);
  assert.equal(a.rig.update(1 / 60), false);
  a.rig.dispose(); b.rig.dispose();
});

test('reset finishes in 0.9 seconds at either refresh rate and uses the shortest turn', () => {
  const a = fixture(), b = fixture();
  for (const f of [a, b]) {
    f.rig.setView(14, .3, Math.PI * 4 + .6);
    f.rig.reset();
  }
  advance(a, .45, 60); advance(b, .45, 120);
  assert.ok(a.camera.position.distanceTo(b.camera.position) < 1e-10);
  assert.ok(spherical(a).theta > 0 && spherical(a).theta < .6);
  advance(a, .45, 60); advance(b, .45, 120);
  assert.ok(a.camera.position.distanceTo(new THREE.Vector3(0, 6.5, 8.5)) < 1e-10);
  assert.ok(a.camera.position.distanceTo(b.camera.position) < 1e-10);
  a.rig.dispose(); b.rig.dispose();
});

test('new drag interrupts reset from the current pose without pulling toward its old destination', () => {
  const f = fixture();
  f.rig.setView(14, .3, 1.2);
  f.rig.reset();
  advance(f, .3);
  const atInterruption = f.camera.position.clone();
  const pose = spherical(f);
  pointer(f, 'pointerdown');
  advance(f, .25);
  assert.ok(f.camera.position.distanceTo(atInterruption) < 1e-10);
  pointer(f, 'pointermove', { clientX: 280 });
  advance(f, .5);
  near(spherical(f).theta, pose.theta - .12, 1e-6);
  near(spherical(f).radius, pose.radius);
  pointer(f, 'pointerup');
  assert.equal(f.canvas.captured.size, 0);
  f.rig.dispose();
});

test('drag sensitivity uses the visible viewport rather than cropped canvas overscan', () => {
  const a = fixture({ overscan: 1 }), b = fixture({ overscan: 1.4 });
  for (const f of [a, b]) {
    pointer(f, 'pointerdown');
    pointer(f, 'pointermove', { clientX: 440, clientY: 300 });
    advance(f, .5);
  }
  assert.ok(a.camera.position.distanceTo(b.camera.position) < 1e-10);
  a.rig.dispose(); b.rig.dispose();
});

test('wheel reversal interrupts pending zoom and wheel input cancels a reset', () => {
  const f = fixture();
  f.rig.setView(14, .3, 1);
  f.rig.reset();
  advance(f, .2);
  const start = spherical(f);
  const first = f.canvas.emit('wheel', { deltaY: -100, deltaMode: 0, timeStamp: 100 });
  assert.equal(first.defaultPrevented, true);
  advance(f, .05);
  const reversedAt = spherical(f);
  f.canvas.emit('wheel', { deltaY: 100, deltaMode: 0, timeStamp: 150 });
  advance(f, .5);
  near(spherical(f).radius, Math.min(14, reversedAt.radius * Math.exp(.12)), 1e-5);
  near(spherical(f).theta, start.theta);
  near(spherical(f).phi, start.phi);
  f.rig.dispose();
});

test('touch pinch changes only distance, respects bounds and cancels cleanly', () => {
  const f = fixture();
  const initial = spherical(f);
  pointer(f, 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 100 });
  pointer(f, 'pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 200 });
  pointer(f, 'pointermove', { pointerType: 'touch', pointerId: 2, clientX: 800 });
  advance(f, .5);
  near(spherical(f).radius, 6, 1e-4);
  near(spherical(f).phi, initial.phi);
  near(spherical(f).theta, initial.theta);
  pointer(f, 'pointermove', { pointerType: 'touch', pointerId: 2, clientX: 115 });
  advance(f, .5);
  near(spherical(f).radius, 14, 1e-4);
  pointer(f, 'pointercancel', { pointerType: 'touch', pointerId: 2 });
  const stopped = f.camera.position.clone();
  pointer(f, 'pointermove', { pointerType: 'touch', pointerId: 1, clientX: 600 });
  advance(f, .5);
  assert.ok(f.camera.position.distanceTo(stopped) < 1e-10);
  assert.equal(f.canvas.captured.size, 0);
  f.rig.dispose();
});

test('keyboard bounds, reduced motion and Home use the same constrained camera state', () => {
  const f = fixture({ reducedMotion: true });
  f.rig.setView(100, -4, 0);
  near(spherical(f).radius, 14);
  near(spherical(f).phi, .2);
  f.rig.setView(-2, 8, 0);
  near(spherical(f).radius, 6);
  near(spherical(f).phi, .9);
  const event = f.canvas.emit('keydown', { key: 'ArrowLeft' });
  assert.equal(event.defaultPrevented, true);
  near(spherical(f).theta, .045);
  f.canvas.emit('keydown', { key: 'Home' });
  assert.ok(f.camera.position.distanceTo(new THREE.Vector3(0, 6.5, 8.5)) < 1e-10);
  const before = f.camera.position.clone();
  f.canvas.emit('keydown', { key: '+', ctrlKey: true });
  f.rig.setView(NaN, .4, .2);
  assert.ok(f.camera.position.equals(before));
  f.rig.dispose();
});

test('enabling reduced motion snaps an in-flight transition and disabling it restores short smoothing', () => {
  const f = fixture();
  f.rig.setView(14, .2, 1, { immediate: false });
  f.rig.update(1 / 60);
  f.rig.setReducedMotion(true);
  near(spherical(f).radius, 14);
  near(spherical(f).phi, .2);
  near(spherical(f).theta, 1);
  f.rig.setReducedMotion(false);
  f.rig.setView(7, .7, .5, { immediate: false });
  near(spherical(f).radius, 14);
  f.rig.update(1 / 60);
  assert.ok(spherical(f).radius > 7 && spherical(f).radius < 14);
  f.rig.dispose();
});

test('blur, hidden document and disposal stop unfinished input and release handlers and captures', () => {
  for (const cancel of ['blur', 'hidden', 'dispose']) {
    const f = fixture();
    pointer(f, 'pointerdown');
    pointer(f, 'pointermove', { clientX: 500 });
    f.rig.update(1 / 60);
    const stopped = f.camera.position.clone();
    if (cancel === 'blur') f.host.emit('blur');
    if (cancel === 'hidden') { f.document.hidden = true; f.document.emit('visibilitychange'); }
    if (cancel === 'dispose') f.rig.dispose();
    advance(f, .5);
    assert.ok(f.camera.position.distanceTo(stopped) < 1e-10);
    assert.equal(f.canvas.captured.size, 0);
    f.rig.dispose();
    assert.equal(f.canvas.listenerCount + f.host.listenerCount + f.document.listenerCount, 0);
    assert.equal(f.canvas.style.touchAction, 'pan-x');
    f.canvas.emit('wheel', { deltaY: 100, deltaMode: 0 });
    assert.equal(f.rig.update(1), false);
  }
});

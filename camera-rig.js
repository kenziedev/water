// Explicit observation controls. The camera has no idle motion or velocity
// inertia: input changes a bounded target and a short, time-based filter follows.
export function createCameraRig(THREE, camera, canvas, { onChange = () => {}, reducedMotion = false } = {}) {
  const target = new THREE.Vector3(0, -.8, 0);
  const initial = new THREE.Spherical().setFromVector3(new THREE.Vector3(0, 7.3, 8.5));
  const current = initial.clone();
  const desired = initial.clone();
  const offset = new THREE.Vector3();
  const previousPosition = new THREE.Vector3();
  const previousQuaternion = new THREE.Quaternion();
  const document = canvas.ownerDocument;
  const host = document?.defaultView ?? globalThis;
  const pointers = new Map();
  const listeners = [];
  const originalTouchAction = canvas.style?.touchAction;
  let motionReduced = Boolean(reducedMotion);
  let transition = null;
  let activeSource = null;
  let lastWheelTime = -Infinity;
  let lastWheelSign = 0;
  let lastKey = null;
  let disposed = false;

  if (canvas.style) canvas.style.touchAction = 'none';

  function clampPose(pose) {
    pose.radius = THREE.MathUtils.clamp(pose.radius, 6, 14);
    pose.phi = THREE.MathUtils.clamp(pose.phi, .2, .9);
  }

  function applyPose() {
    previousPosition.copy(camera.position);
    previousQuaternion.copy(camera.quaternion);
    camera.position.copy(target).add(offset.setFromSpherical(current));
    camera.lookAt(target);
    const changed = camera.position.distanceToSquared(previousPosition) > 1e-18
      || 1 - Math.abs(camera.quaternion.dot(previousQuaternion)) > 1e-14;
    if (changed) onChange();
    return changed;
  }

  function viewport() {
    // The canvas includes a cropped overscan border. Sensitivity follows the
    // actual visible viewport so resizing that border cannot change controls.
    const width = host.innerWidth || document?.documentElement?.clientWidth || canvas.clientWidth || 1;
    const height = host.innerHeight || document?.documentElement?.clientHeight || canvas.clientHeight || 1;
    return { height, shortest: Math.max(1, Math.min(width, height)) };
  }

  function interrupt(source, continuing = false) {
    if (!continuing || transition) desired.copy(current);
    transition = null;
    activeSource = source;
  }

  function acceptInput() {
    clampPose(desired);
    if (motionReduced) {
      current.copy(desired);
      applyPose();
    }
  }

  function releasePointer(id) {
    // Remove first: releasePointerCapture can deliver lostpointercapture.
    pointers.delete(id);
    try {
      if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
    } catch { /* The browser may already have released a cancelled pointer. */ }
  }

  function cancelInput() {
    for (const id of [...pointers.keys()]) releasePointer(id);
    interrupt(null);
    lastWheelTime = -Infinity;
    lastWheelSign = 0;
    lastKey = null;
  }

  function pointerDown(event) {
    if (disposed || (event.pointerType !== 'touch' && event.button !== 0) || pointers.size >= 2) return;
    interrupt('pointer');
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.focus?.({ preventScroll: true });
    try { canvas.setPointerCapture?.(event.pointerId); } catch { /* Detached canvas. */ }
    event.preventDefault();
  }

  function pointerMove(event) {
    const pointer = pointers.get(event.pointerId);
    if (!pointer || disposed) return;
    if (pointers.size === 1) {
      const scale = viewport().shortest;
      desired.theta -= (event.clientX - pointer.x) / scale * 1.2;
      desired.phi -= (event.clientY - pointer.y) / scale * .85;
    } else {
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)[1];
      const before = Math.hypot(pointer.x - other.x, pointer.y - other.y);
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      if (before >= 8 && after >= 8) desired.radius *= before / after;
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    acceptInput();
    event.preventDefault();
  }

  function pointerUp(event) {
    if (!pointers.has(event.pointerId)) return;
    releasePointer(event.pointerId);
    if (!pointers.size) activeSource = null;
  }

  function pointerCancelled(event) {
    if (pointers.has(event.pointerId)) cancelInput();
  }

  function wheel(event) {
    if (disposed || pointers.size || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    const timestamp = Number.isFinite(event.timeStamp) ? event.timeStamp : 0;
    const sign = Math.sign(event.deltaY);
    const continuing = activeSource === 'wheel' && sign === lastWheelSign
      && timestamp >= lastWheelTime && timestamp - lastWheelTime < 160;
    interrupt('wheel', continuing);
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport().height : 1;
    const delta = THREE.MathUtils.clamp(event.deltaY * units, -180, 180);
    desired.radius *= Math.exp(delta * .0012);
    lastWheelTime = timestamp;
    lastWheelSign = sign;
    acceptInput();
    event.preventDefault();
  }

  function keyDown(event) {
    if (disposed || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key;
    if (key === 'Home') {
      event.preventDefault();
      reset();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(key)) return;
    interrupt('keyboard', event.repeat && activeSource === 'keyboard' && key === lastKey);
    lastKey = key;
    if (key === 'ArrowLeft') desired.theta += .045;
    if (key === 'ArrowRight') desired.theta -= .045;
    if (key === 'ArrowUp') desired.phi -= .035;
    if (key === 'ArrowDown') desired.phi += .035;
    if (key === '+' || key === '=') desired.radius *= .94;
    if (key === '-' || key === '_') desired.radius /= .94;
    acceptInput();
    event.preventDefault();
  }

  function keyUp(event) {
    if (event.key === lastKey) {
      lastKey = null;
      if (activeSource === 'keyboard') activeSource = null;
    }
  }

  function reset({ immediate = false } = {}) {
    if (disposed) return;
    cancelInput();
    desired.copy(initial);
    // Return by the shortest azimuth, even after multiple full revolutions.
    desired.theta = current.theta + Math.atan2(Math.sin(initial.theta - current.theta), Math.cos(initial.theta - current.theta));
    if (immediate || motionReduced) {
      current.copy(desired);
      applyPose();
    } else {
      transition = { from: current.clone(), elapsed: 0 };
    }
  }

  function setView(radius, polar, azimuth, { immediate = true } = {}) {
    if (disposed || ![radius, polar, azimuth].every(Number.isFinite)) return;
    cancelInput();
    desired.set(radius, polar, azimuth);
    clampPose(desired);
    if (immediate || motionReduced) {
      current.copy(desired);
      applyPose();
    } else {
      desired.theta = current.theta + Math.atan2(Math.sin(azimuth - current.theta), Math.cos(azimuth - current.theta));
    }
  }

  function update(dt) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return false;
    if (transition) {
      transition.elapsed += dt;
      const progress = Math.min(1, transition.elapsed / .9);
      const weight = 1 - (1 - progress) ** 3;
      current.radius = THREE.MathUtils.lerp(transition.from.radius, desired.radius, weight);
      current.phi = THREE.MathUtils.lerp(transition.from.phi, desired.phi, weight);
      current.theta = THREE.MathUtils.lerp(transition.from.theta, desired.theta, weight);
      if (progress === 1) transition = null;
    } else {
      // 95% settled after 120 ms, 98% after 160 ms, independent of refresh rate.
      const weight = -Math.expm1(-dt / .04);
      current.radius += (desired.radius - current.radius) * weight;
      current.phi += (desired.phi - current.phi) * weight;
      current.theta += (desired.theta - current.theta) * weight;
      if (Math.abs(desired.radius - current.radius) < 1e-5
        && Math.abs(desired.phi - current.phi) < 1e-6
        && Math.abs(desired.theta - current.theta) < 1e-6) current.copy(desired);
    }
    clampPose(current);
    return applyPose();
  }

  function listen(element, name, callback, options) {
    if (!element?.addEventListener) return;
    element.addEventListener(name, callback, options);
    listeners.push(() => element.removeEventListener(name, callback, options));
  }

  listen(canvas, 'pointerdown', pointerDown);
  listen(canvas, 'pointermove', pointerMove);
  listen(canvas, 'pointerup', pointerUp);
  listen(canvas, 'pointercancel', pointerCancelled);
  listen(canvas, 'lostpointercapture', pointerCancelled);
  listen(canvas, 'wheel', wheel, { passive: false });
  listen(canvas, 'keydown', keyDown);
  listen(canvas, 'keyup', keyUp);
  listen(canvas, 'blur', cancelInput);
  listen(host, 'blur', cancelInput);
  listen(document, 'visibilitychange', () => { if (document.hidden) cancelInput(); });
  applyPose();

  return {
    target,
    update,
    reset,
    setView,
    setReducedMotion(enabled) {
      if (disposed) return;
      motionReduced = Boolean(enabled);
      if (motionReduced) {
        transition = null;
        current.copy(desired);
        applyPose();
      }
    },
    dispose() {
      if (disposed) return;
      cancelInput();
      disposed = true;
      listeners.forEach(remove => remove());
      if (canvas.style) canvas.style.touchAction = originalTouchAction;
    },
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSeabed } from '../seabed.js';
import { createEcology } from '../ecology.js';
import { createHabitat } from '../habitat.js';
import { createAmbientSchedule, FAUNA_PORTAL_RADIUS } from '../ambient-events.js';
import { createFishRoute, sampleFishState } from '../fauna.js';
import { createVegetation } from '../vegetation.js';
import { sampleFlow } from '../flow.js';

const seabed = createSeabed(THREE, null, { value: 0 });
const habitat = createHabitat(seabed);

test('habitat obstacles contain the real transformed rock and pebble vertices', () => {
  const records = [...seabed.userData.rockObstacles, ...seabed.userData.pebbleObstacles];
  assert.equal(seabed.userData.rockObstacles.length, seabed.userData.rockCount);
  assert.equal(seabed.userData.pebbleObstacles.length, seabed.userData.pebbleCount);
  let cursor = 0;
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  for (const mesh of seabed.children.filter(child => child.isInstancedMesh)) {
    for (let instance = 0; instance < mesh.count; instance++) {
      const bounds = records[cursor++];
      mesh.getMatrixAt(instance, matrix);
      const positions = mesh.geometry.attributes.position;
      for (let vertex = 0; vertex < positions.count; vertex++) {
        point.fromBufferAttribute(positions, vertex).applyMatrix4(matrix);
        assert.ok(point.x >= bounds.minX - 1e-6 && point.x <= bounds.maxX + 1e-6);
        assert.ok(point.y >= bounds.minY - 1e-6 && point.y <= bounds.maxY + 1e-6);
        assert.ok(point.z >= bounds.minZ - 1e-6 && point.z <= bounds.maxZ + 1e-6);
      }
    }
  }
});

test('rooted patches leave the centre open and every quality tier retains every habitat', () => {
  assert.equal(habitat.clusters.length, 34);
  const time = { value: 0 };
  const vegetation = createVegetation(THREE, habitat, time);
  for (const cluster of habitat.clusters) {
    assert.ok(Math.hypot(cluster.x, cluster.z) >= 4.3);
    assert.ok(habitat.clearGround(cluster.x, cluster.z, .62));
  }
  for (const root of vegetation.roots) {
    assert.ok(habitat.clearGround(root.x, root.z, .2));
    assert.ok(Math.abs(root.y - habitat.groundHeight(root.x, root.z) + .018) < 1e-12);
  }
  const rootedTransforms = vegetation.mesh.instanceMatrix.array.slice();
  for (const level of ['low', 'medium', 'high']) {
    vegetation.setQuality(level);
    const visibleRoots = vegetation.roots.slice(0, vegetation.mesh.count);
    assert.equal(new Set(visibleRoots.map(root => root.cluster)).size, habitat.clusters.length);
    assert.deepEqual(vegetation.mesh.instanceMatrix.array, rootedTransforms);
    assert.equal(vegetation.mesh.material.transparent, false);
    assert.equal(vegetation.mesh.material.depthWrite, true);
  }
  vegetation.dispose();
});

test('visits are deterministic, non-overlapping observation windows with quiet intervals', () => {
  const one = createAmbientSchedule(), two = createAmbientSchedule();
  const visits = one.observationsThrough(7200);
  two.activeAt(3000);
  assert.deepEqual(two.observationsThrough(7200), visits);
  assert.ok(visits[0].start >= 30 && visits[0].start <= 55);
  let schools = 0;
  for (let i = 0; i < visits.length; i++) {
    const event = visits[i];
    assert.ok(event.duration >= 15 && event.duration <= 30);
    assert.ok(event.count >= 1 && event.count <= 6);
    if (event.count > 3) schools++;
    if (i) {
      const gap = event.start - visits[i - 1].end;
      assert.ok(gap >= 120 && gap <= 180);
    }
  }
  assert.ok(schools > 0 && schools < visits.length / 3);
  assert.deepEqual(one.activeAt(20), two.activeAt(20), 'seeking backwards must not change world history');
});

test('whole swimming bodies clear the actual bed, rocks and surface along complete routes', () => {
  const events = createAmbientSchedule().observationsThrough(1800);
  for (const event of events) {
    const route = createFishRoute(event, habitat);
    assert.equal(route.blocked, false);
    for (let time = Math.max(0, event.entry); time <= event.exit; time += 2) {
      for (let member = 0; member < event.count; member++) {
        const fish = sampleFishState(event, route, member, time);
        const radius = fish.length * .58;
        assert.ok(fish.y - radius > habitat.clearanceHeight(fish.x, fish.z, radius), `${fish.id} hit the bed at ${time}`);
        assert.ok(fish.y + radius < -.3, `${fish.id} crossed the surface`);
        assert.ok(Math.abs(fish.x) + radius < 64 && Math.abs(fish.z) + radius < 64);
      }
    }
  }
  const blocked = createFishRoute(events[0], { clearanceHeight: () => 0 });
  assert.equal(blocked.blocked, true);
  assert.equal(sampleFishState(events[0], blocked, 0, events[0].start), null);
});

test('entry and exit portals stay outside the widest cropped camera view and inside the seabed', () => {
  // Reproduce the actual CSS overscan crop, 45-degree visible lens, horizontal
  // FOV cap and extreme allowed orbit. Test a deeper plane than any fish body.
  const overscan = 1.18, target = new THREE.Vector3(0, -.8, 0);
  const cameras = [];
  let greatestVisibleRadius = 0;
  for (const aspect of [.6, 1, 16 / 9, 2.35, 32 / 9]) {
    const halfVisible = Math.atan(Math.tan(THREE.MathUtils.degToRad(22.5)) * Math.min(1, 2.35 / aspect));
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfVisible) * overscan));
    for (const azimuth of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
      const camera = new THREE.PerspectiveCamera(fov, aspect, .1, 160);
      camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(14, .9, azimuth)));
      camera.lookAt(target);
      camera.updateMatrixWorld();
      cameras.push(camera);
      for (const x of [-1, 1]) for (const y of [-1, 1]) {
        const ray = new THREE.Vector3(x / overscan, y / overscan, .5).unproject(camera).sub(camera.position).normalize();
        const distance = (-3.1 - camera.position.y) / ray.y;
        const point = camera.position.clone().addScaledVector(ray, distance);
        greatestVisibleRadius = Math.max(greatestVisibleRadius, Math.hypot(point.x, point.z));
      }
    }
  }
  assert.ok(greatestVisibleRadius < FAUNA_PORTAL_RADIUS - 4,
    `visible footprint ${greatestVisibleRadius} reaches a portal`);
  const events = createAmbientSchedule().observationsThrough(7200);
  for (const event of events) {
    const route = createFishRoute(event, habitat);
    for (const time of [event.entry, event.exit]) for (let member = 0; member < event.count; member++) {
      const fish = sampleFishState(event, route, member, time);
      assert.ok(Math.hypot(fish.x, fish.z) - fish.length > greatestVisibleRadius);
      assert.ok(Math.abs(fish.x) + fish.length < 64 && Math.abs(fish.z) + fish.length < 64);
      // Contact footprints are deeper, hence visible farther into the frame.
      // Include the refracted sun offset and their full ellipse radius.
      const sun = new THREE.Vector3(-.45, .78, -.43).normalize();
      const eta = 1 / 1.333;
      const rayY = -Math.sqrt(1 - eta * eta * (1 - sun.y * sun.y));
      const depth = fish.y - habitat.groundHeight(fish.x, fish.z);
      const shadowX = fish.x + (-sun.x * eta / -rayY) * depth;
      const shadowZ = fish.z + (-sun.z * eta / -rayY) * depth;
      const shadowY = habitat.groundHeight(shadowX, shadowZ) + .016;
      const shadowRadius = fish.length * (.65 + depth * .13);
      assert.ok(Math.abs(shadowX) + shadowRadius < 64 && Math.abs(shadowZ) + shadowRadius < 64);
      for (const camera of cameras) {
        const projected = new THREE.Vector3(shadowX, shadowY, shadowZ).project(camera);
        const visible = projected.z >= -1 && projected.z <= 1
          && Math.abs(projected.x) < 1 / overscan && Math.abs(projected.y) < 1 / overscan;
        assert.equal(visible, false, 'a footprint must not appear or disappear inside the visible crop');
      }
    }
  }
});

test('a full day of overlapping off-centre approaches fits the bounded instance pool', () => {
  const schedule = createAmbientSchedule();
  const visits = schedule.observationsThrough(86400);
  for (const visit of visits) for (const time of [Math.max(0, visit.entry) + .001, visit.exit - .001]) {
    const count = schedule.activeAt(time).reduce((sum, event) => sum + event.count, 0);
    assert.ok(count <= 48, `pool would overflow with ${count} fish at ${time}`);
  }
});

test('default framing has occasional visitors with a quiet first frame and long empty intervals', () => {
  const overscan = 1.18;
  const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(22.5)) * overscan));
  const camera = new THREE.PerspectiveCamera(fov, 16 / 9, .1, 160);
  camera.position.set(0, 6.5, 8.5);
  camera.lookAt(0, -.8, 0);
  camera.updateMatrixWorld();
  const schedule = createAmbientSchedule(), routes = new Map();
  const projected = new THREE.Vector3();
  let visibleSeconds = 0, firstVisible = null, quietRun = 0, seenFish = false, maximumVisible = 0;
  const quietIntervals = [];
  for (let time = 0; time < 3600; time++) {
    let visible = 0;
    for (const event of schedule.activeAt(time)) {
      if (!routes.has(event.id)) routes.set(event.id, createFishRoute(event, habitat));
      for (let member = 0; member < event.count; member++) {
        const fish = sampleFishState(event, routes.get(event.id), member, time);
        projected.set(fish.x, fish.y, fish.z).project(camera);
        if (projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 1 / overscan
          && Math.abs(projected.y) < 1 / overscan) visible++;
      }
    }
    maximumVisible = Math.max(maximumVisible, visible);
    if (visible) {
      visibleSeconds++;
      if (firstVisible === null) firstVisible = time;
      if (seenFish && quietRun) quietIntervals.push(quietRun);
      seenFish = true;
      quietRun = 0;
    } else quietRun++;
  }
  assert.ok(firstVisible >= 20 && firstVisible <= 45, `first visible fish at ${firstVisible}s`);
  assert.ok(visibleSeconds / 3600 >= .2 && visibleSeconds / 3600 <= .4,
    `fish occupied ${(visibleSeconds / 36).toFixed(1)}% of the observation hour`);
  assert.ok(quietIntervals.every(duration => duration >= 60), `shortest empty interval ${Math.min(...quietIntervals)}s`);
  assert.ok(maximumVisible <= 6);
});

test('simulation seeking, frame rates, pausing and quality switches preserve the same fish state', () => {
  const targetTime = 80, referenceTime = { value: targetTime };
  const reference = createEcology(THREE, seabed, referenceTime);
  const expected = reference.snapshot().fish;
  for (const fps of [30, 60, 120]) {
    const time = { value: 0 };
    const ecology = createEcology(THREE, seabed, time);
    for (let step = 1; step <= targetTime * fps; step++) {
      time.value = step / fps;
      ecology.update(1 / fps);
    }
    assert.deepEqual(ecology.snapshot().fish, expected);
    const before = ecology.snapshot();
    assert.equal(ecology.update(120), false, 'wall-clock delay alone must not advance simulation');
    assert.deepEqual(ecology.snapshot(), before);
    ecology.setQuality('low');
    assert.deepEqual(ecology.snapshot().fish, expected);
    ecology.setQuality('high');
    assert.deepEqual(ecology.snapshot().fish, expected);
    ecology.dispose();
  }
  reference.dispose();
});

test('fish body front faces meet a downward ray before its centre at every quality level', () => {
  const ecology = createEcology(THREE, seabed, { value: 76 });
  const fish = ecology.group.children[1].children[0];
  const centre = ecology.snapshot().fish[0];
  const origin = new THREE.Vector3(centre.x, centre.y + 1, centre.z);
  const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0));
  fish.material.side = THREE.FrontSide;
  for (const level of ['high', 'medium', 'low']) {
    ecology.setQuality(level);
    ecology.group.updateMatrixWorld(true);
    const hit = ray.intersectObject(fish)[0];
    assert.ok(hit && hit.instanceId === 0 && hit.distance < 1,
      `${level} body winding exposes the back shell instead of the outward-facing skin`);
  }
  ecology.dispose();
});

test('ecology disposes its own resources once and leaves the shared seabed alive', () => {
  const ecology = createEcology(THREE, seabed, { value: 40 });
  const scene = new THREE.Scene();
  scene.add(seabed, ecology.group);
  const counts = [];
  ecology.group.traverse(object => {
    for (const resource of [object.geometry, object.material]) if (resource) {
      const counter = { count: 0 };
      resource.addEventListener('dispose', () => { counter.count++; });
      counts.push(counter);
    }
  });
  let bedDisposed = 0;
  seabed.children[0].geometry.addEventListener('dispose', () => { bedDisposed++; });
  ecology.dispose();
  ecology.dispose();
  assert.ok(counts.length >= 6);
  assert.ok(counts.every(counter => counter.count === 1));
  assert.equal(bedDisposed, 0);
  assert.equal(seabed.parent, scene);
  assert.equal(ecology.group.parent, null);
});

test('shared visual flow is slow and continuous rather than a frame-step random walk', () => {
  for (const point of [[0, 0], [8, -4], [-17, 12]]) for (const time of [0, 30, 300]) {
    const a = sampleFlow(...point, time), b = sampleFlow(...point, time + 1 / 60);
    assert.ok(Math.hypot(a.x, a.z) < .09);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < .001);
    assert.deepEqual(sampleFlow(...point, time), a);
  }
});

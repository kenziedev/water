import { sampleFlow, seededRandom } from './flow.js';
import { FAUNA_PORTAL_RADIUS, OBSERVATION_SPAN } from './ambient-events.js';
import { addCausticLighting } from './vegetation.js';

const CAPACITY = 48;
const TIERS = { high: [12, 8], medium: [10, 6], low: [8, 6] };

function routePoint(event, along) {
  const lateral = event.lane + event.curve * Math.sin(along * .105 + event.phase);
  const dx = Math.cos(event.angle), dz = Math.sin(event.angle);
  return { x: dx * along - dz * lateral, z: dz * along + dx * lateral };
}

export function createFishRoute(event, habitat) {
  let highest = -Infinity;
  // A wide corridor includes the school, body radius, low current displacement
  // and half-step travel. Cruise above its highest rock with no late dodges.
  for (let along = -FAUNA_PORTAL_RADIUS - 2; along <= FAUNA_PORTAL_RADIUS + 2; along += .5) {
    const point = routePoint(event, along);
    highest = Math.max(highest, habitat.clearanceHeight(point.x, point.z, 3));
  }
  const y = Math.max(-2.65, highest + .28);
  const random = seededRandom(event.seed);
  const members = Array.from({ length: event.count }, (_, index) => ({
    length: .27 + random() * .12,
    lateral: (index - (event.count - 1) * .5) * .42 + (random() - .5) * .1,
    trailing: index * .29 + random() * .12,
    phase: random() * Math.PI * 2,
    tone: .90 + random() * .10,
  }));
  return { y, members, blocked: y > -.65 };
}

export function sampleFishState(event, route, index, time) {
  if (route.blocked || time < event.entry || time > event.exit) return null;
  const member = route.members[index];
  const along = (time - event.start) * event.speed - OBSERVATION_SPAN * .5 - member.trailing;
  const point = routePoint(event, along);
  const flow = sampleFlow(point.x, point.z, time);
  const dx = Math.cos(event.angle), dz = Math.sin(event.angle);
  return {
    id: `${event.id}:${index}`, visit: event.id,
    x: point.x - dz * member.lateral + flow.x * .7,
    y: route.y + Math.sin(time * .42 + member.phase) * .023,
    z: point.z + dx * member.lateral + flow.z * .7,
    length: member.length, phase: member.phase,
    tailRate: Math.PI * 2 * (1.5 + event.speed * 1.6), tone: member.tone,
  };
}

function fishGeometry(THREE, level) {
  const [rings, sides] = TIERS[level];
  const positions = [], colors = [], indices = [];
  const vertex = (x, y, z, color) => {
    positions.push(x, y, z);
    colors.push(...color);
    return positions.length / 3 - 1;
  };
  for (let ring = 0; ring <= rings; ring++) {
    const angle = Math.PI * ring / rings;
    for (let side = 0; side <= sides; side++) {
      const around = Math.PI * 2 * side / sides;
      const height = Math.sin(angle) * Math.cos(around);
      const lightness = .64 - height * .14;
      vertex(.36 * Math.cos(angle) + .06, .115 * height,
        .10 * Math.sin(angle) * Math.sin(around), [lightness * .92, lightness, lightness * .92]);
      if (ring < rings && side < sides) {
        const a = ring * (sides + 1) + side, b = a + sides + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const fin = [.30, .37, .33];
  const tail = [[-.27, 0, 0], [-.56, .13, 0], [-.48, 0, 0], [-.56, -.13, 0]].map(p => vertex(...p, fin));
  indices.push(tail[0], tail[1], tail[2], tail[0], tail[2], tail[3]);
  const dorsal = [[-.19, .06, 0], [-.1, .19, 0], [.15, .1, 0]].map(p => vertex(...p, fin));
  indices.push(...dorsal);
  for (const side of [-1, 1]) {
    const pectoral = [[.11, -.02, side * .06], [-.04, -.055, side * .17], [-.08, -.02, side * .055]].map(p => vertex(...p, fin));
    indices.push(...pectoral);
    const eye = [[.31, .045, side * .066], [.29, .057, side * .076], [.275, .045, side * .082], [.29, .032, side * .076]]
      .map(p => vertex(...p, [.055, .065, .06]));
    indices.push(eye[0], eye[1], eye[2], eye[0], eye[2], eye[3]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createFauna(THREE, habitat, schedule, timeUniform, { quality = 'high', caustics = null } = {}) {
  let level = TIERS[quality] ? quality : 'medium';
  const group = new THREE.Group();
  group.name = 'Occasional shallow-water visitors';
  const phase = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  const tailRate = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true,
    roughness: .56, metalness: .05, envMapIntensity: .2, side: THREE.DoubleSide, transparent: false, depthWrite: true });
  material.onBeforeCompile = shader => {
    shader.uniforms.ecologyTime = timeUniform;
    shader.vertexShader = `
      uniform float ecologyTime;
      attribute float fishPhase, fishTailRate;
      float fishBend(float x) {
        float tail = 1.0 - smoothstep(-.5, .18, x);
        return sin(ecologyTime * fishTailRate + fishPhase + x * 6.0) * tail * tail * .065;
      }
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
      #include <beginnormal_vertex>
      objectNormal.x -= (fishBend(position.x + .005) - fishBend(position.x - .005)) * 100.0 * objectNormal.z;
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      transformed.z += fishBend(position.x);
    `);
    addCausticLighting(shader, caustics);
  };
  material.customProgramCacheKey = () => `small-silver-fish-v1-${Boolean(caustics)}`;
  const attachAttributes = geometry => {
    geometry.setAttribute('fishPhase', phase);
    geometry.setAttribute('fishTailRate', tailRate);
    return geometry;
  };
  let geometry = attachAttributes(fishGeometry(THREE, level));
  const fish = new THREE.InstancedMesh(geometry, material, CAPACITY);
  fish.name = 'Small silver coastal fish';
  fish.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fish.receiveShadow = true;
  fish.castShadow = false;
  fish.frustumCulled = false;
  fish.count = 0;
  group.add(fish);

  // An opaque-queue multiplicative footprint is captured by the underwater
  // pass. Its white rim is neutral, so it needs neither alpha blending nor a
  // dynamic scene-wide shadow map; it also leaves the seabed depth intact.
  const shadowStrength = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  const shadowGeometry = new THREE.CircleGeometry(1, 20);
  shadowGeometry.rotateX(-Math.PI / 2);
  shadowGeometry.setAttribute('shadowStrength', shadowStrength);
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff,
    blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: false, depthWrite: false,
    toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  shadowMaterial.defines = { USE_UV: '' };
  shadowMaterial.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float shadowStrength; varying float contactStrength;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ncontactStrength = shadowStrength;');
    shader.fragmentShader = 'varying float contactStrength;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float contactRadius = length(vUv - .5) * 2.0;
      diffuseColor.rgb = vec3(1.0 - contactStrength * pow(max(0.0, 1.0 - contactRadius), 2.0));
    `);
  };
  shadowMaterial.customProgramCacheKey = () => 'subtle-fish-contact-v1';
  const shadows = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, CAPACITY);
  shadows.name = 'Soft fish contact footprints';
  shadows.count = 0;
  shadows.renderOrder = 2;
  shadows.frustumCulled = false;
  shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(shadows);

  const routes = new Map();
  const transform = new THREE.Object3D();
  const shadowTransform = new THREE.Object3D();
  const heading = new THREE.Vector3(), forward = new THREE.Vector3(1, 0, 0);
  const groundNormal = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const groundRotation = new THREE.Quaternion(), yawRotation = new THREE.Quaternion();
  const color = new THREE.Color();
  const shadowRay = caustics?.receiverUniforms?.causticsRayOffset?.value ?? new THREE.Vector2(.3, .3);
  let lastTime = NaN, states = [], currentEvents = [];
  function update() {
    const time = timeUniform.value;
    if (time === lastTime) return false;
    currentEvents = schedule.activeAt(time);
    states = [];
    for (const event of currentEvents) {
      if (!routes.has(event.id)) routes.set(event.id, createFishRoute(event, habitat));
      const route = routes.get(event.id);
      for (let member = 0; member < event.count; member++) {
        const state = sampleFishState(event, route, member, time);
        if (!state) continue;
        if (states.length >= CAPACITY) throw new RangeError('Ambient fish pool capacity exceeded');
        const index = states.length;
        // Central differences give the same smooth orientation at every frame
        // rate and when seeking directly to a deterministic inspection time.
        const before = sampleFishState(event, route, member, Math.max(event.entry, time - .05));
        const after = sampleFishState(event, route, member, Math.min(event.exit, time + .05));
        heading.set(after.x - before.x, after.y - before.y, after.z - before.z).normalize();
        transform.position.set(state.x, state.y, state.z);
        transform.quaternion.setFromUnitVectors(forward, heading);
        transform.scale.setScalar(state.length);
        transform.updateMatrix();
        fish.setMatrixAt(index, transform.matrix);
        color.setScalar(state.tone);
        fish.setColorAt(index, color);
        phase.setX(index, state.phase);
        tailRate.setX(index, state.tailRate);

        const depth = Math.max(0, state.y - habitat.groundHeight(state.x, state.z));
        const sx = state.x + shadowRay.x * depth, sz = state.z + shadowRay.y * depth;
        const gy = habitat.groundHeight(sx, sz);
        groundNormal.set(-(habitat.groundHeight(sx + .08, sz) - habitat.groundHeight(sx - .08, sz)) / .16,
          1, -(habitat.groundHeight(sx, sz + .08) - habitat.groundHeight(sx, sz - .08)) / .16).normalize();
        groundRotation.setFromUnitVectors(up, groundNormal);
        yawRotation.setFromAxisAngle(up, -Math.atan2(heading.z, heading.x));
        shadowTransform.position.set(sx, gy + .016, sz);
        shadowTransform.quaternion.copy(groundRotation).multiply(yawRotation);
        shadowTransform.scale.set(state.length * (.65 + depth * .13), 1, state.length * (.22 + depth * .10));
        shadowTransform.updateMatrix();
        shadows.setMatrixAt(index, shadowTransform.matrix);
        shadowStrength.setX(index, .17 / (1 + depth * .6));
        states.push({ ...state, heading: heading.toArray() });
      }
    }
    fish.count = shadows.count = states.length;
    fish.instanceMatrix.needsUpdate = shadows.instanceMatrix.needsUpdate = true;
    if (fish.instanceColor) fish.instanceColor.needsUpdate = true;
    phase.needsUpdate = tailRate.needsUpdate = shadowStrength.needsUpdate = true;
    const activeIds = new Set(currentEvents.map(event => event.id));
    for (const id of routes.keys()) if (!activeIds.has(id)) routes.delete(id);
    lastTime = time;
    return true;
  }
  return {
    group, update,
    setQuality(next) {
      if (!TIERS[next] || level === next) return;
      level = next;
      const previous = geometry;
      geometry = attachAttributes(fishGeometry(THREE, level));
      fish.geometry = geometry;
      previous.dispose();
    },
    snapshot: () => ({ quality: level, activeVisits: currentEvents.map(event => ({ id: event.id,
      start: event.start, end: event.end, count: event.count })), fish: states.map(state => ({ ...state, heading: [...state.heading] })) }),
    dispose() {
      geometry.dispose(); material.dispose(); shadowGeometry.dispose(); shadowMaterial.dispose();
      fish.dispose(); shadows.dispose(); routes.clear();
    },
  };
}

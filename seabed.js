// A fixed, three-dimensional limestone bed. The water above it supplies all
// motion and underwater colour; no rock vertices or texture coordinates move.
export function createSeabed(THREE, bedTexture, timeUniform) {
  const group = new THREE.Group();
  group.name = 'Mediterranean seabed';
  const random = seededRandom(0x51a7c0a5);

  function groundHeight(x, z) {
    const ridge = x + 3.2 * Math.sin(z * .095) + 2.0;
    return -4.65
      + .42 * noise3(x * .095, z * .095, 3.1)
      + .17 * noise3(x * .29, z * .29, 7.4)
      + .55 * Math.exp(-ridge * ridge / 65)
      + .16 * Math.sin(z * .13 + .7);
  }

  const groundMap = prepareMap(THREE, bedTexture, 6.2);
  const rockMap = prepareMap(THREE, bedTexture, 2.1);
  const groundMaterial = stoneMaterial(THREE, groundMap, .72, 1.28);
  const rockMaterial = stoneMaterial(THREE, rockMap, .85, 1.65);

  const groundGeometry = new THREE.PlaneGeometry(128, 128, 160, 160);
  groundGeometry.rotateX(-Math.PI / 2);
  const groundPositions = groundGeometry.attributes.position;
  const groundColors = new Float32Array(groundPositions.count * 3);
  for (let i = 0; i < groundPositions.count; i++) {
    const x = groundPositions.getX(i);
    const z = groundPositions.getZ(i);
    groundPositions.setY(i, groundHeight(x, z));
    const shade = .91 + .07 * noise3(x * .45, z * .45, 14.2);
    groundColors.set([shade, shade * .985, shade * .95], i * 3);
  }
  groundGeometry.setAttribute('color', new THREE.BufferAttribute(groundColors, 3));
  groundGeometry.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.name = 'Uneven limestone floor';
  ground.receiveShadow = true;
  group.add(ground);

  // A few long shelves establish the geology; smaller stones settle around
  // them. Separating their footprint avoids a field of intersecting spheres.
  const stones = [];
  const shelves = [
    [-4.9, -2.7, 2.25, .83, 1.65, .35],
    [3.6, -6.4, 1.75, .73, 2.35, -.45],
    [-1.7, -11.5, 2.1, .64, 1.55, .65],
    [7.9, .8, 2.0, .76, 1.55, .15],
    [-8.8, 4.0, 1.9, .68, 1.35, -.25],
    [8.4, -13.3, 1.85, .63, 1.65, -.2],
  ];
  for (const [x, z, sx, sy, sz, angle] of shelves) {
    stones.push({ x, z, sx, sy, sz, angle, variant: stones.length % 4 });
  }

  for (let attempt = 0; stones.length < 158 && attempt < 4500; attempt++) {
    const theta = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * 26;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius - 3;
    const size = .34 + Math.pow(random(), 1.65) * 1.32;
    const sx = size * (.8 + random() * .65);
    const sz = size * (.8 + random() * .65);
    if (stones.some(stone => {
      const minimumGap = (Math.max(sx, sz) + Math.max(stone.sx, stone.sz)) * .66;
      return (x - stone.x) ** 2 + (z - stone.z) ** 2 < minimumGap ** 2;
    })) continue;
    const sy = size * (.35 + random() * .32);
    stones.push({
      x, z, sx, sy, sz,
      angle: random() * Math.PI * 2,
      variant: size > 1.12 ? Math.floor(random() * 4) : 4 + Math.floor(random() * 6),
    });
  }

  const transform = new THREE.Object3D();
  const stoneColor = new THREE.Color();
  const warmStone = new THREE.Color('#dbd5c3');
  const coolStone = new THREE.Color('#a5b1ac');
  for (let variant = 0; variant < 10; variant++) {
    const batch = stones.filter(stone => stone.variant === variant);
    if (!batch.length) continue;
    const geometry = makeStoneGeometry(THREE, variant < 4 ? 3 : 2, variant + 11);
    const instances = new THREE.InstancedMesh(geometry, rockMaterial, batch.length);
    instances.name = `Fixed limestone boulders ${variant + 1}`;
    instances.castShadow = true;
    instances.receiveShadow = true;
    batch.forEach((stone, index) => {
      transform.position.set(stone.x, groundHeight(stone.x, stone.z) + stone.sy * .27, stone.z);
      transform.rotation.set((random() - .5) * .22, stone.angle, (random() - .5) * .20);
      transform.scale.set(stone.sx, stone.sy, stone.sz);
      transform.updateMatrix();
      instances.setMatrixAt(index, transform.matrix);
      stoneColor.copy(warmStone).lerp(coolStone, random() * .72);
      stoneColor.multiplyScalar(.87 + random() * .19);
      instances.setColorAt(index, stoneColor);
    });
    instances.instanceMatrix.needsUpdate = true;
    instances.instanceColor.needsUpdate = true;
    instances.computeBoundingSphere();
    group.add(instances);
  }

  // Low-profile rubble has its own geometry and a more concentrated layout.
  // Instancing keeps this detail to one draw call without animating anything.
  const rubbleCount = 480;
  const rubble = new THREE.InstancedMesh(makeStoneGeometry(THREE, 1, 91), rockMaterial, rubbleCount);
  rubble.name = 'Settled pebbles and fragments';
  rubble.receiveShadow = true;
  for (let index = 0; index < rubbleCount; index++) {
    const cluster = stones[Math.floor(random() * stones.length)];
    const angle = random() * Math.PI * 2;
    const radius = Math.max(cluster.sx, cluster.sz) * (.8 + random() * 1.15);
    const x = cluster.x + Math.cos(angle) * radius;
    const z = cluster.z + Math.sin(angle) * radius;
    const size = .055 + Math.pow(random(), 1.4) * .17;
    transform.position.set(x, groundHeight(x, z) + size * .10, z);
    transform.rotation.set(random() * .35, random() * Math.PI * 2, random() * .25);
    transform.scale.set(size * (1 + random() * .7), size * (.4 + random() * .4), size);
    transform.updateMatrix();
    rubble.setMatrixAt(index, transform.matrix);
    stoneColor.copy(warmStone).lerp(coolStone, random() * .85);
    stoneColor.multiplyScalar(.8 + random() * .25);
    rubble.setColorAt(index, stoneColor);
  }
  rubble.instanceMatrix.needsUpdate = true;
  rubble.instanceColor.needsUpdate = true;
  rubble.computeBoundingSphere();
  group.add(rubble);

  group.userData.rockCount = stones.length;
  group.userData.pebbleCount = rubbleCount;
  group.userData.groundHeight = groundHeight;
  // timeUniform is intentionally unused: it belongs to the moving water, not
  // this static bed. Keep the argument for the shared scene construction API.
  return group;
}

function prepareMap(THREE, source, repeat) {
  if (!source) return null;
  const map = source.clone();
  map.wrapS = map.wrapT = THREE.MirroredRepeatWrapping;
  map.repeat.set(repeat, repeat);
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

function stoneMaterial(THREE, map, neutralize, exposure) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map,
    bumpMap: map,
    bumpScale: .045,
    roughness: .96,
    metalness: 0,
    envMapIntensity: .16,
    vertexColors: true,
  });
  if (map) {
    // The source photograph already contains blue underwater absorption.
    // Recover neutral limestone detail before the real water applies it again.
    // This affects colour only; it has no time input or moving lighting bands.
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         float stoneLuminance = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
         vec3 limestoneColour = stoneLuminance * vec3(1.065, 1.025, .935);
         diffuseColor.rgb = mix(diffuseColor.rgb, limestoneColour, ${neutralize.toFixed(3)}) * ${exposure.toFixed(3)};`,
      );
    };
    material.customProgramCacheKey = () => `static-limestone-${neutralize}-${exposure}`;
  }
  return material;
}

function makeStoneGeometry(THREE, detail, seed) {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const roundedBlock = 1 / Math.pow(Math.max(Math.abs(x), Math.abs(y), Math.abs(z)), .25);
    const largeDetail = noise3(x * 1.45 + seed * 3.7, y * 1.45, z * 1.45);
    const smallDetail = noise3(x * 4.9, y * 4.9 + seed * 2.3, z * 4.9);
    const radius = roundedBlock * (1 + largeDetail * .24 + smallDetail * .055);
    position.setXYZ(i,
      x * radius + .12 * y * z,
      y * radius + .075 * x * x - .055 * z,
      z * radius + .10 * x * y,
    );
    const shade = .94 + .055 * noise3(x * 3.1 + seed, y * 3.1, z * 3.1);
    colors.set([shade, shade, shade], i * 3);
    uv.setXY(i, uv.getX(i) * .83 + seed * .137, uv.getY(i) * .83 + seed * .191);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  smoothCoincidentNormals(THREE, geometry);
  geometry.computeBoundingSphere();
  return geometry;
}

function smoothCoincidentNormals(THREE, geometry) {
  // IcosahedronGeometry duplicates vertices along faces and UV seams. Share
  // the accumulated normals by position, while retaining those texture seams.
  const positions = geometry.attributes.position;
  const accumulated = new Map();
  const keys = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), face = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    const key = `${Math.round(positions.getX(i) * 100000)},${Math.round(positions.getY(i) * 100000)},${Math.round(positions.getZ(i) * 100000)}`;
    keys.push(key);
    if (!accumulated.has(key)) accumulated.set(key, new THREE.Vector3());
  }
  for (let i = 0; i < positions.count; i += 3) {
    a.fromBufferAttribute(positions, i);
    b.fromBufferAttribute(positions, i + 1);
    c.fromBufferAttribute(positions, i + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    face.crossVectors(ab, ac);
    accumulated.get(keys[i]).add(face);
    accumulated.get(keys[i + 1]).add(face);
    accumulated.get(keys[i + 2]).add(face);
  }
  const normals = new Float32Array(positions.count * 3);
  accumulated.forEach(normal => normal.normalize());
  for (let i = 0; i < positions.count; i++) accumulated.get(keys[i]).toArray(normals, i * 3);
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
}

function seededRandom(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const hash = (dx, dy, dz) => {
    const value = Math.sin((ix + dx) * 127.1 + (iy + dy) * 311.7 + (iz + dz) * 74.7) * 43758.5453;
    return (value - Math.floor(value)) * 2 - 1;
  };
  const mix = (a, b, t) => a + (b - a) * t;
  return mix(
    mix(mix(hash(0, 0, 0), hash(1, 0, 0), fx), mix(hash(0, 1, 0), hash(1, 1, 0), fx), fy),
    mix(mix(hash(0, 0, 1), hash(1, 0, 1), fx), mix(hash(0, 1, 1), hash(1, 1, 1), fx), fy),
    fz,
  );
}

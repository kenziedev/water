// A fixed, three-dimensional limestone bed. The water above it supplies all
// motion and underwater colour; no rock vertices or texture coordinates move.
export function createSeabed(THREE, bedTexture, timeUniform, caustics = null) {
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
  const causticsUniforms = caustics?.receiverUniforms ?? null;
  const groundMaterial = stoneMaterial(THREE, groundMap, .72, 1.28, false, causticsUniforms);
  const rockMaterial = stoneMaterial(THREE, rockMap, .85, 1.65, true, causticsUniforms);

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
  const rockObstacles = [], pebbleObstacles = [];
  const recordObstacle = (geometry, destination) => {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bounds = geometry.boundingBox.clone().applyMatrix4(transform.matrix);
    destination.push(Object.freeze({
      minX: bounds.min.x, maxX: bounds.max.x,
      minY: bounds.min.y, maxY: bounds.max.y,
      minZ: bounds.min.z, maxZ: bounds.max.z,
    }));
  };
  const stoneColor = new THREE.Color();
  const warmStone = new THREE.Color('#dbd5c3');
  const coolStone = new THREE.Color('#a5b1ac');
  for (let variant = 0; variant < 10; variant++) {
    const batch = stones.filter(stone => stone.variant === variant);
    if (!batch.length) continue;
    const geometry = makeStoneGeometry(THREE, variant < 4 ? 6 : 2, variant + 11, variant < 4);
    const instances = new THREE.InstancedMesh(geometry, rockMaterial, batch.length);
    instances.name = `Fixed limestone boulders ${variant + 1}`;
    instances.castShadow = true;
    instances.receiveShadow = true;
    batch.forEach((stone, index) => {
      transform.position.set(stone.x, groundHeight(stone.x, stone.z) + stone.sy * (variant < 4 ? .035 : .27), stone.z);
      transform.rotation.set((random() - .5) * .22, stone.angle, (random() - .5) * .20);
      transform.scale.set(stone.sx, stone.sy, stone.sz);
      transform.updateMatrix();
      instances.setMatrixAt(index, transform.matrix);
      recordObstacle(geometry, rockObstacles);
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
    recordObstacle(rubble.geometry, pebbleObstacles);
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
  // Conservative bounds of the actual transformed geometry, used by rooted
  // vegetation and swimming routes without changing the static seabed.
  group.userData.rockObstacles = Object.freeze(rockObstacles);
  group.userData.pebbleObstacles = Object.freeze(pebbleObstacles);
  group.userData.setCaustics = nextCaustics => {
    const uniforms = nextCaustics?.receiverUniforms ?? null;
    groundMaterial.userData.setCaustics(uniforms);
    rockMaterial.userData.setCaustics(uniforms);
  };
  // The shared caustic field carries moving sunlight. Neither the bed geometry
  // nor its colour textures use time; keep the argument for the scene API.
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

function stoneMaterial(THREE, map, neutralize, exposure, detailOnly = false, causticsUniforms = null) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map,
    roughness: .96,
    metalness: 0,
    envMapIntensity: .16,
    vertexColors: true,
  });
  let causticsRevision = 0;
  material.userData.setCaustics = uniforms => {
    if (causticsUniforms === uniforms) return;
    causticsUniforms = uniforms;
    causticsRevision++;
    material.needsUpdate = true;
  };
  {
    // The source photograph already contains blue underwater absorption.
    // Recover neutral limestone detail before the real water applies it again.
    // This affects fixed colour only. Caustics modulate direct lighting below.
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 mineralPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vec4 mineralWorld = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           mineralWorld = instanceMatrix * mineralWorld;
         #endif
         mineralPosition = (modelMatrix * mineralWorld).xyz;`,
      );
      shader.fragmentShader = `
        varying vec3 mineralPosition;
        float mineralHash(vec3 p) {
          p = fract(p * .1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }
        float mineralNoise(vec3 p) {
          vec3 cell = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(mineralHash(cell), mineralHash(cell + vec3(1, 0, 0)), f.x),
                mix(mineralHash(cell + vec3(0, 1, 0)), mineralHash(cell + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(mineralHash(cell + vec3(0, 0, 1)), mineralHash(cell + vec3(1, 0, 1)), f.x),
                mix(mineralHash(cell + vec3(0, 1, 1)), mineralHash(cell + vec3(1, 1, 1)), f.x), f.y), f.z);
        }
      ` + shader.fragmentShader;
      if (map) shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>', detailOnly ? `
         #ifdef USE_MAP
           // Keep fine mineral texture, not the photograph's complete rocks,
           // their baked shadows, or its underwater illumination.
           vec3 stoneSample = texture2D(map, vMapUv).rgb;
           vec3 coarseStone = (
             texture2D(map, vMapUv + vec2(.028, .011)).rgb +
             texture2D(map, vMapUv + vec2(-.028, -.011)).rgb +
             texture2D(map, vMapUv + vec2(.011, -.028)).rgb +
             texture2D(map, vMapUv + vec2(-.011, .028)).rgb
           ) * .25;
           float stoneDetail = dot(stoneSample - coarseStone, vec3(.2126, .7152, .0722));
           float coarseLuma = dot(coarseStone, vec3(.2126, .7152, .0722));
           float mineralMottle = (mineralNoise(mineralPosition * 1.35) - .5) * .60
                               + (mineralNoise(mineralPosition * 4.7) - .5) * .30;
           float fineStone = clamp(stoneDetail / max(coarseLuma, .045), -.8, .8);
           float mineralTone = pow(clamp(coarseLuma / .18, .25, 1.8), .42);
           diffuseColor.rgb *= .30 * mineralTone * clamp(.88 + fineStone * .60 + mineralMottle, .35, 1.45);
         #endif
        ` : `#include <map_fragment>
         float stoneLuminance = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
         vec3 limestoneColour = stoneLuminance * vec3(1.065, 1.025, .935);
         diffuseColor.rgb = mix(diffuseColor.rgb, limestoneColour, ${neutralize.toFixed(3)}) * ${exposure.toFixed(3)};`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         // Millimetre-scale fixed stone grain. It is independent of the photo
         // and fades when too small for a screen pixel to resolve.
         vec3 grainPoint = mineralPosition * 52.0;
         float grainFootprint = max(length(dFdx(grainPoint)), length(dFdy(grainPoint)));
         float grainFade = 1.0 - smoothstep(.45, 1.5, grainFootprint);
         float grainHeight = (mineralNoise(grainPoint) - .5) * .0017 * grainFade;
         vec2 grainSlope = vec2(dFdx(grainHeight), dFdy(grainHeight));
         vec3 mineralDx = dFdx(-vViewPosition), mineralDy = dFdy(-vViewPosition);
         vec3 grainR1 = cross(mineralDy, normal), grainR2 = cross(normal, mineralDx);
         float grainDet = dot(mineralDx, grainR1) * (gl_FrontFacing ? 1.0 : -1.0);
         vec3 grainGradient = sign(grainDet) * (grainSlope.x * grainR1 + grainSlope.y * grainR2);
         normal = normalize(abs(grainDet) * normal - grainGradient);`,
      );
      if (causticsUniforms) {
        Object.assign(shader.uniforms, causticsUniforms);
        shader.fragmentShader = `
          uniform sampler2D causticsMap;
          uniform float causticsPatchSize;
          uniform float causticsStrength;
          uniform float causticsReferenceDepth;
          uniform vec2 causticsRayOffset;
        ` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
           // Project onto the field's receiver plane along the refracted sun
           // ray, so different rock heights share one coherent light pattern.
           vec2 causticsUv = (mineralPosition.xz
             + causticsRayOffset * (mineralPosition.y + causticsReferenceDepth))
             / causticsPatchSize;
           float causticsDepth = -mineralPosition.y;
           vec3 causticsWorldNormal = inverseTransformDirection(normal, viewMatrix);
           float causticsFacing = smoothstep(.08, .78, causticsWorldNormal.y);
           float causticsDepthFade = smoothstep(.10, .50, causticsDepth)
             * (1.0 - smoothstep(3.0, 9.0, causticsDepth));
           float causticsFocus = clamp(texture2D(causticsMap, causticsUv).r, .65, 1.55);
           float causticsWeight = clamp(causticsStrength, 0.0, 1.0)
             * causticsFacing * causticsDepthFade;
           // Direct diffuse already contains the sun's shadow visibility.
           // Keep occluded faces and ambient light free of luminous overlays.
           reflectedLight.directDiffuse *= mix(1.0, causticsFocus, causticsWeight);`,
        );
      }
    };
    material.customProgramCacheKey = () => `static-fractured-limestone-v5-${neutralize}-${exposure}-${detailOnly}-${Boolean(causticsUniforms)}-${causticsRevision}`;
  }
  return material;
}

function makeStoneGeometry(THREE, detail, seed, slab = false) {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const colors = new Float32Array(position.count * 3);
  const planeRandom = seededRandom(seed * 0x45d9f3b);
  const fracturePlanes = slab ? [
    [new THREE.Vector3(.08 + planeRandom() * .13, 1, -.16 + planeRandom() * .22).normalize(), .76 + planeRandom() * .12],
    [new THREE.Vector3(.82, .14 + planeRandom() * .28, .46).normalize(), .77 + planeRandom() * .14],
    [new THREE.Vector3(-.56, -.08 + planeRandom() * .20, .83).normalize(), .76 + planeRandom() * .16],
    [new THREE.Vector3(.30, .13 + planeRandom() * .14, -.94).normalize(), .82 + planeRandom() * .12],
  ] : [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const roundedBlock = 1 / Math.pow(Math.max(Math.abs(x), Math.abs(y), Math.abs(z)), .25);
    const largeDetail = noise3(x * 1.45 + seed * 3.7, y * 1.45, z * 1.45);
    const smallDetail = noise3(x * 4.9, y * 4.9 + seed * 2.3, z * 4.9);
    let radius = roundedBlock * (1 + largeDetail * .24 + smallDetail * .055);
    if (slab) {
      // A rounded block intersected by asymmetric fracture planes has broad
      // ledges and broken shoulders instead of a scaled spherical silhouette.
      radius = 1 / Math.pow(Math.abs(x) ** 7 + Math.abs(y) ** 7 + Math.abs(z) ** 7, 1 / 7);
      for (const [plane, distance] of fracturePlanes) {
        const facing = plane.x * x + plane.y * y + plane.z * z;
        if (facing > 0) radius = Math.min(radius, distance / facing);
      }
      radius *= 1 + largeDetail * .028 + smallDetail * .009;
    }
    position.setXYZ(i,
      x * radius + (slab ? .035 : .12) * y * z,
      y * radius + (slab ? .02 : .075) * x * x - (slab ? .025 : .055) * z,
      z * radius + (slab ? .03 : .10) * x * y,
    );
    const shade = .94 + .055 * noise3(x * 3.1 + seed, y * 3.1, z * 3.1);
    colors.set([shade, shade, shade], i * 3);
    uv.setXY(i, uv.getX(i) * .83 + seed * .137, uv.getY(i) * .83 + seed * .191);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  smoothCoincidentNormals(THREE, geometry, slab ? Math.PI * .24 : Math.PI);
  geometry.computeBoundingSphere();
  return geometry;
}

function smoothCoincidentNormals(THREE, geometry, creaseAngle) {
  // IcosahedronGeometry duplicates vertices along faces and UV seams. Share
  // the accumulated normals by position, while retaining those texture seams.
  const positions = geometry.attributes.position;
  const accumulated = new Map();
  const faceRecords = [];
  const neighboringFaces = new Map();
  const keys = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), face = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    const key = `${Math.round(positions.getX(i) * 100000)},${Math.round(positions.getY(i) * 100000)},${Math.round(positions.getZ(i) * 100000)}`;
    keys.push(key);
    if (!accumulated.has(key)) {
      accumulated.set(key, new THREE.Vector3());
      neighboringFaces.set(key, []);
    }
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
    const record = { normal: face.clone().normalize(), weighted: face.clone() };
    faceRecords.push(record);
    neighboringFaces.get(keys[i]).push(record);
    neighboringFaces.get(keys[i + 1]).push(record);
    neighboringFaces.get(keys[i + 2]).push(record);
  }
  const normals = new Float32Array(positions.count * 3);
  accumulated.forEach(normal => normal.normalize());
  const cosine = Math.cos(creaseAngle);
  const smoothed = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    if (creaseAngle >= Math.PI) accumulated.get(keys[i]).toArray(normals, i * 3);
    else {
      const current = faceRecords[Math.floor(i / 3)].normal;
      smoothed.set(0, 0, 0);
      for (const neighbor of neighboringFaces.get(keys[i])) {
        if (current.dot(neighbor.normal) >= cosine) smoothed.add(neighbor.weighted);
      }
      smoothed.normalize().toArray(normals, i * 3);
    }
  }
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

import { flowGLSL, seededRandom } from './flow.js';

const TIERS = { high: { leaves: 20, segments: 8 }, medium: { leaves: 12, segments: 6 }, low: { leaves: 6, segments: 4 } };

// Also used by the opaque fish material. Caustics change already shadowed sun
// illumination, never the object's base colour or its geometric silhouette.
export function addCausticLighting(shader, caustics) {
  if (!caustics?.receiverUniforms) return;
  Object.assign(shader.uniforms, caustics.receiverUniforms);
  shader.vertexShader = 'varying vec3 ecologyWorldPosition;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `
    #include <worldpos_vertex>
    vec4 ecologyWorld = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      ecologyWorld = instanceMatrix * ecologyWorld;
    #endif
    ecologyWorldPosition = (modelMatrix * ecologyWorld).xyz;
  `);
  shader.fragmentShader = `
    varying vec3 ecologyWorldPosition;
    uniform sampler2D causticsMap;
    uniform float causticsPatchSize, causticsStrength, causticsReferenceDepth;
    uniform vec2 causticsRayOffset;
  ` + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
    #include <lights_fragment_end>
    vec2 ecologyLightUv = (ecologyWorldPosition.xz
      + causticsRayOffset * (ecologyWorldPosition.y + causticsReferenceDepth)) / causticsPatchSize;
    float ecologyDepth = -ecologyWorldPosition.y;
    float ecologyLightMask = smoothstep(.1, .5, ecologyDepth)
      * (1.0 - smoothstep(3.0, 9.0, ecologyDepth))
      * smoothstep(.08, .78, inverseTransformDirection(normal, viewMatrix).y);
    float ecologyFocus = clamp(texture2D(causticsMap, ecologyLightUv).r, .65, 1.55);
    reflectedLight.directDiffuse *= mix(1.0, ecologyFocus, clamp(causticsStrength, 0.0, 1.0) * ecologyLightMask);
  `);
}

function bladeGeometry(THREE, segments) {
  const positions = [], colors = [], indices = [];
  for (let row = 0; row <= segments; row++) {
    const t = row / segments;
    const width = .038 * (1 - t) * (.45 + Math.sin(Math.PI * t));
    for (let side = 0; side < 3; side++) {
      positions.push((side - 1) * width, t, .055 * t * t + (side === 1 ? .004 * Math.sin(Math.PI * t) : 0));
      const tone = .66 + .34 * t;
      colors.push(tone, tone, tone * .97);
    }
    if (row < segments) for (let side = 0; side < 2; side++) {
      const a = row * 3 + side, b = a + 3;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createVegetation(THREE, habitat, timeUniform, { quality = 'high', caustics = null } = {}) {
  let level = TIERS[quality] ? quality : 'medium';
  const capacity = habitat.clusters.length * TIERS.high.leaves;
  const phases = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: .87, metalness: 0, side: THREE.DoubleSide,
    transparent: false, depthWrite: true, vertexColors: true, envMapIntensity: .16,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.ecologyTime = timeUniform;
    shader.vertexShader = `
      uniform float ecologyTime;
      attribute float leafPhase;
      ${flowGLSL}
      vec2 leafBend() {
        vec2 root = instanceMatrix[3].xz;
        vec2 current = ecologyFlow(root, ecologyTime);
        vec2 localCurrent = vec2(dot(current, normalize(instanceMatrix[0].xz)),
          dot(current, normalize(instanceMatrix[2].xz)));
        return localCurrent * 1.25 + .018 * vec2(
          sin(ecologyTime * .43 + leafPhase + root.x * .12),
          cos(ecologyTime * .37 + leafPhase + root.y * .10));
      }
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
      #include <beginnormal_vertex>
      vec2 currentBend = leafBend();
      objectNormal.y -= 2.0 * position.y * dot(objectNormal.xz, currentBend);
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      // Zero displacement and zero bending derivative at every rooted base.
      transformed.xz += currentBend * position.y * position.y;
    `);
    addCausticLighting(shader, caustics);
  };
  material.customProgramCacheKey = () => `rooted-seagrass-v1-${Boolean(caustics)}`;
  let geometry = bladeGeometry(THREE, TIERS[level].segments);
  geometry.setAttribute('leafPhase', phases);
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'Rooted seagrass meadows';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  const transform = new THREE.Object3D();
  const leafColor = new THREE.Color();
  const roots = [];
  // Interleave habitats first: every quality level keeps every planted patch.
  for (let leaf = 0; leaf < TIERS.high.leaves; leaf++) for (const cluster of habitat.clusters) {
    const index = leaf * habitat.clusters.length + cluster.id;
    const random = seededRandom(cluster.seed ^ Math.imul(leaf + 1, 0x45d9f3b));
    const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * .23;
    const x = cluster.x + Math.cos(angle) * radius;
    const z = cluster.z + Math.sin(angle) * radius;
    const y = habitat.groundHeight(x, z) - .018;
    transform.position.set(x, y, z);
    transform.rotation.set((random() - .5) * .15, random() * Math.PI * 2, (random() - .5) * .15);
    transform.scale.setScalar(cluster.scale * (.62 + random() * .38));
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    leafColor.setHSL(.24 + random() * .045, .21 + random() * .10, .27 + random() * .10);
    mesh.setColorAt(index, leafColor);
    phases.setX(index, cluster.phase + random() * .8);
    roots.push(Object.freeze({ cluster: cluster.id, x, y, z }));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  if (mesh.boundingSphere) mesh.boundingSphere.radius += .3;
  mesh.count = habitat.clusters.length * TIERS[level].leaves;
  return {
    mesh, roots: Object.freeze(roots),
    setQuality(next) {
      if (!TIERS[next] || level === next) return;
      level = next;
      const previous = geometry;
      geometry = bladeGeometry(THREE, TIERS[level].segments);
      geometry.setAttribute('leafPhase', phases);
      mesh.geometry = geometry;
      mesh.count = habitat.clusters.length * TIERS[level].leaves;
      previous.dispose();
    },
    snapshot: () => ({ quality: level, clusters: habitat.clusters.length, leaves: mesh.count }),
    dispose() { geometry.dispose(); material.dispose(); mesh.dispose(); },
  };
}

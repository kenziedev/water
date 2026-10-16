import { createWaveField } from './wave-field.js';

const MOTION_PRESETS = {
  calm: { refractionStrength: .22, maxOffset: .006, roughness: .135, specularIntensity: .42 },
  natural: { refractionStrength: .55, maxOffset: .018, roughness: .10, specularIntensity: .72 },
};

// A comfort-oriented approximation: actual scene depth controls absorption and
// ripple displacement, while the mean seabed image stays anchored. Comparing
// perturbed and flat-surface rays removes the large moving warp of a ray march.
const opticsGLSL = /* glsl */ `
  uniform sampler2D underwaterColor;
  uniform sampler2D underwaterDepth;
  uniform vec2 surfaceResolution;
  uniform mat4 waterProjection;
  uniform mat4 waterProjectionInverse;
  uniform vec2 waterClip;
  uniform float refractionStrength;
  uniform float refractionMaxOffset;
  float underwaterViewZ(float depth) {
    return waterClip.x * waterClip.y / ((waterClip.y - waterClip.x) * depth - waterClip.y);
  }
  vec2 waterProject(vec3 p) {
    vec4 projected = waterProjection * vec4(p, 1.0);
    return projected.xy / max(projected.w, .001) * .5 + .5;
  }
  vec3 waterReconstruct(vec2 uv, float depth) {
    vec4 p = waterProjectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }
  vec3 underwaterRadiance(vec3 origin, vec3 direction, vec3 meanDirection) {
    vec2 baseUv = gl_FragCoord.xy / surfaceResolution;
    float baseDepth = texture2D(underwaterDepth, baseUv).r;
    vec3 basePoint = waterReconstruct(baseUv, baseDepth);
    float baseLength = clamp(length(basePoint - origin), 0.0, 14.0);
    vec2 offset = waterProject(origin + direction * baseLength)
                - waterProject(origin + meanDirection * baseLength);
    // Limit in screen-height units, so the comfort limit does not depend on
    // render quality or stretch horizontally on wide displays.
    float aspect = surfaceResolution.x / surfaceResolution.y;
    float offsetLength = length(offset * vec2(aspect, 1.0));
    offset *= refractionMaxOffset / (refractionMaxOffset + offsetLength);
    vec2 radius = refractionMaxOffset * vec2(1.0 / aspect, 1.0);

    // The edge mask samples FIXED screen positions. With a still camera and
    // bed it does not change as waves move, avoiding valid/invalid hit boiling.
    float baseZ = underwaterViewZ(baseDepth);
    float depthJump = 0.0;
    depthJump = max(depthJump, abs(underwaterViewZ(texture2D(underwaterDepth, baseUv + vec2(radius.x, 0.0)).r) - baseZ));
    depthJump = max(depthJump, abs(underwaterViewZ(texture2D(underwaterDepth, baseUv - vec2(radius.x, 0.0)).r) - baseZ));
    depthJump = max(depthJump, abs(underwaterViewZ(texture2D(underwaterDepth, baseUv + vec2(0.0, radius.y)).r) - baseZ));
    depthJump = max(depthJump, abs(underwaterViewZ(texture2D(underwaterDepth, baseUv - vec2(0.0, radius.y)).r) - baseZ));
    // Diagonal samples cover slanted rock and fish edges as well as horizontal
    // and vertical ones, without following the time-varying refracted ray.
    vec2 diagonal = radius * .70710678;
    depthJump = max(depthJump, abs(underwaterViewZ(texture2D(underwaterDepth, baseUv + diagonal).r) - baseZ));
    depthJump = max(depthJump, abs(underwaterViewZ(texture2D(underwaterDepth, baseUv - diagonal).r) - baseZ));
    depthJump = max(depthJump, abs(underwaterViewZ(texture2D(underwaterDepth, baseUv + vec2(diagonal.x, -diagonal.y)).r) - baseZ));
    depthJump = max(depthJump, abs(underwaterViewZ(texture2D(underwaterDepth, baseUv + vec2(-diagonal.x, diagonal.y)).r) - baseZ));
    float silhouetteWeight = 1.0 - smoothstep(.12, .7, depthJump);
    float edge = min(min(baseUv.x / radius.x, baseUv.y / radius.y),
                     min((1.0 - baseUv.x) / radius.x, (1.0 - baseUv.y) / radius.y));
    float edgeWeight = smoothstep(1.0, 2.0, edge);
    vec2 sampleUv = baseUv + offset * silhouetteWeight * edgeWeight;

    // One colour lookup, never a cross-fade between displaced rock silhouettes.
    vec3 colour = texture2D(underwaterColor, sampleUv).rgb;
    float sceneDepth = texture2D(underwaterDepth, sampleUv).r;
    float pathLength = clamp(length(waterReconstruct(sampleUv, sceneDepth) - origin), 0.0, 14.0);
    // Art-directed coastal absorption coefficients, in inverse metres.
    // Shallow limestone keeps its warm detail; deeper paths become turquoise.
    vec3 transmission = exp(-vec3(.11, .026, .038) * pathLength);
    vec3 scatter = vec3(.018, .12, .105);
    return colour * transmission + scatter * (1.0 - transmission);
  }
`;

export function createOcean(THREE, renderer, timeUniform, underwaterUniforms) {
  const field = createWaveField(THREE, renderer, timeUniform);
  const geometry = new THREE.PlaneGeometry(64, 64, 256, 256);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: MOTION_PRESETS.calm.roughness,
    specularIntensity: MOTION_PRESETS.calm.specularIntensity,
    transmission: 0, ior: 1.333, envMapIntensity: .45, dithering: true,
  });
  const motionUniforms = {
    refractionStrength: { value: MOTION_PRESETS.calm.refractionStrength },
    refractionMaxOffset: { value: MOTION_PRESETS.calm.maxOffset },
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, underwaterUniforms, motionUniforms, { waveField: { value: field.texture } });
    const fieldGLSL = /* glsl */ `
      uniform sampler2D waveField;
      varying vec2 waterPoint;
      vec4 sampleWater(vec2 p) {
        return texture2D(waveField, p / ${field.patchSize.toFixed(1)});
      }
    `;
    shader.vertexShader = fieldGLSL + shader.vertexShader;
    shader.fragmentShader = fieldGLSL + opticsGLSL + shader.fragmentShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `vec3 fieldValue = sampleWater(position.xz).rgb;
       float meshDx = (sampleWater(position.xz + vec2(.125, 0.0)).r - sampleWater(position.xz - vec2(.125, 0.0)).r) / .25;
       float meshDz = (sampleWater(position.xz + vec2(0.0, .125)).r - sampleWater(position.xz - vec2(0.0, .125)).r) / .25;
       vec3 objectNormal = normalize(vec3(-meshDx, 1.0, -meshDz));
       #ifdef USE_TANGENT
         vec3 objectTangent = vec3(tangent.xyz);
       #endif`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      'vec3 transformed = position + vec3(0.0, fieldValue.r, 0.0); waterPoint = position.xz;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
       vec4 waveFootprint = sampleWater(waterPoint);
       float unresolvedSlope = max(0.0, waveFootprint.a - dot(waveFootprint.gb, waveFootprint.gb));
       roughnessFactor = sqrt(roughnessFactor * roughnessFactor + unresolvedSlope * .4);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       vec3 waterNormal = normalize(vec3(-waveFootprint.g, 1.0, -waveFootprint.b));
       normal = normalize(mat3(viewMatrix) * waterNormal);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <transmission_fragment>',
      `vec3 incomingRay = -normalize(vViewPosition);
       vec3 flatNormal = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
       vec3 refractionNormal = normalize(mix(flatNormal, normal, refractionStrength));
       vec3 refractedRay = refract(incomingRay, refractionNormal, 1.0 / 1.333);
       vec3 meanRay = refract(incomingRay, flatNormal, 1.0 / 1.333);
       float waterF0 = pow((1.333 - 1.0) / (1.333 + 1.0), 2.0);
       float waterFresnel = waterF0 + (1.0 - waterF0) * pow(1.0 - clamp(dot(-incomingRay, normal), 0.0, 1.0), 5.0);
       totalDiffuse = underwaterRadiance(-vViewPosition, refractedRay, meanRay) * (1.0 - waterFresnel);`,
    );
  };
  material.customProgramCacheKey = () => 'stable-depth-ripple-v2';
  const water = new THREE.Mesh(geometry, material);
  water.name = 'Depth-aware sea surface';
  water.renderOrder = 1;
  water.frustumCulled = false;
  water.userData.waveField = field;
  water.userData.updateWaves = () => field.update();
  water.userData.setMotion = mode => {
    const preset = Object.hasOwn(MOTION_PRESETS, mode) ? MOTION_PRESETS[mode] : null;
    if (!preset) throw new RangeError(`Unknown water motion: ${mode}`);
    motionUniforms.refractionStrength.value = preset.refractionStrength;
    motionUniforms.refractionMaxOffset.value = preset.maxOffset;
    material.roughness = preset.roughness;
    material.specularIntensity = preset.specularIntensity;
    water.userData.motion = mode;
    return { mode, ...preset };
  };
  water.userData.setMotion('calm');
  return water;
}

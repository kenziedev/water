import { createWaveField } from './wave-field.js';

// Bounded screen-space refraction uses actual opaque depth. Hidden faces cannot
// be recovered: invalid rays fall back to the original sample, never edge clamp.
const opticsGLSL = /* glsl */ `
  uniform sampler2D underwaterColor;
  uniform sampler2D underwaterDepth;
  uniform vec2 surfaceResolution;
  uniform mat4 waterProjection;
  uniform mat4 waterProjectionInverse;
  uniform vec2 waterClip;
  float underwaterViewZ(float depth) {
    return waterClip.x * waterClip.y / ((waterClip.y - waterClip.x) * depth - waterClip.y);
  }
  bool waterProject(vec3 p, out vec2 uv) {
    vec4 projected = waterProjection * vec4(p, 1.0);
    if (projected.w <= 0.0) return false;
    uv = projected.xy / projected.w * .5 + .5;
    return all(greaterThan(uv, vec2(.002))) && all(lessThan(uv, vec2(.998)));
  }
  vec3 waterReconstruct(vec2 uv, float depth) {
    vec4 p = waterProjectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }
  vec3 underwaterRadiance(vec3 origin, vec3 direction) {
    vec2 baseUv = gl_FragCoord.xy / surfaceResolution;
    float baseDepth = texture2D(underwaterDepth, baseUv).r;
    vec3 basePoint = waterReconstruct(baseUv, baseDepth);
    float baseLength = clamp(length(basePoint - origin), 0.0, 14.0);
    vec2 hitUv = baseUv;
    float hitLength = baseLength;
    float confidence = 0.0;
    float travel = .08;
    float previousTravel = 0.0;
    for (int step = 0; step < 10; step++) {
      vec3 point = origin + direction * travel;
      vec2 uv;
      if (!waterProject(point, uv)) break;
      float depth = texture2D(underwaterDepth, uv).r;
      if (depth >= .999999) break;
      float sceneZ = underwaterViewZ(depth);
      if (sceneZ >= origin.z - .03) break;
      float gap = point.z - sceneZ;
      if (gap <= .035) {
        float lo = previousTravel, hi = travel;
        if (gap < 0.0) {
          for (int refine = 0; refine < 4; refine++) {
            float mid = (lo + hi) * .5;
            vec3 candidate = origin + direction * mid;
            vec2 candidateUv;
            if (!waterProject(candidate, candidateUv)) break;
            float candidateZ = underwaterViewZ(texture2D(underwaterDepth, candidateUv).r);
            if (candidate.z > candidateZ) lo = mid;
            else hi = mid;
          }
          travel = (lo + hi) * .5;
          waterProject(origin + direction * travel, uv);
        }
        // Silhouette discontinuities can fail the surface intersection test.
        float hitDepth = texture2D(underwaterDepth, uv).r;
        float error = abs((origin + direction * travel).z - underwaterViewZ(hitDepth));
        float edge = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
        confidence = (1.0 - smoothstep(.08, .45, error)) * smoothstep(.002, .025, edge);
        hitUv = uv;
        hitLength = travel;
        break;
      }
      previousTravel = travel;
      travel += clamp(gap / max(-direction.z, .15) * .9, .08, 1.6);
      if (travel > 14.0) break;
    }
    vec3 colour = mix(texture2D(underwaterColor, baseUv).rgb,
                      texture2D(underwaterColor, hitUv).rgb, confidence);
    float pathLength = mix(baseLength, hitLength, confidence);
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
    color: 0xffffff, metalness: 0, roughness: .085,
    transmission: 0, ior: 1.333, envMapIntensity: .45, dithering: true,
  });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, underwaterUniforms, { waveField: { value: field.texture } });
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
       vec3 refractedRay = refract(incomingRay, normal, 1.0 / 1.333);
       float waterF0 = pow((1.333 - 1.0) / (1.333 + 1.0), 2.0);
       float waterFresnel = waterF0 + (1.0 - waterF0) * pow(1.0 - clamp(dot(-incomingRay, normal), 0.0, 1.0), 5.0);
       totalDiffuse = underwaterRadiance(-vViewPosition, refractedRay) * (1.0 - waterFresnel);`,
    );
  };
  material.customProgramCacheKey = () => 'depth-aware-shallow-sea-v1';
  const water = new THREE.Mesh(geometry, material);
  water.name = 'Depth-aware sea surface';
  water.renderOrder = 1;
  water.frustumCulled = false;
  water.userData.waveField = field;
  water.userData.updateWaves = () => field.update();
  return water;
}

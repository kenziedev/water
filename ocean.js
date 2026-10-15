import { createWaveField } from './wave-field.js';

export function createOcean(THREE, renderer, timeUniform) {
  const field = createWaveField(THREE, renderer, timeUniform);
  const geometry = new THREE.PlaneGeometry(64, 64, 320, 320);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xf1f8f5,
    metalness: 0,
    roughness: .055,
    transmission: 1,
    ior: 1.333,
    thickness: 3.4,
    attenuationColor: 0x68c5bc,
    attenuationDistance: 8,
    envMapIntensity: .25,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.waveField = { value: field.texture };
    const fieldGLSL = /* glsl */ `
      uniform sampler2D waveField;
      varying vec2 waterPoint;
      vec4 sampleWater(vec2 p) {
        return texture2D(waveField, p / ${field.patchSize.toFixed(1)});
      }
    `;
    shader.vertexShader = fieldGLSL + shader.vertexShader;
    shader.fragmentShader = fieldGLSL + shader.fragmentShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `vec3 fieldValue = sampleWater(position.xz).rgb;
       // Only resolved geometric waves belong in the vertex normal. Feeding
       // sub-mesh ripples here would alias and inflate Three's geometry roughness.
       float meshDx = (sampleWater(position.xz + vec2(.10, 0.0)).r - sampleWater(position.xz - vec2(.10, 0.0)).r) / .20;
       float meshDz = (sampleWater(position.xz + vec2(0.0, .10)).r - sampleWater(position.xz - vec2(0.0, .10)).r) / .20;
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
       roughnessFactor = sqrt(roughnessFactor * roughnessFactor + unresolvedSlope * .35);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       vec3 surfaceField = waveFootprint.rgb;
       vec3 waterNormal = normalize(vec3(-surfaceField.g, 1.0, -surfaceField.b));
       normal = normalize(mat3(viewMatrix) * waterNormal);`,
    );
  };
  material.customProgramCacheKey = () => 'directional-spectrum-v2';
  const water = new THREE.Mesh(geometry, material);
  water.name = 'Moving sea surface';
  water.frustumCulled = false;
  water.userData.updateWaves = () => field.update();
  return water;
}

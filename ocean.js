// World-space waves: geometry, normals and refraction share one surface.
// The seabed never receives a time-dependent transformation.
const surfaceGLSL = /* glsl */ `
uniform float waterTime;
void swell(vec2 p, vec2 direction, float wavelength, float amplitude, float offset,
           inout vec3 displacement, inout vec3 tangentX, inout vec3 tangentZ) {
  vec2 d = normalize(direction);
  float k = 6.28318530718 / wavelength;
  float phase = k * dot(d, p) - sqrt(9.81 * k) * waterTime * .66 + offset;
  float s = sin(phase), c = cos(phase);
  float horizontal = .36 * amplitude;
  displacement += vec3(horizontal * d.x * c, amplitude * s, horizontal * d.y * c);
  tangentX += vec3(-horizontal * k * d.x * d.x * s,
                   amplitude * k * d.x * c,
                  -horizontal * k * d.x * d.y * s);
  tangentZ += vec3(-horizontal * k * d.x * d.y * s,
                   amplitude * k * d.y * c,
                  -horizontal * k * d.y * d.y * s);
}
void waterSurface(vec2 p, out vec3 displacement, out vec3 surfaceNormal) {
  displacement = vec3(0.0);
  vec3 tangentX = vec3(1.0, 0.0, 0.0);
  vec3 tangentZ = vec3(0.0, 0.0, 1.0);
  swell(p, vec2(.91, .42), 7.10, .155, .70, displacement, tangentX, tangentZ);
  swell(p, vec2(.76, .65), 4.80, .085, 2.10, displacement, tangentX, tangentZ);
  swell(p, vec2(.99, -.12), 3.20, .046, 4.60, displacement, tangentX, tangentZ);
  swell(p, vec2(-.28, .96), 2.15, .026, 1.20, displacement, tangentX, tangentZ);
  swell(p, vec2(.65, .76), 1.35, .012, 3.80, displacement, tangentX, tangentZ);
  swell(p, vec2(.95, .31), .86, .005, 5.40, displacement, tangentX, tangentZ);
  #ifdef WATER_FRAGMENT
    swell(p, vec2(.83, .55), .62, .0038, 2.7, displacement, tangentX, tangentZ);
    swell(p, vec2(.96, -.25), .39, .0024, 1.3, displacement, tangentX, tangentZ);
    swell(p, vec2(.56, .82), .24, .0012, 4.8, displacement, tangentX, tangentZ);
    swell(p, vec2(-.16, .98), .17, .0007, 3.4, displacement, tangentX, tangentZ);
  #endif
  surfaceNormal = normalize(cross(tangentZ, tangentX));
}
`;

export function createOcean(THREE, timeUniform) {
  const geometry = new THREE.PlaneGeometry(64, 64, 320, 320);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xe5f5ef, metalness: 0, roughness: .065,
    transmission: 1, ior: 1.333, thickness: 3.4,
    attenuationColor: 0x4fc5bd, attenuationDistance: 7.5,
    envMapIntensity: .16,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.waterTime = timeUniform;
    shader.vertexShader = 'varying vec2 waterPoint;\n' + surfaceGLSL + shader.vertexShader;
    shader.fragmentShader = '#define WATER_FRAGMENT\nvarying vec2 waterPoint;\n' + surfaceGLSL + shader.fragmentShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `vec3 waterOffset, waterNormal;
       waterSurface(position.xz, waterOffset, waterNormal);
       vec3 objectNormal = waterNormal;
       #ifdef USE_TANGENT
         vec3 objectTangent = vec3(tangent.xyz);
       #endif`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>', 'vec3 transformed = position + waterOffset; waterPoint = position.xz;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       vec3 detailDisplacement, detailNormal;
       waterSurface(waterPoint, detailDisplacement, detailNormal);
       normal = normalize(mat3(viewMatrix) * detailNormal);`,
    );
  };
  material.customProgramCacheKey = () => 'gerstner-sea-v1';
  const water = new THREE.Mesh(geometry, material);
  water.name = 'Moving sea surface';
  water.frustumCulled = false;
  return water;
}

// A deterministic directional spectrum. Integer wave vectors make the sampled
// field tile exactly, with independent phases rather than repeated sine stripes.
const TAU = Math.PI * 2;
const PATCH_SIZE = 16;
const BANDS = [
  [4.5, .045], [2.7, .060], [1.6, .080], [.9, .100],
  [.50, .100], [.26, .075], [.17, .045],
];

export function createWaveSpectrum() {
  let seed = 73129;
  const random = () => {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    return (seed >>> 0) / 4294967296;
  };
  const used = new Set();
  const modes = [];
  for (let band = 0; band < BANDS.length; band++) {
    const [centralLength, rmsSlope] = BANDS[band];
    const members = [];
    while (members.length < 6) {
      const length = centralLength * (.82 + random() * .36);
      const windAngle = .42;
      const spread = random() < .75 ? (random() + random() - 1) * 1.15 : (random() - .5) * Math.PI * 2;
      const direction = windAngle + spread;
      const nx = Math.round(PATCH_SIZE / length * Math.cos(direction));
      const nz = Math.round(PATCH_SIZE / length * Math.sin(direction));
      const key = `${nx},${nz}`;
      if ((!nx && !nz) || used.has(key)) continue;
      used.add(key);
      const kx = TAU * nx / PATCH_SIZE, kz = TAU * nz / PATCH_SIZE;
      const k = Math.hypot(kx, kz);
      const wavelength = TAU / k;
      const weight = .78 + .44 * random();
      members.push({ kx, kz, k, wavelength, weight, phase: TAU * random(), band });
    }
    const energy = members.reduce((sum, mode) => sum + mode.weight ** 2, 0);
    for (const mode of members) {
      mode.amplitude = rmsSlope * Math.sqrt(2 / energy) * mode.weight / mode.k;
      mode.omega = Math.sqrt(9.81 * mode.k * Math.tanh(mode.k * 4));
      // The short waves are surface relief below mesh resolution. They affect
      // optical normals, while metre-scale waves also move the actual mesh.
      const blend = Math.max(0, Math.min(1, (mode.wavelength - .65) / .65));
      mode.geometryWeight = blend * blend * (3 - 2 * blend);
      modes.push(mode);
    }
  }
  return { patchSize: PATCH_SIZE, modes };
}

export function createWaveField(THREE, renderer, timeUniform) {
  const { patchSize, modes } = createWaveSpectrum();
  const target = new THREE.WebGLRenderTarget(512, 512, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: true,
  });
  target.texture.name = 'World-space wave height and slopes';
  const material = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: {
      waterTime: timeUniform,
      waveModes: { value: modes.map(mode => new THREE.Vector4(mode.kx, mode.kz, mode.amplitude, mode.phase)) },
      waveDynamics: { value: modes.map(mode => new THREE.Vector2(mode.omega, mode.geometryWeight)) },
    },
    vertexShader: /* glsl */ `
      varying vec2 fieldUv;
      void main() { fieldUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 fieldUv;
      uniform float waterTime;
      uniform vec4 waveModes[${modes.length}];
      uniform vec2 waveDynamics[${modes.length}];
      void main() {
        vec2 p = fieldUv * ${patchSize.toFixed(1)};
        float height = 0.0;
        vec2 slope = vec2(0.0);
        for (int i = 0; i < ${modes.length}; i++) {
          vec4 mode = waveModes[i];
          vec2 dynamics = waveDynamics[i];
          float phase = dot(mode.xy, p) - dynamics.x * waterTime * .86 + mode.w;
          height += mode.z * sin(phase) * dynamics.y;
          slope += mode.z * mode.xy * cos(phase);
        }
        // Mip levels preserve the slope's second moment. Unresolved tiny
        // waves can then soften highlights instead of shimmering or vanishing.
        gl_FragColor = vec4(height, slope, dot(slope, slope));
      }
    `,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.Camera();
  return {
    texture: target.texture,
    patchSize,
    update() {
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
    },
  };
}

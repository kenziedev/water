// A gentle focusing estimate from the same normals used by the water surface.
// The field lives on a horizontal receiver plane; materials project it onto
// their own fixed world positions without moving geometry or texture detail.
export function createCaustics(THREE, renderer, field, timeUniform, sunDirection, { resolution = 256, strength = .30 } = {}) {
  const referenceDepth = 3.5;
  const sunlight = sunDirection.clone().normalize();
  // Snell's law through the mean horizontal surface. RayOffset is horizontal
  // travel per metre DOWN, hence its positive denominator and the PLUS sign
  // in the receiver's projection to the reference plane.
  const eta = 1 / 1.333;
  const rayY = -Math.sqrt(Math.max(.001, 1 - eta * eta * (1 - sunlight.y * sunlight.y)));
  const rayOffset = new THREE.Vector2(-sunlight.x * eta / -rayY, -sunlight.z * eta / -rayY);
  const target = new THREE.WebGLRenderTarget(resolution, resolution, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: true,
  });
  target.texture.name = 'Soft wave-driven seabed light';
  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      waveField: { value: field.texture },
      patchSize: { value: field.patchSize },
      referenceDepth: { value: referenceDepth },
      sunDirection: { value: sunlight },
      meanRayOffset: { value: rayOffset },
      // Keep approximately the same world-space low pass at each wave tier.
      waveLod: { value: Math.max(0, Math.log2((field.resolution || 512) / 128)) },
    },
    vertexShader: /* glsl */ `
      varying vec2 fieldUv;
      void main() { fieldUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 fieldUv;
      uniform sampler2D waveField;
      uniform float patchSize;
      uniform float referenceDepth;
      uniform float waveLod;
      uniform vec3 sunDirection;
      uniform vec2 meanRayOffset;

      vec2 lightOffset(vec2 p) {
        vec2 slope = textureLod(waveField, p / patchSize, waveLod).gb;
        // Low-pass and damp focusing: unresolved crossing rays must not become
        // tiny flashing singularities in a calm observation scene.
        vec3 normal = normalize(vec3(-slope.x * .65, 1.0, -slope.y * .65));
        vec3 ray = refract(-sunDirection, normal, 1.0 / 1.333);
        return ray.xz / max(-ray.y, .3) * referenceDepth;
      }

      void main() {
        vec2 receiver = fieldUv * patchSize;
        vec2 surface = receiver - meanRayOffset * referenceDepth;
        // Two damped inverse steps locate the source area on the water.
        surface = mix(surface, receiver - lightOffset(surface), .7);
        surface = mix(surface, receiver - lightOffset(surface), .7);
        const float stepSize = .16;
        vec2 dx = (lightOffset(surface + vec2(stepSize, 0.0))
                 - lightOffset(surface - vec2(stepSize, 0.0))) / (2.0 * stepSize);
        vec2 dz = (lightOffset(surface + vec2(0.0, stepSize))
                 - lightOffset(surface - vec2(0.0, stepSize))) / (2.0 * stepSize);
        float determinant = (1.0 + dx.x) * (1.0 + dz.y) - dx.y * dz.x;
        float focus = 1.0 / max(determinant, .45);
        // Smooth saturation bounds both bright focusing and darker spreading.
        float delta = focus - 1.0;
        focus = 1.0 + delta / (1.0 + abs(delta) * 2.0);
        gl_FragColor = vec4(vec3(focus), 1.0);
      }
    `,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.Camera();
  let lastTime = NaN;
  return {
    texture: target.texture,
    patchSize: field.patchSize,
    referenceDepth,
    strength,
    sunDirection: sunlight,
    refractedSunXZ: rayOffset,
    receiverUniforms: {
      causticsMap: { value: target.texture },
      causticsPatchSize: { value: field.patchSize },
      causticsStrength: { value: strength },
      causticsReferenceDepth: { value: referenceDepth },
      causticsRayOffset: { value: rayOffset },
    },
    update() {
      if (lastTime === timeUniform.value) return false;
      const previous = renderer.getRenderTarget();
      const cubeFace = renderer.getActiveCubeFace();
      const mipLevel = renderer.getActiveMipmapLevel();
      try {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        lastTime = timeUniform.value;
      } finally {
        renderer.setRenderTarget(previous, cubeFace, mipLevel);
      }
      return true;
    },
    invalidate() { lastTime = NaN; },
    dispose() {
      target.dispose();
      material.dispose();
      quad.geometry.dispose();
    },
  };
}

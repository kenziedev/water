// Linear scene colour and opaque depth before the surface is drawn. Replaces
// Three's fixed-thickness transmission pass; both passes use the same camera.
export function createUnderwater(THREE, renderer) {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
  });
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  target.texture.name = 'Linear underwater scene';
  target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  target.depthTexture.minFilter = target.depthTexture.magFilter = THREE.NearestFilter;
  target.depthTexture.name = 'Underwater object depth';
  const uniforms = {
    underwaterColor: { value: target.texture },
    underwaterDepth: { value: target.depthTexture },
    surfaceResolution: { value: new THREE.Vector2(1, 1) },
    waterProjection: { value: new THREE.Matrix4() },
    waterProjectionInverse: { value: new THREE.Matrix4() },
    waterClip: { value: new THREE.Vector2(.1, 160) },
  };
  return {
    uniforms,
    resize(width, height, scale = 1) {
      target.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
      uniforms.surfaceResolution.value.set(width, height);
    },
    render(scene, camera, surface) {
      uniforms.waterProjection.value.copy(camera.projectionMatrix);
      uniforms.waterProjectionInverse.value.copy(camera.projectionMatrixInverse);
      uniforms.waterClip.value.set(camera.near, camera.far);
      const previousTarget = renderer.getRenderTarget();
      const cubeFace = renderer.getActiveCubeFace();
      const mipLevel = renderer.getActiveMipmapLevel();
      const wasVisible = surface.visible;
      try {
        surface.visible = false;
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
      } finally {
        surface.visible = wasVisible;
        renderer.setRenderTarget(previousTarget, cubeFace, mipLevel);
      }
    },
    dispose() { target.dispose(); },
  };
}

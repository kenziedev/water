export const vertex = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

export const fragment = `
precision highp float;
uniform vec2 resolution;
uniform vec2 imageSize;
uniform float time;
uniform sampler2D bed;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
// A broad, irregular spectrum of short waves. No single large sine wave or
// doubled crest harmonic dominates the surface and creates diagonal stripes.
// Wave packets fade smoothly in space; their derivatives are analytic.
// Returns the surface slope and a restrained lighting term, never bed offsets.
vec3 sea(vec2 p) {
  vec2 slope = vec2(0.0);
  float curvature = 0.0;
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float seed = hash(vec2(fi, 9.73));
    float angle = fi * 2.399963 + .28 * sin(fi * 5.17);
    vec2 direction = vec2(cos(angle), sin(angle));
    vec2 crossDirection = vec2(-direction.y, direction.x);
    float frequency = 3.0 * pow(1.135, fi) * (.85 + seed * .3);
    float crossPhase = dot(p, crossDirection) * (.45 + seed * .3)
                     + time * .08 + fi * 3.17;
    float phase = dot(p, direction) * frequency
                - sqrt(9.81 * frequency) * time * .34 + fi * 7.13
                + .85 * sin(crossPhase);
    vec2 phaseGradient = direction * frequency
                       + crossDirection * .85 * (.45 + seed * .3) * cos(crossPhase);
    float packetPhase = dot(p, crossDirection) * .37 - time * .055 + fi;
    float packet = .65 + .35 * sin(packetPhase);
    vec2 packetGradient = crossDirection * .1295 * cos(packetPhase);
    float amplitude = .105 / frequency * pow(.973, fi);
    slope += amplitude * (packet * phaseGradient * cos(phase)
                         + packetGradient * sin(phase));
    // Use only the large waves for soft illumination below the surface.
    // High-frequency curvature made the old bed flash like a moving lattice.
    if (i < 7) curvature -= amplitude * frequency * frequency * sin(phase) * packet;
  }
  return vec3(slope, curvature);
}

vec3 sky(vec3 ray) {
  float elevation = clamp(ray.z, 0.0, 1.0);
  // Soft clear-sky illumination, without high-contrast procedural cloud masks.
  return mix(vec3(.69, .79, .85), vec3(.16, .34, .52), pow(elevation, .65));
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  float aspect = resolution.x / resolution.y;
  vec2 cover = vec2(1.0);
  float imageAspect = imageSize.x / imageSize.y;
  if (aspect > imageAspect) cover.y = imageAspect / aspect;
  else cover.x = aspect / imageAspect;

  // Stationary bed: intentionally no time, wave slope, displacement or camera
  // motion in this texture lookup. Every rock occupies the same screen pixels.
  vec2 bedUV = (uv - .5) * cover + .5;
  vec3 bottom = texture2D(bed, bedUV).rgb;

  // Perspective compresses the more distant waves at the top of the frame.
  vec2 p = vec2((uv.x - .5) * aspect, uv.y * 1.35) * 11.0;
  p /= 1.0 + uv.y * .28;
  vec3 wave = sea(p);
  vec3 normal = normalize(vec3(-wave.xy, 1.0));
  vec3 view = normalize(vec3((uv.x - .5) * .12, -1.10 - uv.y * 1.05, 1.0));
  vec3 reflected = reflect(-view, normal);
  float facing = max(dot(normal, view), 0.0);
  float fresnel = .0204 + .9796 * pow(1.0 - facing, 5.0);

  // Moving caustic illumination changes brightness, never the rock geometry.
  float lightFocus = clamp(-wave.z * .055, -.075, .10);
  vec3 transmitted = bottom * (1.0 + lightFocus * (1.0 - uv.y * .4));
  vec3 reflection = sky(reflected);
  // Mix in linear light, gently compressing rare grazing-angle peaks so a
  // small steep ripple cannot become an opaque pale patch over the rocks.
  float reflectedEnergy = fresnel / (1.0 + .9 * fresnel);
  vec3 color = mix(pow(transmitted, vec3(2.2)), pow(reflection, vec3(2.2)), reflectedEnergy);

  // Restrained specular points, with no broad artificial glow.
  vec3 sun = normalize(vec3(-.32, .67, .72));
  float alignment = max(dot(reflected, sun), 0.0);
  float glint = pow(alignment, 1400.0);
  color += vec3(1.0, .98, .89) * glint * .085;
  gl_FragColor = vec4(pow(max(color, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
}
`;

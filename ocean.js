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
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float clouds(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += noise(p) * a;
    p = mat2(.8, -.6, .6, .8) * p * 2.03;
    a *= .5;
  }
  return v;
}

// Deep-water dispersion: each wave travels at its own speed, rather than
// scrolling one distortion pattern. Analytic derivatives keep normals smooth.
// Returns slope X/Y and curvature; this function never changes bed coordinates.
vec3 sea(vec2 p) {
  vec2 slope = vec2(0.0);
  float curvature = 0.0;
  float frequency = 2.15;
  float amplitude = .035;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float angle = .5 + sin(fi * 2.399) * 1.75;
    vec2 direction = vec2(cos(angle), sin(angle));
    vec2 crossDirection = vec2(-direction.y, direction.x);
    float crossPhase = dot(p, crossDirection) * .7 + time * .17 + fi;
    float phase = dot(p, direction) * frequency
                - sqrt(9.81 * frequency) * time * .48 + fi * 7.13
                + .65 * sin(crossPhase);
    vec2 phaseGradient = direction * frequency
                       + crossDirection * .455 * cos(crossPhase);
    // Gentle choppy crests and round troughs, with no repeating pulse envelope.
    float crest = sin(phase) + .64 * sin(phase * 2.0);
    float derivative = cos(phase) + .32 * cos(phase * 2.0);
    slope += amplitude * phaseGradient * derivative;
    curvature -= amplitude * (dot(phaseGradient, phaseGradient) * crest
                              + .3185 * sin(crossPhase) * derivative);
    frequency *= 1.32;
    amplitude *= .67;
  }
  return vec3(slope, curvature);
}

vec3 sky(vec3 ray) {
  float elevation = clamp(ray.z, 0.0, 1.0);
  vec3 color = mix(vec3(.67, .81, .88), vec3(.20, .43, .65), pow(elevation, .65));
  vec2 cloudUV = ray.xy / max(.3, ray.z) * 1.4;
  float cloud = smoothstep(.46, .73, clouds(cloudUV + vec2(4.0, 2.0)));
  return mix(color, vec3(.92, .96, .97), cloud * .60);
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
  vec3 normal = normalize(vec3(-wave.xy * 1.75, 1.0));
  vec3 view = normalize(vec3((uv.x - .5) * .12, -.75 - uv.y * 1.55, 1.0));
  vec3 reflected = reflect(-view, normal);
  float facing = max(dot(normal, view), 0.0);
  float fresnel = .0204 + .9796 * pow(1.0 - facing, 5.0);

  // Moving caustic illumination changes brightness, never the rock geometry.
  float lightFocus = clamp(-wave.z * .035, -.08, .16);
  vec3 transmitted = bottom * (1.0 + lightFocus * (1.0 - uv.y * .4));
  vec3 reflection = sky(reflected);
  float reflectance = clamp(fresnel * 2.0 + .045, 0.0, .80);
  vec3 color = mix(transmitted, reflection, reflectance);

  // Small moving specular points; broad sheen comes from the reflected sky.
  vec3 sun = normalize(vec3(-.32, .67, .72));
  float alignment = max(dot(reflected, sun), 0.0);
  float glint = pow(alignment, 680.0);
  float glow = pow(alignment, 32.0);
  color += vec3(1.0, .98, .89) * (glint * .28 + glow * .025);
  gl_FragColor = vec4(color, 1.0);
}
`;

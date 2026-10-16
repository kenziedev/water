// A shared visual current, not a fluid simulation. Long, slow components keep
// plants and fish coherent without transferring surface ripples to the bed.
export function sampleFlow(x, z, time, out = { x: 0, z: 0 }) {
  out.x = .032 + .020 * Math.sin(time * .19 + z * .115)
    + .010 * Math.sin(time * .31 + x * .08 + z * .06);
  out.z = .014 + .018 * Math.cos(time * .16 + x * .105)
    + .009 * Math.sin(time * .27 - z * .09);
  return out;
}

export const flowGLSL = /* glsl */ `
  vec2 ecologyFlow(vec2 p, float t) {
    return vec2(
      .032 + .020 * sin(t * .19 + p.y * .115)
        + .010 * sin(t * .31 + p.x * .08 + p.y * .06),
      .014 + .018 * cos(t * .16 + p.x * .105)
        + .009 * sin(t * .27 - p.y * .09)
    );
  }
`;

export function seededRandom(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

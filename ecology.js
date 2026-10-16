import { createHabitat } from './habitat.js';
import { createAmbientSchedule } from './ambient-events.js';
import { createVegetation } from './vegetation.js';
import { createFauna } from './fauna.js';

export function createEcology(THREE, seabed, timeUniform, { caustics = null, quality = 'high' } = {}) {
  const habitat = createHabitat(seabed);
  const schedule = createAmbientSchedule();
  const vegetation = createVegetation(THREE, habitat, timeUniform, { caustics, quality });
  const fauna = createFauna(THREE, habitat, schedule, timeUniform, { caustics, quality });
  const group = new THREE.Group();
  group.name = 'Quiet shallow-water ecology';
  group.add(vegetation.mesh, fauna.group);
  fauna.update();
  let disposed = false;
  return {
    group,
    update() { return disposed ? false : fauna.update(); },
    setQuality(level) {
      if (disposed) return;
      vegetation.setQuality(level);
      fauna.setQuality(level);
    },
    snapshot() {
      const next = schedule.nextAt(timeUniform.value);
      return { time: timeUniform.value, vegetation: vegetation.snapshot(),
        nextVisit: next ? { id: next.id, start: next.start, end: next.end, count: next.count } : null,
        ...fauna.snapshot() };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      vegetation.dispose(); fauna.dispose();
      group.removeFromParent(); group.clear();
    },
  };
}

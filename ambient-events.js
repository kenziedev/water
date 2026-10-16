import { seededRandom } from './flow.js';

// The observation window is surrounded by a much longer off-centre approach
// and departure. Time is simulation time: pausing or hiding never queues visits.
export const FAUNA_PORTAL_RADIUS = 60;
export const OBSERVATION_SPAN = 7;
const coastalHeading = sample => (sample < .5 ? 0 : Math.PI) + (sample % .5 - .25) * 1.4;

export function createAmbientSchedule(seed = 0x83b61f) {
  const events = [];
  function append() {
    const id = events.length;
    const random = seededRandom(seed ^ Math.imul(id + 1, 0x45d9f3b));
    const previous = events.at(-1);
    const start = previous ? previous.end + previous.gapAfter : 30 + random() * 25;
    const duration = 15 + random() * 15;
    const speed = OBSERVATION_SPAN / duration;
    const rareSchool = random() < .13;
    const event = Object.freeze({
      id, start, end: start + duration, duration, speed,
      gapAfter: 120 + random() * 60,
      count: rareSchool ? 3 + Math.floor(random() * 4) : 1 + Math.floor(random() * 3),
      // Broadly follow the coast. A path aimed into the default camera stays
      // visible for most of its long approach and would make visits constant.
      angle: coastalHeading(random()),
      lane: (random() - .5) * 4.2,
      curve: .55 + random() * .7,
      phase: random() * Math.PI * 2,
      seed: Math.floor(random() * 0xffffffff),
      entry: start - (FAUNA_PORTAL_RADIUS - OBSERVATION_SPAN * .5) / speed,
      exit: start + (FAUNA_PORTAL_RADIUS + OBSERVATION_SPAN * .5) / speed,
    });
    events.push(event);
    return event;
  }
  function through(time) {
    // The slowest route can begin this long before its observation window.
    const lookahead = (FAUNA_PORTAL_RADIUS - OBSERVATION_SPAN * .5) / (OBSERVATION_SPAN / 30);
    while (!events.length || events.at(-1).start < time + lookahead) append();
    return events;
  }
  return {
    activeAt(time) { return through(Math.max(0, time)).filter(event => time >= event.entry && time <= event.exit); },
    observationsThrough(time) { return through(time).filter(event => event.start <= time); },
    nextAt(time) { return through(time).find(event => event.start >= time); },
  };
}

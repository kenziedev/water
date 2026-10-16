import { seededRandom } from './flow.js';

export function createHabitat(seabed, { seed = 0x6baf42, clusterCount = 34 } = {}) {
  const data = seabed.userData ?? seabed;
  if (typeof data.groundHeight !== 'function') throw new TypeError('A seabed height sampler is required');
  const groundHeight = data.groundHeight;
  const rocks = data.rockObstacles ?? [];
  const obstacles = [...rocks, ...(data.pebbleObstacles ?? [])];
  const intersects = (obstacle, x, z, radius) => x + radius >= obstacle.minX
    && x - radius <= obstacle.maxX && z + radius >= obstacle.minZ && z - radius <= obstacle.maxZ;
  const clearGround = (x, z, radius = .55) => !obstacles.some(obstacle => intersects(obstacle, x, z, radius));
  function clearanceHeight(x, z, radius = .25) {
    let height = Math.max(groundHeight(x, z), groundHeight(x - radius, z - radius),
      groundHeight(x + radius, z - radius), groundHeight(x - radius, z + radius), groundHeight(x + radius, z + radius));
    for (const obstacle of obstacles) if (intersects(obstacle, x, z, radius)) height = Math.max(height, obstacle.maxY);
    return height;
  }

  const random = seededRandom(seed);
  const clusters = [];
  for (let attempt = 0; clusters.length < clusterCount && attempt < 16000; attempt++) {
    let x, z;
    const angle = random() * Math.PI * 2;
    if (rocks.length && random() < .82) {
      const rock = rocks[Math.floor(random() * rocks.length)];
      const radius = Math.hypot(rock.maxX - rock.minX, rock.maxZ - rock.minZ) * .5 + .75 + random() * .6;
      x = (rock.minX + rock.maxX) * .5 + Math.cos(angle) * radius;
      z = (rock.minZ + rock.maxZ) * .5 + Math.sin(angle) * radius;
    } else {
      const radius = 5 + Math.sqrt(random()) * 14;
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
    }
    const distance = Math.hypot(x, z);
    if (distance < 4.3 || distance > 20 || !clearGround(x, z, .62)) continue;
    if (clusters.some(cluster => Math.hypot(cluster.x - x, cluster.z - z) < 1.3)) continue;
    clusters.push(Object.freeze({ id: clusters.length, x, y: groundHeight(x, z), z,
      scale: .48 + random() * .38, phase: random() * Math.PI * 2, seed: Math.floor(random() * 0xffffffff) }));
  }
  return { groundHeight, rocks, obstacles, clusters: Object.freeze(clusters), clearGround, clearanceHeight };
}

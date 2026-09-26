import assert from "node:assert/strict";
import test from "node:test";

import { COLLISION_GRID_CELL_SIZE, CollisionGrid } from "./collision-grid.ts";
import type { CollisionGridCollider } from "./collision-grid.ts";
import { XorShift32 } from "./prng.ts";

function collider(id: number, x: number, y: number, collisionRadius = 4): CollisionGridCollider {
  return { id, position: { x, y }, collisionRadius };
}

/** collision system の narrow phase と同じ円判定。 */
function circlesOverlap(left: CollisionGridCollider, right: CollisionGridCollider): boolean {
  const dx = left.position.x - right.position.x;
  const dy = left.position.y - right.position.y;
  const radius = left.collisionRadius + right.collisionRadius;
  return dx * dx + dy * dy <= radius * radius;
}

test("returns nearby colliders in entity id order and skips distant cells", () => {
  const grid = new CollisionGrid([
    collider(9, 100, 100),
    collider(3, 110, 104),
    collider(5, 300, 400),
    collider(7, 96, 90),
  ]);

  assert.deepEqual(grid.query({ x: 100, y: 100 }, 3).map((candidate) => candidate.id), [3, 7, 9]);
  assert.deepEqual(grid.query({ x: 300, y: 400 }, 3).map((candidate) => candidate.id), [5]);
  assert.deepEqual(new CollisionGrid([]).query({ x: 100, y: 100 }, 3), []);
});

test("keeps colliders outside the playfield in the edge cells", () => {
  const grid = new CollisionGrid([
    collider(2, -500, 50),
    collider(3, 900, 50),
    collider(4, 192, -80),
    collider(5, 192, 530),
  ]);

  assert.deepEqual(grid.query({ x: -520, y: 50 }, 30).map((candidate) => candidate.id), [2]);
  assert.deepEqual(grid.query({ x: 420, y: 50 }, 3).map((candidate) => candidate.id), [3]);
  assert.deepEqual(grid.query({ x: 192, y: -60 }, 3).map((candidate) => candidate.id), [4]);
  assert.deepEqual(grid.query({ x: 192, y: 500 }, 3).map((candidate) => candidate.id), [5]);
});

test("widens queries by the largest registered radius", () => {
  const grid = new CollisionGrid([collider(2, 200, 200, 120), collider(3, 20, 20, 2)]);

  // 半径 120 の enemy の中心は 4 cell 離れているが、円は問い合わせ位置まで届く。
  assert.equal(circlesOverlap(collider(1, 200, 330, 12), collider(2, 200, 200, 120)), true);
  assert.deepEqual(grid.query({ x: 200, y: 330 }, 12).map((candidate) => candidate.id), [2]);
});

test("includes every overlapping collider, touching ones across cell boundaries included", () => {
  const prng = new XorShift32("collision-grid");
  const random = (min: number, max: number) => min + (prng.nextUint32() / 0x1_0000_0000) * (max - min);
  let overlaps = 0;
  for (let round = 0; round < 200; round += 1) {
    const colliders = Array.from({ length: 60 }, (_, index) => collider(
      index + 2,
      random(-150, 550),
      random(-150, 600),
      random(0.5, round % 10 === 0 ? 96 : 16),
    ));
    const grid = new CollisionGrid(colliders);
    const sources = [
      ...Array.from({ length: 20 }, () => collider(1, random(-150, 550), random(-150, 600), random(0.5, 40))),
      // cell の境界をはさんで円がちょうど接する位置。
      ...colliders.slice(0, 5).map((target) => {
        const radius = 3;
        return collider(1, target.position.x + target.collisionRadius + radius, target.position.y, radius);
      }),
    ];
    for (const source of sources) {
      const candidates = grid.query(source.position, source.collisionRadius);
      const candidateIds = candidates.map((candidate) => candidate.id);
      assert.deepEqual(candidateIds, [...candidateIds].sort((left, right) => left - right));
      for (const target of colliders) {
        if (circlesOverlap(source, target)) {
          overlaps += 1;
          assert.ok(candidateIds.includes(target.id), `round ${round}: ${JSON.stringify({ source, target })}`);
        }
      }
    }
  }
  assert.ok(overlaps > 500);
});

test("keeps dense bullet queries far below the full scan", () => {
  const bullets = Array.from({ length: 2_000 }, (_, index) => collider(
    index + 2,
    (index * 37) % 384,
    (index * 53) % 448,
  ));
  const candidates = new CollisionGrid(bullets).query({ x: 192, y: 400 }, 3);

  assert.ok(candidates.length < 2_000 / 10, `${candidates.length} candidates`);
  assert.equal(COLLISION_GRID_CELL_SIZE, 32);
});

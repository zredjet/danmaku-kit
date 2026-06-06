import type { GameDefinition } from "@shooting-sample/shooting-core";

/** Core basic の最小 valid content fixture。 */
export function createMinimumDefinition(): GameDefinition {
  return {
    schemaVersion: "1",
    enabledFeatures: [],
    defaultPlayerId: "player.default",
    content: {
      version: "content.0",
      assetKeys: {
        keys: [
          "player.default",
          "enemy.scout",
          "bullet.red_small",
          "shot.player_basic",
        ],
      },
      players: [
        {
          id: "player.default",
          version: 1,
          asset: "player.default",
          movement: { speed: 4, focusSpeed: 1.8 },
          collision: { radius: 3 },
          life: { initialLives: 3, invincibleTicksAfterHit: 120 },
          shot: { definition: "playerShot.basic" },
        },
      ],
      stages: [
        {
          id: "stage.stage_01",
          version: 1,
          difficulties: ["normal"],
          timeline: [
            {
              tick: 60,
              action: {
                type: "spawnEnemy",
                enemy: "enemy.scout",
                path: "path.none",
                pattern: "pattern.none",
                position: { x: 192, y: -16 },
              },
            },
          ],
        },
      ],
      enemies: [{ id: "enemy.scout", version: 1, asset: "enemy.scout", hp: 10, score: 100 }],
      bullets: [{ id: "bullet.red_small", version: 1, asset: "bullet.red_small" }],
      playerShots: [{ id: "playerShot.basic", version: 1, asset: "shot.player_basic", damage: 5 }],
      patterns: [{ id: "pattern.none", version: 1 }],
      paths: [{ id: "path.none", version: 1 }],
    },
  };
}

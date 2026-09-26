import type {
  BulletDefinition,
  EnemyDefinition,
  GameDefinition,
  PathDefinition,
  PatternDefinition,
  PlayerDefinition,
  PlayerShotDefinition,
  StageDefinition,
} from "./types.ts";

export type LoadedContentIndex = Readonly<{
  definition: GameDefinition;
  bulletsById: ReadonlyMap<string, BulletDefinition>;
  enemiesById: ReadonlyMap<string, EnemyDefinition>;
  pathsById: ReadonlyMap<string, PathDefinition>;
  patternsById: ReadonlyMap<string, PatternDefinition>;
  playerShotsById: ReadonlyMap<string, PlayerShotDefinition>;
  playersById: ReadonlyMap<string, PlayerDefinition>;
  stagesById: ReadonlyMap<string, StageDefinition>;
}>;

/** validated content を runtime lookup しやすい形へまとめる。 */
export function createLoadedContentIndex(definition: GameDefinition): LoadedContentIndex {
  return {
    definition,
    bulletsById: new Map(definition.content.bullets.map((bullet) => [bullet.id, bullet])),
    enemiesById: new Map(definition.content.enemies.map((enemy) => [enemy.id, enemy])),
    pathsById: new Map(definition.content.paths.map((path) => [path.id, path])),
    patternsById: new Map(definition.content.patterns.map((pattern) => [pattern.id, pattern])),
    playerShotsById: new Map(definition.content.playerShots.map((playerShot) => [playerShot.id, playerShot])),
    playersById: new Map(definition.content.players.map((player) => [player.id, player])),
    stagesById: new Map(definition.content.stages.map((stage) => [stage.id, stage])),
  };
}

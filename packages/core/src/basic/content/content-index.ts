import { compilePatternProgram, hasDifficultyBranch } from "../patterns/pattern-program.ts";
import type { PatternProgram } from "../patterns/pattern-program.ts";
import { KNOWN_DIFFICULTIES } from "./types.ts";
import type {
  BulletDefinition,
  Difficulty,
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
  /**
   * difficulty ごとの、`steps` を持つ pattern だけの PatternProgram。difficulty の `if` を持たない pattern は、どの difficulty でも同じ
   * program を共有する。
   */
  patternProgramsByDifficulty: ReadonlyMap<Difficulty, ReadonlyMap<string, PatternProgram>>;
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
    patternProgramsByDifficulty: compilePatternProgramsByDifficulty(definition),
    playerShotsById: new Map(definition.content.playerShots.map((playerShot) => [playerShot.id, playerShot])),
    playersById: new Map(definition.content.players.map((player) => [player.id, player])),
    stagesById: new Map(definition.content.stages.map((stage) => [stage.id, stage])),
  };
}

/** 既知の difficulty ごとに PatternProgram を作る。`if` を持たない pattern は 1 度だけ compile して全 difficulty の表で共有する。 */
function compilePatternProgramsByDifficulty(
  definition: GameDefinition,
): ReadonlyMap<Difficulty, ReadonlyMap<string, PatternProgram>> {
  const tables = new Map(KNOWN_DIFFICULTIES.map((difficulty) => [difficulty, new Map<string, PatternProgram>()]));
  for (const pattern of definition.content.patterns) {
    const shared = hasDifficultyBranch(pattern) ? null : compilePatternProgram(pattern, KNOWN_DIFFICULTIES[0]);
    for (const [difficulty, table] of tables) {
      const program = pattern.steps ? shared ?? compilePatternProgram(pattern, difficulty) : null;
      if (program) {
        table.set(pattern.id, program);
      }
    }
  }
  return tables;
}

/** difficulty の PatternProgram の表。`KNOWN_DIFFICULTIES` の difficulty はすべて表を持つ。 */
export function patternProgramsForDifficulty(
  content: Pick<LoadedContentIndex, "patternProgramsByDifficulty">,
  difficulty: Difficulty,
): ReadonlyMap<string, PatternProgram> {
  const programs = content.patternProgramsByDifficulty.get(difficulty);
  if (!programs) {
    throw new RangeError(`no pattern programs for difficulty ${difficulty}`);
  }
  return programs;
}

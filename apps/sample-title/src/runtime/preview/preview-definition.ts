import type {
  Difficulty,
  EnemyId,
  GameDefinition,
  PathId,
  PatternId,
  StageId,
  StageTimelineAction,
} from "@shooting-sample/shooting-core";

import { PLAYFIELD_WIDTH } from "../view/playfield.ts";

/** Preview で単体再生するもの。enemy は path と pattern を選んで出す。 */
export type PreviewTarget =
  | Readonly<{ kind: "stage"; stageId: StageId }>
  | Readonly<{ kind: "enemy"; enemyId: EnemyId; pathId: PathId; patternId: PatternId }>
  | Readonly<{ kind: "pattern"; patternId: PatternId }>
  | Readonly<{ kind: "path"; pathId: PathId }>;

/** Preview が stage 以外の対象を出すために合成する stage。 */
export const PREVIEW_STAGE_ID: StageId = "stage.preview";
/** 合成した stage が対象を出す tick。開始演出の後、少し待ってから出す。 */
export const PREVIEW_SPAWN_TICK = 30;
/** pattern の単体再生で、enemy を止めておく path（区間がないので spawn の位置から動かない）。 */
export const PREVIEW_HOLD_PATH_ID: PathId = "path.preview_hold";
/** path の単体再生で、enemy に撃たせない pattern。 */
export const PREVIEW_SILENT_PATTERN_ID: PatternId = "pattern.preview_silent";
/** pattern の単体再生で enemy を止める位置。 */
const PATTERN_PREVIEW_POSITION = Object.freeze({ x: PLAYFIELD_WIDTH / 2, y: 120 });
/** stage で使われていない enemy や path を出す位置（上の境界の外）。 */
const DEFAULT_SPAWN_POSITION = Object.freeze({ x: PLAYFIELD_WIDTH / 2, y: -16 });

/**
 * Preview の対象だけを出す `GameDefinition` を合成する（design 19）。Core に Preview 専用の API は足さず、合成した definition を普通に
 * load して動かす。
 *
 * - stage はそのまま（`stageId` だけを返す）。
 * - enemy、pattern、path は、それだけを tick `PREVIEW_SPAWN_TICK` に 1 体出す stage（`PREVIEW_STAGE_ID`）を足す。stage で最初に
 *   使われている spawn の enemy と位置を借りる。pattern は止めた enemy に撃たせ（`PREVIEW_HOLD_PATH_ID`）、path は撃たない enemy
 *   （`PREVIEW_SILENT_PATTERN_ID`）で動かす。stage は content の stage が持つ difficulty をすべて持つ。
 */
export function composePreviewDefinition(
  definition: GameDefinition,
  target: PreviewTarget,
): Readonly<{ definition: GameDefinition; stageId: StageId }> {
  if (target.kind === "stage") {
    return Object.freeze({ definition, stageId: target.stageId });
  }
  const action = previewAction(definition, target);
  const difficulties = [...new Set(definition.content.stages.flatMap((stage) => stage.difficulties))] as Difficulty[];
  return Object.freeze({
    definition: {
      ...definition,
      content: {
        ...definition.content,
        stages: [
          ...definition.content.stages,
          { id: PREVIEW_STAGE_ID, version: 1, difficulties, timeline: [{ tick: PREVIEW_SPAWN_TICK, action }] },
        ],
        paths: [...definition.content.paths, { id: PREVIEW_HOLD_PATH_ID, version: 1 }],
        patterns: [...definition.content.patterns, { id: PREVIEW_SILENT_PATTERN_ID, version: 1 }],
      },
    },
    stageId: PREVIEW_STAGE_ID,
  });
}

function previewAction(definition: GameDefinition, target: Exclude<PreviewTarget, { kind: "stage" }>): StageTimelineAction {
  const actions = definition.content.stages.flatMap((stage) => stage.timeline.map((step) => step.action));
  const firstEnemy = definition.content.enemies[0]?.id ?? "enemy.preview";
  switch (target.kind) {
    case "enemy": {
      const usage = actions.find((action) => action.enemy === target.enemyId);
      return {
        type: "spawnEnemy",
        enemy: target.enemyId,
        path: target.pathId,
        pattern: target.patternId,
        position: usage?.position ?? DEFAULT_SPAWN_POSITION,
      };
    }
    case "pattern": {
      const usage = actions.find((action) => action.pattern === target.patternId);
      return {
        type: "spawnEnemy",
        enemy: usage?.enemy ?? firstEnemy,
        path: PREVIEW_HOLD_PATH_ID,
        pattern: target.patternId,
        position: PATTERN_PREVIEW_POSITION,
      };
    }
    case "path": {
      const usage = actions.find((action) => action.path === target.pathId);
      return {
        type: "spawnEnemy",
        enemy: usage?.enemy ?? firstEnemy,
        path: target.pathId,
        pattern: PREVIEW_SILENT_PATTERN_ID,
        position: usage?.position ?? DEFAULT_SPAWN_POSITION,
      };
    }
  }
}

/** Preview で選べるもの（content の id）。 */
export type PreviewChoices = Readonly<{
  stages: readonly StageId[];
  enemies: readonly EnemyId[];
  patterns: readonly PatternId[];
  paths: readonly PathId[];
}>;

export function listPreviewChoices(definition: GameDefinition): PreviewChoices {
  const { stages, enemies, patterns, paths } = definition.content;
  return Object.freeze({
    stages: Object.freeze(stages.map((stage) => stage.id)),
    enemies: Object.freeze(enemies.map((enemy) => enemy.id)),
    patterns: Object.freeze(patterns.map((pattern) => pattern.id)),
    paths: Object.freeze(paths.map((path) => path.id)),
  });
}

/**
 * URL の `?preview=` の値を対象にする。`stage:<id>`、`pattern:<id>`、`path:<id>`、`enemy:<enemy>,<path>,<pattern>` を受け、content に
 * ない id や形の誤りは null（呼び出し側は最初の stage にする）。
 */
export function parsePreviewTarget(value: string, definition: GameDefinition): PreviewTarget | null {
  const choices = listPreviewChoices(definition);
  const separator = value.indexOf(":");
  const [kind, rest] = separator < 0 ? [value, ""] : [value.slice(0, separator), value.slice(separator + 1)];
  const has = <T extends string>(ids: readonly T[], id: string): id is T => (ids as readonly string[]).includes(id);
  switch (kind) {
    case "stage":
      return has(choices.stages, rest) ? { kind, stageId: rest } : null;
    case "pattern":
      return has(choices.patterns, rest) ? { kind, patternId: rest } : null;
    case "path":
      return has(choices.paths, rest) ? { kind, pathId: rest } : null;
    case "enemy": {
      const [enemyId = "", pathId = "", patternId = ""] = rest.split(",");
      return has(choices.enemies, enemyId) && has(choices.paths, pathId) && has(choices.patterns, patternId)
        ? { kind, enemyId, pathId, patternId }
        : null;
    }
    default:
      return null;
  }
}

/** 対象を `?preview=` の値にする（`parsePreviewTarget()` の逆）。 */
export function formatPreviewTarget(target: PreviewTarget): string {
  switch (target.kind) {
    case "stage":
      return `stage:${target.stageId}`;
    case "pattern":
      return `pattern:${target.patternId}`;
    case "path":
      return `path:${target.pathId}`;
    case "enemy":
      return `enemy:${target.enemyId},${target.pathId},${target.patternId}`;
  }
}

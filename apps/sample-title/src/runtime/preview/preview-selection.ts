import type { Difficulty, GameDefinition, ShootingCore, StageDefinition } from "@shooting-sample/shooting-core";

import type { GameShellContent } from "../lifecycle/game-shell.ts";
import { selectStageDifficulty } from "../lifecycle/stage-difficulty.ts";
import {
  composePreviewDefinition,
  formatPreviewTarget,
  listPreviewChoices,
  parsePreviewTarget,
  type PreviewTarget,
} from "./preview-definition.ts";

export type PreviewSelectionOptions = Readonly<{
  /** `?preview=` の値。content にない対象や形の誤りは最初の stage にする。 */
  targetParameter: string;
  seed: string;
  requestedDifficulty: string | null;
}>;

/** 選んだ対象を合成して load した結果。 */
export type PreviewComposition =
  | Readonly<{ ok: true; content: GameShellContent; stage: StageDefinition }>
  | Readonly<{ ok: false; errors: readonly string[] }>;

/**
 * Preview（design 19）の選択（対象、seed、difficulty）。DOM と Phaser に依存せず、panel はこれを変えて `compose()` の content で stage を
 * 始め直す。difficulty は合成した stage が持つものに合わせる（持たなければ stage の最初の difficulty）。
 */
export class PreviewSelection {
  #definition: GameDefinition;
  #target: PreviewTarget;
  #seed: string;
  #difficulty: string | null;

  constructor(definition: GameDefinition, options: PreviewSelectionOptions) {
    this.#definition = definition;
    this.#target = parsePreviewTarget(options.targetParameter, definition) ?? firstStageTarget(definition);
    this.#seed = options.seed;
    this.#difficulty = options.requestedDifficulty;
  }

  get definition(): GameDefinition {
    return this.#definition;
  }

  get target(): PreviewTarget {
    return this.#target;
  }

  get seed(): string {
    return this.#seed;
  }

  /** 選んでいる difficulty（合成した stage が持たない値のままなら、`compose()` が stage の最初の difficulty にする）。 */
  get difficulty(): string | null {
    return this.#difficulty;
  }

  /** `?preview=` の値の形の対象を選ぶ。content にない対象なら選択を変えず false を返す。 */
  selectTarget(value: string): boolean {
    const target = parsePreviewTarget(value, this.#definition);
    if (target === null) {
      return false;
    }
    this.#target = target;
    return true;
  }

  /** 空白だけの seed は受けない。 */
  setSeed(seed: string): boolean {
    if (seed.trim().length === 0) {
      return false;
    }
    this.#seed = seed;
    return true;
  }

  setDifficulty(difficulty: string): void {
    this.#difficulty = difficulty;
  }

  /** content の hot reload。今の対象が新しい content になければ最初の stage にする。 */
  replaceDefinition(definition: GameDefinition): void {
    this.#definition = definition;
    this.#target = parsePreviewTarget(formatPreviewTarget(this.#target), definition) ?? firstStageTarget(definition);
  }

  /** 今の対象の stage が持つ difficulty（panel の選択肢）。 */
  difficulties(): readonly Difficulty[] {
    return composedStage(composePreviewDefinition(this.#definition, this.#target))?.difficulties ?? [];
  }

  /** 今の対象を合成した definition を `core` で load し、stage を始める content にする。 */
  compose(core: Pick<ShootingCore, "load">): PreviewComposition {
    const composed = composePreviewDefinition(this.#definition, this.#target);
    const stage = composedStage(composed);
    const difficulty = stage ? selectStageDifficulty(stage.difficulties, this.#difficulty) : null;
    if (!stage || difficulty === null) {
      return Object.freeze({ ok: false, errors: Object.freeze([`${composed.stageId} has no difficulty to preview`]) });
    }
    const loaded = core.load(composed.definition);
    if (!loaded.ok) {
      return Object.freeze({ ok: false, errors: Object.freeze(loaded.errors.map((error) => `${error.code}: ${error.message}`)) });
    }
    this.#difficulty = difficulty;
    return Object.freeze({
      ok: true,
      content: Object.freeze({ loadedGame: loaded.value, stage: Object.freeze({ stageId: composed.stageId, difficulty }) }),
      stage,
    });
  }
}

/** kind を切り替えたときの対象（content の最初の id。enemy は最初の path と pattern で出す）。content になければ null。 */
export function firstPreviewTarget(kind: PreviewTarget["kind"], definition: GameDefinition): PreviewTarget | null {
  const choices = listPreviewChoices(definition);
  const value = kind === "enemy"
    ? `enemy:${choices.enemies[0] ?? ""},${choices.paths[0] ?? ""},${choices.patterns[0] ?? ""}`
    : `${kind}:${{ stage: choices.stages, pattern: choices.patterns, path: choices.paths }[kind][0] ?? ""}`;
  return parsePreviewTarget(value, definition);
}

function firstStageTarget(definition: GameDefinition): PreviewTarget {
  const stage = definition.content.stages[0];
  if (!stage) {
    throw new Error("Preview needs content with at least one stage");
  }
  return Object.freeze({ kind: "stage", stageId: stage.id });
}

function composedStage(composed: ReturnType<typeof composePreviewDefinition>): StageDefinition | undefined {
  return composed.definition.content.stages.find((stage) => stage.id === composed.stageId);
}

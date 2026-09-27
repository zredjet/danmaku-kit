import type { DanmakuCore, Difficulty, GameDefinition, StageDefinition } from "@danmaku-kit/core";

import type { GameShellContent } from "../lifecycle/game-shell.ts";
import { selectStageDifficulty } from "../lifecycle/stage-difficulty.ts";
import { applyPreviewCheats, snapStageJumpTick, stageJumpTicks, type PreviewCheats } from "./preview-cheats.ts";
import {
  composePreviewDefinition,
  formatPreviewTarget,
  listPreviewChoices,
  parsePreviewTarget,
  previewDifficulties,
  type PreviewTarget,
} from "./preview-definition.ts";

export type PreviewSelectionOptions = Readonly<{
  /** `?preview=` の値。content にない対象や形の誤りは最初の stage にする。 */
  targetParameter: string;
  seed: string;
  requestedDifficulty: string | null;
  /** `?invincible=1`。 */
  invincible?: boolean;
  /** `?jump=` の値。stage の対象だけで使い、その stage の spawn の tick に寄せる（`snapStageJumpTick()`）。 */
  jumpTickParameter?: string | null;
}>;

/** 選んだ対象を合成して load した結果。 */
export type PreviewComposition =
  | Readonly<{ ok: true; content: GameShellContent; stage: StageDefinition }>
  | Readonly<{ ok: false; errors: readonly string[] }>;

/**
 * Preview（design 19）の選択（対象、seed、difficulty、dev-only の cheat）。DOM と Phaser に依存せず、panel はこれを変えて `compose()` の
 * content で stage を始め直す。difficulty は対象で選べるもの（`difficulties()`）に合わせる（なければ最初の difficulty）。stage jump は
 * stage の対象だけが持ち、対象を変えると 0 に戻し、content が変わったら jump 先の tick 以下で最大の spawn の tick に寄せる。
 */
export class PreviewSelection {
  #definition: GameDefinition;
  #target: PreviewTarget;
  #seed: string;
  #difficulty: string | null;
  #invincible: boolean;
  #jumpTick: number;

  constructor(definition: GameDefinition, options: PreviewSelectionOptions) {
    this.#definition = definition;
    this.#target = parsePreviewTarget(options.targetParameter, definition) ?? firstStageTarget(definition);
    this.#seed = options.seed;
    this.#difficulty = options.requestedDifficulty;
    this.#invincible = options.invincible ?? false;
    const jumpTick = Number(options.jumpTickParameter ?? 0);
    this.#jumpTick = Number.isSafeInteger(jumpTick) ? this.#snapJumpTick(jumpTick) : 0;
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

  get cheats(): PreviewCheats {
    return Object.freeze({ invincible: this.#invincible, jumpTick: this.#jumpTick });
  }

  /** `?preview=` の値の形の対象を選ぶ。content にない対象なら選択を変えず false を返す。 */
  selectTarget(value: string): boolean {
    const target = parsePreviewTarget(value, this.#definition);
    if (target === null) {
      return false;
    }
    if (formatPreviewTarget(target) !== formatPreviewTarget(this.#target)) {
      this.#jumpTick = 0;
    }
    this.#target = target;
    return true;
  }

  setInvincible(invincible: boolean): void {
    this.#invincible = invincible;
  }

  /** stage jump の tick を選ぶ。今の対象で選べない tick なら選択を変えず false を返す。 */
  setJumpTick(tick: number): boolean {
    if (!this.jumpTicks().includes(tick)) {
      return false;
    }
    this.#jumpTick = tick;
    return true;
  }

  /** stage jump で選べる tick（panel の選択肢）。stage の対象だけが持つ。 */
  jumpTicks(): readonly number[] {
    const stage = this.#targetStage();
    return stage ? stageJumpTicks(stage) : [];
  }

  /** 今の対象の stage の spawn の tick に寄せた jump の tick。stage の対象でなければ 0。 */
  #snapJumpTick(tick: number): number {
    const stage = this.#targetStage();
    return stage ? snapStageJumpTick(stage, tick) : 0;
  }

  #targetStage(): StageDefinition | undefined {
    const target = this.#target;
    return target.kind === "stage" ? this.#definition.content.stages.find((stage) => stage.id === target.stageId) : undefined;
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

  /**
   * content の hot reload。新しい content で今の対象（新しい content になければ最初の stage）を合成し、load できたときだけ選択を新しい
   * content に移す。load できなければ選択を変えずに error を返す。
   */
  replaceDefinition(definition: GameDefinition, core: Pick<DanmakuCore, "load">): PreviewComposition {
    const previous = { definition: this.#definition, target: this.#target, jumpTick: this.#jumpTick };
    this.#definition = definition;
    const target = parsePreviewTarget(formatPreviewTarget(this.#target), definition);
    this.#target = target ?? firstStageTarget(definition);
    this.#jumpTick = target ? this.#snapJumpTick(this.#jumpTick) : 0;
    const composed = this.compose(core);
    if (!composed.ok) {
      this.#definition = previous.definition;
      this.#target = previous.target;
      this.#jumpTick = previous.jumpTick;
    }
    return composed;
  }

  /** 今の対象で選べる difficulty（panel の選択肢）。stage はその stage の difficulty、他は content の stage の difficulty すべて。 */
  difficulties(): readonly Difficulty[] {
    const target = this.#target;
    return target.kind === "stage"
      ? this.#definition.content.stages.find((stage) => stage.id === target.stageId)?.difficulties ?? []
      : previewDifficulties(this.#definition);
  }

  /** 今の対象を合成した definition を `core` で load し、stage を始める content にする。 */
  compose(core: Pick<DanmakuCore, "load">): PreviewComposition {
    const difficulty = selectStageDifficulty(this.difficulties(), this.#difficulty);
    if (difficulty === null) {
      return Object.freeze({ ok: false, errors: Object.freeze([`${formatPreviewTarget(this.#target)} has no difficulty to preview`]) });
    }
    const target = composePreviewDefinition(this.#definition, this.#target, difficulty);
    const composed = applyPreviewCheats(target.definition, target.stageId, this.cheats);
    const stage = composed.definition.content.stages.find((candidate) => candidate.id === composed.stageId);
    if (!stage) {
      return Object.freeze({ ok: false, errors: Object.freeze([`${composed.stageId} is not in the content`]) });
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

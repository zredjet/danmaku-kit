import type { Difficulty, GameFrame } from "@shooting-sample/shooting-core";

import type { AudioStatus } from "../audio/audio-status.ts";
import type { GameLifecycleState } from "../lifecycle/game-lifecycle.ts";
import { ENTITY_KINDS, countEntitiesByKind } from "../view/entity-counts.ts";

export type DebugHudInput = Readonly<{
  /** Core と content の version。 */
  versionLabel: string;
  lifecycle: GameLifecycleState;
  audioStatus: AudioStatus;
  /** 現在の stage の seed。stage の外では null。 */
  seed: string | null;
  /** 現在の stage の difficulty。stage の外では null。 */
  difficulty: Difficulty | null;
  frame: GameFrame | null;
  droppedTicksTotal: number;
  /** asset の fallback や hit spark の drop のように、そのまま並べる注記。 */
  notes: readonly string[];
}>;

/**
 * debug HUD の行を組み立てる（design 19）。
 *
 * browser へ Core 内部の diagnostics を公開しない方針（design 21.5）に合わせ、state hash、PRNG hash、collision candidate 数、
 * pattern の命令数は出さず、公開の `GameFrame` と Runtime が持つ値だけを出す。
 */
export function buildDebugHudLines(input: DebugHudInput): readonly string[] {
  const lines = [input.versionLabel, `${input.lifecycle}  audio ${input.audioStatus}`];
  if (input.seed !== null) {
    lines.push(`${input.difficulty ?? "-"}  seed ${input.seed}  tick ${input.frame?.tick ?? "-"}  dropped ${input.droppedTicksTotal}`);
  }
  if (input.frame !== null) {
    const counts = countEntitiesByKind(input.frame.state.entities);
    lines.push(ENTITY_KINDS.map((kind) => `${kind} ${counts[kind]}`).join("  "));
  }
  return Object.freeze([...lines, ...input.notes]);
}

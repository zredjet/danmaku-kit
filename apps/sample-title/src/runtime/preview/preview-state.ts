import type { GameFrame, SerializedGameState, StageDefinition } from "@danmaku-kit/core";

type Point = Readonly<{ x: number; y: number }>;

/** これから出る spawn（Preview の overlay の spawn 位置の印）。 */
export type UpcomingSpawn = Readonly<{ tick: number; enemy: string; position: Point }>;

/**
 * `tick` から `window` tick の間に timeline が出す spawn（design 19 の spawn position の overlay）。`tick` は次に実行する tick。
 */
export function upcomingSpawns(stage: StageDefinition, tick: number, window: number): readonly UpcomingSpawn[] {
  return Object.freeze(stage.timeline
    .filter((step) => step.tick >= tick && step.tick < tick + window)
    .map((step) => Object.freeze({ tick: step.tick, enemy: step.action.enemy, position: step.action.position })));
}

/** overlay に id を出す entity（player、enemy、pickup）。敵弾と自機の shot は数が多いので出さない。 */
export type EntityLabel = Readonly<{ id: number; position: Point }>;

export function labeledEntities(frame: GameFrame | null): readonly EntityLabel[] {
  if (frame === null) {
    return [];
  }
  return Object.freeze([
    ...frame.state.entities.filter((entity) => entity.kind === "player" || entity.kind === "enemy"),
    ...frame.state.features?.pickups ?? [],
  ].map((entity) => Object.freeze({ id: entity.id, position: entity.position })));
}

/**
 * Preview の panel の文字（design 19）。次に実行する tick（`expectedTick`。debug dump の `tick` と同じで、debug HUD の最後に実行した
 * tick より 1 大きい）、PRNG の state、pattern runner ごとの cursor と待ちの tick を、公開の `serialize()` の結果から読む（collision
 * candidate 数のような Core 内部の diagnostics は出さない）。
 */
export function describePreviewState(serialized: SerializedGameState | null): readonly string[] {
  if (serialized === null) {
    return Object.freeze([]);
  }
  const runners = serialized.state.patternRunnerStates.map((runner) => {
    const payload = runner.payload as Readonly<{ cursor?: number; waitRemaining?: number }>;
    return `${runner.runnerId.replace("patternRunner.", "")} ${runner.patternId} cursor ${payload.cursor ?? "-"} wait ${payload.waitRemaining ?? "-"}`;
  });
  return Object.freeze([
    `next tick ${serialized.expectedTick}  prng ${serialized.prngState.state.toString(16).padStart(8, "0")}`,
    ...(runners.length > 0 ? runners : ["no pattern runner"]),
  ]);
}

/**
 * Preview の panel の文字（`serialize()` を読む）を描き直す単位。playing の間は `intervalTicks` tick ごとに描き直し、それ以外（開始演出、
 * pause と 1 tick 送り、stage の終わり）は lifecycle か tick が変わるたびに描き直す。
 */
export function previewInfoKey(lifecycle: string, frameTick: number | null, intervalTicks: number): string {
  return lifecycle === "playing" && frameTick !== null
    ? `playing ${Math.floor(frameTick / intervalTicks)}`
    : `${lifecycle} ${frameTick ?? "-"}`;
}

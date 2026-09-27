import type {
  CoreResult,
  GameEvent,
  GameFrame,
  InputFrame,
  ReadonlyEntityState,
  StageSession,
} from "@danmaku-kit/core";

type StageStatus = GameFrame["state"]["status"];

export type TestFrameOptions = Partial<Readonly<{
  status: StageStatus;
  lives: number;
  invincibleTicksRemaining: number;
  score: number;
  entities: readonly ReadonlyEntityState[];
  events: readonly GameEvent[];
}>>;

/** test 用の `GameFrame`。指定しない field は、sample stage を始めたばかりで自機も entity もない frame の値にする。 */
export function createTestFrame(tick: number, options: TestFrameOptions = {}): GameFrame {
  return {
    tick,
    state: {
      tick,
      stageId: "stage.stage_01",
      playerId: "player.default",
      status: options.status ?? "playing",
      player: { lives: options.lives ?? 3, invincibleTicksRemaining: options.invincibleTicksRemaining ?? 0 },
      score: options.score ?? 0,
      entities: options.entities ?? [],
    },
    events: options.events ?? [],
  };
}

/**
 * tick ごとに `result(tick)` を返す fake の stage session。呼ばれた tick を `ticked` に記録する。
 *
 * `result` が stage の status を返した tick は、その status の frame（event は `tickAdvanced` だけ）で成功する。
 */
export function createFakeSession(
  result: (tick: number) => CoreResult<GameFrame> | StageStatus,
  ticked: number[] = [],
): StageSession {
  return {
    tick(input: InputFrame): CoreResult<GameFrame> {
      ticked.push(input.tick);
      const outcome = result(input.tick);
      if (typeof outcome !== "string") {
        return outcome;
      }
      return {
        ok: true,
        value: createTestFrame(input.tick, { status: outcome, events: [{ type: "tickAdvanced", tick: input.tick }] }),
        warnings: [],
      };
    },
    serialize() {
      throw new Error("serialize is not used by the fake session");
    },
  };
}

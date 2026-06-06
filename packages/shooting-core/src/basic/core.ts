import { isNamespacedId } from "./content/identifier.ts";
import type { Difficulty, EnemyId, GameDefinition, PlayerDefinition, PlayerId, StageDefinition, StageId } from "./content/types.ts";
import { validateGameDefinition } from "./content/validation.ts";
import { EventLog } from "./events/game-event.ts";
import type { GameEvent } from "./events/game-event.ts";
import { GAMEPLAY_ACTION_ORDER } from "./input/input-frame.ts";
import type { InputFrame } from "./input/input-frame.ts";
import { deepFreezeClone, deepFreezePlainData } from "./internal/immutable.ts";
import { coreError, errorResult, okResult } from "./result.ts";
import type { CoreErrorCode, CoreResult } from "./result.ts";
import { EntityAllocator } from "./simulation/entity.ts";
import type { EntityId } from "./simulation/entity.ts";
import { XorShift32 } from "./simulation/prng.ts";

const MAX_SEED_LENGTH = 128;

/**
 * ステージ開始時に runtime adapter から渡すオプション。
 *
 * `seed` は replay determinism の入口なので、タイトル側の乱数とは分けて
 * Core に明示的に渡す。
 */
export type StartStageOptions = {
  stageId: StageId;
  difficulty: Difficulty;
  playerId?: PlayerId;
  seed: string;
};

/**
 * 1 tick 終了時点の gameplay state。
 *
 * renderer 専用情報を含めず、将来 state hash や replay diff の対象にしやすい
 * 値だけを置く。
 */
export type ReadonlyGameState = Readonly<{
  tick: number;
  stageId: StageId;
  playerId: PlayerId;
  score: number;
  entities: ReadonlyArray<ReadonlyEntityState>;
}>;

/** renderer / debug / replay が読む最小 entity snapshot。 */
export type ReadonlyEntityState = Readonly<{
  id: EntityId;
  kind: "enemy";
  definitionId: EnemyId;
  position: Readonly<{
    x: number;
    y: number;
  }>;
}>;

/**
 * serialize / state hash 用に使う内部 simulation snapshot。
 *
 * `ReadonlyGameState` は renderer が読む表示用 state に留め、PRNG や pending event の
 * ような決定性検査に必要な値はこの系統の型へ分ける。
 */
export type HashableGameState = Readonly<{
  visible: ReadonlyGameState;
  expectedTick: number;
  nextEntityId: number;
  timelineCursor: number;
  prngState: number;
  pendingEvents: ReadonlyArray<GameEvent>;
}>;

/**
 * Core から renderer / debug / replay へ渡す 1 tick 分の出力。
 *
 * `events` はこの frame で発生した gameplay event のみを含み、DOM や audio の
 * runtime event とは混ぜない。
 */
export type GameFrame = Readonly<{
  tick: number;
  state: ReadonlyGameState;
  events: ReadonlyArray<GameEvent>;
}>;

/**
 * renderer 非依存の shooting core 入口。
 *
 * `load()` は型上は `GameDefinition` を受けるが、JS や unsafe cast からの呼び出しも
 * runtime validation に通して immutable snapshot を保持する。
 */
export type ShootingCore = {
  coreVersion: string;
  load(definition: GameDefinition): CoreResult<LoadedGame>;
};

/**
 * 検証済みの game definition から stage session を開始する API。
 *
 * `LoadedGame` は load 後の content mutation に影響されない snapshot を参照する。
 */
export type LoadedGame = {
  startStage(options: StartStageOptions): CoreResult<StageSession>;
};

/**
 * gameplay simulation の実行単位。
 *
 * 現時点では playing 中の fixed tick だけを扱う。pause / result / replay UI は
 * runtime lifecycle 側で管理する。
 */
export type StageSession = {
  tick(input: InputFrame): CoreResult<GameFrame>;
};

/**
 * Core minimum 実装を生成する。
 *
 * Phase 1A では Phaser / Vite / DOM に依存せず、Node の test runner だけで
 * load / startStage / tick を検証できることを優先している。
 */
export function createShootingCore(coreVersion = "0.0.0"): ShootingCore {
  return Object.freeze({
    coreVersion,
    load(definition) {
      const plainDefinition = deepFreezePlainData(definition);
      if (!plainDefinition) {
        return error("definition.invalidShape", "GameDefinition must be JSON-compatible plain data");
      }
      const errors = validateGameDefinition(plainDefinition);
      if (errors.length > 0) {
        return errorResult(errors);
      }
      return okResult(createLoadedGame(createLoadedContentIndex(plainDefinition as GameDefinition)));
    },
  });
}

type LoadedContentIndex = Readonly<{
  definition: GameDefinition;
  playersById: ReadonlyMap<string, PlayerDefinition>;
  stagesById: ReadonlyMap<string, StageDefinition>;
}>;

type StageSessionContext = {
  pendingEvents: readonly GameEvent[];
  entityAllocator: EntityAllocator;
  prng: XorShift32;
  stage: StageDefinition;
  player: PlayerDefinition;
};

/** validated content を runtime lookup しやすい形へまとめる。 */
function createLoadedContentIndex(definition: GameDefinition): LoadedContentIndex {
  return {
    definition,
    playersById: new Map(definition.content.players.map((player) => [player.id, player])),
    stagesById: new Map(definition.content.stages.map((stage) => [stage.id, stage])),
  };
}

/**
 * 検証済み snapshot から `LoadedGame` を作る。
 *
 * この関数へ渡る `definition` は `load()` 済みで freeze されている前提。
 * そのため startStage ごとに再 validation せず、ID 解決と session 初期化だけを行う。
 */
function createLoadedGame(content: LoadedContentIndex): LoadedGame {
  return Object.freeze({
    startStage(rawOptions) {
      const plainOptions = deepFreezePlainData(rawOptions);
      if (!plainOptions) {
        return error("startStage.invalidShape", "StartStageOptions must be JSON-compatible plain data");
      }
      const options = parseStartStageOptions(plainOptions);
      if (!options.ok) {
        return options;
      }
      // startStage の入力は runtime 側から来るため、stage/player/difficulty は毎回確認する。
      const stage = content.stagesById.get(options.value.stageId);
      const playerId = options.value.playerId ?? content.definition.defaultPlayerId;
      const player = content.playersById.get(playerId);

      if (!stage) {
        return error("stage.notFound", `Stage not found: ${options.value.stageId}`);
      }
      if (!player) {
        return error("player.notFound", `Player not found: ${playerId}`);
      }
      if (!stage.difficulties.includes(options.value.difficulty)) {
        return error("difficulty.notSupported", `Difficulty not supported: ${options.value.difficulty}`);
      }

      // stageStarted は最初の GameFrame で renderer/debug が初期状態を同期するための event。
      return okResult(createStageSession({
        entityAllocator: new EntityAllocator(),
        pendingEvents: [{ type: "stageStarted", tick: 0, stageId: stage.id }],
        prng: new XorShift32(options.value.seed),
        stage,
        player,
      }));
    },
  });
}

/**
 * 1 stage の simulation session を作る。
 *
 * movement / collision / lifetime update は後続スライスで追加するが、timeline spawn
 * だけはここで state mutation として扱い、ID 採番と event 順序を固定する。
 */
function createStageSession(options: StageSessionContext): StageSession {
  let expectedTick = 0;
  let activeEntities: readonly ReadonlyEntityState[] = [];
  let entityAllocator = options.entityAllocator;
  let pendingEvents = options.pendingEvents;
  let prng = options.prng;
  let score = 0;
  let timelineCursor = 0;

  return Object.freeze({
    tick(rawInput) {
      const plainInput = deepFreezePlainData(rawInput);
      if (!plainInput) {
        return error("input.invalidShape", "InputFrame must be JSON-compatible plain data");
      }
      const input = parseInputFrame(plainInput);
      if (!input.ok) {
        return input;
      }
      // 入力 tick のズレは replay divergence に直結するため、状態を進める前に拒否する。
      if (input.value.tick !== expectedTick) {
        return error("input.tickMismatch", `Expected tick ${expectedTick}, got ${input.value.tick}`);
      }

      const restoredPrng = XorShift32.restore(prng.snapshot());
      if (!restoredPrng.ok) {
        return restoredPrng;
      }
      const workingPrng = restoredPrng.value;
      const restoredAllocator = EntityAllocator.restore(entityAllocator.snapshot());
      if (!restoredAllocator.ok) {
        return restoredAllocator;
      }
      const workingEntityAllocator = restoredAllocator.value;
      const eventLog = new EventLog();
      for (const event of pendingEvents) {
        eventLog.push(event);
      }
      const workingEntities = [...activeEntities];
      let workingTimelineCursor = timelineCursor;

      while (
        workingTimelineCursor < options.stage.timeline.length
        && options.stage.timeline[workingTimelineCursor]!.tick === expectedTick
      ) {
        const step = options.stage.timeline[workingTimelineCursor]!;
        if (step.action.type === "spawnEnemy") {
          const entity = workingEntityAllocator.create();
          if (!entity.ok) {
            return entity;
          }
          const entityState: ReadonlyEntityState = Object.freeze({
            id: entity.value.id,
            kind: "enemy",
            definitionId: step.action.enemy,
            position: Object.freeze({
              x: step.action.position.x,
              y: step.action.position.y,
            }),
          });
          workingEntities.push(entityState);
          eventLog.push({
            type: "entitySpawned",
            tick: expectedTick,
            entityId: entity.value.id,
            entityKind: "enemy",
            definitionId: step.action.enemy,
            path: step.action.path,
            pattern: step.action.pattern,
            position: step.action.position,
          });
        }
        workingTimelineCursor += 1;
      }
      // PRNG はまだ event payload に出していないが、tick ごとの消費順を先に固定しておく。
      workingPrng.nextUint32();
      eventLog.push({ type: "tickAdvanced", tick: expectedTick });

      // frame に載せる state は renderer が保持しても安全な immutable snapshot にする。
      const state: ReadonlyGameState = Object.freeze({
        tick: expectedTick,
        stageId: options.stage.id,
        playerId: options.player.id,
        score,
        entities: Object.freeze(workingEntities.map((entity) => deepFreezeClone(entity))),
      });
      const frame = Object.freeze({
        tick: expectedTick,
        state,
        events: eventLog.drain(),
      });

      prng = workingPrng;
      entityAllocator = workingEntityAllocator;
      activeEntities = state.entities;
      pendingEvents = [];
      timelineCursor = workingTimelineCursor;
      expectedTick += 1;
      return okResult(frame);
    },
  });
}

/**
 * public API 境界で受け取る stage start option を検証する。
 *
 * `load()` 以外の API も runtime adapter から呼ばれるため、壊れた入力は throw ではなく
 * `CoreResult` の失敗として返す。
 */
function parseStartStageOptions(value: unknown): CoreResult<StartStageOptions> {
  const record = asRecord(value);
  if (!record) {
    return error("startStage.invalidShape", "StartStageOptions must be an object");
  }
  if (!hasOnlyKeys(record, ["stageId", "difficulty", "playerId", "seed"])) {
    return error("startStage.invalidShape", "StartStageOptions contains unknown fields");
  }
  if (typeof record.stageId !== "string") {
    return error("startStage.invalidShape", "stageId must be a string");
  }
  if (!isNamespacedId(record.stageId, "stage")) {
    return error("startStage.invalidShape", "stageId must use the stage.* namespace");
  }
  if (record.difficulty !== "normal" && record.difficulty !== "hard") {
    return error("startStage.invalidShape", "difficulty must be normal or hard");
  }
  if (typeof record.seed !== "string") {
    return error("startStage.invalidShape", "seed must be a string");
  }
  if (record.seed.trim().length === 0 || record.seed.length > MAX_SEED_LENGTH) {
    return error("startStage.invalidShape", `seed must be a non-empty string up to ${MAX_SEED_LENGTH} characters`);
  }
  if (record.playerId !== undefined && typeof record.playerId !== "string") {
    return error("startStage.invalidShape", "playerId must be a string when provided");
  }
  if (typeof record.playerId === "string" && !isNamespacedId(record.playerId, "player")) {
    return error("startStage.invalidShape", "playerId must use the player.* namespace");
  }
  return okResult(deepFreezeClone({
    stageId: record.stageId as StageId,
    difficulty: record.difficulty,
    playerId: record.playerId as PlayerId | undefined,
    seed: record.seed,
  }));
}

function parseInputFrame(value: unknown): CoreResult<InputFrame> {
  const record = asRecord(value);
  if (!record) {
    return error("input.invalidShape", "InputFrame must be an object");
  }
  if (!hasOnlyKeys(record, ["tick", "axes", "held", "pressed", "released"])) {
    return error("input.invalidShape", "InputFrame contains unknown fields");
  }
  if (typeof record.tick !== "number" || !Number.isSafeInteger(record.tick) || record.tick < 0) {
    return error("input.invalidShape", "input.tick must be a non-negative safe integer");
  }

  const axes = asRecord(record.axes);
  if (!axes || !isAxisValue(axes.moveX) || !isAxisValue(axes.moveY)) {
    return error("input.invalidShape", "input.axes must contain moveX/moveY values of -1, 0, or 1");
  }
  if (!hasOnlyKeys(axes, ["moveX", "moveY"])) {
    return error("input.invalidShape", "input.axes contains unknown fields");
  }

  const held = parseActionArray(record.held);
  const pressed = parseActionArray(record.pressed);
  const released = parseActionArray(record.released);
  if (!held || !pressed || !released) {
    return error("input.invalidShape", "input action arrays must contain unique supported gameplay actions");
  }
  if (hasIntersection(held, released)) {
    return error("input.invalidShape", "input.held and input.released must not contain the same action");
  }

  return okResult(deepFreezeClone({
    tick: record.tick,
    axes: { moveX: axes.moveX, moveY: axes.moveY },
    held,
    pressed,
    released,
  }));
}

function isAxisValue(value: unknown): value is -1 | 0 | 1 {
  return value === -1 || value === 0 || value === 1;
}

/** action 配列を重複のない canonical order へ正規化する。 */
function parseActionArray(value: unknown): InputFrame["held"] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const actions = new Set<InputFrame["held"][number]>();
  for (const item of value) {
    if (item !== "shot" && item !== "focus") {
      return null;
    }
    if (actions.has(item)) {
      return null;
    }
    actions.add(item);
  }
  return GAMEPLAY_ACTION_ORDER.filter((action) => actions.has(action));
}

/** same tick の押下/離上 edge と held state の矛盾を検出する。 */
function hasIntersection(left: readonly InputFrame["held"][number][], right: readonly InputFrame["held"][number][]): boolean {
  const rightActions = new Set(right);
  return left.some((action) => rightActions.has(action));
}

/** public API 境界で typo 付き field を silent accept しないための key 検査。 */
function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** 単一エラーを `CoreResult` の失敗として返すための小さな helper。 */
function error<T>(code: CoreErrorCode, message: string): CoreResult<T> {
  return coreError(code, message);
}

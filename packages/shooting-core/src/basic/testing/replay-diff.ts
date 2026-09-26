import { HASHABLE_GAME_STATE_FIELD_ORDER } from "../hash/hashable-state.ts";
import type { HashableGameState, HashableRuntimeEntityState } from "../hash/hashable-state.ts";
import type { ReplayDivergenceSide } from "./replay-trace.ts";

/** replay artifact に残す JSON 互換値。 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | Readonly<{ [key: string]: JsonValue }>;

/** 片側に値がない、または片側が error で値を観測できないことを JSON で表す diff 値。 */
export type ReplayDiffValue =
  | JsonValue
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "error"; codes: readonly string[] }>;

/** first divergent checkpoint の field 単位の差分。 */
export type ReplayDiffItem = Readonly<{
  path: string;
  expected: ReplayDiffValue;
  actual: ReplayDiffValue;
  entityId?: number;
  component?: string;
}>;

/** report の分類ごとの diff。 */
export type ReplayCheckpointDiff = Readonly<{
  inputDiff: readonly ReplayDiffItem[];
  entityDiff: readonly ReplayDiffItem[];
  componentDiff: readonly ReplayDiffItem[];
  eventDiff: readonly ReplayDiffItem[];
  prngStateDiff: ReplayDiffItem | null;
}>;

/** diff 走査中だけ使う欠落値。object marker と違い、JSON object として再帰しない。 */
const MISSING = Symbol("missing");
type DiffInput = JsonValue | typeof MISSING;
type DiffDecoration = Readonly<{ entityId?: number; component?: string }>;

const MISSING_VALUE: ReplayDiffValue = Object.freeze({ kind: "missing" });
const STATE_COMPONENT_FIELDS = HASHABLE_GAME_STATE_FIELD_ORDER.filter(
  (field) => field !== "runtimeEntities" && field !== "prngState",
);

/**
 * 同じ checkpoint の2つの観測が同一かを判定する。
 *
 * status、parse 後の input、state hash、順序付き event の完全 payload を比べるため、state hash が同じでも
 * event の欠落・順序・payload が違えば divergence とする。error 同士は error code 列で比べる。
 */
export function isSameReplayCheckpoint(expected: ReplayDivergenceSide, actual: ReplayDivergenceSide): boolean {
  if (expected.status !== actual.status || !jsonEquals(toJson(expected.inputFrame), toJson(actual.inputFrame))) {
    return false;
  }
  if (expected.status === "ok" && actual.status === "ok") {
    return expected.stateHash === actual.stateHash && jsonEquals(toJson(expected.events), toJson(actual.events));
  }
  if (expected.status === "error" && actual.status === "error") {
    return jsonEquals(errorCodes(expected), errorCodes(actual));
  }
  return true;
}

/**
 * first divergent checkpoint の input / entity / component / event / PRNG diff を作る。
 *
 * 両側 `ok` なら runtime entity を id で対応付け、片側だけの entity や kind 違いは `entityDiff`、同じ entity の
 * field と state 直下の field は `componentDiff`、PRNG は `prngStateDiff` に分ける。片側が `missing` / `error`
 * の場合は field 単位で比べられないため、`stateHash` と `events` の1件ずつで表す。
 */
export function diffReplayCheckpoint(expected: ReplayDivergenceSide, actual: ReplayDivergenceSide): ReplayCheckpointDiff {
  const inputDiff: ReplayDiffItem[] = [];
  diffJson("inputFrame", expected.inputFrame ?? MISSING, actual.inputFrame ?? MISSING, inputDiff, {});

  if (expected.status !== "ok" || actual.status !== "ok") {
    const componentDiff: ReplayDiffItem[] = [];
    const eventDiff: ReplayDiffItem[] = [];
    pushIfDifferent(componentDiff, "stateHash", observed(expected, (side) => side.stateHash), observed(actual, (side) => side.stateHash));
    pushIfDifferent(eventDiff, "events", observed(expected, (side) => toJson(side.events)), observed(actual, (side) => toJson(side.events)));
    return freezeDiff({ inputDiff, entityDiff: [], componentDiff, eventDiff, prngStateDiff: null });
  }

  const entityDiff: ReplayDiffItem[] = [];
  const componentDiff: ReplayDiffItem[] = [];
  diffRuntimeEntities(expected.state, actual.state, entityDiff, componentDiff);
  for (const field of STATE_COMPONENT_FIELDS) {
    diffJson(`state.${field}`, toJson(expected.state[field]), toJson(actual.state[field]), componentDiff, { component: field });
  }
  const prngItems: ReplayDiffItem[] = [];
  diffJson("state.prngState.state", expected.state.prngState.state, actual.state.prngState.state, prngItems, {});
  const eventDiff: ReplayDiffItem[] = [];
  diffJson("events", toJson(expected.events), toJson(actual.events), eventDiff, {});
  return freezeDiff({ inputDiff, entityDiff, componentDiff, eventDiff, prngStateDiff: prngItems[0] ?? null });
}

/** JSON 値を key 順に依存せず比較する。 */
export function jsonEquals(left: JsonValue, right: JsonValue): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => jsonEquals(item, right[index]!));
  }
  if (isJsonObject(left) && isJsonObject(right)) {
    const leftKeys = Object.keys(left);
    return leftKeys.length === Object.keys(right).length
      && leftKeys.every((key) => Object.hasOwn(right, key) && jsonEquals(left[key]!, right[key]!));
  }
  return false;
}

/** runtime entity を id で対応付け、entity 単位と component 単位の差分に分ける。 */
function diffRuntimeEntities(
  expected: HashableGameState,
  actual: HashableGameState,
  entityDiff: ReplayDiffItem[],
  componentDiff: ReplayDiffItem[],
): void {
  const expectedById = new Map(expected.runtimeEntities.map((entity) => [entity.id, entity]));
  const actualById = new Map(actual.runtimeEntities.map((entity) => [entity.id, entity]));
  const ids = [...new Set([...expectedById.keys(), ...actualById.keys()])].sort((left, right) => left - right);
  for (const entityId of ids) {
    const path = `state.runtimeEntities[id=${entityId}]`;
    const expectedEntity = expectedById.get(entityId);
    const actualEntity = actualById.get(entityId);
    if (!expectedEntity || !actualEntity || expectedEntity.kind !== actualEntity.kind) {
      pushIfDifferent(entityDiff, path, entityValue(expectedEntity), entityValue(actualEntity), { entityId });
      continue;
    }
    const expectedFields = toJson(expectedEntity) as Readonly<Record<string, JsonValue>>;
    const actualFields = toJson(actualEntity) as Readonly<Record<string, JsonValue>>;
    for (const component of unionKeys(expectedFields, actualFields)) {
      diffJson(
        `${path}.${component}`,
        Object.hasOwn(expectedFields, component) ? expectedFields[component]! : MISSING,
        Object.hasOwn(actualFields, component) ? actualFields[component]! : MISSING,
        componentDiff,
        { entityId, component },
      );
    }
  }
}

/** object は key、array は index で再帰し、異なる leaf だけを path 付きで積む。 */
function diffJson(
  path: string,
  expected: DiffInput,
  actual: DiffInput,
  items: ReplayDiffItem[],
  decoration: DiffDecoration,
): void {
  if (expected !== MISSING && actual !== MISSING) {
    if (jsonEquals(expected, actual)) {
      return;
    }
    if (Array.isArray(expected) && Array.isArray(actual)) {
      for (let index = 0; index < Math.max(expected.length, actual.length); index += 1) {
        diffJson(
          `${path}[${index}]`,
          index < expected.length ? expected[index]! : MISSING,
          index < actual.length ? actual[index]! : MISSING,
          items,
          decoration,
        );
      }
      return;
    }
    if (isJsonObject(expected) && isJsonObject(actual)) {
      for (const key of unionKeys(expected, actual)) {
        diffJson(
          `${path}.${key}`,
          Object.hasOwn(expected, key) ? expected[key]! : MISSING,
          Object.hasOwn(actual, key) ? actual[key]! : MISSING,
          items,
          decoration,
        );
      }
      return;
    }
  }
  pushIfDifferent(items, path, toDiffValue(expected), toDiffValue(actual), decoration);
}

function pushIfDifferent(
  items: ReplayDiffItem[],
  path: string,
  expected: ReplayDiffValue,
  actual: ReplayDiffValue,
  decoration: DiffDecoration = {},
): void {
  if (jsonEquals(expected as JsonValue, actual as JsonValue)) {
    return;
  }
  items.push(Object.freeze({
    path,
    expected,
    actual,
    ...(decoration.entityId === undefined ? {} : { entityId: decoration.entityId }),
    ...(decoration.component === undefined ? {} : { component: decoration.component }),
  }));
}

/** `ok` side なら値を、それ以外は missing / error marker を返す。 */
function observed(
  side: ReplayDivergenceSide,
  read: (side: Extract<ReplayDivergenceSide, Readonly<{ status: "ok" }>>) => JsonValue,
): ReplayDiffValue {
  if (side.status === "ok") {
    return read(side);
  }
  return side.status === "missing" ? MISSING_VALUE : Object.freeze({ kind: "error", codes: errorCodes(side) });
}

function errorCodes(side: Extract<ReplayDivergenceSide, Readonly<{ status: "error" }>>): readonly string[] {
  return Object.freeze(side.errors.map((error) => error.code));
}

function entityValue(entity: HashableRuntimeEntityState | undefined): ReplayDiffValue {
  return entity === undefined ? MISSING_VALUE : toJson(entity);
}

function toDiffValue(value: DiffInput): ReplayDiffValue {
  return value === MISSING ? MISSING_VALUE : value;
}

/** expected の key 順を保ち、actual だけにある key を後ろへ足す。 */
function unionKeys(expected: Readonly<Record<string, JsonValue>>, actual: Readonly<Record<string, JsonValue>>): string[] {
  return [...Object.keys(expected), ...Object.keys(actual).filter((key) => !Object.hasOwn(expected, key))];
}

function isJsonObject(value: JsonValue): value is Readonly<{ [key: string]: JsonValue }> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Core の frozen DTO は JSON 互換だが、型としては index signature を持たないため JSON 値として扱う。 */
function toJson(value: unknown): JsonValue {
  return value as JsonValue;
}

function freezeDiff(diff: Readonly<{
  inputDiff: ReplayDiffItem[];
  entityDiff: ReplayDiffItem[];
  componentDiff: ReplayDiffItem[];
  eventDiff: ReplayDiffItem[];
  prngStateDiff: ReplayDiffItem | null;
}>): ReplayCheckpointDiff {
  return Object.freeze({
    inputDiff: Object.freeze(diff.inputDiff),
    entityDiff: Object.freeze(diff.entityDiff),
    componentDiff: Object.freeze(diff.componentDiff),
    eventDiff: Object.freeze(diff.eventDiff),
    prngStateDiff: diff.prngStateDiff,
  });
}

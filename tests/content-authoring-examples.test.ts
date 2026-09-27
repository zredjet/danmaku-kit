import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createShootingCore,
  type BulletDefinition,
  type ContentRegistry,
  type EnemyDefinition,
  type FeatureContentRegistry,
  type GameDefinition,
  type InputFrame,
  type PathDefinition,
  type PatternDefinition,
  type PickupDefinition,
  type PlayerDefinition,
  type PlayerShotDefinition,
  type StageDefinition,
} from "@shooting-sample/shooting-core";
import { pickupFeature } from "@shooting-sample/shooting-core/features/pickup";
import { formatValidateContentHuman, loadValidatedGameDefinition } from "@shooting-sample/validate-content";

// content 制作者向けの minimal YAML examples（design 19 / 21.6、Phase 2B-11）を validate-content に通し、docs の例と schema の
// ずれを検出する。下の表は Core の公開型から key を網羅させるので、Core に collection、field、Pattern DSL の命令が増えると型検査が
// 止まる。例で見せるなら true にして例を足し、見せないなら false にして README の「例にない形」に書く。

type KeysOf<T> = T extends unknown ? keyof T : never;
type ShownKeys<T> = Readonly<Record<KeysOf<T>, boolean>>;
type PatternStep = NonNullable<PatternDefinition["steps"]>[number];
type PatternFire = Extract<PatternStep, { fire: unknown }>["fire"];
type PatternIf = Extract<PatternStep, { if: unknown }>["if"];
type PathSegment = NonNullable<PathDefinition["segments"]>[number];

const COLLECTIONS = {
  version: false,
  assetKeys: false,
  players: true,
  stages: true,
  enemies: true,
  bullets: true,
  playerShots: true,
  patterns: true,
  paths: true,
  features: true,
} as const satisfies ShownKeys<ContentRegistry>;
const FEATURE_COLLECTIONS = { pickups: true } as const satisfies ShownKeys<FeatureContentRegistry>;
const DEFINITION_KEYS = {
  players: { id: true, version: true, asset: true, movement: true, collision: true, life: true, shot: true } satisfies ShownKeys<PlayerDefinition>,
  stages: { id: true, version: true, difficulties: true, timeline: true } satisfies ShownKeys<StageDefinition>,
  enemies: { id: true, version: true, asset: true, collision: true, hp: true, score: true, drops: true } satisfies ShownKeys<EnemyDefinition>,
  bullets: { id: true, version: true, asset: true, collision: true } satisfies ShownKeys<BulletDefinition>,
  playerShots: {
    id: true,
    version: true,
    asset: true,
    collision: true,
    damage: true,
    fire: true,
    projectile: true,
  } satisfies ShownKeys<PlayerShotDefinition>,
  patterns: { id: true, version: true, steps: true, fireOnSpawn: false } satisfies ShownKeys<PatternDefinition>,
  paths: { id: true, version: true, segments: true } satisfies ShownKeys<PathDefinition>,
  pickups: {
    id: true,
    version: true,
    asset: true,
    score: true,
    collectRadius: true,
    magnetRadius: true,
    velocity: true,
  } satisfies ShownKeys<PickupDefinition>,
} as const;
const PATTERN_STEP_KEYS = { wait: true, fire: true, loop: true, repeat: true, if: true } as const satisfies ShownKeys<PatternStep>;
const PATTERN_FIRE_KEYS = {
  bullet: true,
  origin: false,
  speed: true,
  stream: true,
  fan: true,
  radial: true,
  aim: true,
  angleDeg: true,
} as const satisfies ShownKeys<PatternFire>;
const PATTERN_IF_KEYS = { difficulty: true, then: true, else: true } as const satisfies ShownKeys<PatternIf>;
const PATH_SEGMENT_KEYS = { type: true, duration: true, velocity: true, offset: true } as const satisfies ShownKeys<PathSegment>;

/** 入力のない自機が stage を clear するまでの上限（tick）。 */
const CLEAR_TICK_LIMIT = 3_000;

const examplesRoot = fileURLToPath(new URL("../docs/content-authoring/examples/", import.meta.url));

async function loadExamples() {
  const loaded = await loadValidatedGameDefinition({
    gameDefinitionPath: path.join(examplesRoot, "game-definition.yaml"),
    contentRoot: path.join(examplesRoot, "content"),
  });
  assert.ok(loaded.ok, formatValidateContentHuman(loaded.runResult.output));
  return loaded;
}

/** `table` で true の key のうち、`values` のどれも持たない key。 */
function unshownKeys(table: Readonly<Record<string, boolean>>, values: readonly object[]): readonly string[] {
  return Object.entries(table)
    .filter(([key, shown]) => shown && !values.some((value) => Object.hasOwn(value, key)))
    .map(([key]) => key);
}

/** pattern の命令（`repeat` と `if` の中も）をすべて返す。 */
function flattenSteps(steps: readonly PatternStep[]): readonly PatternStep[] {
  return steps.flatMap((step): readonly PatternStep[] => {
    if ("repeat" in step) {
      return [step, ...flattenSteps(step.repeat.steps)];
    }
    if ("if" in step) {
      return [step, ...flattenSteps([...step.if.then, ...step.if.else ?? []])];
    }
    return [step];
  });
}

/** examples の file（README 以外）を examples root からの相対 path で返す。 */
async function listExampleFiles(): Promise<readonly string[]> {
  const entries = await readdir(examplesRoot, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name !== "README.md")
    .map((entry) => path.relative(examplesRoot, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

test("validates the examples without errors, warnings or infos", async () => {
  const loaded = await loadExamples();

  assert.deepEqual(loaded.runResult.output.diagnostics, [], formatValidateContentHuman(loaded.runResult.output));
});

test("shows every content collection and every field of the definitions", async () => {
  const { definition, assetManifest } = await loadExamples();
  const { content } = definition;
  const features = content.features ?? {};

  assert.deepEqual(unshownKeys(COLLECTIONS, [content]), []);
  assert.deepEqual(unshownKeys(FEATURE_COLLECTIONS, [features]), []);
  assert.deepEqual(definition.enabledFeatures, ["pickup"]);
  assert.ok(Object.keys(assetManifest.assets).length > 0);
  const collections: Readonly<Record<keyof typeof DEFINITION_KEYS, readonly object[]>> = {
    ...content,
    pickups: features.pickups ?? [],
  };
  for (const [collection, keys] of Object.entries(DEFINITION_KEYS)) {
    assert.deepEqual(unshownKeys(keys, collections[collection as keyof typeof DEFINITION_KEYS]), [], collection);
  }
  assert.deepEqual(unshownKeys(PATH_SEGMENT_KEYS, content.paths.flatMap((pathDefinition) => pathDefinition.segments ?? [])), []);
});

test("shows every Pattern DSL instruction and fire modifier and both branches of a difficulty if", async () => {
  const { definition } = await loadExamples();
  const steps = flattenSteps(definition.content.patterns.flatMap((pattern) => pattern.steps ?? []));
  const ifs = steps.flatMap((step) => "if" in step ? [step.if] : []);

  assert.deepEqual(unshownKeys(PATTERN_STEP_KEYS, steps), []);
  assert.deepEqual(unshownKeys(PATTERN_FIRE_KEYS, steps.flatMap((step) => "fire" in step ? [step.fire] : [])), []);
  assert.deepEqual(unshownKeys(PATTERN_IF_KEYS, ifs), []);
  // stage の difficulty に、`if` の条件に入るものと入らないものがあり、両方の枝が使われる。
  const difficulties = definition.content.stages.flatMap((stage) => stage.difficulties);
  for (const { difficulty } of ifs) {
    assert.ok(difficulties.some((candidate) => difficulty.includes(candidate)), `a stage must use the then branch of ${difficulty}`);
    assert.ok(difficulties.some((candidate) => !difficulty.includes(candidate)), `a stage must use the else branch of ${difficulty}`);
  }
});

test("clears every stage of every difficulty without input when the player survives", async () => {
  const { definition } = await loadExamples();
  // 被弾しても stage が終わらないよう lives を増やし、残った敵で stage が終わらなくなる例（画面の中で止まる path など）を検出する。
  const survivor: GameDefinition = {
    ...definition,
    content: {
      ...definition.content,
      players: definition.content.players.map((player) => ({ ...player, life: { ...player.life, initialLives: CLEAR_TICK_LIMIT } })),
    },
  };
  const loaded = createShootingCore({ features: [pickupFeature] }).load(survivor);
  assert.ok(loaded.ok, JSON.stringify(loaded.ok ? null : loaded.errors));

  for (const stage of definition.content.stages) {
    for (const difficulty of stage.difficulties) {
      const session = loaded.value.startStage({ stageId: stage.id, difficulty, seed: "examples" });
      assert.ok(session.ok);
      let status = "playing";
      for (let tick = 0; tick < CLEAR_TICK_LIMIT && status === "playing"; tick += 1) {
        const frame = session.value.tick(idleInput(tick));
        assert.ok(frame.ok, JSON.stringify(frame.ok ? null : frame.errors));
        status = frame.value.state.status;
      }
      assert.equal(status, "stageCleared", `${stage.id} ${difficulty}`);
    }
  }
});

test("lists every example file in the README and no file that does not exist", async () => {
  const readme = await readFile(path.join(examplesRoot, "README.md"), "utf8");
  const listed = [...readme.matchAll(/^\| `([^`]+)` \|/gmu)].map((match) => match[1]!).sort();

  assert.deepEqual(listed, await listExampleFiles());
});

function idleInput(tick: number): InputFrame {
  return { tick, axes: { moveX: 0, moveY: 0 }, held: [], pressed: [], released: [] };
}

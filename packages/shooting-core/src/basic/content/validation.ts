import type { CoreError } from "../result.ts";
import { deepFreezePlainData } from "../internal/immutable.ts";
import { MAX_IDENTIFIER_LENGTH, isNamespacedId, isSafeAssetKey } from "./identifier.ts";
import { KNOWN_ENABLED_FEATURES } from "./types.ts";
import type { ContentRegistry, GameDefinition } from "./types.ts";

const SUPPORTED_SCHEMA_VERSION = "1";
const KNOWN_FEATURE_SET = new Set<string>(KNOWN_ENABLED_FEATURES);
const MAX_STAGE_TIMELINE_STEPS = 4_096;
const MAX_SPAWNS_PER_TICK = 100;

/**
 * `GameDefinition` 全体の validation pipeline。
 *
 * まず runtime shape を確定し、その後で ID の一意性や参照解決のような semantic
 * validation を行う。shape 不正のまま semantic validation に進むと例外になりやすいため、
 * `validateDefinitionShape()` が失敗した場合はそこで止める。
 */
export function validateGameDefinition(definition: unknown): CoreError[] {
  const errors: CoreError[] = [];
  const plainDefinition = deepFreezePlainData(definition);
  if (!plainDefinition) {
    return [{ code: "definition.invalidShape", message: "GameDefinition must be JSON-compatible plain data" }];
  }
  const validated = validateDefinitionShape(plainDefinition, errors);
  if (!validated) {
    return errors;
  }

  validateUniqueIds("player", validated.content.players, errors);
  validateUniqueIds("stage", validated.content.stages, errors);
  validateUniqueIds("enemy", validated.content.enemies, errors);
  validateUniqueIds("bullet", validated.content.bullets, errors);
  validateUniqueIds("playerShot", validated.content.playerShots, errors);
  validateUniqueIds("pattern", validated.content.patterns, errors);
  validateUniqueIds("path", validated.content.paths, errors);

  const defaultPlayerIdIsValid = validateNamespacedReference("defaultPlayerId", "player", validated.defaultPlayerId, errors);
  if (defaultPlayerIdIsValid && !validated.content.players.some((player) => player.id === validated.defaultPlayerId)) {
    errors.push({
      code: "player.defaultNotFound",
      message: `Default player not found: ${validated.defaultPlayerId}`,
    });
  }

  validateAssetReferences(validated.content, errors);
  validatePlayerShotReferences(validated.content, errors);
  validateStageTimelineReferences(validated.content, errors);
  return errors;
}

/**
 * 外部入力を `GameDefinition` として扱える形か検証する。
 *
 * TypeScript の型は JSON/YAML 読み込み後には効かないため、ここで object / array /
 * primitive を明示的に確認する。
 */
function validateDefinitionShape(definition: unknown, errors: CoreError[]): GameDefinition | null {
  const root = asRecord(definition);
  if (!root) {
    errors.push({ code: "definition.invalidShape", message: "GameDefinition must be an object" });
    return null;
  }

  const shapeErrorCount = errors.length;
  validateAllowedKeys("GameDefinition", root, ["schemaVersion", "enabledFeatures", "defaultPlayerId", "content"], errors);
  validateNonEmptyString("schemaVersion", root.schemaVersion, errors);
  validateNonEmptyString("defaultPlayerId", root.defaultPlayerId, errors);
  if (typeof root.schemaVersion === "string" && root.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    errors.push({
      code: "schema.unsupportedVersion",
      message: `Unsupported schema version: ${String(root.schemaVersion)}`,
    });
  }

  if (!Array.isArray(root.enabledFeatures)) {
    errors.push({ code: "definition.invalidShape", message: "enabledFeatures must be an array" });
  } else {
    const seenFeatures = new Set<string>();
    for (const feature of root.enabledFeatures) {
      if (typeof feature !== "string") {
        errors.push({ code: "definition.invalidShape", message: "enabledFeatures must contain strings" });
        continue;
      }
      if (seenFeatures.has(feature)) {
        errors.push({ code: "feature.duplicate", message: `Duplicate optional feature: ${feature}` });
        continue;
      }
      seenFeatures.add(feature);
      if (!KNOWN_FEATURE_SET.has(feature)) {
        errors.push({ code: "feature.unknown", message: `Unknown optional feature: ${feature}` });
      }
    }
    if (root.enabledFeatures.some((feature) => typeof feature === "string" && KNOWN_FEATURE_SET.has(feature))) {
      errors.push({
        code: "feature.unsupported",
        message: "Basic core does not support optional features yet",
      });
    }
  }

  const content = asRecord(root.content);
  if (!content) {
    errors.push({ code: "definition.invalidShape", message: "content must be an object" });
    return null;
  }

  validateAllowedKeys(
    "content",
    content,
    ["version", "assetKeys", "players", "stages", "enemies", "bullets", "playerShots", "patterns", "paths"],
    errors,
  );
  validateNonEmptyString("content.version", content.version, errors);

  const assetKeys = asRecord(content.assetKeys);
  if (!assetKeys) {
    errors.push({ code: "definition.invalidShape", message: "content.assetKeys must be an object" });
  } else {
    validateAllowedKeys("content.assetKeys", assetKeys, ["keys"], errors);
    validateAssetKeyArray("content.assetKeys.keys", assetKeys.keys, errors);
  }

  const players = validateObjectArray("content.players", content.players, errors);
  const stages = validateObjectArray("content.stages", content.stages, errors);
  const enemies = validateObjectArray("content.enemies", content.enemies, errors);
  const bullets = validateObjectArray("content.bullets", content.bullets, errors);
  const playerShots = validateObjectArray("content.playerShots", content.playerShots, errors);
  const patterns = validateObjectArray("content.patterns", content.patterns, errors);
  const paths = validateObjectArray("content.paths", content.paths, errors);

  for (const player of players) {
    validatePlayerShape(player, errors);
  }
  for (const stage of stages) {
    validateStageShape(stage, errors);
  }
  for (const enemy of enemies) {
    validateAllowedKeys("enemy", enemy, ["id", "version", "asset", "hp", "score"], errors);
    validateNonEmptyString("enemy.id", enemy.id, errors);
    validatePositiveInteger("enemy.version", enemy.version, errors);
    validateNonEmptyString("enemy.asset", enemy.asset, errors);
    validatePositiveNumber("enemy.hp", enemy.hp, errors);
    validateNonNegativeInteger("enemy.score", enemy.score, errors);
  }
  for (const bullet of bullets) {
    validateAllowedKeys("bullet", bullet, ["id", "version", "asset"], errors);
    validateNonEmptyString("bullet.id", bullet.id, errors);
    validatePositiveInteger("bullet.version", bullet.version, errors);
    validateNonEmptyString("bullet.asset", bullet.asset, errors);
  }
  for (const playerShot of playerShots) {
    validateAllowedKeys("playerShot", playerShot, ["id", "version", "asset", "damage"], errors);
    validateNonEmptyString("playerShot.id", playerShot.id, errors);
    validatePositiveInteger("playerShot.version", playerShot.version, errors);
    validateNonEmptyString("playerShot.asset", playerShot.asset, errors);
    validatePositiveNumber("playerShot.damage", playerShot.damage, errors);
  }
  for (const pattern of patterns) {
    validateAllowedKeys("pattern", pattern, ["id", "version"], errors);
    validateNonEmptyString("pattern.id", pattern.id, errors);
    validatePositiveInteger("pattern.version", pattern.version, errors);
  }
  for (const path of paths) {
    validateAllowedKeys("path", path, ["id", "version"], errors);
    validateNonEmptyString("path.id", path.id, errors);
    validatePositiveInteger("path.version", path.version, errors);
  }

  if (errors.length > shapeErrorCount) {
    return null;
  }
  return definition as GameDefinition;
}

/** PlayerDefinition の shape validation。 */
function validatePlayerShape(player: Record<string, unknown>, errors: CoreError[]): void {
  validateAllowedKeys(
    "player",
    player,
    ["id", "version", "asset", "movement", "collision", "life", "shot"],
    errors,
  );
  validateNonEmptyString("player.id", player.id, errors);
  validatePositiveInteger("player.version", player.version, errors);
  validateNonEmptyString("player.asset", player.asset, errors);

  const movement = asRecord(player.movement);
  if (!movement) {
    errors.push({ code: "definition.invalidShape", message: "player.movement must be an object" });
  } else {
    validateAllowedKeys("player.movement", movement, ["speed", "focusSpeed"], errors);
    validatePositiveNumber("player.movement.speed", movement.speed, errors);
    validatePositiveNumber("player.movement.focusSpeed", movement.focusSpeed, errors);
  }

  const collision = asRecord(player.collision);
  if (!collision) {
    errors.push({ code: "definition.invalidShape", message: "player.collision must be an object" });
  } else {
    validateAllowedKeys("player.collision", collision, ["radius"], errors);
    validatePositiveNumber("player.collision.radius", collision.radius, errors);
  }

  const life = asRecord(player.life);
  if (!life) {
    errors.push({ code: "definition.invalidShape", message: "player.life must be an object" });
  } else {
    validateAllowedKeys("player.life", life, ["initialLives", "invincibleTicksAfterHit"], errors);
    validateNonNegativeInteger("player.life.initialLives", life.initialLives, errors);
    validateNonNegativeInteger("player.life.invincibleTicksAfterHit", life.invincibleTicksAfterHit, errors);
  }

  const shot = asRecord(player.shot);
  if (!shot) {
    errors.push({ code: "definition.invalidShape", message: "player.shot must be an object" });
  } else {
    validateAllowedKeys("player.shot", shot, ["definition"], errors);
    validateNonEmptyString("player.shot.definition", shot.definition, errors);
  }
}

/** StageDefinition の shape validation。 */
function validateStageShape(stage: Record<string, unknown>, errors: CoreError[]): void {
  validateAllowedKeys("stage", stage, ["id", "version", "difficulties", "timeline"], errors);
  validateNonEmptyString("stage.id", stage.id, errors);
  validatePositiveInteger("stage.version", stage.version, errors);
  validateDifficultyArray("stage.difficulties", stage.difficulties, errors);

  let previousTick = -1;
  let currentTick = -1;
  let spawnsInCurrentTick = 0;
  const timeline = validateObjectArray("stage.timeline", stage.timeline, errors);
  if (timeline.length > MAX_STAGE_TIMELINE_STEPS) {
    errors.push({
      code: "timeline.tooManySteps",
      message: `stage.timeline must contain at most ${MAX_STAGE_TIMELINE_STEPS} steps`,
    });
  }
  for (const step of timeline) {
    validateAllowedKeys("stage.timeline[]", step, ["tick", "action"], errors);
    validateNonNegativeInteger("stage.timeline[].tick", step.tick, errors);
    if (typeof step.tick === "number" && Number.isInteger(step.tick) && step.tick < previousTick) {
      errors.push({
        code: "timeline.invalidOrder",
        message: "stage.timeline must be sorted by tick in ascending order",
      });
    }
    if (typeof step.tick === "number" && Number.isInteger(step.tick)) {
      if (step.tick !== currentTick) {
        currentTick = step.tick;
        spawnsInCurrentTick = 0;
      }
      previousTick = step.tick;
    }

    const action = asRecord(step.action);
    if (!action) {
      errors.push({ code: "definition.invalidShape", message: "stage.timeline[].action must be an object" });
      continue;
    }
    validateAllowedKeys("stage.timeline[].action", action, ["type", "enemy", "path", "pattern", "position"], errors);
    if (action.type !== "spawnEnemy") {
      errors.push({ code: "definition.invalidShape", message: "stage.timeline[].action.type must be spawnEnemy" });
    }
    if (action.type === "spawnEnemy" && typeof step.tick === "number" && Number.isInteger(step.tick)) {
      spawnsInCurrentTick += 1;
      if (spawnsInCurrentTick === MAX_SPAWNS_PER_TICK + 1) {
        errors.push({
          code: "timeline.tooManySpawnsPerTick",
          message: `stage.timeline must spawn at most ${MAX_SPAWNS_PER_TICK} enemies per tick`,
        });
      }
    }
    validateNonEmptyString("stage.timeline[].action.enemy", action.enemy, errors);
    validateNonEmptyString("stage.timeline[].action.path", action.path, errors);
    validateNonEmptyString("stage.timeline[].action.pattern", action.pattern, errors);

    const position = asRecord(action.position);
    if (!position) {
      errors.push({ code: "definition.invalidShape", message: "stage.timeline[].action.position must be an object" });
      continue;
    }
    validateAllowedKeys("stage.timeline[].action.position", position, ["x", "y"], errors);
    validateFiniteNumber("stage.timeline[].action.position.x", position.x, errors);
    validateFiniteNumber("stage.timeline[].action.position.y", position.y, errors);
  }
}

/** namespace prefix と重複 ID を検証する。 */
function validateUniqueIds(
  namespace: string,
  definitions: readonly { id: string }[],
  errors: CoreError[],
): void {
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (!isNamespacedId(definition.id, namespace)) {
      errors.push({
        code: "id.invalidNamespace",
        message: `Expected ${namespace}. prefix for id: ${definition.id}`,
      });
    }
    if (seen.has(definition.id)) {
      errors.push({
        code: "id.duplicate",
        message: `Duplicate id: ${definition.id}`,
      });
    }
    seen.add(definition.id);
  }
}

/** content が参照する asset key が manifest に存在するか検証する。 */
function validateAssetReferences(registry: ContentRegistry, errors: CoreError[]): void {
  const assetKeys = new Set(registry.assetKeys.keys);
  const referenced = [
    ...registry.players.map((definition) => definition.asset),
    ...registry.enemies.map((definition) => definition.asset),
    ...registry.bullets.map((definition) => definition.asset),
    ...registry.playerShots.map((definition) => definition.asset),
  ];

  for (const asset of referenced) {
    if (!isSafeAssetKey(asset)) {
      errors.push({ code: "asset.invalidKey", message: `Invalid asset key reference: ${asset}` });
      continue;
    }
    if (!assetKeys.has(asset)) {
      errors.push({
        code: "asset.notFound",
        message: `Asset not found: ${asset}`,
      });
    }
  }
}

/** PlayerDefinition から参照される player shot が registry に存在するか検証する。 */
function validatePlayerShotReferences(registry: ContentRegistry, errors: CoreError[]): void {
  const playerShotIds = new Set(registry.playerShots.map((definition) => definition.id));
  for (const player of registry.players) {
    if (!validateNamespacedReference("player.shot.definition", "playerShot", player.shot.definition, errors)) {
      continue;
    }
    if (!playerShotIds.has(player.shot.definition)) {
      errors.push({
        code: "playerShot.notFound",
        message: `Player shot not found: ${player.shot.definition}`,
      });
    }
  }
}

/** Stage timeline 内の enemy / pattern / path 参照を検証する。 */
function validateStageTimelineReferences(registry: ContentRegistry, errors: CoreError[]): void {
  const enemyIds = new Set(registry.enemies.map((definition) => definition.id));
  const patternIds = new Set(registry.patterns.map((definition) => definition.id));
  const pathIds = new Set(registry.paths.map((definition) => definition.id));

  for (const stage of registry.stages) {
    for (const step of stage.timeline) {
      const enemyReferenceIsValid = validateNamespacedReference(
        "stage.timeline[].action.enemy",
        "enemy",
        step.action.enemy,
        errors,
      );
      const patternReferenceIsValid = validateNamespacedReference(
        "stage.timeline[].action.pattern",
        "pattern",
        step.action.pattern,
        errors,
      );
      const pathReferenceIsValid = validateNamespacedReference(
        "stage.timeline[].action.path",
        "path",
        step.action.path,
        errors,
      );
      if (enemyReferenceIsValid && !enemyIds.has(step.action.enemy)) {
        errors.push({ code: "enemy.notFound", message: `Enemy not found: ${step.action.enemy}` });
      }
      if (patternReferenceIsValid && !patternIds.has(step.action.pattern)) {
        errors.push({ code: "pattern.notFound", message: `Pattern not found: ${step.action.pattern}` });
      }
      if (pathReferenceIsValid && !pathIds.has(step.action.path)) {
        errors.push({ code: "path.notFound", message: `Path not found: ${step.action.path}` });
      }
    }
  }
}

/** object の許可 field を検証する。 */
function validateAllowedKeys(
  path: string,
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  errors: CoreError[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push({
        code: "definition.unknownField",
        message: `Unknown field at ${path}.${key}`,
      });
    }
  }
}

/** unknown value を object array として取り出す。 */
function validateObjectArray(path: string, value: unknown, errors: CoreError[]): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be an array` });
    return [];
  }

  const records: Record<string, unknown>[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      errors.push({ code: "definition.invalidShape", message: `${path} must contain objects` });
      continue;
    }
    records.push(record);
  }
  return records;
}

/** asset key 配列として使える内容か検証する。 */
function validateAssetKeyArray(path: string, value: unknown, errors: CoreError[]): void {
  if (!Array.isArray(value)) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be an array` });
    return;
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      errors.push({ code: "definition.invalidShape", message: `${path} must contain strings` });
      continue;
    }
    if (item.trim().length === 0) {
      errors.push({ code: "asset.invalidKey", message: `${path} must not contain empty asset keys` });
      continue;
    }
    if (!isSafeAssetKey(item)) {
      errors.push({ code: "asset.invalidKey", message: `Invalid asset key: ${item}` });
      continue;
    }
    if (seen.has(item)) {
      errors.push({ code: "asset.duplicate", message: `Duplicate asset key: ${item}` });
      continue;
    }
    seen.add(item);
  }
}

/** Difficulty 配列を検証する。 */
function validateDifficultyArray(path: string, value: unknown, errors: CoreError[]): void {
  if (!Array.isArray(value)) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be an array` });
    return;
  }
  if (value.length === 0) {
    errors.push({ code: "definition.invalidShape", message: `${path} must contain at least one difficulty` });
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (item !== "normal" && item !== "hard") {
      errors.push({ code: "definition.invalidShape", message: `${path} must contain supported difficulties` });
      continue;
    }
    if (seen.has(item)) {
      errors.push({ code: "definition.invalidShape", message: `${path} must not contain duplicate difficulties` });
      continue;
    }
    seen.add(item);
  }
}

/** 参照 ID が期待 namespace と安全な形式を満たすか検証する。 */
function validateNamespacedReference(
  path: string,
  namespace: string,
  value: string,
  errors: CoreError[],
): boolean {
  const prefix = `${namespace}.`;
  const suffix = value.startsWith(prefix) ? value.slice(prefix.length) : "";
  if (value.length > MAX_IDENTIFIER_LENGTH || suffix.length === 0 || !isNamespacedId(value, namespace)) {
    errors.push({
      code: "id.invalidNamespace",
      message: `${path} must reference a ${namespace}.* id: ${value}`,
    });
    return false;
  }
  return true;
}

/** unknown value が空白だけではない string であることを検証する。 */
function validateNonEmptyString(path: string, value: unknown, errors: CoreError[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be a string` });
  }
}

/** unknown value が finite number であることを検証する。 */
function validateFiniteNumber(path: string, value: unknown, errors: CoreError[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be a finite number` });
  }
}

/** unknown value が 0 以上の整数であることを検証する。 */
function validateNonNegativeInteger(path: string, value: unknown, errors: CoreError[]): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be a non-negative integer` });
  }
}

/** unknown value が 1 以上の整数であることを検証する。 */
function validatePositiveInteger(path: string, value: unknown, errors: CoreError[]): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be a positive integer` });
  }
}

/** unknown value が 0 より大きい有限数であることを検証する。 */
function validatePositiveNumber(path: string, value: unknown, errors: CoreError[]): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be a positive number` });
  }
}

/** unknown value を plain object として扱えるか判定する。 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

import type { CoreError } from "../result.ts";
import { deepFreezePlainData } from "../internal/immutable.ts";
import { MAX_IDENTIFIER_LENGTH, isNamespacedId, isSafeAssetKey } from "./identifier.ts";
import {
  MAX_PLAYER_MOVEMENT_SPEED,
  MAX_PLAYER_SHOT_FIRE_INTERVAL_TICKS,
  MAX_PLAYER_SHOT_LIFETIME_TICKS,
  MAX_PLAYER_SHOT_SPEED_PER_AXIS,
  MAX_SPAWNS_PER_TICK,
  MAX_STAGE_TIMELINE_STEPS,
} from "./runtime-budgets.ts";
import { KNOWN_ENABLED_FEATURES } from "./types.ts";
import type { ContentRegistry, GameDefinition } from "./types.ts";

const SUPPORTED_SCHEMA_VERSION = "1";
const KNOWN_FEATURE_SET = new Set<string>(KNOWN_ENABLED_FEATURES);

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

  validateUniqueIds("player", "players", validated.content.players, errors);
  validateUniqueIds("stage", "stages", validated.content.stages, errors);
  validateUniqueIds("enemy", "enemies", validated.content.enemies, errors);
  validateUniqueIds("bullet", "bullets", validated.content.bullets, errors);
  validateUniqueIds("playerShot", "playerShots", validated.content.playerShots, errors);
  validateUniqueIds("pattern", "patterns", validated.content.patterns, errors);
  validateUniqueIds("path", "paths", validated.content.paths, errors);

  const defaultPlayerIdIsValid = validateNamespacedReference(
    "defaultPlayerId",
    "player",
    validated.defaultPlayerId,
    errors,
    { schemaPath: "defaultPlayerId", referrerId: "gameDefinition", targetId: validated.defaultPlayerId },
  );
  if (defaultPlayerIdIsValid && !validated.content.players.some((player) => player.id === validated.defaultPlayerId)) {
    errors.push({
      code: "player.defaultNotFound",
      message: `Default player not found: ${validated.defaultPlayerId}`,
      schemaPath: "defaultPlayerId",
      referrerId: "gameDefinition",
      targetId: validated.defaultPlayerId,
    });
  }

  validateAssetReferences(validated.content, errors);
  validatePlayerShotReferences(validated.content, errors);
  validatePatternBulletReferences(validated.content, errors);
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
      schemaPath: "schemaVersion",
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
        errors.push({
          code: "feature.duplicate",
          message: `Duplicate optional feature: ${feature}`,
          schemaPath: "enabledFeatures",
          targetId: feature,
        });
        continue;
      }
      seenFeatures.add(feature);
      if (!KNOWN_FEATURE_SET.has(feature)) {
        errors.push({
          code: "feature.unknown",
          message: `Unknown optional feature: ${feature}`,
          schemaPath: "enabledFeatures",
          targetId: feature,
        });
      }
    }
    if (root.enabledFeatures.some((feature) => typeof feature === "string" && KNOWN_FEATURE_SET.has(feature))) {
      errors.push({
        code: "feature.unsupported",
        message: "Basic core does not support optional features yet",
        schemaPath: "enabledFeatures",
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

  players.items.forEach(({ record: player, index }) => validateContentItem(
    `content.players[${index}]`, "player", player, errors,
    () => validatePlayerShape(player, errors),
  ));
  stages.items.forEach(({ record: stage, index }) => validateContentItem(
    `content.stages[${index}]`, "stage", stage, errors,
    () => validateStageShape(stage, errors),
  ));
  enemies.items.forEach(({ record: enemy, index }) => validateContentItem(
    `content.enemies[${index}]`, "enemy", enemy, errors,
    () => {
      validateAllowedKeys("enemy", enemy, ["id", "version", "asset", "collision", "hp", "score"], errors);
      validateNonEmptyString("enemy.id", enemy.id, errors);
      validatePositiveInteger("enemy.version", enemy.version, errors);
      validateNonEmptyString("enemy.asset", enemy.asset, errors);
      validateCollisionShape("enemy.collision", enemy.collision, errors);
      validatePositiveNumber("enemy.hp", enemy.hp, errors);
      validateNonNegativeInteger("enemy.score", enemy.score, errors);
    },
  ));
  bullets.items.forEach(({ record: bullet, index }) => validateContentItem(
    `content.bullets[${index}]`, "bullet", bullet, errors,
    () => {
      validateAllowedKeys("bullet", bullet, ["id", "version", "asset", "collision"], errors);
      validateNonEmptyString("bullet.id", bullet.id, errors);
      validatePositiveInteger("bullet.version", bullet.version, errors);
      validateNonEmptyString("bullet.asset", bullet.asset, errors);
      validateCollisionShape("bullet.collision", bullet.collision, errors);
    },
  ));
  playerShots.items.forEach(({ record: playerShot, index }) => validateContentItem(
    `content.playerShots[${index}]`, "playerShot", playerShot, errors,
    () => {
      validateAllowedKeys("playerShot", playerShot, ["id", "version", "asset", "collision", "damage", "fire", "projectile"], errors);
      validateNonEmptyString("playerShot.id", playerShot.id, errors);
      validatePositiveInteger("playerShot.version", playerShot.version, errors);
      validateNonEmptyString("playerShot.asset", playerShot.asset, errors);
      validateCollisionShape("playerShot.collision", playerShot.collision, errors);
      validatePositiveNumber("playerShot.damage", playerShot.damage, errors);
      validatePlayerShotFireShape(playerShot.fire, errors);
      validatePlayerShotProjectileShape(playerShot.projectile, errors);
    },
  ));
  patterns.items.forEach(({ record: pattern, index }) => validateContentItem(
    `content.patterns[${index}]`, "pattern", pattern, errors,
    () => {
      validateAllowedKeys("pattern", pattern, ["id", "version", "fireOnSpawn"], errors);
      validateNonEmptyString("pattern.id", pattern.id, errors);
      validatePositiveInteger("pattern.version", pattern.version, errors);
      if (pattern.fireOnSpawn !== undefined) {
        validatePatternFireOnSpawnShape(pattern.fireOnSpawn, errors);
      }
    },
  ));
  paths.items.forEach(({ record: path, index }) => validateContentItem(
    `content.paths[${index}]`, "path", path, errors,
    () => {
      validateAllowedKeys("path", path, ["id", "version"], errors);
      validateNonEmptyString("path.id", path.id, errors);
      validatePositiveInteger("path.version", path.version, errors);
    },
  ));

  if (errors.length > shapeErrorCount) {
    return null;
  }
  return definition as GameDefinition;
}

/** radius だけを持つ最小 collision 定義を検証する。 */
function validateCollisionShape(path: string, value: unknown, errors: CoreError[]): void {
  const collision = asRecord(value);
  if (!collision) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be an object` });
    return;
  }
  validateAllowedKeys(path, collision, ["radius"], errors);
  validatePositiveNumber(`${path}.radius`, collision.radius, errors);
}

/** player shot の最小 fire 定義を検証する。 */
function validatePlayerShotFireShape(value: unknown, errors: CoreError[]): void {
  const fire = asRecord(value);
  if (!fire) {
    errors.push({ code: "definition.invalidShape", message: "playerShot.fire must be an object" });
    return;
  }
  validateAllowedKeys("playerShot.fire", fire, ["intervalTicks"], errors);
  validatePositiveIntegerAtMost(
    "playerShot.fire.intervalTicks",
    fire.intervalTicks,
    MAX_PLAYER_SHOT_FIRE_INTERVAL_TICKS,
    errors,
  );
}

/** player shot の最小 projectile 定義を検証する。 */
function validatePlayerShotProjectileShape(value: unknown, errors: CoreError[]): void {
  const projectile = asRecord(value);
  if (!projectile) {
    errors.push({ code: "definition.invalidShape", message: "playerShot.projectile must be an object" });
    return;
  }
  validateAllowedKeys("playerShot.projectile", projectile, ["velocity", "lifetimeTicks"], errors);

  const velocity = asRecord(projectile.velocity);
  if (!velocity) {
    errors.push({ code: "definition.invalidShape", message: "playerShot.projectile.velocity must be an object" });
  } else {
    validateAllowedKeys("playerShot.projectile.velocity", velocity, ["x", "y"], errors);
    validateFiniteNumberWithinAbs(
      "playerShot.projectile.velocity.x",
      velocity.x,
      MAX_PLAYER_SHOT_SPEED_PER_AXIS,
      errors,
    );
    validateFiniteNumberWithinAbs(
      "playerShot.projectile.velocity.y",
      velocity.y,
      MAX_PLAYER_SHOT_SPEED_PER_AXIS,
      errors,
    );
  }

  validatePositiveIntegerAtMost(
    "playerShot.projectile.lifetimeTicks",
    projectile.lifetimeTicks,
    MAX_PLAYER_SHOT_LIFETIME_TICKS,
    errors,
  );
}

/** pattern.fireOnSpawn の最小弾生成定義を検証する。 */
function validatePatternFireOnSpawnShape(value: unknown, errors: CoreError[]): void {
  const fireOnSpawn = asRecord(value);
  if (!fireOnSpawn) {
    errors.push({ code: "definition.invalidShape", message: "pattern.fireOnSpawn must be an object" });
    return;
  }
  validateAllowedKeys("pattern.fireOnSpawn", fireOnSpawn, ["bullet", "offset"], errors);
  validateNonEmptyString("pattern.fireOnSpawn.bullet", fireOnSpawn.bullet, errors);

  const offset = asRecord(fireOnSpawn.offset);
  if (!offset) {
    errors.push({ code: "definition.invalidShape", message: "pattern.fireOnSpawn.offset must be an object" });
    return;
  }
  validateAllowedKeys("pattern.fireOnSpawn.offset", offset, ["x", "y"], errors);
  validateFiniteNumber("pattern.fireOnSpawn.offset.x", offset.x, errors);
  validateFiniteNumber("pattern.fireOnSpawn.offset.y", offset.y, errors);
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
    validateNumberAtMost("player.movement.speed", movement.speed, MAX_PLAYER_MOVEMENT_SPEED, String(MAX_PLAYER_MOVEMENT_SPEED), errors);
    validateNumberAtMost("player.movement.focusSpeed", movement.focusSpeed, MAX_PLAYER_MOVEMENT_SPEED, String(MAX_PLAYER_MOVEMENT_SPEED), errors);
    validateNumberAtMost("player.movement.focusSpeed", movement.focusSpeed, movement.speed, "player.movement.speed", errors);
  }

  validateCollisionShape("player.collision", player.collision, errors);

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
  if (timeline.sourceLength > MAX_STAGE_TIMELINE_STEPS) {
    errors.push({
      code: "timeline.tooManySteps",
      message: `stage.timeline must contain at most ${MAX_STAGE_TIMELINE_STEPS} steps`,
    });
  }
  for (const { record: step, index: stepIndex } of timeline.items) {
    const stepErrorStart = errors.length;
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
      addSchemaContext(errors, stepErrorStart, `stage.timeline[${stepIndex}]`, "stage.timeline[]");
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
      addSchemaContext(errors, stepErrorStart, `stage.timeline[${stepIndex}]`, "stage.timeline[]");
      continue;
    }
    validateAllowedKeys("stage.timeline[].action.position", position, ["x", "y"], errors);
    validateFiniteNumber("stage.timeline[].action.position.x", position.x, errors);
    validateFiniteNumber("stage.timeline[].action.position.y", position.y, errors);
    addSchemaContext(errors, stepErrorStart, `stage.timeline[${stepIndex}]`, "stage.timeline[]");
  }
}

/**
 * 1つのcontent definitionを検証し、その間に生成されたerrorへ配列indexとsource IDを付ける。
 * validator本体の読みやすいlocal pathは維持し、public error境界で一意なschema pathへ展開する。
 */
function validateContentItem(
  contentPath: string,
  localPrefix: string,
  definition: Record<string, unknown>,
  errors: CoreError[],
  validate: () => void,
): void {
  const errorStart = errors.length;
  validate();
  const referrerId = typeof definition.id === "string" && definition.id.length > 0
    ? definition.id
    : undefined;
  addSchemaContext(errors, errorStart, contentPath, localPrefix, referrerId);
}

/** error messageのlocal pathを、呼び出し元が持つ一意なcontent pathへ変換する。 */
function addSchemaContext(
  errors: CoreError[],
  errorStart: number,
  contentPath: string,
  localPrefix: string,
  referrerId?: string,
): void {
  for (let index = errorStart; index < errors.length; index += 1) {
    const error = errors[index]!;
    const localPath = error.schemaPath ?? inferValidationPath(error.message);
    const schemaPath = remapSchemaPath(localPath, localPrefix, contentPath) ?? contentPath;
    errors[index] = {
      ...error,
      schemaPath,
      ...(error.referrerId !== undefined ? {} : referrerId === undefined ? {} : { referrerId }),
    };
  }
}

/** Core validation messageの先頭から、既存のlocal schema path表現だけを抽出する。 */
function inferValidationPath(message: string): string | null {
  const unknownField = /^Unknown field at (.+)$/.exec(message);
  if (unknownField) {
    return unknownField[1]!;
  }
  return /^([A-Za-z][A-Za-z0-9.[\]]*) (?:must|exceeds|is )/.exec(message)?.[1] ?? null;
}

/** local prefix以下のpathを、index付きcontent path以下へ付け替える。 */
function remapSchemaPath(localPath: string | null, localPrefix: string, contentPath: string): string | null {
  if (localPath === null) {
    return null;
  }
  if (localPath === localPrefix) {
    return contentPath;
  }
  return localPath.startsWith(`${localPrefix}.`) || localPath.startsWith(`${localPrefix}[`)
    ? `${contentPath}${localPath.slice(localPrefix.length)}`
    : localPath;
}

/** namespace prefix と重複 ID を検証する。 */
function validateUniqueIds(
  namespace: string,
  collection: keyof Omit<ContentRegistry, "version" | "assetKeys">,
  definitions: readonly { id: string }[],
  errors: CoreError[],
): void {
  const seen = new Set<string>();
  for (const [index, definition] of definitions.entries()) {
    const context = {
      schemaPath: `content.${collection}[${index}].id`,
      referrerId: definition.id,
      targetId: definition.id,
    } as const;
    if (!isNamespacedId(definition.id, namespace)) {
      errors.push({
        code: "id.invalidNamespace",
        message: `Expected ${namespace}. prefix for id: ${definition.id}`,
        ...context,
      });
    }
    if (seen.has(definition.id)) {
      errors.push({
        code: "id.duplicate",
        message: `Duplicate id: ${definition.id}`,
        ...context,
      });
    }
    seen.add(definition.id);
  }
}

/** content が参照する asset key が manifest に存在するか検証する。 */
function validateAssetReferences(registry: ContentRegistry, errors: CoreError[]): void {
  const assetKeys = new Set(registry.assetKeys.keys);
  const referenced = [
    ...registry.players.map((definition, index) => ({
      asset: definition.asset,
      schemaPath: `content.players[${index}].asset`,
      referrerId: definition.id,
    })),
    ...registry.enemies.map((definition, index) => ({
      asset: definition.asset,
      schemaPath: `content.enemies[${index}].asset`,
      referrerId: definition.id,
    })),
    ...registry.bullets.map((definition, index) => ({
      asset: definition.asset,
      schemaPath: `content.bullets[${index}].asset`,
      referrerId: definition.id,
    })),
    ...registry.playerShots.map((definition, index) => ({
      asset: definition.asset,
      schemaPath: `content.playerShots[${index}].asset`,
      referrerId: definition.id,
    })),
  ];

  for (const { asset, schemaPath, referrerId } of referenced) {
    const context = { schemaPath, referrerId, targetId: asset } as const;
    if (!isSafeAssetKey(asset)) {
      errors.push({ code: "asset.invalidKey", message: `Invalid asset key reference: ${asset}`, ...context });
      continue;
    }
    if (!assetKeys.has(asset)) {
      errors.push({
        code: "asset.notFound",
        message: `Asset not found: ${asset}`,
        ...context,
      });
    }
  }
}

/** PlayerDefinition から参照される player shot が registry に存在するか検証する。 */
function validatePlayerShotReferences(registry: ContentRegistry, errors: CoreError[]): void {
  const playerShotIds = new Set(registry.playerShots.map((definition) => definition.id));
  for (const [index, player] of registry.players.entries()) {
    const context = {
      schemaPath: `content.players[${index}].shot.definition`,
      referrerId: player.id,
      targetId: player.shot.definition,
    } as const;
    if (!validateNamespacedReference(
      "player.shot.definition", "playerShot", player.shot.definition, errors, context,
    )) {
      continue;
    }
    if (!playerShotIds.has(player.shot.definition)) {
      errors.push({
        code: "playerShot.notFound",
        message: `Player shot not found: ${player.shot.definition}`,
        ...context,
      });
    }
  }
}

/** PatternDefinition から参照される enemy bullet が registry に存在するか検証する。 */
function validatePatternBulletReferences(registry: ContentRegistry, errors: CoreError[]): void {
  const bulletIds = new Set(registry.bullets.map((definition) => definition.id));
  for (const [index, pattern] of registry.patterns.entries()) {
    const bulletId = pattern.fireOnSpawn?.bullet;
    if (bulletId === undefined) {
      continue;
    }
    const context = {
      schemaPath: `content.patterns[${index}].fireOnSpawn.bullet`,
      referrerId: pattern.id,
      targetId: bulletId,
    } as const;
    if (!validateNamespacedReference("pattern.fireOnSpawn.bullet", "bullet", bulletId, errors, context)) {
      continue;
    }
    if (!bulletIds.has(bulletId)) {
      errors.push({ code: "bullet.notFound", message: `Bullet not found: ${bulletId}`, ...context });
    }
  }
}

/** Stage timeline 内の enemy / pattern / path 参照を検証する。 */
function validateStageTimelineReferences(registry: ContentRegistry, errors: CoreError[]): void {
  const enemyIds = new Set(registry.enemies.map((definition) => definition.id));
  const patternsById = new Map(registry.patterns.map((definition) => [definition.id, definition]));
  const pathIds = new Set(registry.paths.map((definition) => definition.id));

  for (const [stageIndex, stage] of registry.stages.entries()) {
    for (const [stepIndex, step] of stage.timeline.entries()) {
      const actionPath = `content.stages[${stageIndex}].timeline[${stepIndex}].action`;
      const enemyContext = {
        schemaPath: `${actionPath}.enemy`, referrerId: stage.id, targetId: step.action.enemy,
      } as const;
      const patternContext = {
        schemaPath: `${actionPath}.pattern`, referrerId: stage.id, targetId: step.action.pattern,
      } as const;
      const pathContext = {
        schemaPath: `${actionPath}.path`, referrerId: stage.id, targetId: step.action.path,
      } as const;
      const enemyReferenceIsValid = validateNamespacedReference(
        "stage.timeline[].action.enemy",
        "enemy",
        step.action.enemy,
        errors,
        enemyContext,
      );
      const patternReferenceIsValid = validateNamespacedReference(
        "stage.timeline[].action.pattern",
        "pattern",
        step.action.pattern,
        errors,
        patternContext,
      );
      const pathReferenceIsValid = validateNamespacedReference(
        "stage.timeline[].action.path",
        "path",
        step.action.path,
        errors,
        pathContext,
      );
      if (enemyReferenceIsValid && !enemyIds.has(step.action.enemy)) {
        errors.push({ code: "enemy.notFound", message: `Enemy not found: ${step.action.enemy}`, ...enemyContext });
      }
      const pattern = patternsById.get(step.action.pattern);
      if (patternReferenceIsValid && !pattern) {
        errors.push({ code: "pattern.notFound", message: `Pattern not found: ${step.action.pattern}`, ...patternContext });
      }
      if (patternReferenceIsValid && pattern?.fireOnSpawn) {
        validateFireOnSpawnPosition(
          "stage.timeline[].action.position + pattern.fireOnSpawn.offset",
          step.action.position,
          pattern.fireOnSpawn,
          errors,
          { schemaPath: `${actionPath}.position`, referrerId: stage.id },
        );
      }
      if (pathReferenceIsValid && !pathIds.has(step.action.path)) {
        errors.push({ code: "path.notFound", message: `Path not found: ${step.action.path}`, ...pathContext });
      }
    }
  }
}

/** timeline spawn 位置と fireOnSpawn offset の合成結果が有限座標になるか検証する。 */
function validateFireOnSpawnPosition(
  path: string,
  position: { x: number; y: number },
  fireOnSpawn: NonNullable<ContentRegistry["patterns"][number]["fireOnSpawn"]>,
  errors: CoreError[],
  context?: Readonly<Pick<CoreError, "schemaPath" | "referrerId">>,
): void {
  const x = position.x + fireOnSpawn.offset.x;
  const y = position.y + fireOnSpawn.offset.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    errors.push({
      code: "definition.invalidConstraint",
      message: `${path} must produce a finite position`,
      ...context,
    });
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

type IndexedObjectArray = Readonly<{
  items: readonly Readonly<{ index: number; record: Record<string, unknown> }>[];
  sourceLength: number;
}>;

/** unknown valueをobject arrayとして検証し、除外した要素があっても元indexを保持する。 */
function validateObjectArray(path: string, value: unknown, errors: CoreError[]): IndexedObjectArray {
  if (!Array.isArray(value)) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be an array`, schemaPath: path });
    return Object.freeze({ items: Object.freeze([]), sourceLength: 0 });
  }

  const items: Array<Readonly<{ index: number; record: Record<string, unknown> }>> = [];
  for (const [index, item] of value.entries()) {
    const record = asRecord(item);
    if (!record) {
      errors.push({
        code: "definition.invalidShape",
        message: `${path} must contain objects`,
        schemaPath: `${path}[${index}]`,
      });
      continue;
    }
    items.push(Object.freeze({ index, record }));
  }
  return Object.freeze({ items: Object.freeze(items), sourceLength: value.length });
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
  context?: Readonly<Pick<CoreError, "schemaPath" | "referrerId" | "targetId">>,
): boolean {
  const prefix = `${namespace}.`;
  const suffix = value.startsWith(prefix) ? value.slice(prefix.length) : "";
  if (value.length > MAX_IDENTIFIER_LENGTH || suffix.length === 0 || !isNamespacedId(value, namespace)) {
    errors.push({
      code: "id.invalidNamespace",
      message: `${path} must reference a ${namespace}.* id: ${value}`,
      schemaPath: context?.schemaPath ?? path,
      ...(context?.referrerId === undefined ? {} : { referrerId: context.referrerId }),
      targetId: context?.targetId ?? value,
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

/** unknown value が有限数であり、絶対値上限内であることを検証する。 */
function validateFiniteNumberWithinAbs(path: string, value: unknown, maxAbs: number, errors: CoreError[]): void {
  validateFiniteNumber(path, value, errors);
  if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) > maxAbs) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be between ${-maxAbs} and ${maxAbs}` });
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

/** unknown value が 1 以上 max 以下の整数であることを検証する。 */
function validatePositiveIntegerAtMost(path: string, value: unknown, max: number, errors: CoreError[]): void {
  validatePositiveInteger(path, value, errors);
  if (typeof value === "number" && Number.isSafeInteger(value) && value > max) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be at most ${max}` });
  }
}

/** unknown value が 0 より大きい有限数であることを検証する。 */
function validatePositiveNumber(path: string, value: unknown, errors: CoreError[]): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be a positive number` });
  }
}

/** unknown value が比較対象の number 以下であることを検証する。 */
function validateNumberAtMost(
  path: string,
  value: unknown,
  maxValue: unknown,
  maxPath: string,
  errors: CoreError[],
): void {
  if (
    typeof value === "number"
    && Number.isFinite(value)
    && typeof maxValue === "number"
    && Number.isFinite(maxValue)
    && value > maxValue
  ) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be less than or equal to ${maxPath}` });
  }
}

/** unknown value を plain object として扱えるか判定する。 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

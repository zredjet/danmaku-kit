import type { CoreError } from "../../result.ts";
import { asRecord } from "../../shared/guards.ts";
import {
  MAX_PLAYER_MOVEMENT_SPEED,
  MAX_PLAYER_SHOT_FIRE_INTERVAL_TICKS,
  MAX_PLAYER_SHOT_LIFETIME_TICKS,
  MAX_PLAYER_SHOT_SPEED_PER_AXIS,
  MAX_SPAWNS_PER_TICK,
  MAX_STAGE_TIMELINE_STEPS,
} from "../runtime-budgets.ts";
import { KNOWN_ENABLED_FEATURES } from "../types.ts";
import type { GameDefinition } from "../types.ts";
import {
  validateAllowedKeys,
  validateAssetKeyArray,
  validateDifficultyArray,
  validateFiniteNumber,
  validateFiniteNumberWithinAbs,
  validateNonEmptyString,
  validateNonNegativeInteger,
  validateNumberAtMost,
  validateObjectArray,
  validatePositiveInteger,
  validatePositiveIntegerAtMost,
  validatePositiveNumber,
} from "./fields.ts";
import { validatePathShape } from "./path-shape.ts";
import { validatePatternShape } from "./pattern-shape.ts";
import { addSchemaContext, validateContentItem } from "./schema-path.ts";

const SUPPORTED_SCHEMA_VERSION = "1";

const KNOWN_FEATURE_SET = new Set<string>(KNOWN_ENABLED_FEATURES);

/**
 * 外部入力を `GameDefinition` として扱える形か検証する。
 *
 * TypeScript の型は JSON/YAML 読み込み後には効かないため、ここで object / array /
 * primitive を明示的に確認する。
 */
export function validateDefinitionShape(definition: unknown, errors: CoreError[]): GameDefinition | null {
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
    () => validatePatternShape(pattern, errors),
  ));
  paths.items.forEach(({ record: path, index }) => validateContentItem(
    `content.paths[${index}]`, "path", path, errors,
    () => validatePathShape(path, errors),
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
    validatePositiveInteger("player.life.initialLives", life.initialLives, errors);
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

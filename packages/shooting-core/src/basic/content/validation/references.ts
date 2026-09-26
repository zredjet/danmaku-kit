import type { CoreError } from "../../result.ts";
import { MAX_IDENTIFIER_LENGTH, isNamespacedId, isSafeAssetKey } from "../identifier.ts";
import type { ContentRegistry } from "../types.ts";

/** namespace prefix と重複 ID を検証する。 */
export function validateUniqueIds(
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
export function validateAssetReferences(registry: ContentRegistry, errors: CoreError[]): void {
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
export function validatePlayerShotReferences(registry: ContentRegistry, errors: CoreError[]): void {
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
export function validatePatternBulletReferences(registry: ContentRegistry, errors: CoreError[]): void {
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
export function validateStageTimelineReferences(registry: ContentRegistry, errors: CoreError[]): void {
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

/** 参照 ID が期待 namespace と安全な形式を満たすか検証する。 */
export function validateNamespacedReference(
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

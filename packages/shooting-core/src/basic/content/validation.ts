import type { CoreError, CoreWarning } from "../result.ts";
import { deepFreezePlainData } from "../shared/immutable.ts";
import {
  validateAssetReferences,
  validateNamespacedReference,
  validatePatternBulletReferences,
  validatePlayerShotReferences,
  validateStageTimelineReferences,
  validateUniqueIds,
} from "./validation/references.ts";
import { validatePatternSemantics } from "./validation/pattern-semantics.ts";
import { validateDefinitionShape } from "./validation/shape.ts";

/**
 * `GameDefinition` 全体の validation pipeline。
 *
 * まず runtime shape を確定し、その後で ID の一意性や参照解決のような semantic
 * validation を行う。shape 不正のまま semantic validation に進むと例外になりやすいため、
 * `validateDefinitionShape()` が失敗した場合はそこで止める。warning は `validateGameDefinitionWithWarnings()` で受け取る。
 */
export function validateGameDefinition(definition: unknown): CoreError[] {
  return [...validateGameDefinitionWithWarnings(definition).errors];
}

/**
 * `validateGameDefinition()` の本体。error がなければ、動作はするが content 制作者へ知らせたい warning（pattern の意味の検証など）も
 * 返す。
 */
export function validateGameDefinitionWithWarnings(
  definition: unknown,
): Readonly<{ errors: readonly CoreError[]; warnings: readonly CoreWarning[] }> {
  const errors: CoreError[] = [];
  const plainDefinition = deepFreezePlainData(definition);
  if (!plainDefinition) {
    return { errors: [{ code: "definition.invalidShape", message: "GameDefinition must be JSON-compatible plain data" }], warnings: [] };
  }
  const validated = validateDefinitionShape(plainDefinition, errors);
  if (!validated) {
    return { errors, warnings: [] };
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
  if (errors.length > 0) {
    return { errors, warnings: [] };
  }
  // pattern の意味の検証は、shape と参照がすべて正しい content の program だけを見る。
  const semantics = validatePatternSemantics(validated.content.patterns);
  return { errors: [...semantics.errors], warnings: semantics.errors.length > 0 ? [] : semantics.warnings };
}

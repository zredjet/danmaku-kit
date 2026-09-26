import type { CoreError } from "../result.ts";
import { deepFreezePlainData } from "../shared/immutable.ts";
import {
  validateAssetReferences,
  validateNamespacedReference,
  validatePatternBulletReferences,
  validatePlayerShotReferences,
  validateStageTimelineReferences,
  validateUniqueIds,
} from "./validation/references.ts";
import { validateDefinitionShape } from "./validation/shape.ts";

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

import type { CoreError, CoreWarning } from "../../result.ts";
import { asRecord } from "../../shared/guards.ts";
import { FEATURE_CONTENT_COLLECTIONS } from "../feature-fields.ts";
import type { EnabledFeature, GameDefinition } from "../types.ts";
import { validateAllowedKeys } from "./fields.ts";

/** `content.features` が object で、既知の feature の collection だけを持つことを検証する。 */
export function validateFeatureContentShape(value: unknown, errors: CoreError[]): void {
  // feature の collection の値は、feature が有効なら module が、有効でなければ使わないので検証しない。
  if (value !== undefined) {
    const features = asRecord(value);
    if (!features) {
      errors.push({ code: "definition.invalidShape", message: "content.features must be an object" });
    } else {
      validateAllowedKeys("content.features", features, Object.keys(FEATURE_CONTENT_COLLECTIONS), errors);
    }
  }
}

/**
 * basic の definition に feature が足す field を gating する。feature が `enabledFeatures` にあれば値の検証を feature の module に任せ、
 * なければ `feature.disabled` にする。
 */
export function validateFeatureFields(
  path: string,
  definition: Record<string, unknown>,
  fields: Readonly<Record<string, EnabledFeature>>,
  listedFeatures: ReadonlySet<unknown>,
  errors: CoreError[],
): void {
  for (const [field, feature] of Object.entries(fields)) {
    if (definition[field] !== undefined && !listedFeatures.has(feature)) {
      errors.push({
        code: "feature.disabled",
        message: `${path}.${field} requires the ${feature} feature in enabledFeatures`,
        schemaPath: `${path}.${field}`,
        targetId: feature,
      });
    }
  }
}

/** 有効でない feature の collection（使わずに読み込むだけの content）を warning にする（design 20）。 */
export function collectDisabledFeatureContent(definition: GameDefinition): CoreWarning[] {
  return Object.entries(FEATURE_CONTENT_COLLECTIONS).flatMap(([collection, feature]) => (
    definition.content.features?.[collection as keyof typeof FEATURE_CONTENT_COLLECTIONS] !== undefined
      && !definition.enabledFeatures.includes(feature)
      ? [{
        code: "feature.disabledContent",
        message: `content.features.${collection} is not used because the ${feature} feature is not in enabledFeatures`,
        schemaPath: `content.features.${collection}`,
      }]
      : []
  ));
}

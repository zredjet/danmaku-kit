/**
 * optional feature の module が content の検証に使う basic の helper（design 20）。
 *
 * feature は basic の `content/validation/` を直接 import せず、この module を通して使う（`tests/module-graph.test.mjs`）。error の
 * message と schema path の規則は basic の content と同じにする。
 */
export {
  validateAllowedKeys,
  validateFiniteNumberWithinAbs,
  validateNonEmptyString,
  validateNonNegativeInteger,
  validateNonNegativeNumberAtMost,
  validateNumberAtMost,
  validateObjectArray,
  validatePositiveInteger,
  validatePositiveIntegerAtMost,
  validatePositiveNumber,
} from "../content/validation/fields.ts";
export { validateContentItem } from "../content/validation/schema-path.ts";
export { validateAssetReference, validateNamespacedReference, validateUniqueIds } from "../content/validation/references.ts";

import type { GameplayActionId } from "@shooting-sample/shooting-core";

/** held 中の方向から tick ごとの `InputFrame.axes` を作る移動方向。 */
export type MoveDirection = "moveLeft" | "moveRight" | "moveUp" | "moveDown";

/** Runtime / UI が消費する action。`InputFrame` と replay には入れない（design 11）。 */
export type UiActionId = "pause" | "confirm" | "toggleDebug";

/** physical key を割り当てられる action。 */
export type KeyBindingAction = MoveDirection | GameplayActionId | UiActionId;

/** 1 action に割り当てる physical key（`KeyboardEvent.code`）の一覧。 */
export type KeyBinding = Readonly<{
  action: KeyBindingAction;
  keys: readonly string[];
}>;

/** Core が canonical order として扱う gameplay action の並び。`InputFrame` の action 配列もこの順に作る。 */
export const GAMEPLAY_ACTIONS = Object.freeze(["shot", "focus"] as const satisfies readonly GameplayActionId[]);

// Core に gameplay action が増えたとき、並びへの追加漏れを型エラーにする。
true satisfies [Exclude<GameplayActionId, (typeof GAMEPLAY_ACTIONS)[number]>] extends [never] ? true : false;

/** UI / lifecycle action の一覧。 */
export const UI_ACTIONS = Object.freeze(["pause", "confirm", "toggleDebug"] as const satisfies readonly UiActionId[]);

// UI action が増えたとき、一覧への追加漏れを型エラーにする。
true satisfies [Exclude<UiActionId, (typeof UI_ACTIONS)[number]>] extends [never] ? true : false;

/** Runtime settings の key config を導入するまで使う既定の割り当て。 */
export const DEFAULT_KEY_BINDINGS: readonly KeyBinding[] = Object.freeze([
  Object.freeze({ action: "moveLeft", keys: Object.freeze(["ArrowLeft"]) }),
  Object.freeze({ action: "moveRight", keys: Object.freeze(["ArrowRight"]) }),
  Object.freeze({ action: "moveUp", keys: Object.freeze(["ArrowUp"]) }),
  Object.freeze({ action: "moveDown", keys: Object.freeze(["ArrowDown"]) }),
  Object.freeze({ action: "shot", keys: Object.freeze(["KeyZ"]) }),
  Object.freeze({ action: "focus", keys: Object.freeze(["ShiftLeft", "ShiftRight"]) }),
  Object.freeze({ action: "pause", keys: Object.freeze(["Escape", "KeyP"]) }),
  Object.freeze({ action: "confirm", keys: Object.freeze(["Enter", "Space"]) }),
  Object.freeze({ action: "toggleDebug", keys: Object.freeze(["Backquote", "F3"]) }),
] satisfies readonly KeyBinding[]);

/**
 * key binding を physical key から action への表にする。
 *
 * 同じ physical key を複数 action に割り当てた binding は throw で拒否する。design 11 は UI modal が開いている間だけ
 * UI action と gameplay action の key 共有を許すが、modal を導入するまでは共有も含めて禁止する。
 */
export function resolveKeyBindings(bindings: readonly KeyBinding[]): ReadonlyMap<string, KeyBindingAction> {
  const actionsByKey = new Map<string, KeyBindingAction>();
  for (const binding of bindings) {
    for (const key of binding.keys) {
      const existing = actionsByKey.get(key);
      if (existing !== undefined) {
        throw new Error(`Key ${key} is bound to both ${existing} and ${binding.action}`);
      }
      actionsByKey.set(key, binding.action);
    }
  }
  return actionsByKey;
}

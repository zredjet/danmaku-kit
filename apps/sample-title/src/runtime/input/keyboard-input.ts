import type { GameplayActionId, InputFrame } from "@shooting-sample/shooting-core";

import {
  DEFAULT_KEY_BINDINGS,
  GAMEPLAY_ACTIONS,
  UI_ACTIONS,
  resolveKeyBindings,
  type KeyBinding,
  type KeyBindingAction,
  type MoveDirection,
  type UiActionId,
} from "./key-bindings.ts";

/** adapter が読む keyboard event の field。DOM の `KeyboardEvent` をそのまま渡せる。 */
export type KeyboardInputEvent = Readonly<{
  /** `keydown` と `keyup` 以外は無視する。 */
  type: string;
  /** physical key を表す `KeyboardEvent.code`。 */
  code: string;
  repeat: boolean;
  /** Meta（macOS の Cmd）が押されているか。macOS は Meta を押している間、他の key の keyup を送らない。 */
  metaKey: boolean;
}>;

/** 1 render frame で Runtime / UI が消費する UI action の押下。`InputFrame` と replay には入れない。 */
export type UiInputFrame = Readonly<{
  pressed: readonly UiActionId[];
}>;

const NO_GAMEPLAY_ACTIONS: readonly GameplayActionId[] = Object.freeze([]);

/**
 * keyboard event を tick ごとの `InputFrame` と render frame ごとの `UiInputFrame` へ変換する adapter（design 11）。
 *
 * keydown / keyup は届いた順に処理し、gameplay action の押下・解放 edge を次に実行する tick までラッチする。render frame 間で
 * 押して離した tap は同じ tick の `pressed` と `released` に入り、`held` には入らない。`reset()` 後は全 key を up として扱い、
 * reset 前から押されている key の auto-repeat は keyup を観測するまで再ラッチしない。repeat でない keydown は新しい押下なので、
 * 離した keyup が focus 外で失われていても受け付ける。
 */
export class KeyboardInputAdapter {
  readonly #actionsByKey: ReadonlyMap<string, KeyBindingAction>;
  readonly #downKeys = new Set<string>();
  readonly #staleKeys = new Set<string>();
  readonly #pressedActions = new Set<GameplayActionId>();
  readonly #releasedActions = new Set<GameplayActionId>();
  readonly #pressedUiActions = new Set<UiActionId>();

  constructor(bindings: readonly KeyBinding[] = DEFAULT_KEY_BINDINGS) {
    this.#actionsByKey = resolveKeyBindings(bindings);
  }

  /**
   * keydown / keyup を届いた順に反映し、割り当てのある key なら true を返す。
   *
   * 割り当てのない key と、keydown / keyup 以外の event type は無視する。呼び出し側は true のとき browser の既定動作
   * （矢印 key の scroll や Cmd+← の履歴移動など）を止める。Meta を押している event は、macOS で keyup が届かず key が
   * 押されたままになるため入力に使わず、押下中の key も `reset()` と同じく keyup まで無視する。
   */
  handleKeyEvent(event: KeyboardInputEvent): boolean {
    const action = this.#actionsByKey.get(event.code);
    if (event.metaKey) {
      this.#ignoreDownKeysUntilKeyUp();
      return action !== undefined;
    }
    if (action === undefined) {
      return false;
    }
    if (event.type === "keydown") {
      this.#handleKeyDown(event.code, event.repeat, action);
    } else if (event.type === "keyup") {
      this.#handleKeyUp(event.code, action);
    }
    return true;
  }

  /**
   * render frame で実行する `count` 個の tick の `InputFrame` を、`firstTick` から連番で作る。
   *
   * ラッチした edge は最初の tick だけに入れて消費し、`held` と `axes` は全 tick に同じ値を入れる。`count` が 0 なら edge は
   * 次に tick を実行する frame まで残す。同じ tick の間に離して押し直した action は held のままなので、Core の
   * `held` / `released` 排他に合わせて `released` から外す。
   */
  sampleTicks(firstTick: number, count: number): readonly InputFrame[] {
    if (!Number.isSafeInteger(firstTick) || firstTick < 0) {
      throw new RangeError("firstTick must be a non-negative safe integer");
    }
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError("count must be a non-negative safe integer");
    }
    if (count === 0) {
      return Object.freeze([]);
    }

    const held = Object.freeze(GAMEPLAY_ACTIONS.filter((action) => this.#isActionDown(action)));
    const pressed = Object.freeze(GAMEPLAY_ACTIONS.filter((action) => this.#pressedActions.has(action)));
    const released = Object.freeze(
      GAMEPLAY_ACTIONS.filter((action) => this.#releasedActions.has(action) && !held.includes(action)),
    );
    const axes = Object.freeze({
      moveX: this.#axis("moveLeft", "moveRight"),
      moveY: this.#axis("moveUp", "moveDown"),
    });
    this.#pressedActions.clear();
    this.#releasedActions.clear();

    return Object.freeze(Array.from({ length: count }, (_, index): InputFrame => Object.freeze({
      tick: firstTick + index,
      axes,
      held,
      pressed: index === 0 ? pressed : NO_GAMEPLAY_ACTIONS,
      released: index === 0 ? released : NO_GAMEPLAY_ACTIONS,
    })));
  }

  /** まだ tick や render frame に渡していない、ラッチ済みの押下・解放 edge の数（gameplay と UI の合計）。 */
  get latchedEdgeCount(): number {
    return this.#pressedActions.size + this.#releasedActions.size + this.#pressedUiActions.size;
  }

  /** 前回の呼び出し以降に押された UI action を押した順に返し、消費する。 */
  takeUiInput(): UiInputFrame {
    const pressed = Object.freeze([...this.#pressedUiActions]);
    this.#pressedUiActions.clear();
    return Object.freeze({ pressed });
  }

  /**
   * pause、focus lost、visibility change で、未消費のラッチ、held、axes、physical key state をすべて捨てる。
   *
   * 押されたままの key は keyup を観測するまで無視し、復帰直後に押しっぱなしの key が新しい押下として扱われないようにする。
   */
  reset(): void {
    this.#ignoreDownKeysUntilKeyUp();
    this.#pressedActions.clear();
    this.#releasedActions.clear();
    this.#pressedUiActions.clear();
  }

  /** 押下中の key を up として扱い、その key の auto-repeat を keyup まで無視する。ラッチ済みの edge は残す。 */
  #ignoreDownKeysUntilKeyUp(): void {
    for (const code of this.#downKeys) {
      this.#staleKeys.add(code);
    }
    this.#downKeys.clear();
  }

  #handleKeyDown(code: string, repeat: boolean, action: KeyBindingAction): void {
    if (this.#downKeys.has(code)) {
      return;
    }
    // reset 前から押されていた key と、adapter が押下を観測していない key の auto-repeat は keyup まで無視する。
    if (repeat) {
      this.#staleKeys.add(code);
      return;
    }
    // repeat でない keydown は新しい押下なので、focus 外で keyup が失われた stale key でも押下として受け付ける。
    this.#staleKeys.delete(code);
    const wasDown = this.#isActionDown(action);
    this.#downKeys.add(code);
    if (wasDown) {
      return;
    }
    if (isGameplayAction(action)) {
      this.#pressedActions.add(action);
    } else if (isUiAction(action)) {
      this.#pressedUiActions.add(action);
    }
  }

  #handleKeyUp(code: string, action: KeyBindingAction): void {
    if (this.#staleKeys.delete(code) || !this.#downKeys.delete(code)) {
      return;
    }
    if (isGameplayAction(action) && !this.#isActionDown(action)) {
      this.#releasedActions.add(action);
    }
  }

  /** action に割り当てた key のどれかが押されているかを返す。 */
  #isActionDown(action: KeyBindingAction): boolean {
    for (const code of this.#downKeys) {
      if (this.#actionsByKey.get(code) === action) {
        return true;
      }
    }
    return false;
  }

  /** 逆向きの 2 方向の held から axis 値を作る。両方押されているときは 0 にする。 */
  #axis(negative: MoveDirection, positive: MoveDirection): -1 | 0 | 1 {
    const negativeDown = this.#isActionDown(negative);
    const positiveDown = this.#isActionDown(positive);
    if (negativeDown === positiveDown) {
      return 0;
    }
    return positiveDown ? 1 : -1;
  }
}

function isGameplayAction(action: KeyBindingAction): action is GameplayActionId {
  return (GAMEPLAY_ACTIONS as readonly KeyBindingAction[]).includes(action);
}

function isUiAction(action: KeyBindingAction): action is UiActionId {
  return (UI_ACTIONS as readonly KeyBindingAction[]).includes(action);
}

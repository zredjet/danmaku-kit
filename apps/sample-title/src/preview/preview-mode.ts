import type { GameDefinition, GameFrame, ShootingCore, StageDefinition } from "@shooting-sample/shooting-core";

import type { GameShell } from "../runtime/lifecycle/game-shell.ts";
import { formatPreviewTarget, listPreviewChoices, type PreviewTarget } from "../runtime/preview/preview-definition.ts";
import { firstPreviewTarget, type PreviewComposition, type PreviewSelection } from "../runtime/preview/preview-selection.ts";
import {
  describePreviewState,
  labeledEntities,
  previewInfoKey,
  upcomingSpawns,
  type UpcomingSpawn,
} from "../runtime/preview/preview-state.ts";
import { PLAYFIELD_HEIGHT, PLAYFIELD_WIDTH } from "../runtime/view/playfield.ts";

/** overlay に spawn 位置の印を出す、これから出る spawn の範囲（tick）。 */
const UPCOMING_SPAWN_WINDOW_TICKS = 120;
/** playing 中に panel の文字（`serialize()` を読む）を描き直す間隔（tick）。pause 中と 1 tick 送りでは毎回描き直す。 */
const INFO_INTERVAL_TICKS = 6;
/** playfield の端に寄せた spawn の印を、右端と下端で見切れない程度に内側へ置く幅（px）。上端は HUD の score の行の下に置く。 */
const SPAWN_MARKER_EDGE = 12;
const SPAWN_MARKER_TOP = 24;
/** 近い位置の spawn の印を 1 つにまとめる格子の大きさ（px）。印の文字が重ならない程度にする。 */
const SPAWN_MARKER_CELL = Object.freeze({ width: 96, height: 16 });
const PREVIEW_KINDS: readonly PreviewTarget["kind"][] = Object.freeze(["stage", "enemy", "pattern", "path"]);

type PreviewShell = Pick<GameShell, "lifecycle" | "latestFrame" | "startOrRestart" | "togglePause" | "stepPausedTick" | "serializeStage">;

export type PreviewModeOptions = Readonly<{
  /** panel を置く要素（transform root の外）。 */
  panelParent: HTMLElement;
  /** overlay を置く、canvas と同じ transform root（`.stage-root`）。 */
  stageRoot: HTMLElement;
  shell: PreviewShell;
  core: Pick<ShootingCore, "load">;
  selection: PreviewSelection;
}>;

/**
 * Preview（design 19、Phase 2B-9）の panel と overlay。dev server と test build で `?preview` を付けたときだけ `src/main.ts` が作る。
 *
 * panel は対象（stage、enemy と path と pattern、pattern、path）、seed、difficulty、dev-only の cheat（invincible と stage の jump、
 * Phase 2B-10）の選択と、restart（R）、pause（P）、pause 中の 1 tick 送り（N）を持ち、選択を変えると `PreviewSelection` の合成した
 * content で stage を始め直し、選択を URL（`?preview=`、`seed`、`difficulty`、`invincible`、`jump`）に書いて、page を読み込み直しても
 * 同じ選択で開く。playfield の overlay は player、enemy、pickup の entity id と、これから
 * 出る spawn の位置を出し、panel は tick、PRNG state、pattern runner の cursor を出す（公開の `serialize()` から読む）。Preview の操作は
 * Runtime の操作で、Core へ渡す入力には混ぜない。
 */
export class PreviewMode {
  readonly #options: PreviewModeOptions;
  readonly #panel = element("div", "preview-panel");
  readonly #overlay = element("div", "preview-overlay");
  readonly #info = element("pre", "preview-info");
  #seedInput: HTMLInputElement | null = null;
  #stage: StageDefinition | null = null;
  #error: string | null = null;
  /** overlay を描いた frame（undefined は始め直した後でまだ描いていない）。 */
  #renderedFrame: GameFrame | null | undefined = undefined;
  #infoKey: string | null = null;
  #started = false;

  constructor(options: PreviewModeOptions) {
    this.#options = options;
    document.head.append(previewStyle());
    options.panelParent.append(this.#panel);
    options.stageRoot.append(this.#overlay);
    this.#renderPanel();
    window.addEventListener("keydown", (event) => this.#onKeyDown(event));
    const render = () => {
      this.#renderFrame();
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  /** 今の選択で stage を始め直す（title なら始める）。合成した content を load できなければ始め直さずに error を出す。 */
  restart(): void {
    const { selection } = this.#options;
    // 入力中の seed は、Enter を押したり focus を外したりする前に Restart を押しても使う。
    const seed = this.#seedInput;
    if (seed && seed.value !== selection.seed && !selection.setSeed(seed.value)) {
      seed.value = selection.seed;
    }
    this.#start(selection.compose(this.#options.core));
  }

  /**
   * content の hot reload。新しい content で今の対象を合成して始め直す。合成した content を load できなければ、前の content のまま動かし
   * 続けて error の文字を返す。
   */
  applyDefinition(definition: GameDefinition): string | null {
    const composed = this.#options.selection.replaceDefinition(definition, this.#options.core);
    const error = this.#start(composed);
    this.#renderPanel();
    return error;
  }

  #start(composed: PreviewComposition): string | null {
    this.#renderedFrame = undefined;
    this.#infoKey = null;
    if (!composed.ok) {
      this.#error = ["Preview could not load the composed content", ...composed.errors].join("\n");
      return this.#error;
    }
    this.#error = null;
    this.#stage = composed.stage;
    this.#options.shell.startOrRestart(composed.content);
    this.#writeUrl();
    return null;
  }

  /** 選択を URL に書く（history は増やさない）。`src/main.ts` が page の読み込みで同じ parameter を読む。 */
  #writeUrl(): void {
    const { selection } = this.#options;
    const { cheats } = selection;
    const url = new URL(window.location.href);
    url.searchParams.set("preview", formatPreviewTarget(selection.target));
    url.searchParams.set("seed", selection.seed);
    url.searchParams.set("difficulty", selection.difficulty ?? "");
    setOrDelete(url.searchParams, "invincible", cheats.invincible ? "1" : null);
    setOrDelete(url.searchParams, "jump", cheats.jumpTick > 0 ? String(cheats.jumpTick) : null);
    window.history.replaceState(window.history.state, "", url);
  }

  #onKeyDown(event: KeyboardEvent): void {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || isFormField(event.target)) {
      return;
    }
    if (event.code === "KeyR") {
      this.restart();
    } else if (event.code === "KeyN") {
      this.#options.shell.stepPausedTick();
    }
  }

  #renderPanel(): void {
    const { selection } = this.#options;
    const choices = listPreviewChoices(selection.definition);
    const target = selection.target;
    const kind = select(PREVIEW_KINDS, target.kind, "preview-kind");
    const id = select(
      { stage: choices.stages, enemy: choices.enemies, pattern: choices.patterns, path: choices.paths }[target.kind],
      targetId(target),
      "preview-id",
    );
    const path = select(choices.paths, target.kind === "enemy" ? target.pathId : "", "preview-path");
    const pattern = select(choices.patterns, target.kind === "enemy" ? target.patternId : "", "preview-pattern");
    const seed = element("input", "preview-seed") as HTMLInputElement;
    seed.value = selection.seed;
    seed.spellcheck = false;
    this.#seedInput = seed;
    const difficulty = select(selection.difficulties(), selection.difficulty ?? "", "preview-difficulty");
    const invincible = element("input", "preview-invincible") as HTMLInputElement;
    invincible.type = "checkbox";
    invincible.checked = selection.cheats.invincible;
    const jumpTicks = selection.jumpTicks();
    const jump = select(jumpTicks.map(String), String(selection.cheats.jumpTick), "preview-jump");
    this.#panel.replaceChildren(
      field("target", kind),
      field("id", id),
      ...(target.kind === "enemy" ? [field("path", path), field("pattern", pattern)] : []),
      field("seed", seed),
      field("difficulty", difficulty),
      field("invincible", invincible),
      // stage jump は stage の対象だけが持つ（timeline の spawn の tick から選ぶ）。
      ...(jumpTicks.length > 0 ? [field("jump", jump)] : []),
      buttons([
        button("Restart (R)", "preview-restart", () => this.restart()),
        button("Pause (P)", "preview-pause", () => this.#options.shell.togglePause()),
        button("Step (N)", "preview-step", () => this.#options.shell.stepPausedTick()),
      ]),
      this.#info,
    );

    // 対象を変えたら、選べる difficulty が変わるので始め直した後に panel を作り直す。
    onChange(kind, () => {
      const next = firstPreviewTarget(kind.value as PreviewTarget["kind"], selection.definition);
      if (next) {
        selection.selectTarget(formatPreviewTarget(next));
      }
      this.restart();
      this.#renderPanel();
    });
    for (const control of [id, path, pattern]) {
      onChange(control, () => {
        selection.selectTarget(target.kind === "enemy"
          ? `enemy:${id.value},${path.value},${pattern.value}`
          : `${target.kind}:${id.value}`);
        this.restart();
        this.#renderPanel();
      });
    }
    // Restart で確定済みの seed なら、後から focus を外したときの change では始め直さない。
    onChange(seed, () => {
      if (seed.value !== selection.seed) {
        this.restart();
      }
    });
    onChange(difficulty, () => {
      selection.setDifficulty(difficulty.value);
      this.restart();
    });
    onChange(invincible, () => {
      selection.setInvincible(invincible.checked);
      this.restart();
    });
    onChange(jump, () => {
      selection.setJumpTick(Number(jump.value));
      this.restart();
    });
  }

  #renderFrame(): void {
    const { shell } = this.#options;
    if (!this.#started && shell.lifecycle.state === "title") {
      // Preview は title で止めずに、選んだ対象をすぐ始める。
      this.#started = true;
      this.restart();
    }
    const frame = shell.latestFrame;
    if (frame !== this.#renderedFrame) {
      this.#renderedFrame = frame;
      const nextTick = frame === null ? 0 : frame.tick + 1;
      this.#overlay.replaceChildren(
        ...labeledEntities(frame).map((label) => positioned("preview-entity-id", `#${label.id}`, label.position)),
        ...spawnMarkers(this.#stage ? upcomingSpawns(this.#stage, nextTick, UPCOMING_SPAWN_WINDOW_TICKS) : []),
      );
    }
    const infoKey = previewInfoKey(shell.lifecycle.state, frame?.tick ?? null, INFO_INTERVAL_TICKS);
    if (infoKey !== this.#infoKey) {
      this.#infoKey = infoKey;
      const { selection } = this.#options;
      const { cheats } = selection;
      this.#info.textContent = [
        [
          `seed ${selection.seed}  ${selection.difficulty ?? "-"}`,
          ...(cheats.invincible ? ["invincible"] : []),
          ...(cheats.jumpTick > 0 ? [`jump ${cheats.jumpTick}`] : []),
        ].join("  "),
        ...describePreviewState(shell.serializeStage()),
        ...(this.#error ? [this.#error] : []),
      ].join("\n");
    }
  }
}

function targetId(target: PreviewTarget): string {
  switch (target.kind) {
    case "stage":
      return target.stageId;
    case "enemy":
      return target.enemyId;
    case "pattern":
      return target.patternId;
    case "path":
      return target.pathId;
  }
}

function isFormField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const created = document.createElement(tag);
  created.className = className;
  if (text !== undefined) {
    created.textContent = text;
  }
  return created;
}

function select(values: readonly string[], selected: string, className: string): HTMLSelectElement {
  const created = element("select", className) as HTMLSelectElement;
  created.append(...values.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === selected;
    return option;
  }));
  return created;
}

/** 選び終えたら focus を外し、矢印 key や Space が select や input ではなく game に届くようにする。 */
function onChange(control: HTMLInputElement | HTMLSelectElement, handle: () => void): void {
  control.addEventListener("change", () => {
    control.blur();
    handle();
  });
}

function setOrDelete(parameters: URLSearchParams, name: string, value: string | null): void {
  if (value === null) {
    parameters.delete(name);
  } else {
    parameters.set(name, value);
  }
}

function field(text: string, control: HTMLElement): HTMLElement {
  const label = element("label", "preview-field", text);
  label.append(control);
  return label;
}

function buttons(children: readonly HTMLElement[]): HTMLElement {
  const row = element("div", "preview-buttons");
  row.append(...children);
  return row;
}

/** button は click で focus を取らず、Space や Enter が button を押し直さずに game の confirm に届くようにする。 */
function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const created = element("button", className, text) as HTMLButtonElement;
  created.type = "button";
  created.addEventListener("mousedown", (event) => event.preventDefault());
  created.addEventListener("click", onClick);
  return created;
}

/** playfield の座標に置く印。transform root の中なので、表示の倍率と letterbox は root の transform が当てる。 */
function positioned(className: string, text: string, position: Readonly<{ x: number; y: number }>): HTMLElement {
  const created = element("span", className, text);
  created.style.transform = `translate(${position.x}px, ${position.y}px)`;
  return created;
}

/**
 * これから出る spawn の印。spawn の位置は playfield の外（上の境界の外など）にあることが多いので、印は playfield の端に寄せ、近い位置に
 * 寄った spawn は最初の 1 つと残りの数にまとめる。
 */
function spawnMarkers(spawns: readonly UpcomingSpawn[]): HTMLElement[] {
  const byPosition = Map.groupBy(spawns, (spawn) => {
    const position = insidePlayfield(spawn.position);
    return `${Math.floor(position.x / SPAWN_MARKER_CELL.width)},${Math.floor(position.y / SPAWN_MARKER_CELL.height)}`;
  });
  return [...byPosition.values()].map(([first, ...rest]) => positioned(
    "preview-spawn",
    `${first!.enemy} @${first!.tick}${rest.length > 0 ? ` +${rest.length}` : ""}`,
    insidePlayfield(first!.position),
  ));
}

function insidePlayfield(position: Readonly<{ x: number; y: number }>): Readonly<{ x: number; y: number }> {
  return {
    x: Math.min(Math.max(position.x, 0), PLAYFIELD_WIDTH - SPAWN_MARKER_EDGE),
    y: Math.min(Math.max(position.y, SPAWN_MARKER_TOP), PLAYFIELD_HEIGHT - SPAWN_MARKER_EDGE),
  };
}

/** Preview の style。production build に入らないよう、index.html ではなくこの module が足す。 */
function previewStyle(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    .preview-panel {
      position: fixed; top: 8px; right: 8px; z-index: 3; display: grid; gap: 4px; width: 300px; padding: 8px;
      font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #e2e8f0; background: rgb(15 23 42 / 88%);
    }
    .preview-field { display: grid; grid-template-columns: 64px 1fr; align-items: center; gap: 4px; }
    .preview-field > select, .preview-field > input { min-width: 0; font: inherit; }
    .preview-field > input[type="checkbox"] { justify-self: start; margin: 0; }
    .preview-field:has(> input[type="checkbox"]) { justify-self: start; }
    .preview-buttons { display: flex; gap: 4px; }
    .preview-buttons > button { flex: 1; font: inherit; }
    .preview-overlay { position: absolute; inset: 0; z-index: 1; overflow: hidden; pointer-events: none; }
    .preview-entity-id, .preview-spawn {
      position: absolute; top: 0; left: 0; margin: 6px 0 0 6px; white-space: nowrap;
      font: 8px ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .preview-entity-id { color: #fde68a; }
    .preview-spawn { color: #c4b5fd; }
    .preview-info { margin: 0; font: 10px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; color: #cbd5e1; white-space: pre-wrap; }
  `;
  return style;
}

import type { HudPort, HudView } from "../runtime/hud/hud-view.ts";

/**
 * canvas の上に重ねる DOM overlay の HUD（design 5.5）。score、lives、状態の見出し、debug HUD、error を出す。
 *
 * Phaser の scene からは `HudPort` として呼ばれ、同じ内容の再描画では DOM を触らない。pointer event は canvas へ通す。
 */
export class HudOverlay implements HudPort {
  /** overlay の root。canvas と同じ transform root に置く。 */
  readonly element: HTMLElement;
  readonly #score: HTMLElement;
  readonly #lives: HTMLElement;
  readonly #banner: HTMLElement;
  readonly #bannerTitle: HTMLElement;
  readonly #bannerDetail: HTMLElement;
  readonly #debug: HTMLElement;
  readonly #error: HTMLElement;
  readonly #contentError: HTMLElement;
  #lastView = "";
  #lastDebug = "";

  constructor(container: HTMLElement) {
    const root = element("div", "hud");
    const top = element("div", "hud-top");
    this.#score = element("span", "hud-score");
    this.#lives = element("span", "hud-lives");
    top.append(this.#score, this.#lives);
    this.#banner = element("div", "hud-banner");
    this.#bannerTitle = element("div", "hud-banner-title");
    this.#bannerDetail = element("div", "hud-banner-detail");
    this.#banner.append(this.#bannerTitle, this.#bannerDetail);
    this.#debug = element("pre", "hud-debug");
    this.#error = element("div", "hud-error");
    this.#error.hidden = true;
    this.#contentError = element("pre", "hud-content-error");
    this.#contentError.hidden = true;
    root.append(top, this.#banner, this.#debug, this.#error, this.#contentError);
    container.append(root);
    this.element = root;
    this.render({ score: null, lives: null, banner: null });
  }

  render(view: HudView): void {
    const key = JSON.stringify(view);
    if (key === this.#lastView) {
      return;
    }
    this.#lastView = key;
    this.#score.textContent = view.score === null ? "" : `SCORE ${String(view.score).padStart(7, "0")}`;
    this.#lives.textContent = view.lives === null ? "" : `LIVES ${"▲".repeat(view.lives)}`;
    this.#banner.hidden = view.banner === null;
    this.#banner.dataset.tone = view.banner?.tone ?? "";
    this.#bannerTitle.textContent = view.banner?.title ?? "";
    this.#bannerDetail.textContent = view.banner?.detail ?? "";
  }

  setDebugLines(lines: readonly string[]): void {
    const text = lines.join("\n");
    if (text !== this.#lastDebug) {
      this.#lastDebug = text;
      this.#debug.textContent = text;
    }
  }

  /**
   * dev server の content の検証 error（hot reload）を出す。stage は古い content のまま動かし続けるので、見出しや error と重ならない
   * 下端に出す。null で消す。
   */
  showContentError(message: string | null): void {
    this.#contentError.textContent = message === null ? "" : `Content error (still running the previous content)\n${message}`;
    this.#contentError.hidden = message === null;
  }

  showError(title: string, lines: readonly string[]): void {
    this.#error.textContent = [title, ...lines].join("\n");
    this.#error.hidden = false;
    this.#banner.hidden = true;
  }
}

function element(tag: "div" | "span" | "pre", className: string): HTMLElement {
  const created = document.createElement(tag);
  created.className = className;
  return created;
}

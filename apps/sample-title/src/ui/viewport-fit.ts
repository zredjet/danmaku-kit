import { computeViewportLayout, type ViewportLayout } from "../runtime/view/viewport-layout.ts";

export type ViewportFitOptions = Readonly<{
  /** 表示先の要素。この要素の大きさに playfield を収める。 */
  container: HTMLElement;
  /** canvas と DOM overlay を入れる transform root。 */
  stageRoot: HTMLElement;
}>;

export type ViewportFit = Readonly<{
  /** 最後に当てた配置。 */
  layout: () => ViewportLayout;
  /** 配置が変わるたびに呼ぶ listener を足す。Phaser の canvas を描く解像度の更新に使う。 */
  onLayoutChange: (listener: (layout: ViewportLayout) => void) => void;
}>;

/**
 * container の大きさと devicePixelRatio から配置を求め、transform root を動かして拡大・縮小する（design 12）。
 *
 * container の大きさの変化は ResizeObserver で、devicePixelRatio の変化（browser zoom や別の display への移動）は `resolution` の
 * media query で受け取り、配置が変わったときだけ当て直す。
 */
export function fitStageToViewport(options: ViewportFitOptions): ViewportFit {
  const { container, stageRoot } = options;
  const listeners: ((layout: ViewportLayout) => void)[] = [];
  let current = measure(container);
  apply(stageRoot, current);

  const update = (): void => {
    const next = measure(container);
    if (sameLayout(current, next)) {
      return;
    }
    current = next;
    apply(stageRoot, current);
    for (const listener of listeners) {
      listener(current);
    }
  };
  new ResizeObserver(update).observe(container);
  const watchDevicePixelRatio = (): void => {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener("change", () => {
      update();
      watchDevicePixelRatio();
    }, { once: true });
  };
  watchDevicePixelRatio();

  return Object.freeze({
    layout: () => current,
    onLayoutChange: (listener: (layout: ViewportLayout) => void) => {
      listeners.push(listener);
    },
  });
}

function measure(container: HTMLElement): ViewportLayout {
  return computeViewportLayout({
    width: container.clientWidth,
    height: container.clientHeight,
    devicePixelRatio: window.devicePixelRatio,
  });
}

function apply(stageRoot: HTMLElement, layout: ViewportLayout): void {
  stageRoot.style.transform = `translate(${layout.letterboxX}px, ${layout.letterboxY}px) scale(${layout.scale})`;
}

function sameLayout(a: ViewportLayout, b: ViewportLayout): boolean {
  return a.scale === b.scale
    && a.letterboxX === b.letterboxX
    && a.letterboxY === b.letterboxY
    && a.devicePixelRatio === b.devicePixelRatio
    && a.renderScale === b.renderScale;
}

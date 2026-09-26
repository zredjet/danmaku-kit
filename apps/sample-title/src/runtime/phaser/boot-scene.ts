import { Loader, Scene } from "phaser";

import { planAssetLoads, resolveAssetLoadResults } from "../assets/asset-loading.ts";
import type { AssetLoadRequest } from "../assets/asset-loading.ts";
import type { AssetManifest } from "../assets/asset-manifest.ts";
import { buildLoadingHudView, type HudPort } from "../hud/hud-view.ts";
import type { GameShell } from "../lifecycle/game-shell.ts";
import { describeRuntimeEvent } from "../runtime-event.ts";
import type { RuntimeEvent } from "../runtime-event.ts";
import { resolveDefinitionTextures } from "../view/definition-assets.ts";
import type { ViewPoolPlan } from "../view/view-pool-plan.ts";

export type BootSceneOptions = Readonly<{
  assetManifest: AssetManifest;
  /** manifest の相対 path と合成する base URL（Vite の `import.meta.env.BASE_URL`）。 */
  baseUrl: string;
  /** definition id から content の asset key を引く表。 */
  definitionAssets: ReadonlyMap<string, string>;
  viewPoolPlan: ViewPoolPlan;
  shell: Pick<GameShell, "beginLoading">;
  hud: HudPort;
}>;

/** loading が済んだ stage scene へ渡す、texture と view pool の見積もり。 */
export type StageSceneData = Readonly<{
  /** definition id から、読み込み済みの texture の key を引く表。fallback を使った asset は fallback の key になる。 */
  textures: ReadonlyMap<string, string>;
  viewPoolCapacities: Extract<ViewPoolPlan, { ok: true }>["capacities"];
  /** fallback や省略のように、stage は始められるが debug HUD に出す asset の出来事。 */
  assetEvents: readonly RuntimeEvent[];
}>;

/**
 * lifecycle の loading の前半にあたる scene（design 6、17）。
 *
 * lifecycle を loading へ進め、manifest の sprite を base URL と合成して preload する。読み込めなかった asset に design 17 の規則
 * （required は開始を止め、fallback があれば使い、省略できるものは省略する）を当てる。asset の出来事は log に出し、stage を始められる
 * ときは texture と view pool の見積もりを stage scene へ渡す（view pool の準備までが loading）。始められないときは理由を HUD に
 * 出して止まる。
 */
export class BootScene extends Scene {
  readonly #options: BootSceneOptions;
  readonly #failures = new Map<string, string>();
  #requests: readonly AssetLoadRequest[] = [];

  constructor(options: BootSceneOptions) {
    super("boot");
    this.#options = options;
  }

  preload(): void {
    const plan = planAssetLoads(this.#options.assetManifest, this.#options.baseUrl);
    this.#requests = plan.requests;
    for (const [key, reason] of plan.notLoaded) {
      this.#failures.set(key, reason);
    }
    this.load.on(Loader.Events.FILE_LOAD_ERROR, (file: Loader.File) => {
      this.#failures.set(file.key, `could not load ${String(file.url)}`);
    });
    this.#options.shell.beginLoading();
    const { hud } = this.#options;
    hud.render(buildLoadingHudView("assets 0%"));
    this.load.on(Loader.Events.PROGRESS, (value: number) => {
      hud.render(buildLoadingHudView(`assets ${Math.round(value * 100)}%`));
    });
    for (const request of plan.requests) {
      if (request.format === "svg") {
        this.load.svg(request.key, request.url);
      } else {
        this.load.image(request.key, request.url);
      }
    }
  }

  create(): void {
    // Phaser は取得の失敗だけを FILE_LOAD_ERROR で知らせ、画像として decode できなかった file は texture に加えずに黙って捨てる
    // （dev server が存在しない path に index.html を返す場合もこちらになる）。texture ができなかった asset も失敗として数える。
    for (const request of this.#requests) {
      if (!this.#failures.has(request.key) && !this.textures.exists(request.key)) {
        this.#failures.set(request.key, `could not decode ${request.url}`);
      }
    }
    const outcome = resolveAssetLoadResults(this.#options.assetManifest, this.#failures);
    for (const event of outcome.events) {
      console.warn(`[sample-title] ${describeRuntimeEvent(event)}`);
    }
    if (!outcome.ok) {
      this.#options.hud.showError("Asset load failed", outcome.events.map(describeRuntimeEvent));
      return;
    }
    const textures = resolveDefinitionTextures(this.#options.definitionAssets, outcome.loadedKeys);
    if (!textures.ok) {
      this.#options.hud.showError("Entity sprites are missing", textures.missingAssets);
      return;
    }
    const plan = this.#options.viewPoolPlan;
    if (!plan.ok) {
      this.#options.hud.showError("View pool budget exceeded", [plan.error]);
      return;
    }
    const data: StageSceneData = {
      textures: textures.textures,
      viewPoolCapacities: plan.capacities,
      assetEvents: outcome.events,
    };
    this.scene.start("stage", data);
  }
}

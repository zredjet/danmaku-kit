import { Loader, Scene, type Types } from "phaser";

import { planAssetLoads, resolveAssetLoadResults } from "../assets/asset-loading.ts";
import type { AssetLoadRequest } from "../assets/asset-loading.ts";
import type { AssetManifest } from "../assets/asset-manifest.ts";
import { describeRuntimeEvent } from "../runtime-event.ts";
import type { RuntimeEvent } from "../runtime-event.ts";
import { resolveDefinitionTextures } from "../view/definition-assets.ts";
import { PLAYFIELD_HEIGHT, PLAYFIELD_WIDTH } from "../view/playfield.ts";
import type { ViewPoolPlan } from "../view/view-pool-plan.ts";

export type BootSceneOptions = Readonly<{
  assetManifest: AssetManifest;
  /** manifest の相対 path と合成する base URL（Vite の `import.meta.env.BASE_URL`）。 */
  baseUrl: string;
  /** definition id から content の asset key を引く表。 */
  definitionAssets: ReadonlyMap<string, string>;
  viewPoolPlan: ViewPoolPlan;
}>;

/** loading が済んだ stage scene へ渡す、texture と view pool の見積もり。 */
export type StageSceneData = Readonly<{
  /** definition id から、読み込み済みの texture の key を引く表。fallback を使った asset は fallback の key になる。 */
  textures: ReadonlyMap<string, string>;
  viewPoolCapacities: Extract<ViewPoolPlan, { ok: true }>["capacities"];
  /** fallback や省略のように、stage は始められるが debug HUD に出す asset の出来事。 */
  assetEvents: readonly RuntimeEvent[];
}>;

const TEXT_STYLE: Types.GameObjects.Text.TextStyle = {
  color: "#9aa4c7",
  fontFamily: "monospace",
  fontSize: "12px",
  align: "center",
  wordWrap: { width: PLAYFIELD_WIDTH - 32 },
};

/**
 * lifecycle の loading にあたる scene（design 17）。
 *
 * manifest の sprite を base URL と合成して preload し、読み込めなかった asset に design 17 の規則（required は開始を止め、fallback が
 * あれば使い、省略できるものは省略する）を当てる。asset の出来事は log に出し、stage を始められるときは texture と view pool の見積もりを
 * stage scene へ渡す。始められないときは理由を表示して止まる。
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
    const progress = this.add.text(PLAYFIELD_WIDTH / 2, PLAYFIELD_HEIGHT / 2, "loading assets", TEXT_STYLE).setOrigin(0.5);
    this.load.on(Loader.Events.PROGRESS, (value: number) => {
      progress.setText(`loading assets ${Math.round(value * 100)}%`);
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
      this.#showLoadError(["Asset load failed", ...outcome.events.map(describeRuntimeEvent)]);
      return;
    }
    const textures = resolveDefinitionTextures(this.#options.definitionAssets, outcome.loadedKeys);
    if (!textures.ok) {
      this.#showLoadError(["Entity sprites are missing", ...textures.missingAssets]);
      return;
    }
    const plan = this.#options.viewPoolPlan;
    if (!plan.ok) {
      this.#showLoadError(["View pool budget exceeded", plan.error]);
      return;
    }
    const data: StageSceneData = {
      textures: textures.textures,
      viewPoolCapacities: plan.capacities,
      assetEvents: outcome.events,
    };
    this.scene.start("stage", data);
  }

  #showLoadError(lines: readonly string[]): void {
    this.children.removeAll(true);
    this.add
      .text(PLAYFIELD_WIDTH / 2, PLAYFIELD_HEIGHT / 2, [...lines], { ...TEXT_STYLE, color: "#fca5a5" })
      .setOrigin(0.5);
  }
}

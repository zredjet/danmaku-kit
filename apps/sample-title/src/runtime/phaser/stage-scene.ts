import { Scene, Scenes } from "phaser";

import type { AudioStatus } from "../audio/audio-status.ts";
import { buildDebugHudLines } from "../hud/debug-lines.ts";
import { buildHudView, buildLoadingHudView, type HudPort } from "../hud/hud-view.ts";
import type { GameLifecycleState } from "../lifecycle/game-lifecycle.ts";
import type { GameShell, GameShellStep } from "../lifecycle/game-shell.ts";
import { describeRuntimeEvent } from "../runtime-event.ts";
import { HIT_SPARK_BUDGET, HitSparks } from "../view/hit-sparks.ts";
import { isPlayerVisible } from "../view/invincibility-blink.ts";
import type { StageSceneData } from "./boot-scene.ts";
import { ColliderOverlay } from "./collider-overlay.ts";
import { EntityViews } from "./entity-views.ts";
import { HitSparkViews } from "./hit-spark-views.ts";
import { fitCameraToPlayfield } from "./render-scale.ts";

export type StageSceneOptions = Readonly<{
  shell: GameShell;
  hud: HudPort;
  collisionRadii: ReadonlyMap<string, number>;
  versionLabel: string;
  audioStatus: AudioStatus;
}>;

/** stage start 前の view pool の準備で、1 render frame に作る view の上限。 */
const VIEW_WARMUP_PER_FRAME = 256;

/**
 * loading の後半（view pool の準備）から title、stage、stage 終了までを受け持つ scene。
 *
 * loading（boot scene）が渡した texture と見積もりで view pool を作り、1 render frame に `VIEW_WARMUP_PER_FRAME` 個ずつ作り終えたら
 * lifecycle を title へ進める。以後は render frame ごとに `GameShell` を進め、tick を実行した frame と stage を始めた・離れた frame で
 * `GameFrame.state.entities` を view へ同期し、HUD（score、lives、状態の見出し、debug）を更新する。無敵中の自機の点滅と撃破の
 * hit spark は render-only の演出として state と event から作り、pause 中は spark を古くしない。debug overlay を表示している間は
 * content の collision radius による collider と debug HUD を出す。
 *
 * keyboard event は Phaser の keyboard plugin を使わず window から受けて shell に渡し、割り当てのある key は browser の既定動作を
 * 止める。window の blur と visibility が hidden になったことは lifecycle の focus lost、window の focus と、focus を持ったまま
 * visible に戻ったことは focus の復帰として渡す。Core の error と view pool の枯渇では scene を止めて HUD に error を出す。
 */
export class StageScene extends Scene {
  readonly #options: StageSceneOptions;
  #data: StageSceneData | null = null;
  #views: EntityViews | null = null;
  #sparkViews: HitSparkViews | null = null;
  #colliders: ColliderOverlay | null = null;
  #debugOverlayShown = false;
  #syncedLifecycle: GameLifecycleState | null = null;
  readonly #sparks = new HitSparks();
  #warming = false;
  #halted = false;
  #assetNotes: readonly string[] = [];

  constructor(options: StageSceneOptions) {
    super("stage");
    this.#options = options;
  }

  init(data: StageSceneData): void {
    this.#data = data;
  }

  create(): void {
    const data = this.#data;
    if (!data) {
      throw new Error("stage scene must be started by the boot scene");
    }
    fitCameraToPlayfield(this);
    this.#assetNotes = data.assetEvents.filter((event) => event.type === "assetFallbackUsed").map(describeRuntimeEvent);
    this.#views = new EntityViews(this, {
      collisionRadii: this.#options.collisionRadii,
      textures: data.textures,
      textureScales: data.textureScales,
      capacities: data.viewPoolCapacities,
    });
    this.#sparkViews = new HitSparkViews(this, HIT_SPARK_BUDGET.maxActive);
    this.#colliders = new ColliderOverlay(this, this.#options.collisionRadii);
    this.#warming = true;
    this.#listenToBrowser();
  }

  update(_time: number, delta: number): void {
    const views = this.#views;
    if (this.#halted || !views) {
      return;
    }
    if (this.#warming) {
      const warmed = views.warm(VIEW_WARMUP_PER_FRAME);
      if (!warmed) {
        const { created, capacity } = views.warmProgress;
        this.#options.hud.render(buildLoadingHudView(`views ${created}/${capacity}`));
        return;
      }
      this.#warming = false;
      this.#options.shell.finishLoading();
    }

    const step = this.#options.shell.advance(delta);
    if (!step.ok) {
      this.#halt("Core error", step.errors.map((error) => `${error.code}: ${error.message}`));
      return;
    }
    if (step.stageChanged) {
      this.#sparks.clear();
    }
    // 撃破された敵の位置は、同期で view を片付ける前に直前の描画から引く。
    this.#sparks.update(step.lifecycle.state === "paused" ? 0 : delta, step.events, (id) => views.positionOf(id));
    this.#sparkViews?.render(this.#sparks.active);
    // tick が進まず（高 refresh rate の display や pause 中）、lifecycle も debug overlay も変わらない render frame は、描き直すものが
    // ないので同期も HUD の更新もしない。lifecycle が変わった frame は、点滅を止めて自機を出すためにも同期する。
    const stateChanged = step.stageChanged || step.ticks > 0;
    const lifecycleChanged = step.lifecycle.state !== this.#syncedLifecycle;
    const debugOverlayChanged = step.debugOverlay !== this.#debugOverlayShown;
    this.#syncedLifecycle = step.lifecycle.state;
    this.#debugOverlayShown = step.debugOverlay;
    const entities = step.frame?.state.entities ?? [];
    if (stateChanged || debugOverlayChanged) {
      this.#colliders?.draw(entities, step.debugOverlay);
    }
    if (stateChanged || lifecycleChanged) {
      const exhausted = views.sync(entities, {
        showPlayerHitbox: step.latestInput?.held.includes("focus") ?? false,
        playerVisible: isPlayerVisible(step.lifecycle.state, step.frame?.state.player.invincibleTicksRemaining ?? 0),
      });
      if (exhausted) {
        console.error(`[sample-title] ${describeRuntimeEvent(exhausted)}`);
        this.#halt("Runtime error", [describeRuntimeEvent(exhausted)]);
        return;
      }
    }
    if (stateChanged || lifecycleChanged || debugOverlayChanged) {
      this.#options.hud.render(buildHudView(step.lifecycle.state, step.frame));
      this.#options.hud.setDebugLines(step.debugOverlay ? this.#debugLines(step) : []);
    }
  }

  #debugLines(step: Extract<GameShellStep, { ok: true }>): readonly string[] {
    const sparkNotes = this.#sparks.droppedTotal > 0 ? [`hit sparks dropped ${this.#sparks.droppedTotal}`] : [];
    return buildDebugHudLines({
      versionLabel: this.#options.versionLabel,
      lifecycle: step.lifecycle.state,
      audioStatus: this.#options.audioStatus,
      seed: step.seed,
      difficulty: step.difficulty,
      frame: step.frame,
      droppedTicksTotal: step.droppedTicksTotal,
      notes: [...sparkNotes, ...this.#assetNotes],
    });
  }

  /** Core の error や runtime の fatal で scene を止め、HUD に出す。Phase 2A は dev と本番のどちらも止める。 */
  #halt(title: string, lines: readonly string[]): void {
    this.#halted = true;
    this.#options.hud.showError(title, lines);
  }

  #listenToBrowser(): void {
    const { shell } = this.#options;
    const onKey = (event: KeyboardEvent): void => {
      if (shell.handleKeyEvent(event)) {
        event.preventDefault();
      }
    };
    const onBlur = (): void => {
      shell.loseFocus();
    };
    const onFocus = (): void => {
      shell.regainFocus();
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        shell.loseFocus();
      } else if (document.hasFocus()) {
        shell.regainFocus();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const removeListeners = (): void => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // scene の停止は SHUTDOWN、game の破棄は SHUTDOWN を経ず DESTROY だけを出すため、両方で外す。
    this.events.once(Scenes.Events.SHUTDOWN, removeListeners);
    this.events.once(Scenes.Events.DESTROY, removeListeners);
  }
}

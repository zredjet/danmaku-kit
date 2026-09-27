import type { ViewKind } from "./view/view-entities.ts";

/**
 * runtime adapter で起きた事実（design 5.4 / 17）。
 *
 * asset の読み込みや view pool のように描画側だけで起きることを記録し、Core の `GameEvent` とは混ぜない。replay と state hash の
 * 対象にもしない。
 */
export type RuntimeEvent =
  | Readonly<{ type: "assetLoadFailed"; assetKey: string; reason: string }>
  | Readonly<{ type: "assetFallbackUsed"; assetKey: string; fallbackKey: string }>
  | Readonly<{ type: "assetLoadSkipped"; assetKey: string; reason: string }>
  | Readonly<{ type: "viewPoolExhausted"; kind: ViewKind; capacity: number; entityId: number }>;

/** debug HUD と log に出す 1 行の説明。 */
export function describeRuntimeEvent(event: RuntimeEvent): string {
  switch (event.type) {
    case "assetLoadFailed":
      return `asset ${event.assetKey} failed to load: ${event.reason}`;
    case "assetFallbackUsed":
      return `asset ${event.assetKey} uses fallback ${event.fallbackKey}`;
    case "assetLoadSkipped":
      return `asset ${event.assetKey} skipped: ${event.reason}`;
    case "viewPoolExhausted":
      return `${event.kind} view pool exhausted at ${event.capacity} views (entity ${event.entityId})`;
  }
}

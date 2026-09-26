import type { RuntimeEvent } from "../runtime-event.ts";
import { resolveAssetUrl } from "./asset-manifest.ts";
import type { AssetManifest, AssetManifestEntry } from "./asset-manifest.ts";

/** loading で読み込む画像 1 つ。`format` は Phaser の loader の選び分けに使う。 */
export type AssetLoadRequest = Readonly<{
  key: string;
  url: string;
  format: "svg" | "image";
}>;

/** 読み込み計画。`notLoaded` は Phase 2A の loader が読まない asset と理由で、読み込み失敗と同じ規則で扱う。 */
export type AssetLoadPlan = Readonly<{
  requests: readonly AssetLoadRequest[];
  notLoaded: ReadonlyMap<string, string>;
}>;

/** 読み込み結果。`ok` なら asset key から、実際に使う読み込み済みの key（fallback を含む）を引ける。 */
export type AssetLoadOutcome =
  | Readonly<{ ok: true; loadedKeys: ReadonlyMap<string, string>; events: readonly RuntimeEvent[] }>
  | Readonly<{ ok: false; events: readonly RuntimeEvent[] }>;

/**
 * manifest から loading で読み込む asset を決める。
 *
 * Phase 2A の loader は sprite を画像として読む。audio は Phase 2A の対象外なので読まずに省略として扱い、atlas など未対応の type は
 * 読み込みに失敗した asset と同じ規則（required なら開始を止め、fallback があれば使う）に回す。
 */
export function planAssetLoads(manifest: AssetManifest, baseUrl: string): AssetLoadPlan {
  const requests: AssetLoadRequest[] = [];
  const notLoaded = new Map<string, string>();
  for (const [key, entry] of sortedEntries(manifest)) {
    if (entry.type === "sprite") {
      requests.push(Object.freeze({
        key,
        url: resolveAssetUrl(baseUrl, entry.path),
        format: entry.path.toLowerCase().endsWith(".svg") ? "svg" : "image",
      }));
    } else if (entry.type === "audio") {
      notLoaded.set(key, "audio is muted in Phase 2A");
    } else {
      notLoaded.set(key, `asset type ${entry.type} is not supported yet`);
    }
  }
  return Object.freeze({ requests: Object.freeze(requests), notLoaded });
}

/**
 * 読み込めなかった asset に design 17 の規則を当て、stage を始められるかと、asset ごとに使う key を決める。
 *
 * `required: true` の失敗は開始を止める。`required: false` で fallback があれば、fallback が解決した key を使う。fallback がないか
 * 解決できなければ、particle / effect と ui / decorative の画像は省略し、gameplay の sprite / atlas / tilemap は開始を止める。
 * audio は Phase 2A では鳴らさないので、失敗として扱わず `assetLoadSkipped` だけを残す。
 */
export function resolveAssetLoadResults(
  manifest: AssetManifest,
  failures: ReadonlyMap<string, string>,
): AssetLoadOutcome {
  const events: RuntimeEvent[] = [];
  const loadedKeys = new Map<string, string>();
  let blocked = false;
  for (const [key, entry] of sortedEntries(manifest)) {
    const reason = failures.get(key);
    if (reason === undefined) {
      loadedKeys.set(key, key);
      continue;
    }
    if (entry.type === "audio") {
      // Phase 2A は audio を鳴らさないため、required の audio も読まずに省略する。
      events.push(Object.freeze({ type: "assetLoadSkipped", assetKey: key, reason }));
      continue;
    }
    events.push(Object.freeze({ type: "assetLoadFailed", assetKey: key, reason }));
    if (entry.required) {
      blocked = true;
      continue;
    }
    const fallback = resolveFallback(manifest, failures, entry);
    if (fallback !== null) {
      events.push(Object.freeze({ type: "assetFallbackUsed", assetKey: key, fallbackKey: fallback }));
      if (!fallback.startsWith("runtime.")) {
        loadedKeys.set(key, fallback);
      }
    } else if (canSkip(entry)) {
      events.push(Object.freeze({ type: "assetLoadSkipped", assetKey: key, reason }));
    } else {
      blocked = true;
    }
  }
  return blocked
    ? Object.freeze({ ok: false, events: Object.freeze(events) })
    : Object.freeze({ ok: true, loadedKeys, events: Object.freeze(events) });
}

/** fallback の連鎖をたどり、読み込めた asset か runtime built-in の key を返す。見つからなければ null。 */
function resolveFallback(
  manifest: AssetManifest,
  failures: ReadonlyMap<string, string>,
  entry: AssetManifestEntry,
): string | null {
  const visited = new Set<string>();
  let fallback = entry.fallback;
  while (fallback !== undefined && !visited.has(fallback)) {
    if (fallback.startsWith("runtime.") || !failures.has(fallback)) {
      return fallback;
    }
    visited.add(fallback);
    fallback = manifest.assets[fallback]?.fallback;
  }
  return null;
}

/** fallback のない optional asset を省略できるか（design 17 の表）。gameplay の画像は欠かせない。 */
function canSkip(entry: AssetManifestEntry): boolean {
  if (entry.type === "particle" || entry.type === "effect") {
    return true;
  }
  return entry.usage !== "gameplay";
}

/** manifest の entry を key の UTF-16 順に並べ、読み込みと event の順序を manifest の書き順に依存させない。 */
function sortedEntries(manifest: AssetManifest): [string, AssetManifestEntry][] {
  return Object.entries(manifest.assets).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

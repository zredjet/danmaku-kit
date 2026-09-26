import { freezeSchemaDiagnostic } from "./diagnostic-factory.ts";
import type { ParseOrSchemaContentDiagnostic } from "./types.ts";
import type { ParsedYamlSource } from "./yaml-source.ts";

/** manifest entry の asset type（design 17）。 */
export const ASSET_TYPES = Object.freeze(["sprite", "atlas", "tilemap", "audio", "particle", "effect"] as const);
export type AssetType = (typeof ASSET_TYPES)[number];

/** manifest entry の usage（design 17）。load に失敗した optional asset を省略できるかを決める。 */
export const ASSET_USAGES = Object.freeze(["gameplay", "ui", "decorative", "audio"] as const);
export type AssetUsage = (typeof ASSET_USAGES)[number];

/** manifest file を持たず runtime が提供する built-in asset と、その type。fallback からだけ参照できる。 */
export const RUNTIME_BUILTIN_ASSET_TYPES: Readonly<Record<string, AssetType>> = Object.freeze({
  "runtime.audio.silence": "audio",
});

/** 検証済みの manifest entry。`path` は base URL からの相対 path。 */
export type AssetManifestEntry = Readonly<{
  type: AssetType;
  path: string;
  required: boolean;
  usage: AssetUsage;
  fallback?: string;
  license?: string;
  author?: string;
  source?: string;
}>;

/** runtime が asset を読み込むための検証済み manifest。Core へは key の一覧だけを渡し、path はこちらだけが持つ。 */
export type AssetManifest = Readonly<{
  version: 1;
  assets: Readonly<Record<string, AssetManifestEntry>>;
}>;

const MANIFEST_KEYS = Object.freeze(["version", "assets"]);
const ENTRY_KEYS = Object.freeze(["type", "path", "required", "usage", "fallback", "license", "author", "source"]);
const RUNTIME_KEY_PREFIX = "runtime.";

type ManifestDiagnostics = {
  readonly source: ParsedYamlSource;
  readonly diagnostics: ParseOrSchemaContentDiagnostic[];
};

/**
 * asset manifest の root と各 entry を検証する（design 17）。
 *
 * entry は `type`、`path`、`required`、`usage` を必須とし、`fallback`、`license`、`author`、`source` を任意 field とする。
 * `path` は base URL と合成する相対 path に限り、`fallback` は `required: false` の entry から、同じ type の manifest key か
 * `runtime.` の built-in asset だけを参照でき、fallback の連鎖は循環してはならない。`runtime.` の key は built-in 用に予約する。
 */
export function validateAssetManifestSource(source: ParsedYamlSource): readonly ParseOrSchemaContentDiagnostic[] {
  const context: ManifestDiagnostics = { source, diagnostics: [] };
  const manifest = asPlainRecord(source.value);
  if (!manifest) {
    return Object.freeze([]);
  }
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_KEYS.includes(key)) {
      report(context, [key], "assetManifest.unknownField", `Unknown field at assetManifest.${key}`, `assetManifest.${key}`, "assetManifest");
    }
  }
  if (manifest.version !== 1) {
    report(context, ["version"], "assetManifest.invalidShape", "asset manifest version must be 1", "assetManifest.version", "assetManifest");
  }
  const assets = asPlainRecord(manifest.assets);
  if (!assets) {
    return Object.freeze(context.diagnostics);
  }
  for (const [key, value] of Object.entries(assets)) {
    validateAssetManifestEntry(context, assets, key, value);
  }
  for (const key of Object.keys(assets)) {
    const cycle = findFallbackCycle(assets, key);
    if (cycle) {
      report(
        context,
        ["assets", key, "fallback"],
        "assetManifest.fallbackCycle",
        `asset fallback chain must not form a cycle: ${cycle.join(" -> ")}`,
        entryPath(key, "fallback"),
        key,
      );
    }
  }
  return Object.freeze(context.diagnostics);
}

/** 検証に通った manifest の value を、runtime へ渡す plain data の `AssetManifest` へ写す。 */
export function toAssetManifest(value: unknown): AssetManifest {
  const assets = asPlainRecord(asPlainRecord(value)?.assets) ?? {};
  return Object.freeze({
    version: 1,
    assets: Object.freeze(Object.fromEntries(Object.entries(assets).map(([key, entryValue]) => {
      const entry = asPlainRecord(entryValue)!;
      return [key, Object.freeze(Object.fromEntries(ENTRY_KEYS.filter((field) => entry[field] !== undefined)
        .map((field) => [field, entry[field]]))) as AssetManifestEntry];
    }))),
  });
}

function validateAssetManifestEntry(
  context: ManifestDiagnostics,
  assets: Readonly<Record<string, unknown>>,
  key: string,
  value: unknown,
): void {
  const at = (field?: string) => field === undefined ? ["assets", key] : ["assets", key, field];
  if (key.startsWith(RUNTIME_KEY_PREFIX)) {
    report(context, at(), "assetManifest.invalidShape", "asset keys starting with runtime. are reserved for runtime built-in assets", entryPath(key), key);
  }
  const entry = asPlainRecord(value);
  if (!entry) {
    report(context, at(), "assetManifest.invalidShape", "asset manifest entry must be an object", entryPath(key), key);
    return;
  }
  for (const field of Object.keys(entry)) {
    if (!ENTRY_KEYS.includes(field)) {
      report(context, at(field), "assetManifest.unknownField", `Unknown field at assetManifest.assets[].${field}`, entryPath(key, field), key);
    }
  }
  if (!(ASSET_TYPES as readonly unknown[]).includes(entry.type)) {
    report(context, at("type"), "assetManifest.invalidShape", `asset type must be one of ${ASSET_TYPES.join(", ")}`, entryPath(key, "type"), key);
  }
  if (typeof entry.path !== "string" || !isBaseRelativeAssetPath(entry.path)) {
    report(
      context,
      at("path"),
      "assetManifest.invalidShape",
      "asset path must be a base-relative path without a scheme, leading slash, backslash or . / .. segment",
      entryPath(key, "path"),
      key,
    );
  }
  if (typeof entry.required !== "boolean") {
    report(context, at("required"), "assetManifest.invalidShape", "asset required must be a boolean", entryPath(key, "required"), key);
  }
  if (!(ASSET_USAGES as readonly unknown[]).includes(entry.usage)) {
    report(context, at("usage"), "assetManifest.invalidShape", `asset usage must be one of ${ASSET_USAGES.join(", ")}`, entryPath(key, "usage"), key);
  } else if ((entry.type === "audio") !== (entry.usage === "audio")) {
    report(context, at("usage"), "assetManifest.invalidShape", "asset usage audio must be used exactly for audio assets", entryPath(key, "usage"), key);
  }
  for (const field of ["license", "author", "source"] as const) {
    if (entry[field] !== undefined && typeof entry[field] !== "string") {
      report(context, at(field), "assetManifest.invalidShape", `asset ${field} must be a string`, entryPath(key, field), key);
    }
  }
  if (entry.fallback !== undefined) {
    validateAssetFallback(context, assets, key, entry);
  }
}

/** fallback が required: false の entry から、同じ type の manifest key か runtime built-in を参照していることを検証する。 */
function validateAssetFallback(
  context: ManifestDiagnostics,
  assets: Readonly<Record<string, unknown>>,
  key: string,
  entry: Readonly<Record<string, unknown>>,
): void {
  const at = ["assets", key, "fallback"];
  const fallback = entry.fallback;
  if (typeof fallback !== "string" || fallback.length === 0) {
    report(context, at, "assetManifest.invalidShape", "asset fallback must be a non-empty string", entryPath(key, "fallback"), key);
    return;
  }
  if (entry.required !== false) {
    report(context, at, "assetManifest.invalidFallback", "asset fallback is only used by required: false assets", entryPath(key, "fallback"), key);
  }
  const fallbackType = fallback.startsWith(RUNTIME_KEY_PREFIX)
    ? RUNTIME_BUILTIN_ASSET_TYPES[fallback]
    : asPlainRecord(assets[fallback])?.type;
  if (fallbackType === undefined) {
    report(context, at, "assetManifest.invalidFallback", `asset fallback references an unknown asset: ${fallback}`, entryPath(key, "fallback"), key);
  } else if (fallbackType !== entry.type) {
    report(
      context,
      at,
      "assetManifest.invalidFallback",
      `asset fallback must have the same type ${String(entry.type)}: ${fallback}`,
      entryPath(key, "fallback"),
      key,
    );
  }
}

/** key から manifest 内の fallback を辿り、key に戻ってくるならその連鎖を返す。 */
function findFallbackCycle(assets: Readonly<Record<string, unknown>>, key: string): readonly string[] | null {
  const chain = [key];
  const visited = new Set(chain);
  let current = asPlainRecord(assets[key])?.fallback;
  while (typeof current === "string" && Object.hasOwn(assets, current)) {
    chain.push(current);
    if (current === key) {
      return chain;
    }
    if (visited.has(current)) {
      return null;
    }
    visited.add(current);
    current = asPlainRecord(assets[current])?.fallback;
  }
  return null;
}

/** base URL と合成してよい相対 path か。scheme、先頭の `/`、`\`、空・`.`・`..` の segment を拒否する。 */
function isBaseRelativeAssetPath(value: string): boolean {
  return value.length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && !value.includes(":")
    && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function entryPath(key: string, field?: string): string {
  return `assetManifest.assets[${JSON.stringify(key)}]${field === undefined ? "" : `.${field}`}`;
}

function report(
  context: ManifestDiagnostics,
  sourcePath: readonly (string | number)[],
  code: string,
  message: string,
  schemaPath: string,
  sourceId: string,
): void {
  context.diagnostics.push(freezeSchemaDiagnostic(code, "error", message, schemaPath, {
    span: context.source.locate(sourcePath),
    sourceId,
    schemaPath,
  }));
}

function asPlainRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Readonly<Record<string, unknown>> : null;
}

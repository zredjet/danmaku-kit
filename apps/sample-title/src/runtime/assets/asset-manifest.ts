/** manifest entry の asset type。validate-content の `AssetType` と同じ値。 */
export type AssetType = "sprite" | "atlas" | "tilemap" | "audio" | "particle" | "effect";

/** manifest entry の usage。load に失敗した optional asset を省略できるかを決める。 */
export type AssetUsage = "gameplay" | "ui" | "decorative" | "audio";

/** content plugin が validate-content で検証して渡す manifest entry。`path` は base URL からの相対 path。 */
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

/**
 * runtime が asset を読み込むための検証済み manifest（design 17）。
 *
 * app は validate-content を import しないため、同じ形をここで宣言する。content plugin が validate-content の型をこの型へ代入して
 * 形のずれを型検査で検出する。
 */
export type AssetManifest = Readonly<{
  version: 1;
  assets: Readonly<Record<string, AssetManifestEntry>>;
}>;

/** manifest の base-relative path を base URL（Vite の `import.meta.env.BASE_URL`）と合成する。 */
export function resolveAssetUrl(baseUrl: string, path: string): string {
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}${path}`;
}

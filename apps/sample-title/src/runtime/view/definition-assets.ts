import type { GameDefinition } from "@shooting-sample/shooting-core";

/**
 * content 定義の asset key を definition id から引ける表にする。
 *
 * `GameFrame` の entity は definition id だけを持つため、view の texture は app が持つ content 定義から asset key を引く。definition id は
 * 種類ごとの namespace prefix を持つので、全種類を 1 つの表にまとめても衝突しない。
 */
export function collectDefinitionAssets(definition: GameDefinition): ReadonlyMap<string, string> {
  const { players, enemies, bullets, playerShots } = definition.content;
  return new Map<string, string>([...players, ...enemies, ...bullets, ...playerShots].map((item) => [item.id, item.asset]));
}

/**
 * definition id から、読み込み済みの texture の key を引ける表を作る。
 *
 * asset の読み込み結果（fallback を含む）で key を置き換える。gameplay entity の view は欠かせないため、texture を持たない
 * definition があれば、その asset key の一覧を返して stage を始めない。
 */
export function resolveDefinitionTextures(
  definitionAssets: ReadonlyMap<string, string>,
  loadedKeys: ReadonlyMap<string, string>,
): Readonly<{ ok: true; textures: ReadonlyMap<string, string> }> | Readonly<{ ok: false; missingAssets: readonly string[] }> {
  const textures = new Map<string, string>();
  const missingAssets = new Set<string>();
  for (const [definitionId, assetKey] of definitionAssets) {
    const texture = loadedKeys.get(assetKey);
    if (texture === undefined) {
      missingAssets.add(assetKey);
    } else {
      textures.set(definitionId, texture);
    }
  }
  return missingAssets.size > 0
    ? Object.freeze({ ok: false, missingAssets: Object.freeze([...missingAssets].sort()) })
    : Object.freeze({ ok: true, textures });
}

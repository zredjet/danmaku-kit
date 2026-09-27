import type { CollectionSource, ContentCollectionName } from "./content-collections.ts";
import type { ParsedYamlSource, YamlSourceSpan } from "./yaml-source.ts";

export type ContentSourceContext = Readonly<{
  span: YamlSourceSpan;
  sourceId: string;
  schemaPath: string;
}>;

/** Core error adapterがschema pathや参照値から元YAMLを特定するためのindex。 */
export type ContentSourceIndex = Readonly<{
  locateSchemaPath: (schemaPath: string, referrerId?: string) => ContentSourceContext;
}>;

/** Coreのschema path規則と分割YAMLのlocal pathを対応付けるsource indexを作る。 */
export function createContentSourceIndex(
  gameDefinition: ParsedYamlSource,
  assetManifest: ParsedYamlSource,
  collectionSources: readonly CollectionSource[],
): ContentSourceIndex {
  return Object.freeze({
    locateSchemaPath(schemaPath, referrerId) {
      if (schemaPath === "content.version") {
        return context(gameDefinition, ["contentVersion"], "gameDefinition", schemaPath);
      }
      if (schemaPath === "schemaVersion" || schemaPath === "enabledFeatures" || schemaPath === "defaultPlayerId") {
        return context(gameDefinition, parseSourcePath(schemaPath), "gameDefinition", schemaPath);
      }
      if (schemaPath.startsWith("content.assetKeys")) {
        return context(assetManifest, ["assets"], "assetManifest", schemaPath);
      }

      const contentMatch = /^content\.(players|stages|enemies|bullets|playerShots|patterns|paths|features\.pickups)(?:\[(\d+)\])?(?:\.(.*))?$/
        .exec(schemaPath);
      if (contentMatch?.[2] !== undefined) {
        const collection = contentMatch[1] as ContentCollectionName;
        const index = Number(contentMatch[2]);
        const source = collectionSources.filter((item) => item.collection === collection)[index];
        if (source) {
          return context(source.source, parseSourcePath(contentMatch[3] ?? ""), source.sourceId, schemaPath);
        }
      }

      if (referrerId) {
        const identified = collectionSources.find((item) => item.sourceId === referrerId);
        if (identified) {
          return context(
            identified.source,
            localSourcePath(schemaPath, identified.collection),
            identified.sourceId,
            schemaPath,
          );
        }
      }

      if (contentMatch) {
        const collection = contentMatch[1] as ContentCollectionName;
        const source = collectionSources.find((item) => item.collection === collection);
        if (source) {
          return context(source.source, parseSourcePath(contentMatch[3] ?? ""), source.sourceId, schemaPath);
        }
      }

      const genericMatch = /^(playerShot|player|stage|enemy|bullet|pattern|path|pickup)(?:\.(.*))?$/.exec(schemaPath);
      if (genericMatch) {
        const collection = singularToCollection(genericMatch[1]!);
        const source = collectionSources.find((item) => item.collection === collection);
        if (source) {
          return context(source.source, parseSourcePath(genericMatch[2] ?? ""), source.sourceId, schemaPath);
        }
      }
      return context(gameDefinition, [], "gameDefinition", schemaPath);
    },
  });
}

/** source documentとlocal pathからadapter共通contextを作る。 */
function context(
  source: ParsedYamlSource,
  sourcePath: readonly (string | number)[],
  sourceId: string,
  schemaPath: string,
): ContentSourceContext {
  return Object.freeze({ span: source.locate(sourcePath), sourceId, schemaPath });
}

/** `foo[0].bar`と`timeline[]`をYAML AST lookup用segmentへ変換する。 */
function parseSourcePath(schemaPath: string): readonly (string | number)[] {
  if (schemaPath.length === 0 || schemaPath === "$") {
    return Object.freeze([]);
  }
  const segments: Array<string | number> = [];
  for (const part of schemaPath.split(".")) {
    const match = /^([^[]+)(?:\[(\d*)\])?$/.exec(part);
    if (!match) {
      continue;
    }
    segments.push(match[1]!);
    if (match[2] !== undefined) {
      segments.push(match[2].length === 0 ? 0 : Number(match[2]));
    }
  }
  return Object.freeze(segments);
}

/** Core validatorの単数形path prefixをregistry collection名へ揃える。 */
function singularToCollection(value: string): ContentCollectionName {
  switch (value) {
    case "player": return "players";
    case "stage": return "stages";
    case "enemy": return "enemies";
    case "bullet": return "bullets";
    case "playerShot": return "playerShots";
    case "pattern": return "patterns";
    case "path": return "paths";
    case "pickup": return "features.pickups";
    default: return "players";
  }
}

/** Coreのindex付きschema pathから、1 definition file内のlocal pathだけを取り出す。 */
function localSourcePath(
  schemaPath: string,
  collection: ContentCollectionName,
): readonly (string | number)[] {
  const contentPrefix = `content.${collection}`.replaceAll(".", "\\.");
  if (new RegExp(`^${contentPrefix}(?:\\[\\d+\\])?$`).test(schemaPath)) {
    return Object.freeze([]);
  }
  const contentMatch = new RegExp(`^${contentPrefix}(?:\\[\\d+\\])?\\.(.*)$`).exec(schemaPath);
  if (contentMatch) {
    return parseSourcePath(contentMatch[1]!);
  }
  const singular = collectionToSingular(collection);
  if (schemaPath === singular) {
    return Object.freeze([]);
  }
  return parseSourcePath(schemaPath.startsWith(`${singular}.`)
    ? schemaPath.slice(singular.length + 1)
    : schemaPath);
}

/** registry collection名をCore validatorが使う単数形prefixへ戻す。 */
function collectionToSingular(collection: ContentCollectionName): string {
  switch (collection) {
    case "players": return "player";
    case "stages": return "stage";
    case "enemies": return "enemy";
    case "bullets": return "bullet";
    case "playerShots": return "playerShot";
    case "patterns": return "pattern";
    case "paths": return "path";
    case "features.pickups": return "pickup";
  }
}

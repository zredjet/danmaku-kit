import path from "node:path";

import { toAssetManifest, validateAssetManifestSource, type AssetManifest } from "./asset-manifest.ts";
import {
  COLLECTION_DIRECTORIES,
  FEATURE_COLLECTIONS,
  type CollectionSource,
  type ContentCollectionName,
  type ContentDirectoryName,
} from "./content-collections.ts";
import {
  ContentFileInvalidUtf8Error,
  ContentFileTooLargeError,
  createNodeContentFileSystem,
  type ContentFileEntry,
  type ContentFileSystem,
} from "./content-file-system.ts";
import { createContentSourceIndex, type ContentSourceIndex } from "./content-source-index.ts";
import {
  createRootParseDiagnostic,
  defaultSpan,
  freezeSchemaDiagnostic,
  type OwnSchemaDiagnosticCode,
} from "./diagnostic-factory.ts";
import type { ParseOrSchemaContentDiagnostic } from "./types.ts";
import {
  parseYamlSource,
  MAX_YAML_SOURCE_BYTES,
  type ParsedYamlSource,
  type YamlSourceSpan,
} from "./yaml-source.ts";

export type LoadContentSourceResult =
  | Readonly<{
      ok: true;
      definition: unknown;
      /** 検証済みの asset manifest。Core へは key の一覧だけを渡し、runtime はこちらの path で asset を読み込む。 */
      assetManifest: AssetManifest;
      sourceIndex: ContentSourceIndex;
      diagnostics: readonly ParseOrSchemaContentDiagnostic[];
    }>
  | Readonly<{
      ok: false;
      diagnostics: readonly ParseOrSchemaContentDiagnostic[];
    }>;

/**
 * game-definition YAMLとcontent-root以下の種類別YAMLを1つのGameDefinitionへ組み立てる。
 *
 * game-definitionは`contentVersion`をCLI専用fieldとして持つ。content definitionsは
 * `players/*.yaml`など1file 1definitionとし、asset key catalogは
 * `assets/manifest.yaml`の`assets` object keyから生成する。
 */
export async function loadContentSource(
  gameDefinitionPath: string,
  contentRoot: string,
  fileSystem: ContentFileSystem = createNodeContentFileSystem(),
): Promise<LoadContentSourceResult> {
  const diagnostics: ParseOrSchemaContentDiagnostic[] = [];
  const gameParse = await readYamlSource(gameDefinitionPath, fileSystem);
  diagnostics.push(...gameParse.diagnostics);
  if (!gameParse.ok) {
    return Object.freeze({ ok: false, diagnostics: Object.freeze(diagnostics) });
  }

  const rootEntries = await fileSystem.readDirectory(contentRoot);
  diagnostics.push(...validateContentRootEntries(contentRoot, rootEntries));

  const assetManifestPath = path.join(contentRoot, "assets", "manifest.yaml");
  const assetRootEntry = rootEntries.find((entry) => entry.name === "assets");
  const assetManifest = assetRootEntry && assetRootEntry.kind !== "directory"
    ? null
    : await readOptionalYamlSource(assetManifestPath, fileSystem);
  if (!assetManifest) {
    diagnostics.push(createSchemaDiagnostic(
      defaultSpan(assetManifestPath),
      "content.assetManifestNotFound",
      "content/assets/manifest.yaml is required",
      "content.assetKeys",
      "assetManifest",
    ));
  } else {
    diagnostics.push(...assetManifest.diagnostics);
  }

  const collectionSources: CollectionSource[] = [];
  for (const [directoryName, collection] of Object.entries(COLLECTION_DIRECTORIES) as Array<
    [ContentDirectoryName, ContentCollectionName]
  >) {
    const directoryPath = path.join(contentRoot, directoryName);
    const rootEntry = rootEntries.find((entry) => entry.name === directoryName);
    if (rootEntry && rootEntry.kind !== "directory") {
      continue;
    }
    const entries = await readOptionalDirectory(directoryPath, fileSystem);
    if (!entries) {
      continue;
    }
    for (const entry of [...entries].sort((left, right) => compareUtf8(left.name, right.name))) {
      const sourcePath = path.join(directoryPath, entry.name);
      if (entry.kind !== "file" || !entry.name.endsWith(".yaml")) {
        diagnostics.push(createSchemaDiagnostic(
          defaultSpan(sourcePath),
          "content.unsupportedEntry",
          `${directoryName} must contain only .yaml files`,
          `content.${collection}`,
          directoryName,
        ));
        continue;
      }
      const parsed = await readYamlSource(sourcePath, fileSystem);
      diagnostics.push(...parsed.diagnostics);
      if (parsed.ok) {
        collectionSources.push(Object.freeze({
          collection,
          source: parsed.source,
          sourceId: getDefinitionSourceId(parsed.source.value, sourcePath),
        }));
      }
    }
  }

  if (!assetManifest?.ok) {
    return Object.freeze({ ok: false, diagnostics: Object.freeze(diagnostics) });
  }

  const localSchemaDiagnostics = validateCliSourceShapes(
    gameParse.source,
    assetManifest.source,
    collectionSources,
  );
  diagnostics.push(...localSchemaDiagnostics);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return Object.freeze({ ok: false, diagnostics: Object.freeze(diagnostics) });
  }

  const definition = assembleGameDefinition(gameParse.source.value, assetManifest.source.value, collectionSources);
  const sourceIndex = createContentSourceIndex(gameParse.source, assetManifest.source, collectionSources);
  return Object.freeze({
    ok: true,
    definition,
    assetManifest: toAssetManifest(assetManifest.source.value),
    sourceIndex,
    diagnostics: Object.freeze(diagnostics),
  });
}

/** game-definition固有fieldとasset manifestの最小shapeをCore validation前に検証する。 */
function validateCliSourceShapes(
  gameDefinition: ParsedYamlSource,
  assetManifest: ParsedYamlSource,
  collectionSources: readonly CollectionSource[],
): readonly ParseOrSchemaContentDiagnostic[] {
  const diagnostics: ParseOrSchemaContentDiagnostic[] = [];
  const game = asPlainRecord(gameDefinition.value);
  if (!game) {
    diagnostics.push(createSchemaDiagnostic(
      gameDefinition.locate([]),
      "definition.invalidShape",
      "game-definition must be an object",
      "$",
      "gameDefinition",
    ));
  } else {
    if (typeof game.contentVersion !== "string" || game.contentVersion.length === 0) {
      diagnostics.push(createSchemaDiagnostic(
        gameDefinition.locate(["contentVersion"]),
        "definition.invalidShape",
        "contentVersion must be a non-empty string",
        "content.version",
        "gameDefinition",
      ));
    }
    if (Object.hasOwn(game, "content")) {
      diagnostics.push(createSchemaDiagnostic(
        gameDefinition.locate(["content"]),
        "definition.unknownField",
        "game-definition content is assembled from --content-root and must be omitted",
        "content",
        "gameDefinition",
      ));
    }
  }

  const manifest = asPlainRecord(assetManifest.value);
  if (!manifest) {
    diagnostics.push(createSchemaDiagnostic(
      assetManifest.locate([]),
      "assetManifest.invalidShape",
      "asset manifest must be an object",
      "content.assetKeys",
      "assetManifest",
    ));
  } else if (!asPlainRecord(manifest.assets)) {
    diagnostics.push(createSchemaDiagnostic(
      assetManifest.locate(["assets"]),
      "assetManifest.invalidShape",
      "asset manifest assets must be an object",
      "content.assetKeys.keys",
      "assetManifest",
    ));
  }
  diagnostics.push(...validateAssetManifestSource(assetManifest));
  for (const source of collectionSources) {
    if (!asPlainRecord(source.source.value)) {
      diagnostics.push(createSchemaDiagnostic(
        source.source.locate([]),
        "definition.invalidShape",
        "collection file must contain one definition object",
        `content.${source.collection}`,
        source.sourceId,
      ));
    }
  }
  return Object.freeze(diagnostics);
}

/** CLI入力用shapeからCore公開GameDefinitionを生成する。 */
function assembleGameDefinition(
  gameDefinitionValue: unknown,
  assetManifestValue: unknown,
  collectionSources: readonly CollectionSource[],
): unknown {
  const game = asPlainRecord(gameDefinitionValue)!;
  const manifest = asPlainRecord(assetManifestValue)!;
  const assets = asPlainRecord(manifest.assets)!;
  const content = {
    version: game.contentVersion,
    assetKeys: { keys: Object.keys(assets).sort(compareUtf8) },
    players: collectDefinitions(collectionSources, "players"),
    stages: collectDefinitions(collectionSources, "stages"),
    enemies: collectDefinitions(collectionSources, "enemies"),
    bullets: collectDefinitions(collectionSources, "bullets"),
    playerShots: collectDefinitions(collectionSources, "playerShots"),
    patterns: collectDefinitions(collectionSources, "patterns"),
    paths: collectDefinitions(collectionSources, "paths"),
    ...collectFeatureContent(collectionSources, game.enabledFeatures),
  };
  const { contentVersion: _contentVersion, content: _content, ...coreFields } = game;
  return { ...coreFields, content };
}

/**
 * optional feature の collection を `content.features` にまとめる。file のある collection と、有効な feature の collection（file が
 * なければ空）を置き、どちらもなければ `content.features` を省く。
 */
function collectFeatureContent(
  sources: readonly CollectionSource[],
  enabledFeatures: unknown,
): Readonly<{ features?: Record<string, readonly unknown[]> }> {
  const features: Record<string, readonly unknown[]> = {};
  for (const [collection, feature] of Object.entries(FEATURE_COLLECTIONS)) {
    const enabled = Array.isArray(enabledFeatures) && enabledFeatures.includes(feature);
    if (enabled || sources.some((source) => source.collection === collection)) {
      features[collection.slice("features.".length)] = collectDefinitions(sources, collection as ContentCollectionName);
    }
  }
  return Object.keys(features).length > 0 ? { features } : {};
}

/** collection fileのUTF-8 path順を保ったまま定義配列へ投影する。 */
function collectDefinitions(
  sources: readonly CollectionSource[],
  collection: ContentCollectionName,
): readonly unknown[] {
  return sources.filter((source) => source.collection === collection).map((source) => source.source.value);
}

/** root entryをallowlist検証し、typoしたdirectoryを黙って無視しない。 */
function validateContentRootEntries(
  contentRoot: string,
  entries: readonly ContentFileEntry[],
): readonly ParseOrSchemaContentDiagnostic[] {
  const allowed = new Set<string>([...Object.keys(COLLECTION_DIRECTORIES), "assets"]);
  return Object.freeze(entries
    .filter((entry) => !allowed.has(entry.name) || entry.kind !== "directory")
    .map((entry) => createSchemaDiagnostic(
      defaultSpan(path.join(contentRoot, entry.name)),
      "content.unknownEntry",
      `Unknown content-root entry: ${entry.name}`,
      "content",
      "contentRoot",
    )));
}

/** optional collection directoryを読み、存在しない場合だけ空collectionとして扱う。 */
async function readOptionalDirectory(
  directoryPath: string,
  fileSystem: ContentFileSystem,
): Promise<readonly ContentFileEntry[] | null> {
  try {
    return await fileSystem.readDirectory(directoryPath);
  } catch (cause) {
    if (isNodeErrorCode(cause, "ENOENT")) {
      return null;
    }
    throw cause;
  }
}

/** required判定をcallerへ残したまま、存在するYAMLだけをparseする。 */
async function readOptionalYamlSource(
  sourcePath: string,
  fileSystem: ContentFileSystem,
): Promise<ReturnType<typeof parseYamlSource> | null> {
  try {
    return await readYamlSource(sourcePath, fileSystem);
  } catch (cause) {
    if (isNodeErrorCode(cause, "ENOENT")) {
      return null;
    }
    throw cause;
  }
}

/** filesystemのbyte上限違反も、通常の位置付きYAML resource診断へ変換する。 */
async function readYamlSource(
  sourcePath: string,
  fileSystem: ContentFileSystem,
): Promise<ReturnType<typeof parseYamlSource>> {
  try {
    return parseYamlSource(
      sourcePath,
      await fileSystem.readTextFile(sourcePath, MAX_YAML_SOURCE_BYTES),
    );
  } catch (cause) {
    if (!(cause instanceof ContentFileTooLargeError) && !(cause instanceof ContentFileInvalidUtf8Error)) {
      throw cause;
    }
    const code = cause instanceof ContentFileInvalidUtf8Error
      ? "yaml.parse.invalid_utf8"
      : "yaml.resource";
    return Object.freeze({
      ok: false,
      diagnostics: Object.freeze([createRootParseDiagnostic(sourcePath, code, cause.message)]),
    });
  }
}

/** loader 固有の source file / manifest 構造エラーを error severity の schema diagnostic にする。 */
function createSchemaDiagnostic(
  span: YamlSourceSpan,
  code: OwnSchemaDiagnosticCode,
  message: string,
  schemaPath: string,
  sourceId: string,
): ParseOrSchemaContentDiagnostic {
  return freezeSchemaDiagnostic(code, "error", message, schemaPath, { span, sourceId, schemaPath });
}

/** collection sourceのsourceIdをdefinition id、fallbackは相対file pathとして固定する。 */
function getDefinitionSourceId(value: unknown, sourcePath: string): string {
  const record = asPlainRecord(value);
  return typeof record?.id === "string" && record.id.length > 0 ? record.id : sourcePath;
}

/** localeに依存しないUTF-8 byte orderでpathとasset keyを並べる。 */
function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/** parser / Coreへ渡す前のobject判定をplain recordへ限定する。 */
function asPlainRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Readonly<Record<string, unknown>> : null;
}

/** filesystem adapterのENOENTだけをoptional入力として分類する。 */
function isNodeErrorCode(value: unknown, code: string): boolean {
  return value !== null && typeof value === "object" && "code" in value && value.code === code;
}

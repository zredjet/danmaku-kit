import { open, readdir } from "node:fs/promises";
import path from "node:path";

import type { ParseOrSchemaContentDiagnostic } from "./types.ts";
import {
  parseYamlSource,
  MAX_YAML_SOURCE_BYTES,
  type ParsedYamlSource,
  type YamlSourceSpan,
} from "./yaml-source.ts";

const COLLECTION_DIRECTORIES = Object.freeze({
  players: "players",
  stages: "stages",
  enemies: "enemies",
  bullets: "bullets",
  "player-shots": "playerShots",
  patterns: "patterns",
  paths: "paths",
} as const);

type ContentDirectoryName = keyof typeof COLLECTION_DIRECTORIES;
export type ContentCollectionName = (typeof COLLECTION_DIRECTORIES)[ContentDirectoryName];

export type ContentFileEntry = Readonly<{
  name: string;
  kind: "file" | "directory" | "other";
}>;

/** loaderが利用する最小filesystem port。単体testではin-memory実装へ差し替えられる。 */
export type ContentFileSystem = Readonly<{
  readTextFile: (filePath: string, maxBytes: number) => Promise<string>;
  readDirectory: (directoryPath: string) => Promise<readonly ContentFileEntry[]>;
}>;

export type ContentSourceContext = Readonly<{
  span: YamlSourceSpan;
  sourceId: string;
  schemaPath: string;
}>;

/** Core error adapterがschema pathや参照値から元YAMLを特定するためのindex。 */
export type ContentSourceIndex = Readonly<{
  locateSchemaPath: (schemaPath: string, referrerId?: string) => ContentSourceContext;
}>;

export type LoadContentSourceResult =
  | Readonly<{
      ok: true;
      definition: unknown;
      sourceIndex: ContentSourceIndex;
      diagnostics: readonly ParseOrSchemaContentDiagnostic[];
    }>
  | Readonly<{
      ok: false;
      diagnostics: readonly ParseOrSchemaContentDiagnostic[];
    }>;

type CollectionSource = Readonly<{
  collection: ContentCollectionName;
  source: ParsedYamlSource;
  sourceId: string;
}>;

/** Node.jsのfs/promisesをloader portへ接続するproduction filesystem adapter。 */
export function createNodeContentFileSystem(): ContentFileSystem {
  return Object.freeze({
    async readTextFile(filePath, maxBytes) {
      const handle = await open(filePath, "r");
      try {
        const buffer = Buffer.allocUnsafe(maxBytes + 1);
        let total = 0;
        while (total < buffer.length) {
          const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
          if (bytesRead === 0) {
            break;
          }
          total += bytesRead;
        }
        if (total > maxBytes) {
          throw new ContentFileTooLargeError(filePath, maxBytes);
        }
        try {
          return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, total));
        } catch {
          throw new ContentFileInvalidUtf8Error(filePath);
        }
      } finally {
        await handle.close();
      }
    },
    async readDirectory(directoryPath) {
      const entries = await readdir(directoryPath, { withFileTypes: true });
      return Object.freeze(entries.map((entry) => Object.freeze({
        name: entry.name,
        kind: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "other",
      })));
    },
  });
}

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
  };
  const { contentVersion: _contentVersion, content: _content, ...coreFields } = game;
  return { ...coreFields, content };
}

/** collection fileのUTF-8 path順を保ったまま定義配列へ投影する。 */
function collectDefinitions(
  sources: readonly CollectionSource[],
  collection: ContentCollectionName,
): readonly unknown[] {
  return sources.filter((source) => source.collection === collection).map((source) => source.source.value);
}

/** Coreのschema path規則と分割YAMLのlocal pathを対応付けるsource indexを作る。 */
function createContentSourceIndex(
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

      const contentMatch = /^content\.(players|stages|enemies|bullets|playerShots|patterns|paths)(?:\[(\d+)\])?(?:\.(.*))?$/.exec(schemaPath);
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

      const genericMatch = /^(playerShot|player|stage|enemy|bullet|pattern|path)(?:\.(.*))?$/.exec(schemaPath);
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
      diagnostics: Object.freeze([Object.freeze({
        kind: "parse",
        code,
        severity: "error",
        message: cause.message,
        path: sourcePath,
        line: 1,
        column: 1,
        schemaPath: "$",
      })]),
    });
  }
}

/** schema diagnosticをsource span付きimmutable DTOとして作る。 */
function createSchemaDiagnostic(
  span: YamlSourceSpan,
  code: string,
  message: string,
  schemaPath: string,
  sourceId: string,
): ParseOrSchemaContentDiagnostic {
  const base = {
    kind: "schema",
    code,
    severity: "error",
    message,
    path: span.path,
    line: span.line,
    column: span.column,
    schemaPath,
    sourceId,
  } as const;
  if (span.endLine !== undefined && span.endColumn !== undefined) {
    return Object.freeze({ ...base, endLine: span.endLine, endColumn: span.endColumn });
  }
  return Object.freeze(base);
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
    default: return "players";
  }
}

/** Coreのindex付きschema pathから、1 definition file内のlocal pathだけを取り出す。 */
function localSourcePath(
  schemaPath: string,
  collection: ContentCollectionName,
): readonly (string | number)[] {
  const contentPrefix = `content.${collection}`;
  if (schemaPath === contentPrefix || new RegExp(`^${contentPrefix}\\[\\d+\\]$`).test(schemaPath)) {
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
  }
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

/** Node adapterがYAMLを全量確保する前に通知する内部resource error。 */
class ContentFileTooLargeError extends Error {
  constructor(filePath: string, maxBytes: number) {
    super(`${filePath} exceeds the YAML source budget of ${maxBytes} bytes`);
    this.name = "ContentFileTooLargeError";
  }
}

/** Node adapterのfatal UTF-8 decode failureをloaderまで型付きで運ぶ内部error。 */
class ContentFileInvalidUtf8Error extends Error {
  constructor(filePath: string) {
    super(`${filePath} is not valid UTF-8`);
    this.name = "ContentFileInvalidUtf8Error";
  }
}

/** source fileが存在しないschema error用の1-based fallback位置。 */
function defaultSpan(sourcePath: string): YamlSourceSpan {
  return Object.freeze({ path: sourcePath, line: 1, column: 1 });
}

import {
  isAlias,
  isCollection,
  isNode,
  LineCounter,
  parseDocument,
  visit,
  type Document,
  type Node,
  type YAMLError,
} from "yaml";

import { createRootParseDiagnostic, defaultSpan } from "./diagnostic-factory.ts";
import type { ParseOrSchemaContentDiagnostic } from "./types.ts";

export const MAX_YAML_SOURCE_BYTES = 1_048_576;
const MAX_YAML_AST_NODES = 50_000;
const MAX_YAML_COLLECTION_DEPTH = 64;

/** YAML AST 上の1-based source span。終了位置は parser の exclusive offset を指す。 */
export type YamlSourceSpan = Readonly<{
  path: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}>;

/** parse 済み値と、schema path / scalar value から位置を引くためのsource document。 */
export type ParsedYamlSource = Readonly<{
  path: string;
  value: unknown;
  locate: (path: readonly (string | number)[]) => YamlSourceSpan;
  findScalar: (value: string, occurrence?: "first" | "last") => YamlSourceSpan | null;
}>;

/** YAML parse の成功・失敗を、例外ではなく位置付き診断で返す。 */
export type ParseYamlSourceResult =
  | Readonly<{
      ok: true;
      source: ParsedYamlSource;
      diagnostics: readonly ParseOrSchemaContentDiagnostic[];
    }>
  | Readonly<{
      ok: false;
      diagnostics: readonly ParseOrSchemaContentDiagnostic[];
    }>;

/**
 * YAML 1.2 の単一documentをparseし、plain JS値とsource lookupを生成する。
 *
 * duplicate key、複数document、非string key、aliasはparse errorとして扱う。
 * source byte数とASTのnode数・深さもtoJS前に検証し、過剰なobject graphを生成させない。
 */
export function parseYamlSource(path: string, text: string): ParseYamlSourceResult {
  if (new TextEncoder().encode(text).byteLength > MAX_YAML_SOURCE_BYTES) {
    return resourceFailure(path, defaultSpan(path), `YAML source exceeds ${MAX_YAML_SOURCE_BYTES} bytes`);
  }
  const lineCounter = new LineCounter();
  const document = parseDocument(text, {
    lineCounter,
    prettyErrors: false,
    resolveKnownTags: false,
    schema: "core",
    strict: true,
    stringKeys: true,
    uniqueKeys: true,
    version: "1.2",
  });
  const errors = document.errors.map((error) => createParseDiagnostic(path, error, lineCounter, "error"));
  if (errors.length > 0) {
    return Object.freeze({ ok: false, diagnostics: Object.freeze(errors) });
  }
  if (document.directives.yaml.explicit && document.directives.yaml.version !== "1.2") {
    return resourceFailure(
      path,
      defaultSpan(path),
      `Only YAML 1.2 is supported; received YAML ${document.directives.yaml.version}`,
      "yaml.parse.unsupported_version",
    );
  }

  const unsupportedTagErrors = document.warnings
    .filter((warning) => warning.code === "TAG_RESOLVE_FAILED")
    .map((warning) => createParseDiagnostic(path, warning, lineCounter, "error"));
  if (unsupportedTagErrors.length > 0) {
    return Object.freeze({ ok: false, diagnostics: Object.freeze(unsupportedTagErrors) });
  }

  const resourceLimit = validateAstBudget(path, document, lineCounter);
  if (resourceLimit) {
    return Object.freeze({ ok: false, diagnostics: Object.freeze([resourceLimit]) });
  }

  try {
    const value: unknown = document.toJS({ mapAsMap: false, maxAliasCount: 100 });
    const warnings = document.warnings.map((warning) =>
      createParseDiagnostic(path, warning, lineCounter, "warning")
    );
    const source = createParsedYamlSource(path, value, document, lineCounter);
    return Object.freeze({ ok: true, source, diagnostics: Object.freeze(warnings) });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "YAML value conversion failed";
    const diagnostic = createRootParseDiagnostic(path, "yaml.resource", message);
    return Object.freeze({ ok: false, diagnostics: Object.freeze([diagnostic]) });
  }
}

/** YAML ASTのalias・node数・collection深さを検証し、巨大入力を変換前に拒否する。 */
function validateAstBudget(
  path: string,
  document: Document.Parsed,
  lineCounter: LineCounter,
): ParseOrSchemaContentDiagnostic | null {
  let nodeCount = 0;
  const violation: { code: string; message: string | null; node: unknown } = {
    code: "yaml.resource",
    message: null,
    node: null,
  };
  visit(document, (_key, node, ancestors) => {
    nodeCount += 1;
    if (isAlias(node)) {
      violation.code = "yaml.parse.alias_not_supported";
      violation.message = "YAML aliases are not supported";
      violation.node = node;
      return visit.BREAK;
    }
    if (nodeCount > MAX_YAML_AST_NODES) {
      violation.message = `YAML AST exceeds ${MAX_YAML_AST_NODES} nodes`;
      violation.node = node;
      return visit.BREAK;
    }
    const collectionDepth = ancestors.filter(isCollection).length + (isCollection(node) ? 1 : 0);
    if (collectionDepth > MAX_YAML_COLLECTION_DEPTH) {
      violation.message = `YAML collections exceed depth ${MAX_YAML_COLLECTION_DEPTH}`;
      violation.node = node;
      return visit.BREAK;
    }
    return undefined;
  });
  if (violation.message === null) {
    return null;
  }
  const span = spanFromNode(path, violation.node, lineCounter) ?? defaultSpan(path);
  return createResourceDiagnostic(path, span, violation.message, violation.code);
}

/** parser error のoffsetを公開diagnosticの1-based source spanへ変換する。 */
function createParseDiagnostic(
  path: string,
  error: YAMLError,
  lineCounter: LineCounter,
  severity: "error" | "warning",
): ParseOrSchemaContentDiagnostic {
  const start = error.linePos?.[0] ?? lineCounter.linePos(error.pos[0]);
  const end = error.linePos?.[1] ?? lineCounter.linePos(error.pos[1]);
  const hasDistinctEnd = end.line > start.line || (end.line === start.line && end.col >= start.col);
  const base = {
    kind: "parse",
    code: `yaml.parse.${error.code.toLowerCase()}`,
    severity,
    message: error.message,
    path,
    line: start.line,
    column: start.col,
    schemaPath: "$",
  } as const;
  if (hasDistinctEnd) {
    return Object.freeze({ ...base, endLine: end.line, endColumn: end.col });
  }
  return Object.freeze(base);
}

/** AST lookup関数をcallerから分離し、parse済みdocumentの参照だけをclosureへ閉じ込める。 */
function createParsedYamlSource(
  path: string,
  value: unknown,
  document: Document.Parsed,
  lineCounter: LineCounter,
): ParsedYamlSource {
  const rootSpan = spanFromNode(path, document.contents, lineCounter) ?? defaultSpan(path);
  const scalarSpans = collectScalarSpans(value, document, path, lineCounter);
  return Object.freeze({
    path,
    value,
    locate(sourcePath) {
      for (let length = sourcePath.length; length >= 0; length -= 1) {
        const node = length === 0 ? document.contents : document.getIn(sourcePath.slice(0, length), true);
        const span = spanFromNode(path, node, lineCounter);
        if (span) {
          return span;
        }
      }
      return rootSpan;
    },
    findScalar(scalarValue, occurrence = "first") {
      const spans = scalarSpans.get(scalarValue);
      if (!spans || spans.length === 0) {
        return null;
      }
      return occurrence === "last" ? spans[spans.length - 1]! : spans[0]!;
    },
  });
}

/** plain JS値を辿り、参照errorから文字列値のsource位置を逆引きできるindexを作る。 */
function collectScalarSpans(
  value: unknown,
  document: Document.Parsed,
  path: string,
  lineCounter: LineCounter,
): ReadonlyMap<string, readonly YamlSourceSpan[]> {
  const mutable = new Map<string, YamlSourceSpan[]>();

  const visitValue = (current: unknown, sourcePath: readonly (string | number)[]): void => {
    if (typeof current === "string") {
      const span = spanFromNode(path, document.getIn(sourcePath, true), lineCounter);
      if (span) {
        const spans = mutable.get(current) ?? [];
        spans.push(span);
        mutable.set(current, spans);
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visitValue(item, [...sourcePath, index]));
      return;
    }
    if (isPlainRecord(current)) {
      for (const key of Object.keys(current)) {
        visitValue(current[key], [...sourcePath, key]);
      }
    }
  };

  visitValue(value, []);
  return new Map([...mutable].map(([key, spans]) => [key, Object.freeze(spans)]));
}

/** YAML node のcharacter rangeをline / columnへ変換する。 */
function spanFromNode(path: string, value: unknown, lineCounter: LineCounter): YamlSourceSpan | null {
  if (!isNode(value) || !value.range) {
    return null;
  }
  const node = value as Node;
  const start = lineCounter.linePos(node.range![0]);
  const end = lineCounter.linePos(node.range![1]);
  return Object.freeze({
    path,
    line: start.line,
    column: start.col,
    endLine: end.line,
    endColumn: end.col,
  });
}

/** toJS後の再帰走査をplain objectだけへ限定する。 */
function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** resource/version制約違反を通常のparse失敗resultへ揃える。 */
function resourceFailure(
  path: string,
  span: YamlSourceSpan,
  message: string,
  code = "yaml.resource",
): ParseYamlSourceResult {
  return Object.freeze({
    ok: false,
    diagnostics: Object.freeze([createResourceDiagnostic(path, span, message, code)]),
  });
}

/** source spanを保ったresource制約diagnosticを生成する。 */
function createResourceDiagnostic(
  path: string,
  span: YamlSourceSpan,
  message: string,
  code = "yaml.resource",
): ParseOrSchemaContentDiagnostic {
  const base = {
    kind: "parse",
    code,
    severity: "error",
    message,
    path,
    line: span.line,
    column: span.column,
    schemaPath: "$",
  } as const;
  return span.endLine === undefined || span.endColumn === undefined
    ? Object.freeze(base)
    : Object.freeze({ ...base, endLine: span.endLine, endColumn: span.endColumn });
}

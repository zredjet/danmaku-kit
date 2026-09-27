import type { ErrorCode } from "yaml";

/**
 * validate-content が自分で出す診断の code。Core の検証が返す code（Core の `CoreErrorCode` と warning の code）は、そのまま診断の
 * `code` に入れる。`docs/content-authoring/error-guide.md` はこの一覧と Core の code を見出しに持つ（`tests/error-guide.test.ts`）。
 */
export const VALIDATE_CONTENT_DIAGNOSTIC_CODES = Object.freeze([
  "assetManifest.fallbackCycle",
  "assetManifest.invalidFallback",
  "assetManifest.invalidShape",
  "assetManifest.unknownField",
  "content.assetManifestNotFound",
  "content.unknownEntry",
  "content.unsupportedEntry",
  "tool.invalidArguments",
  "tool.invalidDiagnostic",
  "tool.invalidInput",
  "tool.invalidOutput",
  "tool.readFailed",
  "tool.unexpected",
  "yaml.parse.alias_not_supported",
  "yaml.parse.invalid_utf8",
  "yaml.parse.unsupported_version",
  "yaml.resource",
] as const);

/** YAML parser（`yaml` package）の error の code を小文字にした診断の code。error guide は `yaml.parse.*` にまとめる。 */
export type YamlParserDiagnosticCode = `yaml.parse.${Lowercase<ErrorCode>}`;

/** validate-content が自分で出す診断の code。 */
export type ValidateContentDiagnosticCode = (typeof VALIDATE_CONTENT_DIAGNOSTIC_CODES)[number] | YamlParserDiagnosticCode;

/** validation を完了できなかった tool error の code。 */
export type ValidateContentToolDiagnosticCode = Extract<ValidateContentDiagnosticCode, `tool.${string}`>;

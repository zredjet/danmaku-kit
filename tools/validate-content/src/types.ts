/** validate-content が扱う診断の重要度。warning と info は初期段階では非 blocking とする。 */
export type ContentDiagnosticSeverity = "error" | "warning" | "info";

/** 必須 field の組を判別する診断種別。 */
export type ContentDiagnosticKind = "parse" | "schema" | "reference" | "featureGate" | "tool";

type ContentDiagnosticBase = Readonly<{
  code: string;
  severity: ContentDiagnosticSeverity;
  message: string;
}>;

type DiagnosticSourceEnd =
  | Readonly<{ endLine?: never; endColumn?: never }>
  | Readonly<{ endLine: number; endColumn: number }>;

type DiagnosticSourceSpan = Readonly<{
  path: string;
  line: number;
  column: number;
}> & DiagnosticSourceEnd;

/** YAML parse error と schema error。schema path と開始位置を必須にする。 */
export type ParseOrSchemaContentDiagnostic = ContentDiagnosticBase & DiagnosticSourceSpan & Readonly<{
  kind: "parse" | "schema";
  schemaPath: string;
  sourceId?: string;
}>;

/** cross-file reference error。参照元と解決できない target ID を必須にする。 */
export type ReferenceContentDiagnostic = ContentDiagnosticBase & DiagnosticSourceSpan & Readonly<{
  kind: "reference";
  referrerId: string;
  targetId: string;
  schemaPath?: string;
  sourceId?: string;
}>;

/** feature gate error。source ID と schema path を必須にする。 */
export type FeatureGateContentDiagnostic = ContentDiagnosticBase & Readonly<{
  kind: "featureGate";
  sourceId: string;
  schemaPath: string;
}>;

/** file read や予期しない例外など、source span を持たない tool/runtime error。 */
export type ToolContentDiagnostic = ContentDiagnosticBase & Readonly<{
  kind: "tool";
}>;

/**
 * parser、schema validation、reference validation が共有する診断 DTO。
 *
 * `kind` ごとの必須 field を union で固定し、column だけを持つ不完全な位置情報や、
 * schema path / reference ID が欠落した診断を公開出力へ入れない。
 */
export type ContentDiagnostic =
  | ParseOrSchemaContentDiagnostic
  | ReferenceContentDiagnostic
  | FeatureGateContentDiagnostic
  | ToolContentDiagnostic;

/** schema / reference validation factory が受け付ける、tool error を除いた診断。 */
export type ValidationContentDiagnostic = Exclude<ContentDiagnostic, ToolContentDiagnostic>;

/** severity ごとの診断件数。 */
export type ContentDiagnosticSummary = Readonly<{
  errors: number;
  warnings: number;
  infos: number;
}>;

type ValidateContentJsonOutputBase = Readonly<{
  schemaVersion: "1";
  contentRoot: string;
  diagnostics: readonly ContentDiagnostic[];
  summary: ContentDiagnosticSummary;
}>;

/** CI / editor integration が読み取る validate-content JSON output。 */
export type ValidateContentJsonOutput =
  | (ValidateContentJsonOutputBase & Readonly<{ ok: true }>)
  | (ValidateContentJsonOutputBase & Readonly<{ ok: false }>);

/** CLI process が返す終了コード。 */
export type ValidateContentExitCode = 0 | 1 | 2;

/** exit code と output の成功状態を一致させた実行結果。 */
export type ValidateContentRunResult =
  | Readonly<{ exitCode: 0; output: ValidateContentJsonOutput & Readonly<{ ok: true }> }>
  | Readonly<{ exitCode: 1; output: ValidateContentJsonOutput & Readonly<{ ok: false }> }>
  | Readonly<{ exitCode: 2; output: ValidateContentJsonOutput & Readonly<{ ok: false }> }>;

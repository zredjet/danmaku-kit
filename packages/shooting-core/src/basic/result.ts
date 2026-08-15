/**
 * Core 全体で共有するエラーコード。
 *
 * feature module や validation が `core.ts` に依存しないよう、失敗契約だけを
 * 独立した小さなモジュールに置く。
 */
export type CoreErrorCode =
  | "asset.duplicate"
  | "asset.invalidKey"
  | "asset.notFound"
  | "bullet.notFound"
  | "definition.invalidConstraint"
  | "definition.invalidShape"
  | "definition.unknownField"
  | "difficulty.notSupported"
  | "enemy.notFound"
  | "entityAllocator.invalidState"
  | "feature.duplicate"
  | "feature.unknown"
  | "feature.unsupported"
  | "id.duplicate"
  | "id.invalidNamespace"
  | "input.invalidShape"
  | "input.tickMismatch"
  | "path.notFound"
  | "pattern.notFound"
  | "player.defaultNotFound"
  | "player.notFound"
  | "playerShot.notFound"
  | "prng.invalidState"
  | "schema.unsupportedVersion"
  | "state.contentMismatch"
  | "state.coreVersionMismatch"
  | "state.featureMismatch"
  | "state.inputFormatVersionMismatch"
  | "state.invalidShape"
  | "state.prngInvalid"
  | "state.registryInvalid"
  | "state.schemaVersionMismatch"
  | "state.stateHashVersionMismatch"
  | "stageSession.fatal"
  | "stage.notFound"
  | "startStage.invalidShape"
  | "testHook.failure"
  | "timeline.invalidOrder"
  | "timeline.tooManySpawnsPerTick"
  | "timeline.tooManySteps";

/**
 * Core が返す検証・実行エラー。
 *
 * content validation は renderer や filesystem を知らないため、実ファイル位置ではなく
 * schema path と参照関係だけを optional context として返す。authoring tool はこの情報を
 * 分割 content の source index へ接続し、推測に頼らず診断位置を決定できる。
 */
export type CoreError = {
  code: CoreErrorCode;
  message: string;
  schemaPath?: string;
  referrerId?: string;
  targetId?: string;
};

/**
 * 実行は継続できるが、content 制作者へ知らせたい注意情報。
 *
 * warning code は feature module 側で増えやすいため、現時点では string のままにする。
 */
export type CoreWarning = {
  code: string;
  message: string;
};

/**
 * Core API の標準的な戻り値。
 *
 * public API は原則として throw せず、成功値かエラー配列を返す。
 */
export type CoreResult<T> =
  | { ok: true; value: T; warnings: readonly CoreWarning[] }
  | { ok: false; errors: readonly CoreError[] };

/** 成功値を runtime immutable な `CoreResult` として返す。 */
export function okResult<T>(value: T, warnings: readonly CoreWarning[] = []): CoreResult<T> {
  return Object.freeze({
    ok: true,
    value,
    warnings: freezeWarnings(warnings),
  });
}

/** 複数エラーを runtime immutable な `CoreResult` として返す。 */
export function errorResult<T>(errors: readonly CoreError[]): CoreResult<T> {
  return Object.freeze({
    ok: false,
    errors: freezeErrors(errors),
  });
}

/** 単一エラーを `CoreResult` の失敗として返すための小さな helper。 */
export function coreError<T>(code: CoreErrorCode, message: string): CoreResult<T> {
  return errorResult([{ code, message }]);
}

function freezeErrors(errors: readonly CoreError[]): readonly CoreError[] {
  return Object.freeze(errors.map((error) => Object.freeze({
    code: error.code,
    message: error.message,
    ...(error.schemaPath === undefined ? {} : { schemaPath: error.schemaPath }),
    ...(error.referrerId === undefined ? {} : { referrerId: error.referrerId }),
    ...(error.targetId === undefined ? {} : { targetId: error.targetId }),
  })));
}

function freezeWarnings(warnings: readonly CoreWarning[]): readonly CoreWarning[] {
  return Object.freeze(warnings.map((warning) => Object.freeze({ code: warning.code, message: warning.message })));
}

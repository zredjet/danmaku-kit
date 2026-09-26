import type { CoreError } from "../../result.ts";

/**
 * 1つのcontent definitionを検証し、その間に生成されたerrorへ配列indexとsource IDを付ける。
 * validator本体の読みやすいlocal pathは維持し、public error境界で一意なschema pathへ展開する。
 */
export function validateContentItem(
  contentPath: string,
  localPrefix: string,
  definition: Record<string, unknown>,
  errors: CoreError[],
  validate: () => void,
): void {
  const errorStart = errors.length;
  validate();
  const referrerId = typeof definition.id === "string" && definition.id.length > 0
    ? definition.id
    : undefined;
  addSchemaContext(errors, errorStart, contentPath, localPrefix, referrerId);
}

/** error messageのlocal pathを、呼び出し元が持つ一意なcontent pathへ変換する。 */
export function addSchemaContext(
  errors: CoreError[],
  errorStart: number,
  contentPath: string,
  localPrefix: string,
  referrerId?: string,
): void {
  for (let index = errorStart; index < errors.length; index += 1) {
    const error = errors[index]!;
    const localPath = error.schemaPath ?? inferValidationPath(error.message);
    const schemaPath = remapSchemaPath(localPath, localPrefix, contentPath) ?? contentPath;
    errors[index] = {
      ...error,
      schemaPath,
      ...(error.referrerId !== undefined ? {} : referrerId === undefined ? {} : { referrerId }),
    };
  }
}

/** Core validation messageの先頭から、既存のlocal schema path表現だけを抽出する。 */
function inferValidationPath(message: string): string | null {
  const unknownField = /^Unknown field at (.+)$/.exec(message);
  if (unknownField) {
    return unknownField[1]!;
  }
  return /^([A-Za-z][A-Za-z0-9.[\]]*) (?:must|exceeds|is )/.exec(message)?.[1] ?? null;
}

/** local prefix以下のpathを、index付きcontent path以下へ付け替える。 */
function remapSchemaPath(localPath: string | null, localPrefix: string, contentPath: string): string | null {
  if (localPath === null) {
    return null;
  }
  if (localPath === localPrefix) {
    return contentPath;
  }
  return localPath.startsWith(`${localPrefix}.`) || localPath.startsWith(`${localPrefix}[`)
    ? `${contentPath}${localPath.slice(localPrefix.length)}`
    : localPath;
}

import path from "node:path";
import ts from "typescript";

/** module を specifier で読み込む記述の種類。triple-slash reference directive は含めない。 */
export const MODULE_IMPORT_KINDS = Object.freeze(["import", "export", "importEquals", "dynamicImport", "importType"]);

/**
 * source が module を読み込む記述を、種類と specifier の組で出現順に返す。
 *
 * triple-slash reference directive、型だけのものを含む import / export 宣言、`import x = require()`、dynamic `import()`、
 * 型位置の `import("...")` を対象にする。specifier が文字列 literal でない dynamic import は `specifier: null` とする。
 */
export function collectModuleReferences(file, sourceText) {
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const references = [
    ...sourceFile.referencedFiles.map((reference) => ({ kind: "referencePath", specifier: reference.fileName })),
    ...sourceFile.typeReferenceDirectives.map((reference) => ({ kind: "referenceTypes", specifier: reference.fileName })),
    ...sourceFile.libReferenceDirectives.map((reference) => ({ kind: "referenceLib", specifier: reference.fileName })),
  ];

  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      references.push({ kind: ts.isImportDeclaration(node) ? "import" : "export", specifier: stringLiteralText(node.moduleSpecifier) });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      references.push({ kind: "importEquals", specifier: stringLiteralText(node.moduleReference.expression) });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      references.push({ kind: "dynamicImport", specifier: stringLiteralText(node.arguments[0]) });
    } else if (ts.isImportTypeNode(node)) {
      const literal = ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined;
      references.push({ kind: "importType", specifier: stringLiteralText(literal) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return references;
}

function stringLiteralText(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

/**
 * `sourceRoot` 配下の module を相対 path で読む記述か判定する。
 *
 * bare specifier（npm package）、`node:`、`sourceRoot` の外へ出る相対 path、非 literal の dynamic import は false にする。
 * triple-slash reference directive は `types` / `lib` で node や DOM の型を持ち込めるため、種類を問わず false にする。
 */
export function isRelativeReferenceInside(file, reference, sourceRoot) {
  if (!MODULE_IMPORT_KINDS.includes(reference.kind)) {
    return false;
  }
  if (reference.specifier === null || !(reference.specifier.startsWith("./") || reference.specifier.startsWith("../"))) {
    return false;
  }
  return isPathInside(sourceRoot, path.resolve(path.dirname(file), reference.specifier));
}

/** `candidate` が `root` 自身か、その配下の path なら true を返す。`..notes` のように `..` で始まる名前は配下として扱う。 */
export function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

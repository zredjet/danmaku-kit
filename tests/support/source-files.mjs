import { readdir } from "node:fs/promises";
import path from "node:path";

/** directory 以下の `.ts` file を再帰的に列挙し、path 順に返す。 */
export async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTypeScriptFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

/**
 * `*.test.ts` と test 専用 helper の `test-support/` を package runtime source から除く。
 *
 * checkout 先の絶対 path に同名 directory があっても誤判定しないよう、`sourceRoot` からの相対 path で判定する。
 */
export function isTestCodeFile(sourceRoot, file) {
  return file.endsWith(".test.ts") || path.relative(sourceRoot, file).split(path.sep).includes("test-support");
}

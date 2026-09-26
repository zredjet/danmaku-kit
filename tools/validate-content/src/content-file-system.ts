import { open, readdir } from "node:fs/promises";

export type ContentFileEntry = Readonly<{
  name: string;
  kind: "file" | "directory" | "other";
}>;

/** loaderが利用する最小filesystem port。単体testではin-memory実装へ差し替えられる。 */
export type ContentFileSystem = Readonly<{
  readTextFile: (filePath: string, maxBytes: number) => Promise<string>;
  readDirectory: (directoryPath: string) => Promise<readonly ContentFileEntry[]>;
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

/** Node adapterがYAMLを全量確保する前に通知する内部resource error。 */
export class ContentFileTooLargeError extends Error {
  constructor(filePath: string, maxBytes: number) {
    super(`${filePath} exceeds the YAML source budget of ${maxBytes} bytes`);
    this.name = "ContentFileTooLargeError";
  }
}

/** Node adapterのfatal UTF-8 decode failureをloaderまで型付きで運ぶ内部error。 */
export class ContentFileInvalidUtf8Error extends Error {
  constructor(filePath: string) {
    super(`${filePath} is not valid UTF-8`);
    this.name = "ContentFileInvalidUtf8Error";
  }
}

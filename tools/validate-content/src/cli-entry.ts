#!/usr/bin/env node

import { runValidateContentCli } from "./cli.ts";

const exitCode = await runValidateContentCli(
  process.argv.slice(2),
  Object.freeze({
    async writeStdout(text: string) {
      await writeStream(process.stdout, text);
    },
    async writeStderr(text: string) {
      await writeStream(process.stderr, text);
    },
  }),
);

process.exitCode = exitCode;

/** Node streamのcallback errorとerror eventを1つのPromiseへ正規化する。 */
function writeStream(stream: NodeJS.WriteStream, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    stream.once("error", onError);
    try {
      stream.write(text, (error) => {
        if (error) {
          reject(error);
          // Writableはcallbackの後にerror eventをemitできるため、そのturnまではlistenerを残す。
          setImmediate(() => stream.off("error", onError));
          return;
        }
        stream.off("error", onError);
        resolve();
      });
    } catch (cause) {
      stream.off("error", onError);
      reject(cause);
    }
  });
}

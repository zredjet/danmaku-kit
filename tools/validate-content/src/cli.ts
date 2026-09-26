import { formatValidateContentHuman, formatValidateContentJson } from "./output-format.ts";
import { createToolErrorRunResult } from "./output.ts";
import {
  loadValidatedGameDefinitionWith,
  safeErrorMessage,
  type GameDefinitionLoaderDependencies,
} from "./game-definition-loader.ts";
import type { ValidateContentRunResult } from "./types.ts";

export type ValidateContentFormat = "human" | "json";

export type ValidateContentCliOptions = Readonly<{
  gameDefinitionPath: string;
  contentRoot: string;
  format: ValidateContentFormat;
}>;

export type ValidateContentCliIo = Readonly<{
  writeStdout: (text: string) => void | Promise<void>;
  writeStderr: (text: string) => void | Promise<void>;
}>;

type ParseCliArgumentsResult =
  | Readonly<{ ok: true; kind: "help" }>
  | Readonly<{ ok: true; kind: "run"; options: ValidateContentCliOptions }>
  | Readonly<{ ok: false; message: string; format: ValidateContentFormat }>;

export const VALIDATE_CONTENT_USAGE = [
  "Usage: validate-content --game-definition <file.yaml> --content-root <directory> [--format human|json]",
  "",
  "Options:",
  "  --game-definition <path>  Title metadata YAML file",
  "  --content-root <path>      Root directory containing split content YAML",
  "  --format <human|json>      Output format (default: human)",
  "  --help                     Show this help",
  "",
].join("\n");

/**
 * validate-content CLIを、process globalへ直接依存しない形で実行する。
 *
 * help以外の結果はvalidation/tool errorを問わずstdoutへ選択formatで1回出力する。
 * stderrはentry point自身が出力不能になった最終fallbackだけに予約する。
 */
export async function runValidateContentCli(
  argv: readonly string[],
  io: ValidateContentCliIo,
  dependencies: GameDefinitionLoaderDependencies = {},
): Promise<number> {
  const parsed = parseValidateContentArguments(argv);
  if (!parsed.ok) {
    const result = createToolErrorRunResult("", "tool.invalidArguments", parsed.message);
    return await writeCliOutput(io, formatResult(result, parsed.format), result.exitCode);
  }
  if (parsed.kind === "help") {
    return await writeCliOutput(io, VALIDATE_CONTENT_USAGE, 0);
  }

  const { options } = parsed;
  const { runResult } = await loadValidatedGameDefinitionWith(options, dependencies);
  return await writeCliOutput(io, formatResult(runResult, options.format), runResult.exitCode);
}

/** CLI argvを重複・未知optionを拒否する厳密な設定値へ変換する。 */
export function parseValidateContentArguments(argv: readonly string[]): ParseCliArgumentsResult {
  if (argv.length === 1 && argv[0] === "--help") {
    return Object.freeze({ ok: true, kind: "help" });
  }

  const errorFormat = detectRequestedFormat(argv);
  let gameDefinitionPath: string | undefined;
  let contentRoot: string | undefined;
  let format: ValidateContentFormat = "human";
  const seen = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (option !== "--game-definition" && option !== "--content-root" && option !== "--format") {
      return argumentError(`Unknown option: ${option}`, errorFormat);
    }
    if (seen.has(option)) {
      return argumentError(`Duplicate option: ${option}`, errorFormat);
    }
    seen.add(option);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return argumentError(`Missing value for ${option}`, errorFormat);
    }
    index += 1;
    if (option === "--game-definition") {
      gameDefinitionPath = value;
    } else if (option === "--content-root") {
      contentRoot = value;
    } else if (value === "human" || value === "json") {
      format = value;
    } else {
      return argumentError(`Unsupported format: ${value}`, errorFormat);
    }
  }

  if (!gameDefinitionPath) {
    return argumentError("--game-definition is required", errorFormat);
  }
  if (!contentRoot) {
    return argumentError("--content-root is required", errorFormat);
  }
  return Object.freeze({
    ok: true,
    kind: "run",
    options: Object.freeze({ gameDefinitionPath, contentRoot, format }),
  });
}

/** run resultを選択された公開formatterへ接続する。 */
function formatResult(result: ValidateContentRunResult, format: ValidateContentFormat): string {
  return format === "json"
    ? formatValidateContentJson(result.output)
    : formatValidateContentHuman(result.output);
}

/** stdoutへ完全なresultを書けない場合だけ、短いfallbackをstderrへ出してexit code 2にする。 */
async function writeCliOutput(io: ValidateContentCliIo, text: string, exitCode: number): Promise<number> {
  try {
    await io.writeStdout(text);
    return exitCode;
  } catch (cause) {
    try {
      await io.writeStderr(`validate-content could not write stdout: ${escapeEmergencyText(safeErrorMessage(cause))}\n`);
    } catch {
      // stderrも利用不能な場合は出力を諦め、process側へexit code 2だけを返す。
    }
    return 2;
  }
}

/** parser errorへ、そこまでに確定したformatを保持する。 */
function argumentError(message: string, format: ValidateContentFormat): ParseCliArgumentsResult {
  return Object.freeze({ ok: false, message, format });
}

/** malformed argvでも、有効なJSON指定の位置に依存せずmachine-readable errorを返す。 */
function detectRequestedFormat(argv: readonly string[]): ValidateContentFormat {
  for (let index = 0; index < argv.length - 1; index += 1) {
    if (argv[index] === "--format" && argv[index + 1] === "json") {
      return "json";
    }
  }
  return "human";
}

/** emergency stderrを1行に保ち、terminal control sequenceを無効化する。 */
function escapeEmergencyText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, (character) =>
    `\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`
  );
}

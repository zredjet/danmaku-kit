import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

type GoldenCaseName =
  | "valid"
  | "parse-error"
  | "schema-error"
  | "reference-error"
  | "budget-error"
  | "pattern-error"
  | "pattern-warning"
  | "pattern-silent"
  | "pattern-budget-error"
  | "pattern-repeat-error"
  | "pattern-difficulty-warning"
  | "pickup-disabled-warning"
  | "pickup-reference-error"
  | "pickup-schema-error"
  | "asset-manifest-error"
  | "game-definition-error"
  | "argument-error";
type GoldenFormat = "json" | "human";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixtureRoot = path.join(repositoryRoot, "fixtures");
const sourceGameDefinition = path.join(fixtureRoot, "game-definition.minimum.yaml");
const sourceContentRoot = path.join(fixtureRoot, "content-minimum");
const goldenRoot = path.join(fixtureRoot, "validate-content-golden");
const cliPath = fileURLToPath(new URL("./cli-entry.ts", import.meta.url));
const updateGoldens = process.env.UPDATE_VALIDATE_CONTENT_GOLDENS === "1";
const generatedGoldens = new Map<string, string>();
const CLI_TIMEOUT_MILLISECONDS = 10_000;

const GOLDEN_CASES: readonly Readonly<{
  name: GoldenCaseName;
  exitCode: 0 | 1 | 2;
}>[] = Object.freeze([
  Object.freeze({ name: "valid", exitCode: 0 }),
  Object.freeze({ name: "parse-error", exitCode: 1 }),
  Object.freeze({ name: "schema-error", exitCode: 1 }),
  Object.freeze({ name: "reference-error", exitCode: 1 }),
  Object.freeze({ name: "budget-error", exitCode: 1 }),
  Object.freeze({ name: "pattern-error", exitCode: 1 }),
  Object.freeze({ name: "pattern-warning", exitCode: 0 }),
  Object.freeze({ name: "pattern-silent", exitCode: 0 }),
  Object.freeze({ name: "pattern-budget-error", exitCode: 1 }),
  Object.freeze({ name: "pattern-repeat-error", exitCode: 1 }),
  Object.freeze({ name: "pattern-difficulty-warning", exitCode: 0 }),
  Object.freeze({ name: "pickup-disabled-warning", exitCode: 0 }),
  Object.freeze({ name: "pickup-reference-error", exitCode: 1 }),
  Object.freeze({ name: "pickup-schema-error", exitCode: 1 }),
  Object.freeze({ name: "asset-manifest-error", exitCode: 1 }),
  Object.freeze({ name: "game-definition-error", exitCode: 1 }),
  Object.freeze({ name: "argument-error", exitCode: 2 }),
]);

for (const goldenCase of GOLDEN_CASES) {
  for (const format of ["json", "human"] as const) {
    test(`locks ${goldenCase.name} ${format} CLI output`, async (context) => {
      const fixture = await prepareCaseFixture(context, goldenCase.name);
      const processResult = spawnSync(
        process.execPath,
        ["--experimental-strip-types", cliPath, ...createCliArguments(goldenCase.name, format, fixture)],
        {
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
          timeout: CLI_TIMEOUT_MILLISECONDS,
          windowsHide: true,
        },
      );

      assert.equal(processResult.error, undefined, processResult.error?.message);
      assert.equal(processResult.signal, null);
      assert.equal(processResult.status, goldenCase.exitCode, processResult.stderr);
      assert.equal(processResult.stderr, "");
      const actual = normalizeOutput(processResult.stdout, format, goldenCase.name, fixture);
      const goldenName = `${goldenCase.name}.${format}`;
      if (updateGoldens) {
        assert.equal(generatedGoldens.has(goldenName), false, `${goldenName} must be generated once`);
        generatedGoldens.set(goldenName, actual);
      } else {
        const expected = await readFile(path.join(goldenRoot, goldenName), "utf8");
        assert.equal(actual, expected);
      }
    });
  }
}

after(async () => {
  if (!updateGoldens) {
    return;
  }
  assert.equal(generatedGoldens.size, GOLDEN_CASES.length * 2, "all golden cases must pass before update");
  await replaceGoldenDirectory(generatedGoldens);
});

const SILENT_PATTERN_YAML = "id: pattern.scout_three_way\nversion: 1\nsteps:\n  - wait: 20\n  - loop: 0\n";
const BURST_PATTERN_YAML = [
  "id: pattern.scout_three_way",
  "version: 1",
  "steps:",
  ...Array.from({ length: 32 }, () => "  - fire: { bullet: bullet.red_small, angleDeg: 90, speed: 2, fan: { count: 64, spreadDeg: 63 } }"),
  "  - wait: 60",
  "",
].join("\n");

const REPEAT_ERROR_PATTERN_YAML = [
  "id: pattern.scout_three_way",
  "version: 1",
  "steps:",
  "  - repeat:",
  "      count: 3",
  "      steps:",
  "        - fire:",
  "            bullet: bullet.red_small",
  "            angleDeg: 90",
  "            radial:",
  "              count: 7",
  "            speed: 2",
  "        - wait: 10",
  "  - loop: 0",
  "",
].join("\n");

const DIFFICULTY_BRANCH_PATTERN_YAML = [
  "id: pattern.scout_three_way",
  "version: 1",
  "steps:",
  "  - wait: 20",
  "  - if:",
  "      difficulty: [hard]",
  "      then:",
  "        - fire:",
  "            bullet: bullet.red_small",
  "            aim: player",
  "            fan:",
  "              count: 5",
  "              spreadDeg: 40",
  "            speed: 2.4",
  "      else:",
  "        - fire:",
  "            bullet: bullet.red_small",
  "            aim: player",
  "            speed: 2.4",
  "  - wait: 50",
  "  - loop: 0",
  "",
].join("\n");

const SCORE_PICKUP_YAML = [
  "id: pickup.score_small",
  "version: 1",
  "asset: pickup.score_small",
  "score: 100",
  "collectRadius: 10",
  "velocity:",
  "  x: 0",
  "  y: 1.5",
  "",
].join("\n");

/** 静的minimum fixtureを隔離領域へ複製し、各失敗ケースの差分だけを適用する。 */
async function prepareCaseFixture(
  context: Readonly<{ after: (callback: () => Promise<void>) => void }>,
  name: GoldenCaseName,
): Promise<Readonly<{ gameDefinitionPath: string; contentRoot: string }>> {
  const caseRoot = await mkdtemp(path.join(tmpdir(), `validate-content-${name}-`));
  context.after(async () => rm(caseRoot, { recursive: true, force: true }));
  const gameDefinitionPath = path.join(caseRoot, "game-definition.yaml");
  const contentRoot = path.join(caseRoot, "content");
  await copyFile(sourceGameDefinition, gameDefinitionPath);
  await cp(sourceContentRoot, contentRoot, { recursive: true, errorOnExist: true });

  if (name === "parse-error") {
    const stagePath = path.join(contentRoot, "stages", "stage_01.yaml");
    const stage = await readFile(stagePath, "utf8");
    await writeFile(stagePath, `${stage}id: stage.duplicate\n`, "utf8");
  } else if (name === "schema-error") {
    await replaceFixtureText(contentRoot, "players/default.yaml", "  speed: 4", "  speed: fast");
  } else if (name === "reference-error") {
    await replaceFixtureText(contentRoot, "stages/stage_01.yaml", "      enemy: enemy.scout", "      enemy: enemy.missing");
  } else if (name === "budget-error") {
    await replaceFixtureText(contentRoot, "players/default.yaml", "  speed: 4", "  speed: 17");
  } else if (name === "pattern-error") {
    await replaceFixtureText(contentRoot, "patterns/scout_three_way.yaml", "        spreadDeg: 24\n", "        spreadDeg: 24.1\n");
  } else if (name === "pattern-warning") {
    // loop より後ろの step は spawn からどの run でも実行されない。
    await replaceFixtureText(contentRoot, "patterns/scout_three_way.yaml", "  - loop: 0\n", "  - loop: 0\n  - wait: 5\n");
  } else if (name === "pattern-silent") {
    // 待つだけで一度も撃たない pattern。
    await writeFile(path.join(contentRoot, "patterns", "scout_three_way.yaml"), SILENT_PATTERN_YAML, "utf8");
  } else if (name === "pattern-budget-error") {
    // fan 64 発を 32 回続けて撃ち、1 tick に 2,048 発になる pattern。
    await writeFile(path.join(contentRoot, "patterns", "scout_three_way.yaml"), BURST_PATTERN_YAML, "utf8");
  } else if (name === "pattern-repeat-error") {
    // repeat の中の fire の radial.count が 1 周を 0.25° 刻みに等分しない。
    await writeFile(path.join(contentRoot, "patterns", "scout_three_way.yaml"), REPEAT_ERROR_PATTERN_YAML, "utf8");
  } else if (name === "pattern-difficulty-warning") {
    // normal だけの stage が使う pattern の `if` が hard を挙げる。
    await writeFile(path.join(contentRoot, "patterns", "scout_three_way.yaml"), DIFFICULTY_BRANCH_PATTERN_YAML, "utf8");
    await replaceFixtureText(contentRoot, "stages/stage_01.yaml", "      pattern: pattern.basic\n", "      pattern: pattern.scout_three_way\n");
  } else if (name === "pickup-disabled-warning" || name === "pickup-reference-error" || name === "pickup-schema-error") {
    await mkdir(path.join(contentRoot, "pickups"));
    await writeFile(path.join(contentRoot, "pickups", "score_small.yaml"), SCORE_PICKUP_YAML, "utf8");
    await replaceFixtureText(
      contentRoot,
      "assets/manifest.yaml",
      "    path: shot.png\n    required: true\n    usage: gameplay\n",
      "    path: shot.png\n    required: true\n    usage: gameplay\n  pickup.score_small:\n    type: sprite\n    path: pickup.png\n    required: true\n    usage: gameplay\n",
    );
    if (name === "pickup-schema-error") {
      // 有効な pickup の collectRadius が 0。
      await replaceFileText(gameDefinitionPath, "game-definition.yaml", "enabledFeatures: []", "enabledFeatures: [pickup]");
      await replaceFixtureText(contentRoot, "pickups/score_small.yaml", "collectRadius: 10\n", "collectRadius: 0\n");
    }
    if (name === "pickup-reference-error") {
      // pickup を有効にした content の enemy が、定義のない pickup を落とす。
      await replaceFileText(gameDefinitionPath, "game-definition.yaml", "enabledFeatures: []", "enabledFeatures: [pickup]");
      await replaceFixtureText(contentRoot, "enemies/scout.yaml", "score: 100\n", "score: 100\ndrops:\n  - pickup: pickup.score_large\n    count: 2\n");
    }
  } else if (name === "asset-manifest-error") {
    await replaceFixtureText(contentRoot, "assets/manifest.yaml", "    path: shot.png\n", "    path: /shot.png\n");
  } else if (name === "game-definition-error") {
    await replaceFileText(
      gameDefinitionPath,
      "game-definition.yaml",
      'schemaVersion: "1"',
      'schemaVersion: "2"',
    );
  }
  return Object.freeze({ gameDefinitionPath, contentRoot });
}

/** caseごとのargvを組み立て、tool errorも同じ実process境界へ通す。 */
function createCliArguments(
  name: GoldenCaseName,
  format: GoldenFormat,
  fixture: Readonly<{ gameDefinitionPath: string; contentRoot: string }>,
): readonly string[] {
  if (name === "argument-error") {
    return format === "json" ? ["--wat", "--format", "json"] : ["--wat"];
  }
  return [
    "--game-definition", fixture.gameDefinitionPath,
    "--content-root", fixture.contentRoot,
    "--format", format,
  ];
}

/** fixtureの意図した1箇所だけを置換し、変更前契約がずれた場合はtest setupを失敗させる。 */
async function replaceFixtureText(
  contentRoot: string,
  relativePath: string,
  before: string,
  after: string,
): Promise<void> {
  const filePath = path.join(contentRoot, relativePath);
  await replaceFileText(filePath, relativePath, before, after);
}

/** 任意のfixture fileを1箇所だけ置換し、基準fixtureのdriftを早期検出する。 */
async function replaceFileText(
  filePath: string,
  displayPath: string,
  before: string,
  after: string,
): Promise<void> {
  const source = await readFile(filePath, "utf8");
  assert.equal(source.split(before).length, 2, `${displayPath} must contain one ${before}`);
  await writeFile(filePath, source.replace(before, after), "utf8");
}

/** 一時directoryに依存するpathだけをplaceholderへ変え、formatterの残りのbytesをgolden化する。 */
function normalizeOutput(
  output: string,
  format: GoldenFormat,
  name: GoldenCaseName,
  fixture: Readonly<{ gameDefinitionPath: string; contentRoot: string }>,
): string {
  const diagnosticPath = expectedDiagnosticPath(name, fixture);
  if (format === "human") {
    if (name === "valid") {
      return replaceExactOccurrences(output, fixture.contentRoot, "<content-root>", 1);
    }
    if (diagnosticPath === undefined) {
      return output;
    }
    return replaceExactOccurrences(
      output,
      diagnosticPath,
      normalizeDiagnosticPath(diagnosticPath, fixture),
      1,
    );
  }

  const parsed = JSON.parse(output) as Record<string, unknown>;
  const expectedContentRoot = name === "argument-error" ? "" : fixture.contentRoot;
  assert.equal(parsed.contentRoot, expectedContentRoot);
  assert.ok(Array.isArray(parsed.diagnostics));
  const actualDiagnosticPaths = parsed.diagnostics.flatMap((diagnostic) =>
    isRecord(diagnostic) && typeof diagnostic.path === "string" ? [diagnostic.path] : []
  );
  assert.deepEqual(actualDiagnosticPaths, diagnosticPath === undefined ? [] : [diagnosticPath]);

  let normalized = output;
  if (name !== "argument-error") {
    normalized = replaceJsonString(normalized, fixture.contentRoot, "<content-root>", 1);
  }
  if (diagnosticPath !== undefined) {
    normalized = replaceJsonString(
      normalized,
      diagnosticPath,
      normalizeDiagnosticPath(diagnosticPath, fixture),
      1,
    );
  }
  return normalized;
}

/** caseごとに期待する唯一のpositioned diagnostic sourceを返す。 */
function expectedDiagnosticPath(
  name: GoldenCaseName,
  fixture: Readonly<{ gameDefinitionPath: string; contentRoot: string }>,
): string | undefined {
  if (name === "parse-error" || name === "reference-error") {
    return path.join(fixture.contentRoot, "stages", "stage_01.yaml");
  }
  if (name === "schema-error" || name === "budget-error") {
    return path.join(fixture.contentRoot, "players", "default.yaml");
  }
  if (name.startsWith("pattern-")) {
    return path.join(fixture.contentRoot, "patterns", "scout_three_way.yaml");
  }
  if (name === "pickup-reference-error") {
    return path.join(fixture.contentRoot, "enemies", "scout.yaml");
  }
  if (name === "pickup-schema-error") {
    return path.join(fixture.contentRoot, "pickups", "score_small.yaml");
  }
  if (name === "asset-manifest-error") {
    return path.join(fixture.contentRoot, "assets", "manifest.yaml");
  }
  if (name === "game-definition-error") {
    return fixture.gameDefinitionPath;
  }
  return undefined;
}

/** JSON stringのescapeを保ったまま、指定した動的値だけをplaceholderへ置換する。 */
function replaceJsonString(
  output: string,
  actual: string,
  replacement: string,
  expectedCount: number,
): string {
  return replaceExactOccurrences(
    output,
    JSON.stringify(actual),
    JSON.stringify(replacement),
    expectedCount,
  );
}

/** 置換件数を固定し、意図しない未置換や広すぎる正規化を拒否する。 */
function replaceExactOccurrences(
  source: string,
  before: string,
  after: string,
  expectedCount: number,
): string {
  assert.notEqual(before, "");
  const parts = source.split(before);
  assert.equal(parts.length - 1, expectedCount, `${before} must occur ${expectedCount} time(s)`);
  return parts.join(after);
}

/** JSON diagnostic pathをplatform非依存のfixture placeholderへ変換する。 */
function normalizeDiagnosticPath(
  sourcePath: string,
  fixture: Readonly<{ gameDefinitionPath: string; contentRoot: string }>,
): string {
  if (sourcePath === fixture.gameDefinitionPath) {
    return "<game-definition>";
  }
  const relative = path.relative(fixture.contentRoot, sourcePath);
  if (relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`)) {
    return `<content-root>/${relative.split(path.sep).join("/")}`;
  }
  return sourcePath;
}

/** JSON.parse後のdiagnostic候補を安全に更新できるplain recordか確認する。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 全caseの生成完了後にdirectoryを同一filesystem上で入れ替え、部分更新を避ける。 */
async function replaceGoldenDirectory(goldens: ReadonlyMap<string, string>): Promise<void> {
  const transactionRoot = await mkdtemp(path.join(fixtureRoot, ".validate-content-golden-update-"));
  const nextRoot = path.join(transactionRoot, "next");
  const previousRoot = path.join(transactionRoot, "previous");
  await mkdir(nextRoot);
  try {
    for (const [name, content] of [...goldens].sort(([left], [right]) => left.localeCompare(right))) {
      await writeFile(path.join(nextRoot, name), content, "utf8");
    }
    await rename(goldenRoot, previousRoot);
    try {
      await rename(nextRoot, goldenRoot);
    } catch (cause) {
      await rename(previousRoot, goldenRoot);
      throw cause;
    }
    await rm(previousRoot, { recursive: true, force: true });
  } finally {
    await rm(transactionRoot, { recursive: true, force: true });
  }
}

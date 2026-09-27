#!/usr/bin/env node
// 決定的な角度計算（design 10）で tick 中に使う sine 表を生成する。
//
// 1 周を 1,440 step（0.25°）に分け、0〜90° の 361 entry を `round(sin(step * π / 720) * 2^30)` の整数として書き出す。host の
// `Math.sin` はこの生成時にだけ使い、生成した整数 literal を正本として commit する。tick は表を引くだけで補間しない。
//
// 使い方: node packages/core/scripts/generate-sine-table.mjs

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const QUARTER_TURN_STEPS = 360;
const SINE_TABLE_SCALE = 2 ** 30;
const outputPath = fileURLToPath(new URL("../src/basic/simulation/sine-table.ts", import.meta.url));

const entries = Array.from(
  { length: QUARTER_TURN_STEPS + 1 },
  (_, step) => Math.round(Math.sin((step * Math.PI) / (QUARTER_TURN_STEPS * 2)) * SINE_TABLE_SCALE),
);
if (entries[0] !== 0 || entries[QUARTER_TURN_STEPS] !== SINE_TABLE_SCALE || entries[120] !== SINE_TABLE_SCALE / 2) {
  throw new Error("sine table endpoints must be exact: sin 0° = 0, sin 30° = 1/2, sin 90° = 1");
}
for (let step = 1; step < entries.length; step += 1) {
  if (entries[step] <= entries[step - 1]) {
    throw new Error(`sine table must increase strictly at step ${step}`);
  }
}

const lines = [];
for (let index = 0; index < entries.length; index += 8) {
  lines.push(`  ${entries.slice(index, index + 8).join(", ")},`);
}
const source = [
  "// このファイルは packages/core/scripts/generate-sine-table.mjs が生成する。直接編集しない。",
  "",
  "/** sine 表の固定小数点 scale。表の整数をこの値で割ると sine になる（2 の冪なので割り算は正確）。 */",
  `export const SINE_TABLE_SCALE = ${SINE_TABLE_SCALE};`,
  "",
  "/**",
  " * 0〜90° の sine を 0.25° 刻みの 361 entry で持つ固定小数点表。`round(sin(step * π / 720) * 2^30)`。",
  " *",
  " * 90° より先の角度は対称性から引く。host の `Math.sin` は生成時だけに使い、tick はこの整数 literal だけを参照する。",
  " */",
  "export const QUARTER_WAVE_SINE_TABLE: readonly number[] = Object.freeze([",
  ...lines,
  "]);",
  "",
].join("\n");

await writeFile(outputPath, source, "utf8");
console.log(`wrote ${entries.length} entries to ${outputPath}`);

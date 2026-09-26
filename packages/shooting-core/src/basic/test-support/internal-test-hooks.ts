import { after } from "node:test";

import { INTERNAL_TEST_HOOKS_ENV } from "../instrumentation/test-hooks-guard.ts";

/**
 * この test file の実行中だけ Core 内部 test hook を有効化し、file の test 完了後に元の値へ戻す。
 *
 * hook 有効化の判定は factory 呼び出し時に行われるため、hook を使う test file は module top-level で呼ぶ。
 */
export function enableInternalTestHooksForTestFile(): void {
  const previousFlag = process.env[INTERNAL_TEST_HOOKS_ENV];
  process.env[INTERNAL_TEST_HOOKS_ENV] = "1";
  after(() => {
    if (previousFlag === undefined) {
      delete process.env[INTERNAL_TEST_HOOKS_ENV];
    } else {
      process.env[INTERNAL_TEST_HOOKS_ENV] = previousFlag;
    }
  });
}

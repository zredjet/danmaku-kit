import assert from "node:assert/strict";
import test from "node:test";

import { createRestoreJsonBudget, validateRestoreJsonPayload } from "./restore-json.ts";

test("normalizes restore JSON object keys by UTF-8 byte order", () => {
  const payload = {
    "😀": 3,
    "あ": 2,
    a: 1,
  };

  const restored = validateRestoreJsonPayload(payload, "payload", createRestoreJsonBudget());
  assert.equal(restored.ok, true);
  if (!restored.ok) {
    assert.fail("expected valid JSON payload");
  }
  assert.deepEqual(Object.keys(restored.value as Record<string, unknown>), ["a", "あ", "😀"]);
});

test("counts string values against the aggregate restore JSON byte budget", () => {
  const restored = validateRestoreJsonPayload(
    Array.from({ length: 65 }, () => "x".repeat(4_096)),
    "payload",
    createRestoreJsonBudget(),
  );

  assert.equal(restored.ok, false);
  assert.equal(!restored.ok && restored.errors[0]?.code, "state.invalidShape");
  assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", /payload budget/);
});

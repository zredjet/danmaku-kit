import type { HashableGameState, HashablePrngState } from "../core.ts";
import { writeCanonicalValueToSink } from "./canonical-encoder.ts";
import {
  adaptHashableGameStateToCanonicalValue,
  adaptHashablePrngStateToCanonicalValue,
} from "./hashable-game-state-adapter.ts";
import { SHOOTING_XXHASH64_SEED, XxHash64 } from "./xxhash64.ts";

/**
 * HashableGameState を固定 seed の xxHash64 lower-case hex digest へ変換する。
 *
 * adapter で schema-defined fixedStruct tree を作り、canonical sink から incremental hasher へ直接渡すため、
 * state hash のためだけに canonical byte stream 全体を保持しない。
 */
export function hashHashableGameState(state: HashableGameState): string {
  return digestCanonicalValue(adaptHashableGameStateToCanonicalValue(state));
}

/** debug artifact 用に PRNG state だけを state hash と同じ format / seed で digest する。 */
export function hashHashablePrngState(state: HashablePrngState): string {
  return digestCanonicalValue(adaptHashablePrngStateToCanonicalValue(state));
}

function digestCanonicalValue(value: Parameters<typeof writeCanonicalValueToSink>[0]): string {
  const hasher = new XxHash64(SHOOTING_XXHASH64_SEED);
  writeCanonicalValueToSink(value, hasher);
  return hasher.digestHex();
}

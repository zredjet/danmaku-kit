/** audio adapter の状態（design 18 / 21.5 の `audioStatus`）。 */
export type AudioStatus = "muted" | "suspended" | "running" | "error";

/** Phase 2A は audio を対象外とし、音を出さない。debug HUD と browser dump はこの値を出す。 */
export const PHASE_2A_AUDIO_STATUS: AudioStatus = "muted";

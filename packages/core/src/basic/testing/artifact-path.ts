const MAX_ARTIFACT_NAME_LENGTH = 128;
const ARTIFACT_NAME_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

/** artifact file 名に使う名前と、それを検証した error message 用の label。 */
export type TickArtifactPathOptions = Readonly<{
  directory: string;
  name: string;
  nameLabel: string;
  tick: number;
  tickLabel: string;
}>;

/**
 * portable slug と tick から `<directory>/<name>-tick-<tick>.json` の repository-relative path を作る。
 *
 * name は 1..128 文字の lower-case ASCII slug とし、`/`、`\`、`..` を path へ流さない。
 */
export function createTickArtifactPath(options: TickArtifactPathOptions): string {
  assertArtifactName(options.name, options.nameLabel);
  if (!Number.isSafeInteger(options.tick) || options.tick < 0) {
    throw new RangeError(`${options.tickLabel} must be a non-negative safe integer`);
  }
  return `${options.directory}/${options.name}-tick-${options.tick}.json`;
}

/** artifact file 名の slug 規則を満たさない名前を拒否する。 */
export function assertArtifactName(name: string, label: string): void {
  if (name.length === 0 || name.length > MAX_ARTIFACT_NAME_LENGTH || !ARTIFACT_NAME_PATTERN.test(name)) {
    throw new RangeError(`${label} must be a lower-case artifact slug up to ${MAX_ARTIFACT_NAME_LENGTH} characters`);
  }
}

import type { ParsedYamlSource } from "./yaml-source.ts";

export const COLLECTION_DIRECTORIES = Object.freeze({
  players: "players",
  stages: "stages",
  enemies: "enemies",
  bullets: "bullets",
  "player-shots": "playerShots",
  patterns: "patterns",
  paths: "paths",
  // optional feature の collection は `content.features.<collection>` に入れる（design 20）。
  pickups: "features.pickups",
} as const);

/**
 * optional feature の collection と、その feature。feature が `enabledFeatures` にあれば、file がなくても空の collection を置く
 * （Core は有効な feature の collection を必要とする、design 20）。
 */
export const FEATURE_COLLECTIONS = Object.freeze({
  "features.pickups": "pickup",
} as const);

export type ContentDirectoryName = keyof typeof COLLECTION_DIRECTORIES;

export type ContentCollectionName = (typeof COLLECTION_DIRECTORIES)[ContentDirectoryName];

export type CollectionSource = Readonly<{
  collection: ContentCollectionName;
  source: ParsedYamlSource;
  sourceId: string;
}>;

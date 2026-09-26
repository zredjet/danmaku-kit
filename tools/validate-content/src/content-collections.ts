import type { ParsedYamlSource } from "./yaml-source.ts";

export const COLLECTION_DIRECTORIES = Object.freeze({
  players: "players",
  stages: "stages",
  enemies: "enemies",
  bullets: "bullets",
  "player-shots": "playerShots",
  patterns: "patterns",
  paths: "paths",
} as const);

export type ContentDirectoryName = keyof typeof COLLECTION_DIRECTORIES;

export type ContentCollectionName = (typeof COLLECTION_DIRECTORIES)[ContentDirectoryName];

export type CollectionSource = Readonly<{
  collection: ContentCollectionName;
  source: ParsedYamlSource;
  sourceId: string;
}>;

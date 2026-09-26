/**
 * serialize 用 DTO で共有する座標・速度の plain-data 表現。
 *
 * Phase 1B-5 で追加する restore は各 field を finite number として検証する。position / velocity の
 * ように小数が自然に発生する値は整数化を要求せず、state hash では finite number の
 * canonical binary encoding に任せる。
 */
export type SerializedVector2 = Readonly<{
  x: number;
  y: number;
}>;

/**
 * serialized schema 上の entity ID。Core 内部の採番実装型には依存させない。
 *
 * Phase 1B-5 で追加する restore は正の safe integer だけを受け付ける。`runtimeEntities` 内では
 * strict ascending / unique / `id < nextEntityId` を満たす必要があり、0、負数、
 * 小数、重複、`nextEntityId` 以上の値は restore 用の shape error として拒否する。
 */
export type SerializedEntityId = number;

/**
 * serialize 対象 entity が共通して持つ deterministic な runtime 情報。
 *
 * Phase 1B-5 で追加する restore は common field の shape に加え、position が有限座標、
 * collisionRadius が正の有限値であることを検証する。collisionRadius の上限は
 * content validation 側に同じ上限を導入する slice まで restore 専用には持たせない。
 */
export type SerializedRuntimeEntityBase = Readonly<{
  id: SerializedEntityId;
  kind: "player" | "enemy" | "enemyBullet" | "playerShot";
  definitionId: string;
  position: SerializedVector2;
  collisionRadius: number;
}>;

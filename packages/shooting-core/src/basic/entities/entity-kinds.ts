/**
 * Core basic が扱う runtime entity kind の canonical 一覧。
 *
 * kind を追加するときはここに加え、型検査が示す runtime / serialize / hash の union と dispatch へ登録する。
 */
export const RUNTIME_ENTITY_KINDS = Object.freeze(["player", "enemy", "enemyBullet", "playerShot"] as const);

/** Core basic の runtime entity kind。 */
export type RuntimeEntityKind = (typeof RUNTIME_ENTITY_KINDS)[number];

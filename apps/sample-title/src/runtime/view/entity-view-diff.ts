import type { ReadonlyEntityState } from "@shooting-sample/shooting-core";

/** 表示中の view と frame の entity を突き合わせた、生成・更新・破棄する view。 */
export type EntityViewDiff = Readonly<{
  /** まだ view がない entity。frame の並び（entity id 昇順）のまま。 */
  spawned: readonly ReadonlyEntityState[];
  /** view がある entity。位置などを frame の state に合わせる。 */
  updated: readonly ReadonlyEntityState[];
  /** frame から消えた entity の id。昇順。 */
  destroyedIds: readonly ReadonlyEntityState["id"][];
}>;

/**
 * 表示中の view の entity id と `GameFrame.state.entities` から、view の生成・更新・破棄を決める。
 *
 * view は Core の state を正本にして同期し、spawn / destroy event からは作らない。event は演出だけに使うため、lifetime 切れのように
 * event を伴わない消滅でも view が残らない。entity id は 1 stage 中に再利用されないので、id だけで同じ entity と判定する。
 */
export function diffEntityViews(
  viewIds: Iterable<ReadonlyEntityState["id"]>,
  entities: readonly ReadonlyEntityState[],
): EntityViewDiff {
  const remainingViewIds = new Set(viewIds);
  const spawned: ReadonlyEntityState[] = [];
  const updated: ReadonlyEntityState[] = [];
  for (const entity of entities) {
    if (remainingViewIds.delete(entity.id)) {
      updated.push(entity);
    } else {
      spawned.push(entity);
    }
  }
  return Object.freeze({
    spawned: Object.freeze(spawned),
    updated: Object.freeze(updated),
    destroyedIds: Object.freeze([...remainingViewIds].sort((left, right) => left - right)),
  });
}

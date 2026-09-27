/** deterministic に採番できる最大 entity id。 */
export const MAX_ALLOCATED_ENTITY_ID = Number.MAX_SAFE_INTEGER - 1;

/** serialize / restore で受け付ける nextEntityId の最大値。 */
export const MAX_RESTORABLE_NEXT_ENTITY_ID = MAX_ALLOCATED_ENTITY_ID + 1;

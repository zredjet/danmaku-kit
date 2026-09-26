type HasDuplicateField<
  Keys extends readonly unknown[],
  Seen extends readonly unknown[] = [],
> = Keys extends readonly [infer Head, ...infer Tail]
  ? Head extends Seen[number]
    ? true
    : HasDuplicateField<Tail, readonly [...Seen, Head]>
  : false;

type ExactFieldOrder<T, Keys extends readonly (keyof T)[]> =
  Exclude<keyof T, Keys[number]> extends never
    ? HasDuplicateField<Keys> extends true
      ? never
      : Keys
    : never;

/**
 * hash DTO と runtime component の field set が一致することを検査する。
 *
 * Basic core の runtime entity は hash 対象外の cache / render state を持たないため、
 * runtime field の追加時に hash projection だけを更新し忘れることを型エラーにする。
 */
type ExactFieldSet<Left, Right> =
  Exclude<keyof Left, keyof Right> extends never
    ? Exclude<keyof Right, keyof Left> extends never
      ? unknown
      : never
    : never;

/**
 * DTO の canonical field order を、型の全 field を重複なく1回ずつ並べた frozen 配列として定義する。
 *
 * `RuntimeContract` を渡すと、その型と DTO の field 集合が一致しない限り型エラーにする。
 */
export const defineFieldOrder = <T, RuntimeContract = T>() => <const Keys extends readonly (keyof T)[]>(
  keys: ExactFieldOrder<T, Keys> & ExactFieldSet<T, RuntimeContract>,
): Readonly<Keys> => Object.freeze([...keys]) as unknown as Readonly<Keys>;

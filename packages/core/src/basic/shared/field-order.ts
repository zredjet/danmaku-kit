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
 * DTO / key 一覧と、対応する runtime component の field set が一致することを検査する。
 *
 * Basic core の runtime entity は hash 対象外の cache / render state を持たないため、
 * runtime field の追加時に hash DTO、public serialize DTO、restore key 一覧のどれかだけを更新し忘れることを型エラーにする。
 */
type ExactFieldSet<Left, Right> =
  Exclude<keyof Left, keyof Right> extends never
    ? Exclude<keyof Right, keyof Left> extends never
      ? unknown
      : never
    : never;

/**
 * 型の全 field を重複なく1回ずつ並べた frozen 配列を定義する。
 *
 * hash DTO では配列の順序がそのまま canonical encoding の byte 順になる。restore の key 一覧のように順序に意味がない
 * 用途でも、`RuntimeContract` を渡すとその型と field 集合が一致しない限り型エラーにする。
 */
export const defineFieldOrder = <T, RuntimeContract = T>() => <const Keys extends readonly (keyof T)[]>(
  keys: ExactFieldOrder<T, Keys> & ExactFieldSet<T, RuntimeContract>,
): Readonly<Keys> => Object.freeze([...keys]) as unknown as Readonly<Keys>;

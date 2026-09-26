/** 2つの型が相互に代入可能なだけでなく、同一であることを判定する。 */
export type IsExactly<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

/** 型レベルの assertion が true であることを要求する。 */
export type AssertTrue<Value extends true> = Value;

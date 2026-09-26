/** UTF-8 byte lexicographic order を locale 非依存で比較する。 */
export function compareUtf8Lexicographic(left: string, right: string): number {
  const leftBytes = encodeUtf8Bytes(left);
  const rightBytes = encodeUtf8Bytes(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const diff = leftBytes[index]! - rightBytes[index]!;
    if (diff !== 0) {
      return diff;
    }
  }
  return leftBytes.length - rightBytes.length;
}

/** state hash と同じ UTF-8 byte order 前提を runtime validation でも使えるようにする。 */
function encodeUtf8Bytes(value: string): readonly number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index)!;
    if (codePoint > 0xffff) {
      index += 1;
    }
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return bytes;
}

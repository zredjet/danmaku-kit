import { inflateSync } from "node:zlib";

/** 8 bit RGB / RGBA、interlace なしの PNG を画素の配列にしたもの。 */
export type DecodedPng = Readonly<{ width: number; height: number; channels: 3 | 4; data: Uint8Array }>;

/**
 * Playwright の screenshot（8 bit RGB / RGBA、interlace なし）を decode する。canvas の画素を読むための最小の decoder で、他の形式は
 * 拒否する。
 */
export function decodePng(buffer: Buffer): DecodedPng {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      colorType = chunk[9]!;
      if (chunk[8] !== 8 || chunk[12] !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error("only 8-bit RGB / RGBA PNGs without interlace are supported");
      }
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? data[y * stride + x - channels]! : 0;
      const up = y > 0 ? data[(y - 1) * stride + x]! : 0;
      const upLeft = y > 0 && x >= channels ? data[(y - 1) * stride + x - channels]! : 0;
      const predictor = filter === 1 ? left
        : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2)
        : filter === 4 ? paeth(left, up, upLeft)
        : 0;
      data[y * stride + x] = (raw[y * (stride + 1) + 1 + x]! + predictor) & 0xff;
    }
  }
  return { width, height, channels, data };
}

/** (x, y) の画素の RGB。座標は画像の画素（整数へ切り捨て）。 */
export function rgbAt(image: DecodedPng, x: number, y: number): [number, number, number] {
  const index = (Math.floor(y) * image.width + Math.floor(x)) * image.channels;
  return [image.data[index]!, image.data[index + 1]!, image.data[index + 2]!];
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) {
    return left;
  }
  return toUp <= toUpLeft ? up : upLeft;
}

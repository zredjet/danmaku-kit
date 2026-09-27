import { Loader } from "phaser";

/**
 * SVG を `scale` 倍で rasterize して読む file を loader に足す。
 *
 * Phaser の SVGFile は `scale` を渡すと、応答を XML として解析して `<svg>` 要素の大きさを読む。`<svg>` 要素がない応答（dev server が
 * 存在しない path に返す index.html など）や XML として壊れた SVG では、その解析が例外を投げ、file が完了も失敗もしないまま loader
 * の COMPLETE が来なくなる。解析の例外を file の処理の失敗（`onProcessError()`）に変えて loader を進め、texture ができなかった asset
 * として呼び出し側に扱わせる（design 17 の required、fallback、省略の規則を当てる）。
 */
export function addScaledSvgFile(loader: Loader.LoaderPlugin, key: string, url: string, scale: number): void {
  const file = new Loader.FileTypes.SVGFile(loader, key, url, { scale });
  const process = file.onProcess.bind(file);
  file.onProcess = () => {
    try {
      process();
    } catch {
      file.onProcessError();
    }
  };
  loader.addFile(file);
}

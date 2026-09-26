declare module "virtual:sample-title/game-definition" {
  import type { GameDefinition } from "@shooting-sample/shooting-core";

  /** Vite content plugin が build / dev server 時に validate-content で検証した `GameDefinition`。 */
  const gameDefinition: GameDefinition;
  export default gameDefinition;
}

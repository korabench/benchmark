import path from "node:path";
import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";

const thisDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // `#packScope` resolves through package.json conditions, which point at
    // build output so that Node gets the AsyncLocalStorage scope and a browser
    // bundle gets the node-free one. Tests run from source, and an unbuilt
    // checkout should still be testable, so point it back at the source of the
    // implementation Node would have picked.
    alias: {
      "#packScope": path.resolve(
        thisDir,
        "packages/benchmark/src/packs/packScope.node.ts"
      ),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
  },
});

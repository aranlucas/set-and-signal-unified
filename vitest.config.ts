import { defineConfig } from "vitest/config";
import { instrument } from "./tests/support/compiler";

export default defineConfig({
  plugins: [
    {
      name: "fivefold-compiled-render-counters",
      enforce: "pre",
      resolveId(id) {
        if (/^@expo\/material-symbols\/.+\.xml$/.test(id)) return `\0${id}`;
      },
      load(id) {
        if (id.startsWith("\0@expo/material-symbols/"))
          return 'export default "material-symbol";';
      },
      transform(source, id) {
        const file = id.split("?")[0];
        if (file.includes("/node_modules/") || file.includes("/src/widgets/"))
          return;
        if (file.endsWith("/App.tsx") || /\/src\/.*\.tsx?$/.test(file))
          return { code: instrument(source, file), map: null };
      },
    },
  ],
  test: { testTimeout: 60_000 },
});

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { instrument } from "./tests/support/compiler";

const adapterPath = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@expo\/ui\/jetpack-compose\/modifiers$/,
        replacement: adapterPath("./tests/adapters/jetpack-modifiers.ts"),
      },
      {
        find: /^@expo\/ui\/jetpack-compose$/,
        replacement: adapterPath("./tests/adapters/jetpack-compose.tsx"),
      },
      {
        find: /^expo-file-system$/,
        replacement: adapterPath("./tests/adapters/file-system.ts"),
      },
      ...[
        "react-native",
        "expo-sqlite",
        "expo-status-bar",
        "expo-haptics",
        "expo-keep-awake",
        "expo-notifications",
        "expo-sharing",
        "expo-document-picker",
        "expo-widgets",
      ].map((name) => ({
        find: new RegExp(`^${name.replaceAll("-", String.raw`\-`)}$`),
        replacement: adapterPath("./tests/adapters/native-services.ts"),
      })),
    ],
  },
  plugins: [
    {
      name: "fivefold-compiled-render-counters",
      enforce: "pre",
      resolveId(id) {
        if (/^@expo\/material-symbols\/.+\.xml$/.test(id)) {
          return `\0${id}`;
        }
      },
      load(id) {
        if (id.startsWith("\0@expo/material-symbols/")) {
          return 'export default "material-symbol";';
        }
      },
      transform(source, id) {
        const file = id.split("?")[0];

        if (file.includes("/node_modules/") || file.includes("/src/widgets/")) {
          return;
        }

        if (file.endsWith("/App.tsx") || /\/src\/.*\.tsx?$/.test(file)) {
          return { code: instrument(source, file), map: null };
        }
      },
    },
  ],
  test: { testTimeout: 60_000 },
});

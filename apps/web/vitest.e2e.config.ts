import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config";

// End-to-end tests against the built app; `pnpm --filter web test:e2e` builds it first. Same database, env and
// one-file-at-a-time rule as the unit tests. The base global setup migrates the database before the server starts.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["test/**/*.e2e.ts"],
      globalSetup: ["./test/e2e-server.ts"],
      testTimeout: 30_000,
    },
  }),
);

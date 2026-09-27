import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    // Local docker compose and CI both expose the test database here.
    env: { DATABASE_URL: "postgres://mma:mma@localhost:5433/mma_test" },
    globalSetup: ["./test/global-setup.ts"],
    // Database tests share one database, so test files run one at a time.
    fileParallelism: false,
  },
});

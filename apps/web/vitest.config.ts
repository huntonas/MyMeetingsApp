import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    env: {
      // Local docker compose and CI both expose the test database here.
      DATABASE_URL: "postgres://mma:mma@localhost:5433/mma_test",
      // A fixed test-only pepper: hashes in tests are hand-computed literals that depend on it.
      DEVICE_ID_PEPPER: "test-pepper-not-a-secret-0123456789abcdef",
      // Every absolute URL a test expects starts with this.
      SITE_URL: "https://mymeetingapp.test",
    },
    globalSetup: ["./test/global-setup.ts"],
    // Database tests share one database, so test files run one at a time.
    fileParallelism: false,
    // The lock-racing tests hold a transaction while another waits on it; under a loaded machine that takes longer
    // than vitest's 5-second default, though never close to this.
    testTimeout: 15_000,
  },
});

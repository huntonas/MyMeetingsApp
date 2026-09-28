import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The throttle enforces one request per second per host, so redirect-hop tests take seconds.
    testTimeout: 30_000,
  },
});

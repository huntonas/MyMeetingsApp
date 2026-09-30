import { fetchVocabulary } from "@/api/reads";

import { startApi, type TestApi } from "./api-server";

let api: TestApi;

beforeEach(async () => {
  api = await startApi();
});
afterEach(async () => {
  await api.close();
});

describe("startApi", () => {
  it("rejects instead of hanging when the fixed port is already in use", async () => {
    await expect(startApi()).rejects.toThrow();
  });

  it("close() doesn't hang while a client holds an open connection", async () => {
    api.hang("/api/v1/vocabulary");
    const pending = fetchVocabulary().catch(() => undefined);
    while (api.requests.length === 0) await new Promise((resolve) => setImmediate(resolve));
    await api.close();
    await pending;
  });
});

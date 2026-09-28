import { startServer } from "@mymeetingapp/test-server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetPreviewBranch } from "@/db/preview-branch";

const servers: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const BRANCHES: Record<string, object> = {
  "/projects/proj-1/branches/br-preview": {
    branch: { id: "br-preview", name: "preview", parent_id: "br-seed", default: false },
  },
  "/projects/proj-1/branches/br-seed": {
    branch: { id: "br-seed", name: "seed", parent_id: "br-main", default: false },
  },
  "/projects/proj-1/branches/br-main": { branch: { id: "br-main", name: "main", default: true } },
  "/projects/proj-1/branches/br-feature": {
    branch: { id: "br-feature", name: "feature", parent_id: "br-main", default: false },
  },
};

// A fake Neon API: branches as above, a restore that starts one operation, and that operation's later states.
async function neon(laterStatuses: string[] = ["finished"], status = 200) {
  const statuses = [...laterStatuses];
  const server = await startServer((path) => {
    if (status !== 200) return { status, body: "{}" };
    if (path.endsWith("/restore")) {
      return { status: 200, body: JSON.stringify({ operations: [{ id: "op-1", status: "running" }] }) };
    }
    if (path === "/projects/proj-1/operations/op-1") {
      return {
        status: 200,
        body: JSON.stringify({ operation: { id: "op-1", status: statuses.shift() ?? "finished" } }),
      };
    }
    const branch = BRANCHES[path];
    return branch === undefined ? { status: 404, body: "{}" } : { status: 200, body: JSON.stringify(branch) };
  });
  servers.push(server);
  return server;
}

function stubPreviewBuild(apiUrl: string, branchId = "br-preview") {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("NEON_API_URL", apiUrl);
  vi.stubEnv("NEON_API_KEY", "neon-test-key");
  vi.stubEnv("NEON_PROJECT_ID", "proj-1");
  vi.stubEnv("NEON_PREVIEW_BRANCH_ID", branchId);
}

const calls = (server: { requests: { method: string; path: string }[] }) =>
  server.requests.map((request) => `${request.method} ${request.path}`);

describe("resetPreviewBranch", () => {
  it.each([undefined, "production", "development"])(
    "leaves the database alone when VERCEL_ENV is %j",
    async (env) => {
      const server = await neon();
      stubPreviewBuild(server.baseUrl);
      vi.stubEnv("VERCEL_ENV", env);
      expect(await resetPreviewBranch()).toBe("skipped");
      expect(server.requests).toEqual([]);
    },
  );

  it("restores the preview branch from seed and waits for Neon to finish", async () => {
    const server = await neon(["running", "finished"]);
    stubPreviewBuild(server.baseUrl);
    expect(await resetPreviewBranch()).toBe("reset");
    expect(calls(server)).toEqual([
      "GET /projects/proj-1/branches/br-preview",
      "GET /projects/proj-1/branches/br-seed",
      "POST /projects/proj-1/branches/br-preview/restore",
      "GET /projects/proj-1/operations/op-1",
      "GET /projects/proj-1/operations/op-1",
    ]);
    expect(JSON.parse(server.requests[2]?.body ?? "")).toEqual({ source_branch_id: "br-seed" });
    expect(server.requests[0]?.headers.authorization).toBe("Bearer neon-test-key");
  });

  it("refuses the default branch", async () => {
    const server = await neon();
    stubPreviewBuild(server.baseUrl, "br-main");
    await expect(resetPreviewBranch()).rejects.toThrow(
      'NEON_PREVIEW_BRANCH_ID must name a branch made from "seed"; refusing to restore "main"',
    );
    expect(calls(server).filter((call) => call.startsWith("POST"))).toEqual([]);
  });

  it("refuses a branch whose parent isn't seed", async () => {
    const server = await neon();
    stubPreviewBuild(server.baseUrl, "br-feature");
    await expect(resetPreviewBranch()).rejects.toThrow('refusing to restore "feature"');
    expect(calls(server).filter((call) => call.startsWith("POST"))).toEqual([]);
  });

  it("fails when Neon reports the operation failed", async () => {
    const server = await neon(["failed"]);
    stubPreviewBuild(server.baseUrl);
    await expect(resetPreviewBranch()).rejects.toThrow("Neon operation op-1 failed");
  });

  it("reports Neon's status but never the key when Neon refuses", async () => {
    const server = await neon([], 401);
    stubPreviewBuild(server.baseUrl);
    const error: unknown = await resetPreviewBranch().catch((caught: unknown) => caught);
    expect(String(error)).toContain("returned 401");
    expect(String(error)).not.toContain("neon-test-key");
  });

  it("fails the build when a Neon setting is missing", async () => {
    const server = await neon();
    stubPreviewBuild(server.baseUrl);
    vi.stubEnv("NEON_API_KEY", undefined);
    await expect(resetPreviewBranch()).rejects.toThrow("NEON_API_KEY must be set for preview builds");
  });
});

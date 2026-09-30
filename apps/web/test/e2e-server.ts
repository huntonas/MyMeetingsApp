import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";

import type { TestProject } from "vitest/node";

// The built app (`next build`, run by test:e2e first) served by `next start` against the test database, so these
// tests see what Vercel serves: proxy.ts in place, Server Actions with Next's own checks, real headers and the
// static pages as built.
const PORT = 3107;
export const E2E_URL = `http://localhost:${String(PORT)}`;
// The server's admin credentials. The password is at least 16 characters, as isAdminAuthorization requires.
const E2E_ADMIN = { user: "e2e-admin", password: "e2e-password-not-a-secret-0123" };
export const ADMIN_AUTHORIZATION = `Basic ${Buffer.from(`${E2E_ADMIN.user}:${E2E_ADMIN.password}`).toString("base64")}`;
const WEB_ROOT = path.resolve(import.meta.dirname, "..");

async function serving(): Promise<boolean> {
  try {
    await fetch(`${E2E_URL}/`);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilServing(server: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`next start exited with code ${String(server.exitCode)}`);
    if (await serving()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("next start didn't serve / within 60 seconds");
}

export default async function setup(project: TestProject): Promise<() => void> {
  // A server left over from a crashed run would answer for the new build.
  if (await serving()) throw new Error(`port ${String(PORT)} is already in use; stop the old server first`);
  const server = spawn(
    process.execPath,
    [path.join(WEB_ROOT, "node_modules/next/dist/bin/next"), "start", "--port", String(PORT)],
    {
      cwd: WEB_ROOT,
      // Vitest sets NODE_ENV=test; next start must run as production.
      env: {
        ...process.env,
        ...project.config.env,
        METRICS_USER: E2E_ADMIN.user,
        METRICS_PASSWORD: E2E_ADMIN.password,
        NODE_ENV: "production",
      },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  await waitUntilServing(server);
  return () => {
    server.kill();
  };
}

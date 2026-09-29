import { readEnv } from "@/env";
import { constantTimeEqual } from "@/lib/constant-time";

const MIN_PASSWORD_LENGTH = 16;

// Spec §10: METRICS_USER and METRICS_PASSWORD (sensitive Vercel variables) guard /metrics with HTTP Basic Auth.
// Without both, or with a short password, nobody gets in.
export function isAdminAuthorization(header: string | null): boolean {
  const user = readEnv("METRICS_USER");
  const password = readEnv("METRICS_PASSWORD");
  if (user === undefined || password === undefined || password.length < MIN_PASSWORD_LENGTH) {
    console.warn(
      `[admin] METRICS_USER and METRICS_PASSWORD (at least ${String(MIN_PASSWORD_LENGTH)} characters) must be set; refusing every sign-in`,
    );
    return false;
  }
  const expected = `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
  return header !== null && constantTimeEqual(header, expected);
}

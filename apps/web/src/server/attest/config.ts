import { readEnv } from "@/env";
import type { AppAttestEnvironment } from "@/server/attest/app-attest";

export interface AppAttestConfig {
  teamId: string;
  // What App Attest calls the App ID: the team id, a period, the bundle identifier.
  appId: string;
  environment: AppAttestEnvironment;
}

// TestFlight and App Store builds always attest in Apple's production environment, so staging and production use it;
// only local web, serving a dev build on a device, sets APP_ATTEST_ENVIRONMENT=development. null, with a warning (a
// misconfiguration), until both ids are set: every app check then fails closed.
export function appAttestConfig(): AppAttestConfig | null {
  const teamId = readEnv("APPLE_TEAM_ID");
  const bundleId = readEnv("APPLE_BUNDLE_ID");
  if (teamId === undefined || bundleId === undefined) {
    console.warn("[attestation] APPLE_TEAM_ID and APPLE_BUNDLE_ID must be set; refusing app checks");
    return null;
  }
  const environment = readEnv("APP_ATTEST_ENVIRONMENT") === "development" ? "development" : "production";
  return { teamId, appId: `${teamId}.${bundleId}`, environment };
}

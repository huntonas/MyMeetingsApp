import { z } from "zod";

import { SemVer } from "./version";

export const PLATFORMS = ["ios", "android"] as const;
export const Platform = z.enum(PLATFORMS);
export type Platform = z.infer<typeof Platform>;

// Spec §7: the headers every write carries, and no read.
export const DEVICE_HEADERS = {
  deviceId: "X-Device-Id",
  platform: "X-Platform",
  appVersion: "X-App-Version",
  attestation: "X-Attestation",
} as const;

// Spec §6: iOS sends a Keychain UUID and Android its ANDROID_ID (16 hex digits).
export const WriteHeaders = z.object({
  deviceId: z.string().regex(/^[A-Za-z0-9-]{16,64}$/),
  platform: Platform,
  appVersion: SemVer,
  attestation: z.string().min(1).max(16_384).optional(),
});
export type WriteHeaders = z.infer<typeof WriteHeaders>;

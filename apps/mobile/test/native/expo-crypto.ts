import { randomUUID as nodeRandomUUID } from "node:crypto";

// expo-crypto's randomUUID: a version 4 UUID from the platform's secure random source.
export function randomUUID(): string {
  return nodeRandomUUID();
}

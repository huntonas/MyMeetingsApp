import { requireOptionalNativeModule } from "expo";

// Spec §6, iOS only: Android's Play Integrity joins in Phase 6b, so there the module is absent (null). Keys and proofs
// are base64 strings; the shared contract checks them before anything is sent.
interface AppIntegrityModule {
  readonly isAppAttestSupported: boolean;
  readonly isDeviceCheckSupported: boolean;
  generateKey(): Promise<string>;
  attestKey(keyId: string, challenge: string): Promise<string>;
  generateAssertion(keyId: string, clientData: string): Promise<string>;
  deviceCheckToken(): Promise<string>;
}

export default requireOptionalNativeModule<AppIntegrityModule>("AppIntegrity");

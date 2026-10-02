import { AttestRegisterRequest, AttestRegisterResponse } from "@mymeetingapp/shared";

import { readJsonBody } from "@/lib/api/request";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { APPLE_APP_ATTESTATION_ROOT } from "@/server/attest/apple-root";
import { registerAppAttestKey } from "@/server/attest/register";
import { identifyDevice } from "@/server/devices/write-request";

export const dynamic = "force-dynamic";

// Spec §7: registers an iPhone's App Attest key. The only caller of registerAppAttestKey outside tests: it trusts Apple's
// root alone.
export const POST = withErrors(async (req: Request) => {
  const device = identifyDevice(req);
  await registerAppAttestKey(device, await readJsonBody(req, AttestRegisterRequest), {
    root: APPLE_APP_ATTESTATION_ROOT,
    at: new Date(),
  });
  return jsonResponse(AttestRegisterResponse, { registered: true }, "none", 201);
});

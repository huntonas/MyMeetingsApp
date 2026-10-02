import { AttestRegisterRequest, AttestRegisterResponse } from "@mymeetingapp/shared";

import { readJsonBody } from "@/lib/api/request";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { registerAppAttestKey } from "@/server/attest/register";
import { identifyDevice } from "@/server/devices/write-request";

export const dynamic = "force-dynamic";

// Spec §7: registers an iPhone's App Attest key.
export const POST = withErrors(async (req: Request) => {
  const device = identifyDevice(req);
  await registerAppAttestKey(device, await readJsonBody(req, AttestRegisterRequest));
  return jsonResponse(AttestRegisterResponse, { registered: true }, "none", 201);
});

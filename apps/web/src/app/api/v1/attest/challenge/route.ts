import { AttestChallengeResponse } from "@mymeetingapp/shared";

import { jsonResponse, withErrors } from "@/lib/api/respond";
import { issueChallenge } from "@/server/attest/challenges";
import { identifyDevice } from "@/server/devices/write-request";

export const dynamic = "force-dynamic";

// Spec §7: a single-use App Attest challenge.
export const POST = withErrors(async (req: Request) =>
  jsonResponse(AttestChallengeResponse, await issueChallenge(identifyDevice(req)), "none", 201),
);

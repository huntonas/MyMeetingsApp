import { DeleteMineResponse } from "@mymeetingapp/shared";

import { sendWrite } from "@/api/client";

// Spec §7: every tag, suggestion still linked, rate-limit, audit and attestation row for this phone. It has no body,
// and works below the minimum version and with tagging switched off.
export const deleteMine = () => sendWrite(DeleteMineResponse, "POST", "/api/v1/tags/delete-mine");

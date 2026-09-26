import { AppConfigResponse } from "@mymeetingapp/shared";

import { jsonResponse, withErrors } from "@/lib/api/respond";
import { readAppConfig } from "@/server/app-config";

export const dynamic = "force-dynamic";

export const GET = withErrors((_req: Request) =>
  Promise.resolve(jsonResponse(AppConfigResponse, readAppConfig(), "config")),
);

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { z } from "zod";

import { runAdminForm } from "@/app/metrics/run-admin-form";
import { isAdminAuthorization } from "@/lib/admin-auth";
import type { AdminNotice } from "@/server/admin/notices";

// Spec §10: every admin change is a Server Action on a /metrics page. proxy.ts has already checked the credentials
// and that the post came from this site. The action checks the credentials again, as the Next.js docs advise, so
// moving an action can never leave it unguarded. runAdminForm validates the form and runs the change, and the
// action sends the browser back to the page with the outcome (a 303 for a form posted without JavaScript). The page
// may depend on the form (a review page returns to itself); a form that doesn't parse can't say which record it was
// for, so it goes back to the overview.
export function adminAction<Schema extends z.ZodType>(
  returnTo: string | ((input: z.output<Schema>) => string),
  schema: Schema,
  run: (input: z.output<Schema>) => Promise<AdminNotice>,
): (formData: FormData) => Promise<never> {
  return async (formData) => {
    if (!isAdminAuthorization((await headers()).get("authorization"))) throw new Error("Not signed in");
    let page = typeof returnTo === "string" ? returnTo : "/metrics";
    const notice = await runAdminForm(
      schema,
      (input) => {
        if (typeof returnTo !== "string") page = returnTo(input);
        return run(input);
      },
      formData,
    );
    redirect(`${page}?notice=${notice}`);
  };
}

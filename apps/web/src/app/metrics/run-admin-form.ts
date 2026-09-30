import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";

import { logError } from "@/lib/log";
import type { AdminNotice } from "@/server/admin/notices";

// Validates a submitted admin form and runs the change, answering with the notice to show. A change that throws
// answers "failed": logError records only the SQL and the database's structured fields, never the form's text,
// whereas Next.js would log the whole error with its query parameters. Each change runs in one statement or one
// transaction, so a failure leaves nothing half done. Next.js's own interrupts (redirect, notFound) pass through.
export async function runAdminForm<Schema extends z.ZodType>(
  schema: Schema,
  run: (input: z.output<Schema>) => Promise<AdminNotice>,
  formData: FormData,
): Promise<AdminNotice> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return "invalid_form";
  try {
    return await run(parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    logError("[admin] action failed", error);
    return "failed";
  }
}

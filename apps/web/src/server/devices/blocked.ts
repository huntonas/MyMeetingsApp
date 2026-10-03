import { eq } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { devices } from "@/db/schema";

// Whether the device is blocked. A read: it takes no transaction id and stamps nothing on the device's record.
export async function isBlocked(deviceHash: string, executor: Executor): Promise<boolean> {
  const [row] = await executor
    .select({ blocked: devices.blocked })
    .from(devices)
    .where(eq(devices.deviceHash, deviceHash));
  return row?.blocked === true;
}

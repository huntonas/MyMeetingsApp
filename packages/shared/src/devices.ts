import { z } from "zod";

export const PLATFORMS = ["ios", "android"] as const;
export const Platform = z.enum(PLATFORMS);
export type Platform = z.infer<typeof Platform>;

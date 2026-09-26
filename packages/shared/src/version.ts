import { z } from "zod";

export const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/, "Expected a version like 1.2.3");

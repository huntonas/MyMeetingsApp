import { z } from "zod";

// Form fields arrive as strings. The ids are Postgres integers, so a larger number can't name a row (and would make
// the query fail rather than find nothing).
export const FormId = z.coerce.number().int().positive().max(2_147_483_647);

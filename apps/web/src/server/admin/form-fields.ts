import { z } from "zod";

// Form fields arrive as strings.
export const FormId = z.coerce.number().int().positive();

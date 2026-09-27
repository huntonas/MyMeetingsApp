import type { z } from "zod";

import { ApiError } from "@/lib/api/respond";

export function parseInput<Schema extends z.ZodType>(schema: Schema, value: unknown): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError("invalid_request");
  return parsed.data;
}

export async function readJsonBody<Schema extends z.ZodType>(
  req: Request,
  schema: Schema,
): Promise<z.output<Schema>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError("invalid_request");
  }
  return parseInput(schema, body);
}

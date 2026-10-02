import type { z } from "zod";

import { ApiError } from "@/lib/api/respond";

export function parseInput<Schema extends z.ZodType>(schema: Schema, value: unknown): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError("invalid_request");
  return parsed.data;
}

// Parses a body already read as text: for a write, whose attestation signs that exact text (readWriteRequest).
export function parseJsonText<Schema extends z.ZodType>(text: string, schema: Schema): z.output<Schema> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError("invalid_request");
  }
  return parseInput(schema, body);
}

export async function readJsonBody<Schema extends z.ZodType>(
  req: Request,
  schema: Schema,
): Promise<z.output<Schema>> {
  return parseJsonText(await req.text(), schema);
}

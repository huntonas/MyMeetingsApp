import { ApiErrorBody, type ErrorCode } from "@mymeetingapp/shared";
import type { z } from "zod";

import { serverUrl } from "@/config/server-url";

const TIMEOUT_MS = 15_000;

// The server refused the request with one of its codes; `message` is plain language the app shows as it is.
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// No usable answer: no connection, a timeout, or a reply that isn't the contract (a newer server, a captive portal).
// Readers fall back to a saved copy.
export class Unreachable extends Error {
  constructor() {
    super("The server couldn't be reached");
    this.name = "Unreachable";
  }
}

function unreachable(): never {
  throw new Unreachable();
}

function parseReply<S extends z.ZodType>(ok: boolean, body: unknown, schema: S): z.output<S> {
  if (!ok) {
    const failure = ApiErrorBody.safeParse(body);
    if (failure.success) throw new ApiError(failure.data.error.code, failure.data.error.message);
    return unreachable();
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : unreachable();
}

async function request<S extends z.ZodType>(
  schema: S,
  path: string,
  init: RequestInit,
): Promise<z.output<S>> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);
  try {
    const response = await fetch(`${serverUrl()}${path}`, { ...init, signal: controller.signal }).catch(
      unreachable,
    );
    const body: unknown = await response.json().catch(unreachable);
    return parseReply(response.ok, body, schema);
  } finally {
    clearTimeout(timer);
  }
}

// Reads send nothing that identifies the phone: no device headers, no cookies.
export function getJson<S extends z.ZodType>(schema: S, path: string): Promise<z.output<S>> {
  return request(schema, path, { headers: { Accept: "application/json" } });
}

export function postJson<S extends z.ZodType>(schema: S, path: string, body: unknown): Promise<z.output<S>> {
  return request(schema, path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

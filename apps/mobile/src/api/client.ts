import {
  ApiErrorBody,
  appAttestHeader,
  assertionClientData,
  AttestChallengeResponse,
  AttestRegisterRequest,
  AttestRegisterResponse,
  DEVICE_HEADERS,
  deviceCheckHeader,
  type ErrorCode,
  parseAttestation,
} from "@mymeetingapp/shared";
import type { z } from "zod";

import { serverUrl } from "@/config/server-url";
import {
  assertion,
  attestNewKey,
  deviceCheckToken,
  forgetAttestKey,
  integritySupport,
  rememberAttestKey,
  savedAttestKey,
  StaleAttestKey,
} from "@/device/app-integrity";
import { writeHeaders } from "@/device/write-headers";

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
    // expo/fetch defaults credentials to "include": iOS replays cookies from HTTPCookieStorage.shared and Android
    // from a persistent jar, so any Set-Cookie from the API origin would become a stable identifier. Omit it.
    const response = await fetch(`${serverUrl()}${path}`, {
      ...init,
      credentials: "omit",
      signal: controller.signal,
    }).catch(unreachable);
    const body: unknown = await response.json().catch(unreachable);
    return parseReply(response.ok, body, schema);
  } finally {
    clearTimeout(timer);
  }
}

// Reads send nothing that identifies the phone: no device headers (only sendWrite adds them), no cookies.
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

type WriteMethod = "POST" | "PUT" | "DELETE";

async function deviceHeaders(): Promise<Record<string, string>> {
  return { Accept: "application/json", ...(await writeHeaders()) };
}

// Spec §6: a new App Attest key. The server gives a challenge, Apple attests the key over it, and the server checks
// that. The challenge comes first, so a phone that can't reach the server makes no key; the key's id is saved only
// once the server holds it.
async function registerAttestKey(): Promise<string> {
  const headers = await deviceHeaders();
  const { challenge } = await request(AttestChallengeResponse, "/api/v1/attest/challenge", {
    method: "POST",
    headers,
  });
  const { keyId, attestation } = await attestNewKey(challenge);
  const registration = AttestRegisterRequest.parse({ keyId, attestation, challenge });
  await request(AttestRegisterResponse, "/api/v1/attest/register", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(registration),
  });
  await rememberAttestKey(keyId);
  return keyId;
}

async function signed(keyId: string, clientData: string, timestamp: number): Promise<string> {
  return appAttestHeader(keyId, timestamp, await assertion(keyId, clientData));
}

// Spec §6: the proof for one write. Whatever stops the phone making one (a simulator, Apple out of reach, a refused
// registration) sends the write without it, and the server decides whether it needs one. The exception is a
// registration refused because the phone is blocked: that refusal is the answer, so the person sees it.
async function attestation(method: WriteMethod, path: string, body: string): Promise<string | undefined> {
  try {
    const support = integritySupport();
    if (support === "none") return undefined;
    if (support === "deviceCheck") return deviceCheckHeader(await deviceCheckToken());
    const timestamp = Date.now();
    const clientData = assertionClientData({ method, path, timestamp, body });
    const saved = await savedAttestKey();
    if (saved !== null) {
      try {
        return await signed(saved, clientData, timestamp);
      } catch (error) {
        if (!(error instanceof StaleAttestKey)) throw error;
        await forgetAttestKey();
      }
    }
    return await signed(await registerAttestKey(), clientData, timestamp);
  } catch (error) {
    if (error instanceof ApiError && error.code === "device_blocked") throw error;
    return undefined;
  }
}

async function attempt<S extends z.ZodType>(
  schema: S,
  method: WriteMethod,
  path: string,
  body: string | undefined,
  proof: string | undefined,
): Promise<z.output<S>> {
  const headers = await deviceHeaders();
  if (proof !== undefined) headers[DEVICE_HEADERS.attestation] = proof;
  if (body === undefined) return request(schema, path, { method, headers });
  return request(schema, path, { method, headers: { ...headers, "Content-Type": "application/json" }, body });
}

let writing: Promise<unknown> = Promise.resolve();

// One write at a time, so the server sees assertion counters in the order they were made.
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = writing.then(task, task);
  writing = run.catch(() => undefined);
  return run;
}

async function attested<S extends z.ZodType>(
  schema: S,
  method: WriteMethod,
  path: string,
  text: string | undefined,
): Promise<z.output<S>> {
  // A write with no body signs an empty one, as the server reads it.
  const signedBody = text ?? "";
  const proof = await attestation(method, path, signedBody);
  try {
    return await attempt(schema, method, path, text, proof);
  } catch (error) {
    const keyRefused =
      error instanceof ApiError &&
      error.code === "attestation_failed" &&
      proof !== undefined &&
      parseAttestation(proof)?.kind === "appAttest";
    if (!keyRefused) throw error;
    await forgetAttestKey();
    return attempt(schema, method, path, text, await attestation(method, path, signedBody));
  }
}

// Writes carry the phone's device headers and its proof (spec §6, §7) and, like reads, no cookies. A write with
// nothing to say (a deletion) sends no body and no Content-Type. A refused App Attest key (gone from the server after
// Delete all my tags) is replaced and the write sent once more: nothing was written, as the check runs first. A write
// whose server deletes this phone's key (`forgetsAttestKey`) forgets it before the next write starts, best effort: a
// key it couldn't forget is replaced on that write's retry.
export function sendWrite<S extends z.ZodType>(
  schema: S,
  method: WriteMethod,
  path: string,
  body?: unknown,
  { forgetsAttestKey = false }: { forgetsAttestKey?: boolean } = {},
): Promise<z.output<S>> {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return oneAtATime(async () => {
    const answer = await attested(schema, method, path, text);
    if (forgetsAttestKey) await forgetAttestKey().catch(() => undefined);
    return answer;
  });
}

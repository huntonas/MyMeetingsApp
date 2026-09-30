// Advisory-only signals: worth a human glance in a real capture, but not proven violations. A map SDK
// legitimately sends tile coordinates to its own host, and a local dev capture legitimately uses plain http —
// so these are reported separately and never fail the run (see docs/mobile.md's "known limits").

const COORDINATE_PAIR = /-?\d{1,3}\.\d{2,}[^\n]{0,20}-?\d{1,3}\.\d{2,}/i;

// Deliberately skips DMS ("36°9'46\"N") and e-notation ("3.596e1") coordinates: those forms are common in map
// SDK traffic to third parties and would make this list too noisy to be worth reading. Documented as a known
// limit.
export function looksLikeCoordinatePair(text: string): boolean {
  return COORDINATE_PAIR.test(text);
}

const PRIVATE_HOST =
  /^(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|::1)$/i;

export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host.endsWith(".local") || PRIVATE_HOST.test(host);
}

// Classifies a request's host against --server. "differentWay" is its own outcome, not folded into "other":
// our hostname reached over a scheme or port --server didn't declare must never slip into otherHosts, where
// every check that only runs for our server (headers, cookies, the search body) would be skipped entirely.

export type HostMatch = "server" | "other" | "differentWay";

export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, "");
}

interface ServerAuthority {
  hostname: string;
  port: string | null;
}

function parseServerAuthority(server: string): ServerAuthority {
  const [hostname, port] = server.split(":");
  return { hostname: normalizeHost(hostname ?? ""), port: port ?? null };
}

// --server never carries a scheme (it's a bare host[:port]), so the expected scheme is inferred: an explicit
// non-443 port means a local plain-http dev server (docs/mobile.md); no port, or 443, means production https.
function expectedScheme(port: string | null): "https:" | "http:" {
  return port === null || port === "443" ? "https:" : "http:";
}

export function classifyHost(url: URL, server: string): HostMatch {
  const authority = parseServerAuthority(server);
  if (normalizeHost(url.hostname) !== authority.hostname) return "other";
  const requestPort = url.port || (url.protocol === "https:" ? "443" : "80");
  const wantedPort = authority.port ?? "443";
  if (requestPort !== wantedPort || url.protocol !== expectedScheme(authority.port)) return "differentWay";
  return "server";
}

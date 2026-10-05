// A BMLT server names itself (root_server_uri) as it was set up: behind a TLS proxy it may say http, or write its
// host in another case. The sync and discovery count a row as a server's own by the same rule.
function rootKey(uri: string): string {
  return uri
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .replace(/^[^/]+/, (host) => host.toLowerCase());
}

export function sameBmltRoot(a: string, b: string): boolean {
  return rootKey(a) === rootKey(b);
}

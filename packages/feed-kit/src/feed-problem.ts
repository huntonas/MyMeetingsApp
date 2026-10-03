// Spec §4: why a feed's answer isn't a usable feed, in the words the admin reads on /metrics and in coverage.md. A bot
// check (a challenge page served in place of the feed) is recorded and reported, never worked around: requests keep our
// honest User-Agent, never imitate a browser, curl or its TLS, and are never retried to slip past one.
// File-local (not exported): nothing outside this module names a bot-check service directly (D7).
type BotCheck = "Cloudflare" | "Incapsula";

export type FeedProblem =
  | { kind: "bot_check"; by: BotCheck }
  | { kind: "restricted"; status: number }
  | { kind: "not_json"; contentType: string | null }
  | { kind: "http"; status: number };

// What each service's challenge page carries, in place of the page asked for.
const BOT_CHECKS: readonly { by: BotCheck; signs: readonly string[] }[] = [
  { by: "Cloudflare", signs: ["<title>Just a moment...</title>", "/cdn-cgi/challenge-platform/"] },
  { by: "Incapsula", signs: ["_Incapsula_Resource"] },
];

function isJson(body: string): boolean {
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

// The media type alone: "text/html; charset=UTF-8" is "text/html".
function mediaType(contentType: string | null): string | null {
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  return type === undefined || type === "" ? null : type;
}

// null when the answer is a 2xx JSON body. A JSON body is never a bot check, whatever its text says.
export function feedProblem(answer: {
  status: number;
  contentType: string | null;
  body: string;
}): FeedProblem | null {
  const json = isJson(answer.body);
  const botCheck = json
    ? undefined
    : BOT_CHECKS.find(({ signs }) => signs.some((sign) => answer.body.includes(sign)));
  if (botCheck !== undefined) return { kind: "bot_check", by: botCheck.by };
  if ((answer.status === 401 || answer.status === 403) && json)
    return { kind: "restricted", status: answer.status };
  if (answer.status < 200 || answer.status >= 300) return { kind: "http", status: answer.status };
  return json ? null : { kind: "not_json", contentType: mediaType(answer.contentType) };
}

export function feedProblemMessage(problem: FeedProblem): string {
  switch (problem.kind) {
    case "bot_check":
      return `blocked by a bot check (${problem.by})`;
    case "restricted":
      return `restricted by the site (HTTP ${String(problem.status)})`;
    case "not_json":
      return `not valid JSON (${problem.contentType ?? "no content type"})`;
    case "http":
      return `HTTP ${String(problem.status)}`;
  }
}

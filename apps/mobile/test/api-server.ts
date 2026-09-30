import { type RecordedRequest, startServer } from "@mymeetingapp/test-server";

// jest.config.js points EXPO_PUBLIC_SERVER_URL here.
const API_PORT = 3197;

export interface TestApi {
  requests: RecordedRequest[];
  reply(path: string, json: unknown, status?: number): void;
  // The server takes the request and never answers.
  hang(path: string): void;
  close(): Promise<void>;
}

// A real HTTP server for the app's reads. Paths include the query string; an unexpected path answers 599, which the
// app treats as unreachable, so a test can't pass on a request it didn't expect.
export async function startApi(): Promise<TestApi> {
  const replies = new Map<string, { status: number; json: unknown } | "hang">();
  const server = await startServer(
    (path) => {
      const reply = replies.get(path);
      if (reply === "hang") return new Promise<never>(() => undefined);
      if (reply === undefined) return { status: 599, body: `no reply set for ${path}` };
      return {
        status: reply.status,
        body: JSON.stringify(reply.json),
        headers: { "content-type": "application/json" },
      };
    },
    { port: API_PORT },
  );
  return {
    requests: server.requests,
    reply: (path, json, status = 200) => {
      replies.set(path, { status, json });
    },
    hang: (path) => {
      replies.set(path, "hang");
    },
    close: server.close,
  };
}

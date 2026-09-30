import { type RecordedRequest, startServer } from "@mymeetingapp/test-server";

// jest.config.js points EXPO_PUBLIC_SERVER_URL here.
const API_PORT = 3197;

export interface TestApi {
  requests: RecordedRequest[];
  reply(path: string, json: unknown, status?: number): void;
  // The server takes the request and never answers.
  hang(path: string): void;
  // Requests on this path wait until the test calls the returned function with the reply, as a slow server does. A
  // later reply() or hang() applies to requests arriving after it; the waiting ones still get this answer.
  answerLater(path: string): (json: unknown) => void;
  close(): Promise<void>;
}

// A real HTTP server for the app's reads. Paths include the query string; an unexpected path answers 599, which the
// app treats as unreachable, so a test can't pass on a request it didn't expect.
export async function startApi(): Promise<TestApi> {
  const replies = new Map<string, { status: number; json: unknown } | "hang" | Promise<unknown>>();
  const jsonReply = (status: number, body: unknown) => ({
    status,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  const server = await startServer(
    (path) => {
      const reply = replies.get(path);
      if (reply === "hang") return new Promise<never>(() => undefined);
      if (reply === undefined) return { status: 599, body: `no reply set for ${path}` };
      if (reply instanceof Promise) return reply.then((body) => jsonReply(200, body));
      return jsonReply(reply.status, reply.json);
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
    answerLater: (path) => {
      let answer: (json: unknown) => void = () => undefined;
      replies.set(
        path,
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      return answer;
    },
    close: server.close,
  };
}

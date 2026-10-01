import { type RecordedRequest, startServer } from "@mymeetingapp/test-server";

// jest.config.js points EXPO_PUBLIC_SERVER_URL here.
const API_PORT = 3197;

export interface TestApi {
  requests: RecordedRequest[];
  // A reply given a method answers only that method on the path (PUT and DELETE share /api/v1/tags/:id).
  reply(path: string, json: unknown, status?: number, method?: string): void;
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
  // Every reply closes its connection: tests close and restart this server on the same port, and Node's fetch would
  // otherwise reuse a kept-alive socket to the closed one, failing a POST (never retried) as unreachable.
  const CLOSE = { connection: "close" };
  const jsonReply = (status: number, body: unknown) => ({
    status,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...CLOSE },
  });
  const server = await startServer(
    (path, _headers, method) => {
      const reply = replies.get(`${method} ${path}`) ?? replies.get(path);
      if (reply === "hang") return new Promise<never>(() => undefined);
      if (reply === undefined) return { status: 599, body: `no reply set for ${path}`, headers: CLOSE };
      if (reply instanceof Promise) return reply.then((body) => jsonReply(200, body));
      return jsonReply(reply.status, reply.json);
    },
    { port: API_PORT },
  );
  return {
    requests: server.requests,
    reply: (path, json, status = 200, method) => {
      replies.set(method === undefined ? path : `${method} ${path}`, { status, json });
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

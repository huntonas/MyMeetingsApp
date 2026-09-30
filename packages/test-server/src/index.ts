import { once } from "node:events";
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  path: string;
  method: string;
  // The request body as text, complete by the time the handler runs.
  body: string;
  headers: IncomingHttpHeaders;
  at: number;
  // Response body bytes the server managed to write before the client stopped reading or disconnected.
  sentBytes: number;
}

interface Reply {
  status: number;
  body?: string;
  headers?: Record<string, string>;
  // Streams `chunk` `count` times instead of sending `body`, pausing whenever the client stops reading.
  stream?: { chunk: string; count: number };
}

async function streamChunks(
  res: ServerResponse,
  record: RecordedRequest,
  { chunk, count }: { chunk: string; count: number },
) {
  const closed = once(res, "close");
  for (let i = 0; i < count && !res.destroyed; i++) {
    const flushed = res.write(chunk);
    record.sentBytes += Buffer.byteLength(chunk);
    if (!flushed) await Promise.race([once(res, "drain"), closed]);
  }
  res.end();
}

export async function startServer(
  handler: (path: string, headers: IncomingHttpHeaders) => Reply | Promise<Reply>,
  { port = 0 }: { port?: number } = {},
) {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    const record: RecordedRequest = {
      path,
      method: req.method ?? "GET",
      body: "",
      headers: req.headers,
      at: Date.now(),
      sentBytes: 0,
    };
    requests.push(record);
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      record.body = Buffer.concat(chunks).toString("utf8");
      void Promise.resolve(handler(path, req.headers)).then(async (reply) => {
        res.writeHead(reply.status, reply.headers);
        if (reply.stream === undefined) {
          record.sentBytes = Buffer.byteLength(reply.body ?? "");
          res.end(reply.body);
        } else {
          await streamChunks(res, record, reply.stream);
        }
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const { port: boundPort } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(boundPort)}`,
    port: boundPort,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        // A hanging response leaves its connection open; close() alone waits for it to end on its own.
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

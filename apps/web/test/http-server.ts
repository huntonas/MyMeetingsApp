import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

interface RecordedRequest {
  path: string;
  headers: IncomingHttpHeaders;
  at: number;
}

interface Reply {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

export async function startServer(handler: (path: string, headers: IncomingHttpHeaders) => Reply) {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    requests.push({ path, headers: req.headers, at: Date.now() });
    const reply = handler(path, req.headers);
    res.writeHead(reply.status, reply.headers);
    res.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}

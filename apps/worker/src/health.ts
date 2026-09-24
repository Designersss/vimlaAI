import { createServer, type Server, type ServerResponse } from "node:http";

export type WorkerReadinessProbe = () => Promise<boolean>;

export async function listenWorkerHealth(
  port: number,
  host = "127.0.0.1",
  readinessProbe?: WorkerReadinessProbe,
): Promise<Server> {
  const server = createServer((request, response) => {
    void handleRequest(request.method, request.url, response, readinessProbe);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      resolve();
    });
  });
  return server;
}

async function handleRequest(
  method: string | undefined,
  url: string | undefined,
  response: ServerResponse,
  readinessProbe?: WorkerReadinessProbe,
): Promise<void> {
  if (method !== "GET") {
    response.writeHead(404);
    response.end();
    return;
  }

  if (url === "/health" || url === "/") {
    writeJson(response, 200, { status: "ok" });
    return;
  }

  if (url === "/ready") {
    let ready = true;
    if (readinessProbe) {
      try {
        ready = await readinessProbe();
      } catch {
        ready = false;
      }
    }
    writeJson(
      response,
      ready ? 200 : 503,
      { status: ready ? "ok" : "not_ready" },
    );
    return;
  }

  response.writeHead(404);
  response.end();
}

function writeJson(
  response: ServerResponse,
  status: number,
  payload: Record<string, string>,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

export async function closeHttpServer(server: Server | undefined): Promise<void> {
  if (!server) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

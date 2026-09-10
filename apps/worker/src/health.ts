import { createServer, type Server } from "node:http";

export async function listenWorkerHealth(port: number, host = "127.0.0.1"): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method === "GET" && (request.url === "/health" || request.url === "/")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      resolve();
    });
  });
  return server;
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

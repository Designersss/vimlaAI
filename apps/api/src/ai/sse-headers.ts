export function sseResponseHeaders(webOrigin: string): Record<string, string> {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": webOrigin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
    "X-Accel-Buffering": "no",
  };
}

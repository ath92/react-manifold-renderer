// ─── Worker Entrypoint (Router) ─────────────────────────────────────────────
// Stateless Worker that routes requests to the correct DocumentRoom DO.

import type { Env } from "./document-room";

export { DocumentRoom } from "./document-room";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Routes: /rooms/:roomId/(ws|snapshot|history)
    // Room IDs may contain alphanumeric, underscore, hyphen, colon, and dot.
    const match = url.pathname.match(
      /^\/rooms\/([a-zA-Z0-9_:.\-]+)\/(ws|snapshot|history)$/,
    );
    if (!match) {
      return new Response("Not found", {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    const roomId = match[1];
    const id = env.DOCUMENT_ROOM.idFromName(roomId);
    const stub = env.DOCUMENT_ROOM.get(id);
    const response = await stub.fetch(request);

    // Add CORS headers to DO response (skip for WebSocket upgrades)
    if (response.status === 101) return response;
    const patched = new Response(response.body, response);
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      patched.headers.set(k, v);
    }
    return patched;
  },
};

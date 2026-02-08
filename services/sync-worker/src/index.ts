// ─── Worker Entrypoint (Router) ─────────────────────────────────────────────
// Stateless Worker that routes requests to the correct DocumentRoom DO.

import type { Env } from "./document-room";

export { DocumentRoom } from "./document-room";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Routes: /docs/:docId/(ws|snapshot|history)
    const match = url.pathname.match(
      /^\/docs\/([a-zA-Z0-9_-]+)\/(ws|snapshot|history)$/,
    );
    if (!match) {
      return new Response("Not found", { status: 404 });
    }

    const docId = match[1];
    const id = env.DOCUMENT_ROOM.idFromName(docId);
    const stub = env.DOCUMENT_ROOM.get(id);
    return stub.fetch(request);
  },
};

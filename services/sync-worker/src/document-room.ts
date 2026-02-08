// ─── DocumentRoom Durable Object ────────────────────────────────────────────
// Each Loro document lives in one DO instance. Clients connect via WebSocket
// (Hibernation API). Updates are WAL-persisted before broadcast. Snapshots
// are compacted via storage.setAlarm().

import { DurableObject } from "cloudflare:workers";
import { LoroDoc, VersionVector } from "loro-crdt";
import {
  TAG_C_UPDATE,
  TAG_C_AWARENESS,
  TAG_C_VERSION_VECTOR,
  TAG_S_UPDATE,
  TAG_S_AWARENESS,
  TAG_S_CATCHUP,
  TAG_S_PEER_ID,
  encodeMessage,
  decodeMessage,
  encodePeerId,
} from "./protocol";
import { generatePeerId } from "./peer-id";

export interface Env {
  DOCUMENT_ROOM: DurableObjectNamespace;
}

const COMPACTION_DELAY_MS = 5_000;

export class DocumentRoom extends DurableObject {
  private doc: LoroDoc | null = null;
  private nextSeq = 0;
  private dirty = false;

  // ─── Hydration ──────────────────────────────────────────────────────────

  /** Load the doc from storage on first access. Replays the WAL if needed. */
  private async hydrate(): Promise<LoroDoc> {
    if (this.doc) return this.doc;

    this.doc = new LoroDoc();

    // 1. Load snapshot
    const snapshot = await this.ctx.storage.get<ArrayBuffer>("doc:snapshot");
    if (snapshot) {
      this.doc.import(new Uint8Array(snapshot));
    }

    // 2. Restore WAL sequence counter
    this.nextSeq = (await this.ctx.storage.get<number>("update:seq")) ?? 0;

    // 3. Replay any un-compacted WAL entries
    const walEntries = await this.ctx.storage.list<ArrayBuffer>({
      prefix: "update:",
    });
    const updates: Uint8Array[] = [];
    for (const [key, value] of walEntries) {
      if (key === "update:seq") continue;
      updates.push(new Uint8Array(value));
    }

    if (updates.length > 0) {
      for (const u of updates) {
        this.doc.import(u);
      }
      // Compact immediately so next cold start is fast
      await this.compact();
    }

    return this.doc;
  }

  // ─── Snapshot compaction ────────────────────────────────────────────────

  /** Write a full snapshot to storage and clear the WAL. */
  private async compact(): Promise<void> {
    if (!this.doc) return;

    const snapshot = this.doc.export({ mode: "snapshot" });
    await this.ctx.storage.put("doc:snapshot", snapshot.buffer);

    // Delete all WAL entries
    const walKeys = await this.ctx.storage.list({ prefix: "update:" });
    const keysToDelete = [...walKeys.keys()].filter((k) => k !== "update:seq");
    if (keysToDelete.length > 0) {
      await this.ctx.storage.delete(keysToDelete);
    }

    await this.ctx.storage.put("update:seq", 0);
    this.nextSeq = 0;
    this.dirty = false;
  }

  // ─── Broadcast ──────────────────────────────────────────────────────────

  /** Send a tagged message to all connected WebSockets except `sender`. */
  private broadcast(
    sender: WebSocket,
    tag: number,
    payload: Uint8Array,
  ): void {
    const msg = encodeMessage(tag, payload);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === sender) continue;
      try {
        ws.send(msg);
      } catch {
        // Socket may have closed between getWebSockets() and send()
      }
    }
  }

  // ─── HTTP fetch handler ─────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const segment = url.pathname.split("/").pop();

    switch (segment) {
      case "snapshot":
        return this.handleSnapshot(url);
      case "history":
        return this.handleHistory();
      case "ws":
        return this.handleWebSocketUpgrade(request);
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  // ─── GET /snapshot ──────────────────────────────────────────────────────

  private async handleSnapshot(url: URL): Promise<Response> {
    const doc = await this.hydrate();

    const atParam = url.searchParams.get("at");
    if (atParam) {
      try {
        // Parse "peer1:counter1,peer2:counter2"
        const frontiers = atParam.split(",").map((entry) => {
          const [peer, counter] = entry.split(":");
          return { peer: peer as `${number}`, counter: parseInt(counter, 10) };
        });
        const fork = doc.forkAt(frontiers);
        const snapshot = fork.export({ mode: "snapshot" });
        return new Response(snapshot, {
          headers: { "Content-Type": "application/octet-stream" },
        });
      } catch (e) {
        return new Response(`Invalid frontiers: ${e}`, { status: 400 });
      }
    }

    const snapshot = doc.export({ mode: "snapshot" });
    return new Response(snapshot, {
      headers: { "Content-Type": "application/octet-stream" },
    });
  }

  // ─── GET /history ───────────────────────────────────────────────────────

  private async handleHistory(): Promise<Response> {
    const doc = await this.hydrate();
    const allChanges = doc.getAllChanges();

    // Flatten Map<PeerID, Change[]> into a JSON array
    const changes: Array<{
      peer: string;
      counter: number;
      lamport: number;
      length: number;
      timestamp: number;
      message: string | undefined;
      deps: Array<{ peer: string; counter: number }>;
    }> = [];

    for (const [peer, peerChanges] of allChanges) {
      for (const change of peerChanges) {
        changes.push({
          peer: String(peer),
          counter: change.counter,
          lamport: change.lamport,
          length: change.length,
          timestamp: change.timestamp,
          message: change.message,
          deps: change.deps.map((d) => ({
            peer: String(d.peer),
            counter: d.counter,
          })),
        });
      }
    }

    // Sort by lamport clock for a global causal ordering
    changes.sort((a, b) => a.lamport - b.lamport);

    return new Response(JSON.stringify(changes), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ─── WebSocket upgrade ──────────────────────────────────────────────────

  private async handleWebSocketUpgrade(
    request: Request,
  ): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    await this.hydrate();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const peerId = generatePeerId();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ peerId: peerId.toString() });

    // Send assigned peer ID
    server.send(encodeMessage(TAG_S_PEER_ID, encodePeerId(peerId)));

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── WebSocket message handler (Hibernation API) ────────────────────────

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message === "string") return;

    const { tag, payload } = decodeMessage(message);
    const doc = await this.hydrate();

    switch (tag) {
      case TAG_C_UPDATE: {
        // 1. Persist to WAL — MUST complete before broadcast
        const seq = this.nextSeq++;
        await this.ctx.storage.put(
          `update:${String(seq).padStart(8, "0")}`,
          payload.buffer.slice(
            payload.byteOffset,
            payload.byteOffset + payload.byteLength,
          ),
        );
        await this.ctx.storage.put("update:seq", this.nextSeq);

        // 2. Now safe to import + broadcast
        doc.import(payload);
        this.broadcast(ws, TAG_S_UPDATE, payload);

        // 3. Arm compaction alarm (resets on each update)
        this.dirty = true;
        await this.ctx.storage.setAlarm(Date.now() + COMPACTION_DELAY_MS);
        break;
      }

      case TAG_C_AWARENESS: {
        // Ephemeral — just relay, don't persist
        this.broadcast(ws, TAG_S_AWARENESS, payload);
        break;
      }

      case TAG_C_VERSION_VECTOR: {
        // Client sent its version vector (encoded via VersionVector.encode()).
        // Compute incremental updates since that version and send as catch-up.
        try {
          const clientVV = VersionVector.decode(payload);
          const catchUp = doc.export({ mode: "update", from: clientVV });
          ws.send(encodeMessage(TAG_S_CATCHUP, catchUp));
        } catch {
          // If decoding fails, send empty catch-up
          ws.send(encodeMessage(TAG_S_CATCHUP, new Uint8Array(0)));
        }
        break;
      }
    }
  }

  // ─── WebSocket close/error (Hibernation API) ───────────────────────────

  async webSocketClose(): Promise<void> {
    await this.compactIfEmpty();
  }

  async webSocketError(): Promise<void> {
    await this.compactIfEmpty();
  }

  /** If no peers remain, compact immediately. */
  private async compactIfEmpty(): Promise<void> {
    const remaining = this.ctx.getWebSockets();
    if (remaining.length === 0 && this.dirty) {
      await this.compact();
    }
  }

  // ─── Alarm handler ─────────────────────────────────────────────────────

  async alarm(): Promise<void> {
    if (!this.dirty) return;
    await this.compact();
  }
}

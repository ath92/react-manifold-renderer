// ─── Peer ID Generation ─────────────────────────────────────────────────────
// Each WebSocket connection gets a unique 64-bit peer ID used as the Loro peer.

/** Generate a random 64-bit peer ID. */
export function generatePeerId(): bigint {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  const view = new DataView(buf.buffer);
  return view.getBigUint64(0);
}

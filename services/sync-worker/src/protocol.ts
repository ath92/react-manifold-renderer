// ─── Wire Protocol ──────────────────────────────────────────────────────────
// All WebSocket messages are binary (ArrayBuffer) with a 1-byte tag prefix.

// Client → Server
export const TAG_C_UPDATE = 0x01;
export const TAG_C_AWARENESS = 0x02;
export const TAG_C_VERSION_VECTOR = 0x03;

// Server → Client
export const TAG_S_UPDATE = 0x81;
export const TAG_S_AWARENESS = 0x82;
export const TAG_S_CATCHUP = 0x83;
export const TAG_S_PEER_ID = 0x84;

/** Encode a tagged message: [tag, ...payload]. */
export function encodeMessage(tag: number, payload: Uint8Array): ArrayBuffer {
  const msg = new Uint8Array(1 + payload.length);
  msg[0] = tag;
  msg.set(payload, 1);
  return msg.buffer;
}

/** Decode a tagged message into tag + payload. */
export function decodeMessage(data: ArrayBuffer): {
  tag: number;
  payload: Uint8Array;
} {
  const bytes = new Uint8Array(data);
  return {
    tag: bytes[0],
    payload: bytes.subarray(1),
  };
}

/** Encode a bigint peer ID as 8 bytes (big-endian). */
export function encodePeerId(peerId: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, peerId);
  return buf;
}

/** Decode 8 bytes (big-endian) into a bigint peer ID. */
export function decodePeerId(bytes: Uint8Array): bigint {
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  return view.getBigUint64(0);
}

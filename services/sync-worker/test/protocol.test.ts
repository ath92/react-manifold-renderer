import { describe, it, expect } from "vitest";
import {
  TAG_C_UPDATE,
  TAG_S_UPDATE,
  TAG_S_PEER_ID,
  encodeMessage,
  decodeMessage,
  encodePeerId,
  decodePeerId,
} from "../src/protocol";

describe("encodeMessage / decodeMessage", () => {
  it("roundtrips a tagged message", () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const encoded = encodeMessage(TAG_C_UPDATE, payload);
    const { tag, payload: decoded } = decodeMessage(encoded);

    expect(tag).toBe(TAG_C_UPDATE);
    expect([...decoded]).toEqual([1, 2, 3, 4, 5]);
  });

  it("handles empty payload", () => {
    const encoded = encodeMessage(TAG_S_UPDATE, new Uint8Array(0));
    const { tag, payload } = decodeMessage(encoded);

    expect(tag).toBe(TAG_S_UPDATE);
    expect(payload.length).toBe(0);
  });

  it("preserves large payloads", () => {
    const payload = new Uint8Array(10_000);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 256;

    const encoded = encodeMessage(TAG_S_PEER_ID, payload);
    const { tag, payload: decoded } = decodeMessage(encoded);

    expect(tag).toBe(TAG_S_PEER_ID);
    expect(decoded.length).toBe(10_000);
    expect([...decoded]).toEqual([...payload]);
  });
});

describe("encodePeerId / decodePeerId", () => {
  it("roundtrips a peer ID", () => {
    const id = 0x0123456789ABCDEFn;
    const encoded = encodePeerId(id);
    expect(encoded.length).toBe(8);

    const decoded = decodePeerId(encoded);
    expect(decoded).toBe(id);
  });

  it("handles zero", () => {
    const encoded = encodePeerId(0n);
    const decoded = decodePeerId(encoded);
    expect(decoded).toBe(0n);
  });

  it("handles max u64", () => {
    const max = 0xFFFFFFFFFFFFFFFFn;
    const encoded = encodePeerId(max);
    const decoded = decodePeerId(encoded);
    expect(decoded).toBe(max);
  });
});

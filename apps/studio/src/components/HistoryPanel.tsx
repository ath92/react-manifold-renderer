import { useState, useCallback } from "react";
import { useHistoryChanges, forkTreeAt, type HistoryChange } from "../sync-store";
import { useSetPreviewTree, usePreviewTree } from "../store";
import type { PeerID } from "loro-crdt";

function formatTime(timestamp: number): string {
  if (timestamp === 0) return "unknown time";
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function shortPeer(peer: PeerID): string {
  return String(peer).slice(0, 6);
}

export function HistoryPanel() {
  const changes = useHistoryChanges();
  const previewTree = usePreviewTree();
  const setPreviewTree = useSetPreviewTree();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const handleBackToLive = useCallback(() => {
    setPreviewTree(null);
    setSelectedIdx(null);
  }, [setPreviewTree]);

  const handleSelect = useCallback(
    (change: HistoryChange, idx: number) => {
      const frontiers = [{ peer: change.peer, counter: change.counter + change.length - 1 }];
      const tree = forkTreeAt(frontiers);
      setPreviewTree(tree);
      setSelectedIdx(idx);
    },
    [setPreviewTree],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <h3 style={{ margin: "0 0 12px 0", fontSize: "14px" }}>History</h3>

      {previewTree && (
        <button
          onClick={handleBackToLive}
          style={{
            padding: "6px 10px",
            background: "#4fc3f7",
            color: "#000",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: 600,
            marginBottom: "12px",
          }}
        >
          Back to live
        </button>
      )}

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
        }}
      >
        {changes.length === 0 && (
          <p style={{ fontSize: "12px", color: "#666" }}>No changes yet</p>
        )}
        {/* Show newest first */}
        {[...changes].reverse().map((change, reverseIdx) => {
          const idx = changes.length - 1 - reverseIdx;
          const isSelected = selectedIdx === idx;
          return (
            <button
              key={`${change.peer}-${change.counter}`}
              onClick={() => handleSelect(change, idx)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px",
                background: isSelected ? "#334" : "#252525",
                border: isSelected ? "1px solid #4fc3f7" : "1px solid transparent",
                borderRadius: "4px",
                cursor: "pointer",
                textAlign: "left",
                color: "#ccc",
                fontSize: "12px",
              }}
            >
              <span style={{ flex: 1 }}>
                <span style={{ color: "#888" }}>{shortPeer(change.peer)}</span>
                {" "}
                <span style={{ color: "#aaa" }}>
                  {change.length} op{change.length !== 1 ? "s" : ""}
                </span>
              </span>
              <span style={{ color: "#666", fontSize: "11px", whiteSpace: "nowrap" }}>
                {formatTime(change.timestamp)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

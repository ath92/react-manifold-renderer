import { useState } from "react";
import type { CsgTreeNode } from "../types/CsgTree";
import { hasChildren } from "../types/CsgTree";

// ─── Color by node category ─────────────────────────────────────────────────

function getTypeColor(type: CsgTreeNode["type"]): string {
  switch (type) {
    case "union":
    case "difference":
    case "intersection":
      return "#c792ea";
    case "cube":
    case "sphere":
    case "cylinder":
    case "extrude":
      return "#c3e88d";
    case "group":
      return "#ffcb6b";
    case "transclude":
      return "#89ddff";
  }
}

// ─── Tree Node Row ───────────────────────────────────────────────────────────

const DEFAULT_EXPAND_DEPTH = 2;
const INDENT_PX = 16;

function CsgTreeNodeRow({
  node,
  depth,
  selectedId,
  cursorParentId,
  onSelect,
  onEnter,
}: {
  node: CsgTreeNode;
  depth: number;
  selectedId?: string | null;
  cursorParentId?: string | null;
  onSelect?: (node: CsgTreeNode) => void;
  onEnter?: (id: string | null) => void;
}) {
  const isParent = hasChildren(node);
  const [expanded, setExpanded] = useState(depth < DEFAULT_EXPAND_DEPTH);
  const isSelected = node.id === selectedId;
  const isCursorParent = node.id === cursorParentId;

  return (
    <div>
      <div
        style={{
          paddingLeft: depth * INDENT_PX,
          lineHeight: "22px",
          fontSize: "12px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          cursor: "pointer",
          userSelect: "none",
          backgroundColor: isSelected ? "#3a3a3a" : "transparent",
          borderLeft: isCursorParent
            ? "2px solid #4fc3f7"
            : "2px solid transparent",
          display: "flex",
          alignItems: "center",
        }}
        onClick={() => onSelect?.(node)}
        onDoubleClick={() => {
          if (isParent && onEnter) {
            onEnter(node.id);
          }
        }}
      >
        <span
          style={{
            color: "#888",
            marginRight: 6,
            fontSize: "10px",
            width: "12px",
            display: "inline-block",
            textAlign: "center",
            cursor: isParent ? "pointer" : "default",
          }}
          onClick={(e) => {
            if (isParent) {
              e.stopPropagation();
              setExpanded((v) => !v);
            }
          }}
        >
          {isParent ? (expanded ? "\u25BC" : "\u25B6") : "\u2022"}
        </span>
        <span
          style={{
            fontFamily: "monospace",
            color: getTypeColor(node.type),
          }}
        >
          {node.type === "transclude"
            ? `${node.roomId}${node.frontiers ? " (pinned)" : " (live)"}`
            : "name" in node && node.name
              ? node.name
              : node.type}
        </span>
      </div>
      {isParent &&
        expanded &&
        node.children.map((child, i) => (
          <CsgTreeNodeRow
            key={child.id ?? i}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            cursorParentId={cursorParentId}
            onSelect={onSelect}
            onEnter={onEnter}
          />
        ))}
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function CsgTreePanel({
  tree,
  selectedId,
  cursorParentId,
  onSelect,
  onEnter,
}: {
  tree: CsgTreeNode;
  selectedId?: string | null;
  cursorParentId?: string | null;
  onSelect?: (node: CsgTreeNode) => void;
  onEnter?: (id: string | null) => void;
}) {
  return (
    <fieldset
      style={{
        border: "1px solid #444",
        borderRadius: "4px",
        padding: "12px",
        maxHeight: "400px",
        overflowY: "auto",
      }}
    >
      <legend style={{ color: "#aaa", fontSize: "12px" }}>CSG Tree</legend>
      <CsgTreeNodeRow
        node={tree}
        depth={0}
        selectedId={selectedId}
        cursorParentId={cursorParentId}
        onSelect={onSelect}
        onEnter={onEnter}
      />
    </fieldset>
  );
}

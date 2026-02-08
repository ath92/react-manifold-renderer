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
    case "translate":
    case "rotate":
    case "scale":
      return "#82aaff";
    case "cube":
    case "sphere":
    case "cylinder":
    case "extrude":
      return "#c3e88d";
    case "group":
      return "#ffcb6b";
  }
}

// ─── Tree Node Row ───────────────────────────────────────────────────────────

const DEFAULT_EXPAND_DEPTH = 2;
const INDENT_PX = 16;

function CsgTreeNodeRow({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: CsgTreeNode;
  depth: number;
  selectedId?: string | null;
  onSelect?: (node: CsgTreeNode) => void;
}) {
  const isParent = hasChildren(node);
  const [expanded, setExpanded] = useState(depth < DEFAULT_EXPAND_DEPTH);
  const isSelected = node.id === selectedId;

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
          display: "flex",
          alignItems: "center",
        }}
        onClick={() => onSelect?.(node)}
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
          {"name" in node && node.name ? node.name : node.type}
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
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function CsgTreePanel({
  tree,
  selectedId,
  onSelect,
}: {
  tree: CsgTreeNode;
  selectedId?: string | null;
  onSelect?: (node: CsgTreeNode) => void;
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
        onSelect={onSelect}
      />
    </fieldset>
  );
}

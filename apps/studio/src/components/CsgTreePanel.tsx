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
}: {
  node: CsgTreeNode;
  depth: number;
}) {
  const isParent = hasChildren(node);
  const [expanded, setExpanded] = useState(depth < DEFAULT_EXPAND_DEPTH);

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
          cursor: isParent ? "pointer" : "default",
          userSelect: "none",
        }}
        onClick={isParent ? () => setExpanded((v) => !v) : undefined}
      >
        <span style={{ color: "#888", marginRight: 6, fontSize: "10px" }}>
          {isParent ? (expanded ? "\u25BC" : "\u25B6") : "\u2022"}
        </span>
        <span
          style={{
            fontFamily: "monospace",
            color: getTypeColor(node.type),
          }}
        >
          {node.type}
        </span>
      </div>
      {isParent &&
        expanded &&
        node.children.map((child, i) => (
          <CsgTreeNodeRow key={i} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function CsgTreePanel({ tree }: { tree: CsgTreeNode }) {
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
      <CsgTreeNodeRow node={tree} depth={0} />
    </fieldset>
  );
}

import React from "react";
import {
  Cube,
  Sphere,
  Cylinder,
  Extrude,
  Union,
  Difference,
  Intersection,
  Transform,
  Group,
} from "@manifold-studio/react-manifold";
import type { CsgTreeNode } from "../types/CsgTree";

interface CsgTreeRendererProps {
  node: CsgTreeNode;
}

export function CsgTreeRenderer({
  node,
}: CsgTreeRendererProps): React.ReactElement | null {
  const children =
    "children" in node
      ? node.children.map((child, i) => (
          <CsgTreeRenderer key={i} node={child} />
        ))
      : undefined;

  switch (node.type) {
    case "cube":
      return <Cube size={node.size} center={node.center} nodeId={node.id} />;
    case "sphere":
      return (
        <Sphere
          radius={node.radius}
          segments={node.segments}
          nodeId={node.id}
        />
      );
    case "cylinder":
      return (
        <Cylinder
          radius={node.radius}
          radiusLow={node.radiusLow}
          radiusHigh={node.radiusHigh}
          height={node.height}
          segments={node.segments}
          center={node.center}
          nodeId={node.id}
        />
      );
    case "extrude":
      return (
        <Extrude polygon={node.polygon} height={node.height} nodeId={node.id} />
      );
    case "union":
      return <Union>{children}</Union>;
    case "difference":
      return <Difference>{children}</Difference>;
    case "intersection":
      return <Intersection>{children}</Intersection>;
    case "transform":
      return <Transform matrix={node.matrix}>{children}</Transform>;
    case "group":
      return <Group>{children}</Group>;
    default: {
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}

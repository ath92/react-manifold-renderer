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

  let element: React.ReactElement | null;

  switch (node.type) {
    case "cube":
      element = <Cube size={node.size} center={node.center} nodeId={node.id} />;
      break;
    case "sphere":
      element = (
        <Sphere
          radius={node.radius}
          segments={node.segments}
          nodeId={node.id}
        />
      );
      break;
    case "cylinder":
      element = (
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
      break;
    case "extrude":
      element = (
        <Extrude polygon={node.polygon} height={node.height} nodeId={node.id} />
      );
      break;
    case "union":
      element = <Union>{children}</Union>;
      break;
    case "difference":
      element = <Difference>{children}</Difference>;
      break;
    case "intersection":
      element = <Intersection>{children}</Intersection>;
      break;
    case "group":
      element = <Group>{children}</Group>;
      break;
    case "transclude":
      // Transclude nodes should be resolved before reaching the renderer.
      // Render nothing if one slips through unresolved.
      return null;
    default: {
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }

  // Wrap with a Transform element if the node carries its own matrix
  if (node.matrix) {
    return <Transform matrix={node.matrix}>{element}</Transform>;
  }

  return element;
}

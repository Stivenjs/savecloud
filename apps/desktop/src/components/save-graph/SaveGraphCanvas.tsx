import "reactflow/dist/style.css";
import { useMemo, useCallback } from "react";
import ReactFlow, { Background, BackgroundVariant, Controls, MiniMap, type Edge, type Node } from "reactflow";
import { SaveGraphNode } from "@components/save-graph/SaveGraphNode";
import type { SaveGraphFlowNodeData } from "@utils/saveGraph.mapper";

const nodeTypes = {
  saveGraphNode: SaveGraphNode,
};

interface SaveGraphCanvasProps {
  nodes: Node<SaveGraphFlowNodeData>[];
  edges: Edge[];
  onNodeSelect?: (nodeId: string | null) => void;
}

/**
 * Canvas interactivo del grafo de guardados.
 */
export function SaveGraphCanvas({ nodes, edges, onNodeSelect }: SaveGraphCanvasProps) {
  const flowNodeCount = nodes.length;

  const handleNodeClick = useCallback(
    (_event: unknown, node: Node<SaveGraphFlowNodeData>) => {
      onNodeSelect?.(node.id);
    },
    [onNodeSelect]
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect?.(null);
  }, [onNodeSelect]);

  const minimapClassName = useMemo(() => "rounded-[18px] border border-divider bg-content2 shadow-sm", []);

  return (
    <div className="relative h-[min(72vh,900px)] min-h-140 w-full overflow-hidden rounded-[28px] border border-divider bg-content1 px-2 pt-2 pb-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(99,102,241,0.10),transparent_30%),radial-gradient(circle_at_18%_22%,rgba(16,185,129,0.08),transparent_24%),radial-gradient(circle_at_82%_72%,rgba(168,85,247,0.09),transparent_26%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent_22%,transparent_78%,rgba(255,255,255,0.02))] opacity-60" />

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.34, includeHiddenNodes: false }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        minZoom={0.22}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        className="relative z-10">
        <MiniMap
          zoomable
          pannable
          className={minimapClassName}
          maskColor="rgba(15, 23, 42, 0.22)"
          nodeColor="rgba(100, 116, 139, 0.72)"
          nodeStrokeColor="rgba(30, 41, 59, 0.75)"
        />
        <Controls showInteractive={false} className="rounded-full! border! border-divider! bg-content2! shadow-sm!" />
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="rgba(148,163,184,0.16)" />
        <Background variant={BackgroundVariant.Lines} gap={96} size={1} color="rgba(148,163,184,0.06)" />
      </ReactFlow>
      {flowNodeCount === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="rounded-full border border-dashed border-default-300/70 bg-default-50/80 px-4 py-2 text-xs text-default-500 shadow-sm backdrop-blur">
            No hay nodos para mostrar con los filtros actuales
          </div>
        </div>
      ) : null}
    </div>
  );
}

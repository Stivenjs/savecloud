import "reactflow/dist/style.css";
import { useMemo, useCallback } from "react";
import ReactFlow, { Background, Controls, MiniMap, type Edge, type Node } from "reactflow";
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
    <div className="relative h-[min(72vh,900px)] min-h-140 w-full overflow-hidden rounded-[28px] border border-divider bg-content1 p-2">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, includeHiddenNodes: false }}
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
        <Controls showInteractive={false} className="rounded-full! border! border-divider! bg-content2!" />
        <Background gap={22} size={1} color="rgba(148,163,184,0.28)" />
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

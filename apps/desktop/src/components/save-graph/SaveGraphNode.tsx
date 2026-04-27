import { Handle, Position, type NodeProps } from "reactflow";
import { Archive, CircleDot, Database, Gamepad2, Layers3, Sparkles } from "lucide-react";
import { formatRelativeDate } from "@utils/format";
import type { SaveGraphFlowNodeData } from "@utils/saveGraph.mapper";

const ICONS = {
  biblioteca: Database,
  juego: Gamepad2,
  actividad: CircleDot,
  respaldo: Archive,
  resumen: Layers3,
};

/**
 * Nodo premium reutilizable para el grafo de guardados.
 */
export function SaveGraphNode({ data, selected }: NodeProps<SaveGraphFlowNodeData>) {
  const Icon = ICONS[data.kind] ?? Sparkles;

  return (
    <div
      className={`relative overflow-hidden rounded-3xl border p-4 text-left transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${data.toneClassName} ${
        selected ? "ring-2 ring-primary/50" : ""
      }`}>
      <Handle type="target" position={Position.Top} className="h-2! w-2! border-0! bg-default-400/70" />
      <Handle type="source" position={Position.Bottom} className="h-2! w-2! border-0! bg-default-400/70" />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] opacity-70">{data.kindLabel}</p>
          <h3 className="truncate text-base font-semibold leading-tight">{data.title}</h3>
          {data.subtitle ? <p className="line-clamp-2 text-xs leading-5 opacity-80">{data.subtitle}</p> : null}
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-divider bg-content1 text-default-600">
          <Icon size={18} />
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-2 border-t border-divider/70 pt-3 text-xs">
        <div className="space-y-0.5">
          <p className="font-medium text-default-500">Estado</p>
          <p className="font-semibold">{data.status ?? "Sin estado"}</p>
        </div>
        <div className="text-right space-y-0.5">
          <p className="font-medium text-default-500">Métrica</p>
          <p className="font-semibold">{data.metric ?? "Sin datos"}</p>
        </div>
      </div>

      {data.timestamp ? (
        <div className="mt-3 text-[10px] uppercase tracking-[0.2em] text-default-500">
          {formatRelativeDate(data.timestamp)}
        </div>
      ) : null}
    </div>
  );
}

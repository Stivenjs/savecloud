/**
 * Leyenda compacta con la taxonomía visual del grafo.
 */
export function SaveGraphLegend() {
  return (
    <section className="rounded-3xl border border-divider bg-content1 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-default-500">Leyenda</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-default-600">
        <span className="rounded-full border border-success/30 bg-success/15 px-3 py-1">Juego</span>
        <span className="rounded-full border border-slate-400/30 bg-slate-500/15 px-3 py-1">Actividad</span>
        <span className="rounded-full border border-warning/30 bg-warning/15 px-3 py-1">Respaldo</span>
        <span className="rounded-full border border-secondary/30 bg-secondary/15 px-3 py-1">Biblioteca</span>
        <span className="rounded-full border border-divider bg-content2 px-3 py-1">Cronología</span>
        <span className="rounded-full border border-divider bg-content2 px-3 py-1">Respaldo (arista)</span>
      </div>
    </section>
  );
}

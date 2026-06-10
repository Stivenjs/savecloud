export default function WhySelfHosted() {
  const benefits = [
    "Sin costos de suscripción — solo pagas lo que usas en AWS",
    "Datos 100% bajo tu control",
    "Sin límites de almacenamiento artificiales",
    "Código abierto y auditable",
    "Actualizaciones gratuitas para siempre",
  ];

  return (
    <section className="border-b border-divider py-14 px-6 md:px-12 grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start">
      <div>
        <p className="text-xs uppercase tracking-widest text-default-400 font-medium">Por qué self-hosted</p>
      </div>
      <div className="space-y-4">
        {benefits.map((b, i) => (
          <div key={i} className="flex items-start gap-3 py-3 border-b border-divider last:border-0">
            <span className="text-xs font-mono text-default-300 mt-0.5">{String(i + 1).padStart(2, "0")}</span>
            <span className="text-sm md:text-base text-default-700">{b}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

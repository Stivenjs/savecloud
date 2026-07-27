export default function Security() {
  const security = [
    { title: "Tus archivos son tuyos", desc: "Almacenados en tu propio Docker local o cuenta de AWS" },
    { title: "Conexiones encriptadas", desc: "HTTPS/TLS en todas las comunicaciones" },
    { title: "Sin telemetría", desc: "Cero rastreo, cero analytics ocultos" },
    { title: "Código auditable", desc: "100% open source en GitHub" },
  ];

  return (
    <section className="border-b border-divider py-14 px-6 md:px-12 grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start">
      <div>
        <p className="text-xs uppercase tracking-widest text-default-400 font-medium">Seguridad</p>
      </div>
      <div>
        <div className="grid sm:grid-cols-2 gap-px bg-divider border border-divider rounded-xl overflow-hidden">
          {security.map((s, i) => (
            <div key={i} className="bg-background px-7 py-6">
              <h3 className="text-sm font-semibold mb-1">{s.title}</h3>
              <p className="text-xs text-default-500">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

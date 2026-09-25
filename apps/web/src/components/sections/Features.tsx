export default function Features() {
  const features = [
    {
      number: "01",
      title: "Tu propia nube",
      description:
        "Despliega tu infraestructura personal en AWS. Tú controlas tus datos, sin depender de servicios de terceros.",
    },
    {
      number: "02",
      title: "100% privado",
      description: "Tus partidas se almacenan en tu propia cuenta de AWS. Nadie más tiene acceso a tus archivos.",
    },
    {
      number: "03",
      title: "Invita a tus amigos",
      description:
        "Una vez desplegado, comparte tu instancia con amigos. Ellos solo necesitan las credenciales que generas.",
    },
    {
      number: "04",
      title: "Sincronización instantánea",
      description: "Sube y descarga partidas con un clic. Detección automática de cambios en tus archivos de guardado.",
    },
  ];

  return (
    <section className="border-b border-divider py-14 px-6 md:px-12">
      <div className="grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start mb-10">
        <p className="text-xs uppercase tracking-widest text-default-400 font-medium">Características</p>
      </div>
      <div className="grid sm:grid-cols-2 md:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-divider border border-divider rounded-xl overflow-hidden">
        {features.map((f) => (
          <div key={f.number} className="p-6 md:p-8">
            <p className="text-xs text-default-300 font-mono mb-4">{f.number}</p>
            <h3 className="text-sm font-semibold mb-2">{f.title}</h3>
            <p className="text-xs text-default-500 leading-relaxed">{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

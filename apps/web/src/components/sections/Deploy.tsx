export default function Deploy() {
  const deploySteps = [
    { cmd: "git clone https://github.com/Stivenjs/savecloud", label: "Clona el repositorio" },
    { cmd: "cd savecloud && bun run deploy:live", label: "Ejecuta el deploy" },
  ];

  return (
    <section className="border-b border-divider py-14 px-6 md:px-12 grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start">
      <div>
        <p className="text-xs uppercase tracking-widest text-default-400 font-medium">Deploy</p>
      </div>
      <div>
        <h2 className="text-2xl md:text-3xl font-bold mb-2">Listo en minutos</h2>
        <p className="text-default-500 mb-8 text-sm">Solo necesitas una cuenta de AWS y dos comandos.</p>
        <div className="space-y-3">
          {deploySteps.map((step, i) => (
            <div
              key={i}
              className="flex items-center gap-4 bg-default-100 rounded-lg px-5 py-4 border border-default-200">
              <span className="text-xs text-default-400 font-mono shrink-0 w-4">{i + 1}</span>
              <code className="text-sm font-mono text-foreground flex-1 overflow-x-auto">$ {step.cmd}</code>
              <span className="text-xs text-default-400 hidden md:block">{step.label}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-default-400 mt-4">
          El proceso genera automáticamente todas las credenciales necesarias para conectarte.
        </p>
      </div>
    </section>
  );
}

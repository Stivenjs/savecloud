import { Download } from "lucide-react";

export default function Hero() {
  const scrollToDownloads = () => {
    document.getElementById("downloads")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section id="hero" className="border-b border-divider py-16 px-6 md:px-12">
      <div className="flex items-center justify-between gap-4 mb-4">
        <p className="text-xs uppercase tracking-widest text-default-400 font-medium">
          Open Source · Privacidad Total · Docker & AWS
        </p>
        <button
          onClick={scrollToDownloads}
          className="flex items-center gap-2 bg-foreground text-background text-xs font-semibold px-4 py-2 rounded-full hover:opacity-90 active:scale-95 transition-all cursor-pointer">
          <Download size={14} />
          <span>Descargar App</span>
        </button>
      </div>
      <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-6 max-w-3xl">SaveCloud</h1>
      <p className="text-lg md:text-xl text-default-500 max-w-xl leading-relaxed">
        Tu infraestructura, tus reglas. Nuestra prioridad es tu privacidad, por eso ofrecemos alternativas 100%
        autohospedadas con 0 tracking de información. Sincroniza partidas en tu propio Docker local o cuenta de AWS,
        descarga el catálogo de Steam y compártelo con quien quieras.
      </p>
    </section>
  );
}

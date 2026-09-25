import { ShoppingBag, Download } from "lucide-react";

export default function Store() {
  const storeHighlights = [
    {
      number: "01",
      title: "Catálogo completo de Steam",
      description:
        "Explora el catálogo oficial de Steam directamente desde la app. Busca, descubre y consulta información de cualquier juego sin salir de SaveCloud.",
    },
    {
      number: "02",
      title: "Descarga vía torrent",
      description:
        "Descarga juegos directamente desde la tienda usando torrents, similar a Hydra Launcher. Integración nativa con el cliente torrent para una experiencia fluida.",
    },
    {
      number: "03",
      title: "Fichas detalladas",
      description:
        "Capturas, descripciones, reseñas y requisitos del sistema obtenidos directamente de Steam para cada título disponible.",
    },
    {
      number: "04",
      title: "Gestión desde un solo lugar",
      description:
        "Una vez descargado, SaveCloud sincroniza automáticamente tus partidas en la nube. Descarga y guarda, todo en la misma app.",
    },
  ];

  return (
    <section className="border-b border-divider py-14 px-6 md:px-12">
      <div className="grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start mb-10">
        <div>
          <p className="text-xs uppercase tracking-widest text-default-400 font-medium mb-3">Tienda</p>
          <div className="flex items-center gap-2 text-default-400">
            <ShoppingBag className="w-4 h-4" />
            <Download className="w-4 h-4" />
          </div>
        </div>
        <div>
          <h2 className="text-2xl md:text-3xl font-bold mb-2">Catálogo de Steam, descarga directa</h2>
          <p className="text-default-500 text-sm md:text-base leading-relaxed max-w-lg">
            Accede al catálogo completo de Steam desde la app. Encuentra el juego que quieras y descárgalo directamente
            mediante torrent, sin salir de SaveCloud. Una vez instalado, tus partidas se sincronizan automáticamente en
            tu nube.
          </p>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 md:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-divider border border-divider rounded-xl overflow-hidden">
        {storeHighlights.map((f) => (
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

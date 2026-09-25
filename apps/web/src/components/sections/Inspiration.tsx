import { Flame } from "lucide-react";

export default function Inspiration() {
  return (
    <section className="border-b border-divider py-14 px-6 md:px-12 grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start">
      <div>
        <p className="text-xs uppercase tracking-widest text-default-400 font-medium">Inspiración</p>
      </div>
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Flame className="w-5 h-5 text-default-400" />
          <h2 className="text-2xl md:text-3xl font-bold">Inspirado en Hydra Launcher</h2>
        </div>
        <p className="text-default-500 leading-relaxed text-sm md:text-base max-w-lg mb-4">
          SaveCloud nació inspirado en <span className="text-foreground font-semibold">Hydra Launcher</span>, el popular
          cliente open source que combina un catálogo de juegos con descargas por torrent. Tomamos esa idea y la
          llevamos un paso más allá: además de descargar juegos, SaveCloud te permite{" "}
          <span className="text-foreground font-semibold">
            sincronizar y respaldar tus partidas en tu propia infraestructura en AWS
          </span>
          , dándote control total sobre tus datos.
        </p>
        <p className="text-default-500 leading-relaxed text-sm md:text-base max-w-lg">
          Si ya usas Hydra Launcher, SaveCloud es el complemento perfecto: misma filosofía de acceso abierto, con la
          capa de nube privada que siempre faltó.
        </p>
      </div>
    </section>
  );
}

import { useNavigationStore } from "@features/input/store";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { Github, ArrowUpRight, ShoppingBag, Download, Flame } from "lucide-react";
import { Button, Link } from "@heroui/react";
import { openUrl } from "@tauri-apps/plugin-opener";

export function AboutPage() {
  const popLayer = useNavigationStore((s) => s.popLayer);

  useRegisterGlobalBack(() => {
    popLayer();
    return true;
  });

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

  const benefits = [
    "Sin costos de suscripción — solo pagas lo que usas en AWS",
    "Datos 100% bajo tu control",
    "Sin límites de almacenamiento artificiales",
    "Código abierto y auditable",
    "Actualizaciones gratuitas para siempre",
  ];

  const deploySteps = [
    { cmd: "git clone https://github.com/Stivenjs/savecloud", label: "Clona el repositorio" },
    { cmd: "cd savecloud && bun run deploy:live", label: "Ejecuta el deploy" },
  ];

  const security = [
    { title: "Tus archivos son tuyos", desc: "Almacenados en tu propia cuenta de AWS" },
    { title: "Conexiones encriptadas", desc: "HTTPS en todas las comunicaciones" },
    { title: "Sin telemetría", desc: "Cero rastreo, cero analytics ocultos" },
    { title: "Código auditable", desc: "100% open source en GitHub" },
  ];

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
    <div className="w-full">
      {/* Hero */}
      <section className="border-b border-divider py-16 px-6 md:px-12">
        <p className="text-xs uppercase tracking-widest text-default-400 mb-4 font-medium">
          Open Source · Self-Hosted · AWS
        </p>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-6 max-w-3xl">SaveCloud</h1>
        <p className="text-lg md:text-xl text-default-500 max-w-xl leading-relaxed">
          Tu infraestructura, tus reglas. Sincroniza partidas de videojuegos en tu propia nube, descarga títulos desde
          el catálogo de Steam y compártelo con quien quieras.
        </p>
      </section>

      {/* Qué es */}
      <section className="border-b border-divider py-14 px-6 md:px-12 grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start">
        <div>
          <p className="text-xs uppercase tracking-widest text-default-400 font-medium">¿Qué es?</p>
        </div>
        <div>
          <p className="text-base md:text-lg text-default-600 leading-relaxed mb-4">
            SaveCloud es una aplicación <span className="text-foreground font-semibold">open source y self-hosted</span>{" "}
            que sincroniza tus partidas guardadas de videojuegos con tu propia nube en AWS, e incluye una tienda
            integrada con el catálogo de Steam para descargar juegos vía torrent.
          </p>
          <p className="text-base md:text-lg text-default-600 leading-relaxed">
            A diferencia de otros servicios,{" "}
            <span className="text-foreground font-semibold">tú despliegas y controlas toda la infraestructura</span>.
            Nosotros te damos los scripts necesarios para tener tu instancia lista en minutos.
          </p>
        </div>
      </section>

      {/* Features */}
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

      {/* Tienda — Steam + Torrents */}
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
              Accede al catálogo completo de Steam desde la app. Encuentra el juego que quieras y descárgalo
              directamente mediante torrent, sin salir de SaveCloud. Una vez instalado, tus partidas se sincronizan
              automáticamente en tu nube.
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

      {/* Inspiración — Hydra Launcher */}
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
            SaveCloud nació inspirado en <span className="text-foreground font-semibold">Hydra Launcher</span>, el
            popular cliente open source que combina un catálogo de juegos con descargas por torrent. Tomamos esa idea y
            la llevamos un paso más allá: además de descargar juegos, SaveCloud te permite{" "}
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

      {/* Deploy */}
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

      {/* Por qué self-hosted */}
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

      {/* Comparte */}
      <section className="border-b border-divider py-14 px-6 md:px-12 grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start">
        <div>
          <p className="text-xs uppercase tracking-widest text-default-400 font-medium">Comparte</p>
        </div>
        <div>
          <h2 className="text-2xl md:text-3xl font-bold mb-4">Tu nube, tu comunidad</h2>
          <p className="text-default-500 leading-relaxed text-sm md:text-base max-w-lg">
            Una vez desplegada tu instancia, puedes invitar a tus amigos a usarla. Ellos solo necesitan las credenciales
            que genera el deploy. Perfecto para grupos que quieren compartir recursos y costos.
          </p>
        </div>
      </section>

      {/* Seguridad */}
      <section className="border-b border-divider py-14 px-6 md:px-12">
        <div className="grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start mb-10">
          <p className="text-xs uppercase tracking-widest text-default-400 font-medium">Seguridad</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-px bg-divider border border-divider rounded-xl overflow-hidden">
          {security.map((s, i) => (
            <div key={i} className="bg-background px-7 py-6">
              <h3 className="text-sm font-semibold mb-1">{s.title}</h3>
              <p className="text-xs text-default-500">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-6 md:px-12 flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div>
          <h2 className="text-3xl md:text-5xl font-bold mb-3">¿Listo para empezar?</h2>
          <p className="text-default-500 text-sm md:text-base max-w-md">
            Revisa el repositorio en GitHub para instrucciones detalladas y documentación completa.
          </p>
        </div>
        <div className="flex gap-3 shrink-0">
          <Button
            as={Link}
            href="https://github.com/Stivenjs/savecloud"
            target="_blank"
            rel="noopener noreferrer"
            color="primary"
            size="lg"
            onPress={async () => {
              await openUrl("https://github.com/Stivenjs/savecloud");
            }}
            startContent={<Github className="w-4 h-4" />}
            endContent={<ArrowUpRight className="w-4 h-4" />}>
            Ver en GitHub
          </Button>
        </div>
      </section>

      {/* Footer */}
      <div className="border-t border-divider px-6 md:px-12 py-6 flex items-center justify-between">
        <span className="text-xs text-default-400 font-medium">SaveCloud</span>
        <span className="text-xs text-default-300">Open Source · Self-Hosted · Hecho para gamers</span>
      </div>
    </div>
  );
}

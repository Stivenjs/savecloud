import { useState } from "react";
import { Container, HardDrive, Database, Check, Copy, Zap } from "lucide-react";

export default function DockerSection() {
  const [copied, setCopied] = useState(false);

  const dockerCommand = `git clone https://github.com/Stivenjs/savecloud.git\ncd savecloud && docker compose up -d`;

  const handleCopy = () => {
    navigator.clipboard.writeText(dockerCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const stackServices = [
    {
      name: "savecloud-api",
      desc: "API HTTP REST en Fastify + Worker de Catálogo Steam en segundo plano",
      badge: "Puerto 3000",
      icon: Zap,
    },
    {
      name: "savecloud-minio",
      desc: "Almacenamiento compatible con S3 local + Console Web de Administración",
      badge: "Puertos 9000 / 9001",
      icon: HardDrive,
    },
    {
      name: "savecloud-dynamodb",
      desc: "Base de datos ligera para estadísticas de uso e índices de partidas",
      badge: "Puerto 8000",
      icon: Database,
    },
    {
      name: "savecloud-create-bucket",
      desc: "Inicialización automática de buckets S3 locales sin intervención",
      badge: "Auto-init",
      icon: Container,
    },
  ];

  return (
    <section className="border-b border-divider py-14 px-6 md:px-12 grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start">
      <div>
        <p className="text-xs uppercase tracking-widest text-default-400 font-medium">Docker & Homelab</p>
      </div>
      <div>
        <h2 className="text-2xl md:text-3xl font-bold mb-2">Despliegue Local con Docker Compose</h2>
        <p className="text-default-500 mb-8 text-sm leading-relaxed">
          La alternativa ideal si prefieres 0 dependencia de la nube y 0 costos de hosting. Ejecuta la pila completa de
          SaveCloud en tu servidor local, Homelab, NAS (Unraid, TrueNAS, Synology) o PC con total privacidad y modo 100%
          offline.
        </p>

        {/* macOS Terminal Window Box */}
        <div className="mb-8 rounded-xl border border-divider bg-background p-5 md:p-6 relative">
          <div className="flex items-center justify-between border-b border-divider pb-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
              <span className="ml-2 text-xs font-mono text-default-400">docker-compose.yml · 1-Click Launch</span>
            </div>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-default-100 hover:bg-default-200 border border-divider text-default-700 text-xs font-medium transition-all active:scale-95 cursor-pointer">
              {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
              <span>{copied ? "¡Copiado!" : "Copiar"}</span>
            </button>
          </div>

          <pre className="font-mono text-xs md:text-sm text-foreground overflow-x-auto leading-relaxed">
            <code>
              <span className="text-default-400"># Clona el repositorio oficial</span>
              {"\n"}
              <span className="text-emerald-500 font-semibold">git clone</span>{" "}
              https://github.com/Stivenjs/savecloud.git{"\n\n"}
              <span className="text-default-400"># Inicia todos los servicios en segundo plano</span>
              {"\n"}
              <span className="text-emerald-500 font-semibold">cd</span> savecloud{" "}
              <span className="text-emerald-500 font-semibold">&&</span> docker compose up -d
            </code>
          </pre>
        </div>

        {/* Services Stack Grid */}
        <p className="text-xs uppercase tracking-widest text-default-400 font-medium mb-4">
          Servicios Incluidos en la Pila Docker
        </p>
        <div className="grid sm:grid-cols-2 gap-px bg-divider border border-divider rounded-xl overflow-hidden">
          {stackServices.map((srv, idx) => {
            const SrvIcon = srv.icon;
            return (
              <div key={idx} className="bg-background px-6 py-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <SrvIcon size={16} className="text-default-400" />
                      <h4 className="font-bold text-xs font-mono text-foreground">{srv.name}</h4>
                    </div>
                    <span className="text-[10px] font-mono text-default-400 bg-default-100 px-2 py-0.5 rounded border border-divider">
                      {srv.badge}
                    </span>
                  </div>
                  <p className="text-xs text-default-500 leading-relaxed">{srv.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

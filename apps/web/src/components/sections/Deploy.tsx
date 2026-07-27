import { useState } from "react";
import { Check, Copy, Zap, HardDrive, Database, Container } from "lucide-react";

export default function Deploy() {
  const [copiedDocker, setCopiedDocker] = useState(false);
  const [copiedAws, setCopiedAws] = useState(false);

  const dockerCommand = `git clone https://github.com/Stivenjs/savecloud.git\ncd savecloud && docker compose up -d`;
  const awsCommand = `git clone https://github.com/Stivenjs/savecloud.git\ncd savecloud && bun run deploy:live`;

  const copyDocker = () => {
    navigator.clipboard.writeText(dockerCommand);
    setCopiedDocker(true);
    setTimeout(() => setCopiedDocker(false), 2000);
  };

  const copyAws = () => {
    navigator.clipboard.writeText(awsCommand);
    setCopiedAws(true);
    setTimeout(() => setCopiedAws(false), 2000);
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
        <p className="text-xs uppercase tracking-widest text-default-400 font-medium">Deploy</p>
      </div>
      <div>
        <h2 className="text-2xl md:text-3xl font-bold mb-2">Listo en minutos</h2>
        <p className="text-default-500 mb-8 text-sm leading-relaxed">
          Ofrecemos dos alternativas 100% privadas y con 0 tracking de información: Docker Compose para tu servidor
          local u Homelab, o AWS Serverless para tu nube personal.
        </p>

        {/* OPCIÓN A: DOCKER COMPOSE */}
        <div className="mb-10">
          <p className="text-xs uppercase tracking-widest text-default-400 font-medium mb-3">
            OPCIÓN A: DOCKER COMPOSE (LOCAL / HOMELAB)
          </p>

          <div className="bg-default-100 rounded-lg p-5 border border-default-200 mb-4">
            <div className="flex items-center justify-between border-b border-default-200 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
                <span className="ml-2 text-xs font-mono text-default-400">docker-compose.yml · 0 AWS Costs</span>
              </div>
              <button
                onClick={copyDocker}
                className="flex items-center gap-1.5 px-3 py-1 rounded bg-background hover:bg-default-200 border border-default-200 text-default-700 text-xs font-medium transition-all active:scale-95 cursor-pointer">
                {copiedDocker ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                <span>{copiedDocker ? "¡Copiado!" : "Copiar"}</span>
              </button>
            </div>
            <pre className="font-mono text-xs md:text-sm text-foreground overflow-x-auto leading-relaxed">
              <code>
                <span className="text-default-400">
                  # Clona el repositorio y levanta la pila local (MinIO + DynamoDB)
                </span>
                {"\n"}
                <span className="font-semibold text-foreground">git clone</span>{" "}
                https://github.com/Stivenjs/savecloud.git{"\n"}
                <span className="font-semibold text-foreground">cd</span> savecloud{" "}
                <span className="font-semibold text-foreground">&&</span> docker compose up -d
              </code>
            </pre>
          </div>

          <p className="text-xs uppercase tracking-widest text-default-400 font-medium mb-3">
            Servicios Incluidos en el Contenedor
          </p>
          <div className="grid sm:grid-cols-2 gap-px bg-divider border border-divider rounded-xl overflow-hidden">
            {stackServices.map((srv, i) => {
              const SrvIcon = srv.icon;
              return (
                <div key={i} className="bg-background px-6 py-5 flex flex-col justify-between">
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

        {/* OPCIÓN B: AWS SERVERLESS */}
        <div className="mb-6">
          <p className="text-xs uppercase tracking-widest text-default-400 font-medium mb-3">
            OPCIÓN B: AWS SERVERLESS (NUBE PERSONAL)
          </p>

          <div className="bg-default-100 rounded-lg p-5 border border-default-200">
            <div className="flex items-center justify-between border-b border-default-200 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
                <span className="ml-2 text-xs font-mono text-default-400">serverless.yml · AWS Cloud</span>
              </div>
              <button
                onClick={copyAws}
                className="flex items-center gap-1.5 px-3 py-1 rounded bg-background hover:bg-default-200 border border-default-200 text-default-700 text-xs font-medium transition-all active:scale-95 cursor-pointer">
                {copiedAws ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                <span>{copiedAws ? "¡Copiado!" : "Copiar"}</span>
              </button>
            </div>
            <pre className="font-mono text-xs md:text-sm text-foreground overflow-x-auto leading-relaxed">
              <code>
                <span className="text-default-400"># Clona el repositorio y despliega en tu cuenta propia de AWS</span>
                {"\n"}
                <span className="font-semibold text-foreground">git clone</span>{" "}
                https://github.com/Stivenjs/savecloud.git{"\n"}
                <span className="font-semibold text-foreground">cd</span> savecloud{" "}
                <span className="font-semibold text-foreground">&&</span> bun run deploy:live
              </code>
            </pre>
          </div>
        </div>

        <p className="text-xs text-default-400">
          Ambas opciones generan automáticamente todas las credenciales necesarias sin intermediarios ni almacenamiento
          centralizado.
        </p>
      </div>
    </section>
  );
}

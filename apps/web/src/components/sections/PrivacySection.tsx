import { EyeOff, Lock, ShieldCheck, Server, Cpu, Database } from "lucide-react";

export default function PrivacySection() {
  const privacyPillars = [
    {
      icon: ShieldCheck,
      title: "Prioridad nº 1: Tu Privacidad",
      desc: "Diseñado desde la raíz para respetar tu intimidad con 0 tracking de datos de ningún tipo.",
    },
    {
      icon: EyeOff,
      title: "Sin telemetría ni analíticas",
      desc: "Cero rastreo de actividad, cero píxeles de seguimiento, cero recolección de tus hábitos de juego.",
    },
    {
      icon: Server,
      title: "Múltiples alternativas",
      desc: "Despliega en Docker local (100% offline en tu LAN) o en tu propia cuenta de AWS privada.",
    },
    {
      icon: Lock,
      title: "Tus archivos son tuyos",
      desc: "Guardados únicamente en tu infraestructura personal sin servidores centralizados de terceros.",
    },
    {
      icon: Cpu,
      title: "Conexiones encriptadas",
      desc: "HTTPS/TLS en todas las comunicaciones del sistema y firmas criptográficas HMAC.",
    },
    {
      icon: Database,
      title: "Código 100% auditable",
      desc: "Proyecto Open Source disponible transparentemente en GitHub sin cajas negras.",
    },
  ];

  return (
    <section className="border-b border-divider py-14 px-6 md:px-12 grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start">
      <div>
        <p className="text-xs uppercase tracking-widest text-default-400 font-medium">Privacidad & 0 Tracking</p>
      </div>
      <div>
        <h2 className="text-2xl md:text-3xl font-bold mb-2">Tu privacidad es nuestra prioridad</h2>
        <p className="text-default-500 mb-8 text-sm leading-relaxed">
          Diseñamos SaveCloud bajo la convención de que tus partidas guardadas, datos de juego y configuraciones son
          estrictamente tuyas. Ofrecemos alternativas de autohospedaje local con 0 telemetría comercial ni
          almacenamiento centralizado obligatorio.
        </p>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-px bg-divider border border-divider rounded-xl overflow-hidden">
          {privacyPillars.map((p, i) => {
            const Icon = p.icon;
            return (
              <div key={i} className="bg-background px-7 py-6">
                <div className="flex items-center gap-2 mb-2 text-default-400">
                  <Icon size={18} />
                  <h3 className="text-sm font-semibold text-foreground">{p.title}</h3>
                </div>
                <p className="text-xs text-default-500 leading-relaxed">{p.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

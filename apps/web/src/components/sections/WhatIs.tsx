export default function WhatIs() {
  return (
    <section className="border-b border-divider py-14 px-6 md:px-12 grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start">
      <div>
        <p className="text-xs uppercase tracking-widest text-default-400 font-medium">¿Qué es?</p>
      </div>
      <div>
        <p className="text-base md:text-lg text-default-600 leading-relaxed mb-4">
          SaveCloud es una aplicación <span className="text-foreground font-semibold">open source y self-hosted</span>{" "}
          que sincroniza tus partidas guardadas de videojuegos con tu propia nube en AWS, e incluye una tienda integrada
          con el catálogo de Steam para descargar juegos vía torrent.
        </p>
        <p className="text-base md:text-lg text-default-600 leading-relaxed">
          A diferencia de otros servicios,{" "}
          <span className="text-foreground font-semibold">tú despliegas y controlas toda la infraestructura</span>.
          Nosotros te damos los scripts necesarios para tener tu instancia lista en minutos.
        </p>
      </div>
    </section>
  );
}

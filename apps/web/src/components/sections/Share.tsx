export default function Share() {
  return (
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
  );
}

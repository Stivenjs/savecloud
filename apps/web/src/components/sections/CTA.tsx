import { ArrowUpRight } from "lucide-react";
import { Link } from "@heroui/react";

export default function CTA() {
  return (
    <section className="py-16 px-6 md:px-12 flex flex-col md:flex-row md:items-end justify-between gap-8">
      <div>
        <h2 className="text-3xl md:text-5xl font-bold mb-3">¿Listo para empezar?</h2>
        <p className="text-default-500 text-sm md:text-base max-w-md">
          Revisa el repositorio en GitHub para instrucciones detalladas y documentación completa.
        </p>
      </div>
      <div className="flex gap-3 shrink-0">
        <Link
          href="https://github.com/Stivenjs/savecloud"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-zinc-900 text-white dark:bg-white dark:text-black hover:opacity-90 active:scale-[0.98] transition-all rounded-full px-6 py-3 text-sm font-semibold justify-center">
          <svg
            role="img"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-6 h-6"
            xmlns="http://www.w3.org/2000/svg">
            <title>GitHub</title>
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
          <span>Ver en GitHub</span>
          <ArrowUpRight className="w-4 h-4" />
        </Link>
      </div>
    </section>
  );
}

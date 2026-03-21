import { Button } from "@heroui/react";

interface ErrorScreenProps {
  message?: string;
}

export function ErrorScreen({ message }: ErrorScreenProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Ocurrió un error inesperado</h1>

      <p className="text-default-500">Algo salió mal. Intenta reiniciar la aplicación.</p>

      {import.meta.env.DEV && message && (
        <pre className="max-w-xl overflow-auto rounded-md bg-default-100 p-4 text-left text-xs text-red-500">
          {message}
        </pre>
      )}

      <Button color="primary" onPress={() => window.location.reload()}>
        Reiniciar app
      </Button>
    </div>
  );
}

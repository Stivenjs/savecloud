import { useMemo, useState } from "react";
import { Button, Input } from "@heroui/react";
import { User } from "lucide-react";
import type { ProfileSessionSource } from "@store/ProfileSessionStore";
import { resolveProfileAsset } from "@utils/profileMedia";

export interface StartupProfileOption {
  readonly id: string;
  readonly name: string;
  readonly localUserId: string;
  readonly profileAvatarUrl: string | null;
  readonly source: ProfileSessionSource;
}

interface ProfileStartupSelectorProps {
  options: readonly StartupProfileOption[];
  selectingId: string | null;
  creatingProfile: boolean;
  error: string | null;
  onSelect: (profileId: string) => void;
  onCreateProfile: (input: {
    name: string;
    userId: string;
    apiBaseUrl: string;
    wsBaseUrl: string;
    apiKey: string;
  }) => void;
}

export function ProfileStartupSelector({
  options,
  selectingId,
  creatingProfile,
  error,
  onSelect,
  onCreateProfile,
}: ProfileStartupSelectorProps) {
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [wsBaseUrl, setWsBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  const canCreate = useMemo(
    () =>
      name.trim().length > 0 &&
      userId.trim().length > 0 &&
      apiBaseUrl.trim().length > 0 &&
      wsBaseUrl.trim().length > 0 &&
      apiKey.trim().length > 0 &&
      !creatingProfile &&
      selectingId == null,
    [name, userId, apiBaseUrl, wsBaseUrl, apiKey, creatingProfile, selectingId]
  );

  const submitCreate = () => {
    if (!canCreate) return;
    onCreateProfile({
      name: name.trim(),
      userId: userId.trim(),
      apiBaseUrl: apiBaseUrl.trim(),
      wsBaseUrl: wsBaseUrl.trim(),
      apiKey: apiKey.trim(),
    });
  };

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 bg-linear-to-br from-default-100/90 via-default-50/35 to-background dark:from-default-200/10 dark:via-default-100/5" />
      <div className="absolute inset-0 backdrop-blur-sm" />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-5xl items-center justify-center px-6 py-10">
        <section className="w-full rounded-2xl border border-default-200 bg-content1/85 p-8 shadow-2xl shadow-default-900/20 sm:p-10">
          <header className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3 text-foreground">
              <div className="flex size-9 items-center justify-center rounded-full border border-default-200 bg-default-100">
                <span className="text-base font-semibold">SC</span>
              </div>
              <span className="text-2xl font-semibold tracking-wide">SAVECLOUD</span>
            </div>
          </header>

          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl">¿Quien va a jugar?</h1>
            <p className="mt-3 text-sm text-default-500 sm:text-base">Selecciona el perfil activo para esta sesion.</p>
          </div>

          {error && (
            <div className="mx-auto mt-6 max-w-xl rounded-lg border border-danger-300/60 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700/50 dark:bg-danger-950/40 dark:text-danger-300">
              {error}
            </div>
          )}

          <div className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {options.map((option) => {
              const avatarSrc = resolveProfileAsset(option.profileAvatarUrl);
              const isSelecting = selectingId === option.id;
              const label = option.source === "config-default" ? "Default (config.json)" : "Perfil";

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSelect(option.id)}
                  disabled={selectingId != null}
                  className="group flex min-h-44 flex-col rounded-xl border border-default-200 bg-content2/65 p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:border-default-400 hover:bg-content2 disabled:cursor-not-allowed disabled:opacity-70">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full border border-default-300 bg-default-100 px-2 py-0.5 text-xs text-default-700 dark:border-default-600 dark:bg-default-200/10 dark:text-default-300">
                      {label}
                    </span>
                    {isSelecting && <span className="text-xs text-primary">Cambiando...</span>}
                  </div>

                  <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-3 text-center">
                    <div className="relative size-20 overflow-hidden rounded-md border border-default-300 bg-default-100 shadow-lg shadow-default-900/15 dark:bg-default-200/10">
                      {avatarSrc ? (
                        <img src={avatarSrc} alt="" decoding="async" className="size-full object-cover" />
                      ) : (
                        <div className="flex size-full items-center justify-center text-default-500">
                          <User size={34} strokeWidth={1.4} />
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="line-clamp-1 text-base font-semibold text-foreground">{option.name || "Perfil"}</p>
                      <p className="line-clamp-1 text-xs text-default-500">{option.localUserId || "Sin usuario"}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mx-auto mt-6 flex max-w-3xl justify-center">
            <Button
              color="primary"
              variant="flat"
              onPress={() => setCreatingOpen((v) => !v)}
              isDisabled={selectingId != null || creatingProfile}>
              {creatingOpen ? "Cancelar nuevo perfil" : "Crear nuevo perfil"}
            </Button>
          </div>

          {creatingOpen && (
            <div className="mx-auto mt-5 grid max-w-3xl gap-3 rounded-xl border border-default-200 bg-content2/70 p-4 sm:grid-cols-2">
              <Input label="Nombre" value={name} onValueChange={setName} placeholder="Mi perfil" />
              <Input label="User ID" value={userId} onValueChange={setUserId} placeholder="usuario123" />
              <Input
                label="API Base URL"
                value={apiBaseUrl}
                onValueChange={setApiBaseUrl}
                placeholder="https://api.savecloud.app"
              />
              <Input
                label="WS Base URL"
                value={wsBaseUrl}
                onValueChange={setWsBaseUrl}
                placeholder="wss://api.savecloud.app"
              />
              <Input
                className="sm:col-span-2"
                type="password"
                label="API Key"
                value={apiKey}
                onValueChange={setApiKey}
                placeholder="Clave API"
              />
              <div className="sm:col-span-2 flex justify-end">
                <Button color="primary" onPress={submitCreate} isDisabled={!canCreate} isLoading={creatingProfile}>
                  Crear y usar este perfil
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

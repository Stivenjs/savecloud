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
  onCreateProfile: (input: { name: string }) => void;
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

  const canCreate = useMemo(
    () => name.trim().length > 0 && !creatingProfile && selectingId == null,
    [name, creatingProfile, selectingId]
  );

  const submitCreate = () => {
    if (!canCreate) return;
    onCreateProfile({
      name: name.trim(),
    });
  };

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 bg-linear-to-br from-default-100/90 via-default-50/35 to-background dark:from-default-200/10 dark:via-default-100/5" />
      <div className="absolute inset-0 backdrop-blur-sm" />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-5xl items-center justify-center px-6 py-10">
        <section className="w-full p-3 sm:p-6">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-balance text-3xl font-semibold tracking-tight text-white sm:text-5xl">
              ¿Quién va a jugar?
            </h1>
          </div>

          {error && (
            <div className="mx-auto mt-6 max-w-xl rounded-lg border border-danger-300/60 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700/50 dark:bg-danger-950/40 dark:text-danger-300">
              {error}
            </div>
          )}

          <div className="mx-auto mt-10 flex max-w-3xl flex-wrap items-start justify-center gap-x-10 gap-y-8">
            {options.map((option) => {
              const avatarSrc = resolveProfileAsset(option.profileAvatarUrl);
              const isSelecting = selectingId === option.id;
              const accountDisplayName = option.localUserId.trim() || option.name.trim() || "Sin usuario";

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSelect(option.id)}
                  disabled={selectingId != null}
                  className="group flex w-40 flex-col items-center text-center transition duration-200 hover:-translate-y-0.5 cursor-pointer disabled:opacity-70">
                  <div className="relative size-28 overflow-hidden border border-white/55 bg-black/25 shadow-lg shadow-black/20 transition duration-200 group-hover:border-white group-hover:shadow-[0_0_0_2px_rgba(255,255,255,0.28)]">
                    {avatarSrc ? (
                      <img src={avatarSrc} alt="Avatar de perfil" decoding="async" className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-white/70">
                        <User size={34} strokeWidth={1.4} />
                      </div>
                    )}
                  </div>

                  <div className="mt-3">
                    <p className="line-clamp-1 text-3xl font-semibold text-white">{option.name || "Perfil"}</p>
                    <p className="line-clamp-1 text-xl text-white/65 opacity-0 transition duration-200 group-hover:opacity-100">
                      {accountDisplayName}
                    </p>
                    {isSelecting && <p className="mt-1 text-xs text-white/80">Cambiando...</p>}
                  </div>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setCreatingOpen((v) => !v)}
              disabled={selectingId != null || creatingProfile}
              className="group flex min-h-40 flex-col items-center justify-center rounded-xl border border-transparent bg-transparent transition duration-200 hover:bg-content2/20 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer">
              <div className="relative flex size-16 items-center justify-center border-2 border-transparent text-white transition duration-200 group-hover:border-white/90">
                <span className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-white" />
                <span className="pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2 bg-white" />
              </div>
              <span className="mt-2 text-xl font-semibold text-white/90 opacity-0 transition duration-200 group-hover:opacity-100">
                Añadir cuenta
              </span>
            </button>
          </div>

          {creatingOpen && (
            <div className="mx-auto mt-5 grid max-w-3xl gap-3 rounded-xl border border-default-200 bg-content2/70 p-4 sm:grid-cols-2">
              <Input
                className="sm:col-span-2"
                label="Nombre"
                value={name}
                onValueChange={setName}
                placeholder="Mi perfil"
              />
              <p className="sm:col-span-2 text-xs text-default-500">
                Podras configurar usuario, API URL y credenciales despues en Configuracion.
              </p>
              <div className="sm:col-span-2 flex justify-end">
                <Button color="primary" onPress={submitCreate} isDisabled={!canCreate} isLoading={creatingProfile}>
                  Crear perfil
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

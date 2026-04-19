import { useMemo, useState } from "react";
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { motion } from "framer-motion";
import { RefreshCw, Trash2, User } from "lucide-react";
import Avatar from "react-nice-avatar";
import { ProfileAvatarVisual } from "@features/profile/ProfileAvatarVisual";
import type { ProfileSessionSource } from "@store/ProfileSessionStore";
import { buildNiceAvatarConfig, generateNiceAvatarSeed, serializeNiceAvatarConfig } from "@features/profile/niceAvatar";

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
  deletingId: string | null;
  creatingProfile: boolean;
  error: string | null;
  onSelect: (profileId: string) => void;
  onCreateProfile: (input: { name: string; profileAvatarUrl?: string | null }) => Promise<void>;
  onDeleteProfile: (profileId: string) => Promise<void>;
}

export function ProfileStartupSelector({
  options,
  selectingId,
  deletingId,
  creatingProfile,
  error,
  onSelect,
  onCreateProfile,
  onDeleteProfile,
}: ProfileStartupSelectorProps) {
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [name, setName] = useState("");
  const [avatarSeed, setAvatarSeed] = useState(generateNiceAvatarSeed);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const generatedAvatarConfig = useMemo(() => {
    const seedPrefix = name.trim().toLowerCase();
    return buildNiceAvatarConfig(`${seedPrefix}|${avatarSeed}`);
  }, [name, avatarSeed]);

  const canCreate = useMemo(
    () => name.trim().length > 0 && !creatingProfile && selectingId == null,
    [name, creatingProfile, selectingId]
  );

  const submitCreate = async () => {
    if (!canCreate) return;
    const profileAvatarUrl = serializeNiceAvatarConfig(generatedAvatarConfig);
    await onCreateProfile({
      name: name.trim(),
      profileAvatarUrl,
    });
    setName("");
    setAvatarSeed(generateNiceAvatarSeed());
    setCreatingOpen(false);
  };

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 bg-linear-to-br from-background via-default-50/55 to-default-100/80 dark:from-default-200/10 dark:via-default-100/5 dark:to-background" />
      <div className="absolute inset-0 backdrop-blur-sm" />

      <motion.div
        layout="position"
        transition={{ type: "spring", stiffness: 140, damping: 22, mass: 0.95 }}
        className="relative mx-auto flex min-h-dvh w-full max-w-5xl items-center justify-center px-6 py-10">
        <motion.section
          layout="position"
          transition={{ type: "spring", stiffness: 145, damping: 21, mass: 0.92 }}
          className="w-full p-3 sm:p-6">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-5xl dark:text-white">
              ¿Quién va a jugar?
            </h1>
          </div>

          {error && (
            <div className="mx-auto mt-6 max-w-xl rounded-lg border border-danger-300/60 bg-danger-50 px-4 py-3 text-sm text-danger-700 shadow-sm shadow-danger-950/5 dark:border-danger-700/50 dark:bg-danger-950/40 dark:text-danger-300 dark:shadow-none">
              {error}
            </div>
          )}

          <motion.div
            layout="position"
            transition={{ type: "spring", stiffness: 150, damping: 20, mass: 0.9 }}
            className="mx-auto mt-10 flex max-w-3xl flex-wrap items-start justify-center gap-x-10 gap-y-8">
            {options.map((option) => {
              const isSelecting = selectingId === option.id;
              const isDeleting = deletingId === option.id;
              const accountDisplayName = option.localUserId.trim() || option.name.trim() || "Sin usuario";
              const isMenuOpen = openMenuId === option.id;

              const handleDeleteProfile = async () => {
                setOpenMenuId(null);
                await onDeleteProfile(option.id);
              };

              return (
                <motion.div
                  layout="position"
                  transition={{ type: "spring", stiffness: 170, damping: 22, mass: 0.85 }}
                  key={option.id}
                  className="group relative flex w-40 flex-col items-center text-center">
                  <button
                    type="button"
                    onClick={() => onSelect(option.id)}
                    disabled={selectingId != null || isDeleting}
                    className="flex w-full flex-col items-center text-center transition duration-200 hover:-translate-y-0.5 cursor-pointer disabled:opacity-70">
                    <div className="relative size-28 overflow-hidden border border-default-200 bg-content1/80 shadow-lg shadow-black/10 transition duration-200 group-hover:border-default-300 group-hover:shadow-[0_0_0_2px_rgba(15,23,42,0.08)] dark:border-white/20 dark:bg-black/25 dark:shadow-black/20 dark:group-hover:border-white/70 dark:group-hover:shadow-[0_0_0_2px_rgba(255,255,255,0.28)]">
                      {option.profileAvatarUrl ? (
                        <ProfileAvatarVisual
                          rawAvatar={option.profileAvatarUrl}
                          alt="Avatar de perfil"
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-default-500 dark:text-white/70">
                          <User size={34} strokeWidth={1.4} />
                        </div>
                      )}
                      {isDeleting && <div className="absolute inset-0 bg-black/35" />}
                    </div>

                    <div className="mt-3">
                      <p className="line-clamp-1 text-3xl font-semibold text-foreground dark:text-white">
                        {option.name || "Perfil"}
                      </p>
                      <p className="line-clamp-1 text-xl text-default-500 opacity-0 transition duration-200 group-hover:opacity-100 dark:text-white/65">
                        {accountDisplayName}
                      </p>
                      {isSelecting && <p className="mt-1 text-xs text-default-500 dark:text-white/80">Cambiando...</p>}
                      {isDeleting && <p className="mt-1 text-xs text-default-500 dark:text-white/80">Borrando...</p>}
                    </div>
                  </button>

                  <Popover
                    isOpen={isMenuOpen}
                    onOpenChange={(open) => setOpenMenuId(open ? option.id : null)}
                    placement="bottom-end"
                    showArrow={false}
                    shouldCloseOnBlur>
                    <PopoverTrigger>
                      <button
                        type="button"
                        aria-label="Opciones del perfil"
                        className="absolute top-21 right-6 z-10 flex size-6 items-center justify-center border border-default-300/80 bg-content1/90 text-foreground/80 opacity-0 shadow-sm shadow-black/5 transition duration-150 hover:bg-content2/90 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 dark:border-white/20 dark:bg-[#6a7079]/65 dark:text-white/85 dark:shadow-black/10 dark:hover:bg-[#7a8089]/80 dark:hover:text-white"
                        disabled={selectingId != null || creatingProfile || isDeleting}>
                        <span className="-translate-y-px text-[14px] leading-none tracking-tight">•••</span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="min-w-48 rounded-none border-0 bg-[#3f434d] px-4 py-3 text-white shadow-2xl shadow-black/40">
                      <div className="space-y-3">
                        <p className="text-sm font-semibold text-white/90">¿Eliminar esta cuenta?</p>
                        <Button
                          color="danger"
                          variant="flat"
                          size="sm"
                          className="w-full justify-center rounded-none bg-white/10 text-white hover:bg-white/15"
                          startContent={<Trash2 size={14} />}
                          isDisabled={selectingId != null || creatingProfile || isDeleting}
                          onPress={() => void handleDeleteProfile()}>
                          Eliminar cuenta
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </motion.div>
              );
            })}

            <motion.button
              layout="position"
              transition={{ type: "spring", stiffness: 170, damping: 22, mass: 0.85 }}
              type="button"
              onClick={() => setCreatingOpen((v) => !v)}
              disabled={selectingId != null || creatingProfile}
              className="group flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border border-transparent bg-transparent text-foreground transition duration-200 hover:bg-content2/40 disabled:cursor-not-allowed disabled:opacity-50 dark:text-white dark:hover:bg-content2/20">
              <div
                className={`relative flex size-16 items-center justify-center border-2 border-transparent text-foreground transition duration-300 group-hover:border-foreground/80 dark:text-white dark:group-hover:border-white/90 ${
                  creatingOpen ? "rotate-45" : "rotate-0"
                }`}>
                <span className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-current" />
                <span className="pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2 bg-current" />
              </div>
              <span className="mt-2 text-xl font-semibold text-foreground/90 opacity-0 transition duration-200 group-hover:opacity-100 dark:text-white/90">
                Añadir cuenta
              </span>
            </motion.button>
          </motion.div>

          <motion.div
            initial={false}
            animate={
              creatingOpen
                ? { height: "auto", opacity: 1, y: 0, marginTop: 24 }
                : { height: 0, opacity: 0, y: -8, marginTop: 0 }
            }
            transition={{ type: "spring", stiffness: 190, damping: 24, mass: 0.75 }}
            className="mx-auto max-w-xl overflow-hidden">
            <div className="rounded-2xl border border-default-200 bg-background/85 p-5 text-foreground shadow-2xl shadow-black/10 backdrop-blur-md sm:p-6 dark:border-white/10 dark:bg-black/25 dark:text-white dark:shadow-black/25">
              <div className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold tracking-tight text-foreground dark:text-white">
                    Crear nuevo perfil
                  </h2>
                  <p className="text-sm text-default-500 dark:text-white/60">
                    Usa un nombre claro para identificar esta cuenta más tarde.
                  </p>
                </div>

                <div className="flex items-center gap-4 rounded-xl border border-default-200 bg-content1/80 p-3 dark:border-white/10 dark:bg-white/5">
                  <div className="relative size-20 overflow-hidden rounded-md border border-default-200 bg-content2/60 shadow-lg shadow-black/10 dark:border-white/20 dark:bg-black/30 dark:shadow-black/30">
                    <Avatar className="size-full" shape="square" {...generatedAvatarConfig} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground/85 dark:text-white/85">
                      Avatar generado automáticamente
                    </p>
                    <p className="text-xs text-default-500 dark:text-white/55">
                      Puedes regenerarlo antes de crear el perfil.
                    </p>
                    <Button
                      size="sm"
                      variant="flat"
                      className="mt-2 rounded-md bg-content2/70 text-foreground hover:bg-content2/90 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
                      startContent={<RefreshCw size={14} />}
                      onPress={() => setAvatarSeed(generateNiceAvatarSeed())}
                      isDisabled={creatingProfile || selectingId != null}>
                      Regenerar avatar
                    </Button>
                  </div>
                </div>

                <Input
                  label="Nombre"
                  labelPlacement="outside"
                  value={name}
                  onValueChange={setName}
                  placeholder="Mi perfil"
                  variant="bordered"
                  size="sm"
                  classNames={{
                    label: "text-default-600 dark:text-white/70",
                    input:
                      "text-foreground placeholder:text-default-400 dark:text-white dark:placeholder:text-white/35",
                    inputWrapper:
                      "border-default-200 bg-background/80 shadow-none hover:border-default-300 data-[hover=true]:border-default-300 group-data-[focus=true]:border-primary/60 dark:border-white/15 dark:bg-white/5 dark:hover:border-white/30 dark:data-[hover=true]:border-white/30 dark:group-data-[focus=true]:border-white/55",
                  }}
                />

                <p className="text-xs text-default-500 dark:text-white/45">
                  Después podrás configurar usuario, API URL y credenciales desde Configuración.
                </p>

                <div className="flex justify-end">
                  <Button
                    color="primary"
                    variant="solid"
                    size="sm"
                    onPress={() => void submitCreate()}
                    isDisabled={!canCreate}
                    isLoading={creatingProfile}
                    className="min-w-36">
                    Crear perfil
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.section>
      </motion.div>
    </div>
  );
}

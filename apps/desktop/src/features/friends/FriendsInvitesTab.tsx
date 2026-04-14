import { useState } from "react";
import { Avatar, Button, Chip, Divider, Input, Skeleton, Tab, Tabs } from "@heroui/react";
import { Check, Cloud, Copy, LogOut, Mail, Plus, RefreshCcw, Trash2, UserRound, Eye, X } from "lucide-react";
import type { CloudInvite, CloudMembership } from "@services/tauri/invites.service";

function SectionCard({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-default-100 bg-default-50/40 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-default-100">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-default-100 text-default-600">
            {icon}
          </span>
          <p className="text-sm font-semibold text-foreground">{title}</p>
        </div>
        {action}
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  );
}

function EmptyState({ message, icon }: { message: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
      <div className="h-10 w-10 rounded-full bg-default-100 flex items-center justify-center">
        {icon ?? <Mail className="h-5 w-5 text-default-400" />}
      </div>
      <p className="text-sm text-default-500">{message}</p>
    </div>
  );
}

interface FriendsInvitesTabProps {
  inviteeUserIdInput: string;
  setInviteeUserIdInput: (value: string) => void;
  inviteTokenInput: string;
  setInviteTokenInput: (value: string) => void;
  inviteBusy: boolean;
  pendingInvites: CloudInvite[];
  hostMemberships: CloudMembership[];
  memberMemberships: CloudMembership[];
  refreshInvitesState: () => void | Promise<void>;
  handleCreateInvite: () => void | Promise<void>;
  handleAcceptInviteByToken: () => void | Promise<void>;
  handleRespondInvite: (inviteId: string, action: "accept" | "reject") => void | Promise<void>;
  handleLeaveMembership: (hostUserId: string) => void | Promise<void>;
  handleRemoveMember: (memberUserId: string) => void | Promise<void>;
  handleUseHostCloud: (hostUserId: string | null) => void | Promise<void>;
  activeCloudHostUserId: string | null;
  lastCreatedInviteToken: string | null;
  handleCopyLastToken: () => void | Promise<void>;
  invitesStatsLoading: boolean;
  /** Carga el perfil (miembro o anfitrión) en la pestaña Buscar por usuario. */
  onViewCloudPeerProfile: (userId: string) => void;
  /** Opcional: Configuración local para comparar URLs de WebSocket descifradas. */
  ourConfig?: any;
}

export function FriendsInvitesTab({
  inviteeUserIdInput,
  setInviteeUserIdInput,
  inviteTokenInput,
  setInviteTokenInput,
  inviteBusy,
  pendingInvites,
  hostMemberships,
  memberMemberships,
  refreshInvitesState,
  handleCreateInvite,
  handleAcceptInviteByToken,
  handleRespondInvite,
  handleLeaveMembership,
  handleRemoveMember,
  handleUseHostCloud,
  activeCloudHostUserId,
  lastCreatedInviteToken,
  handleCopyLastToken,
  invitesStatsLoading,
  onViewCloudPeerProfile,
  ourConfig,
}: FriendsInvitesTabProps) {
  const [view, setView] = useState<"requests" | "cloud">("requests");

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-default-500">
          Comparte un enlace para que tu amigo pueda acceder a la nube del anfitrión (sin configuración manual).
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {invitesStatsLoading ? (
          <>
            <Skeleton className="h-7 w-38 rounded-full" />
            <Skeleton className="h-7 w-44 rounded-full" />
            <Skeleton className="h-7 w-46 rounded-full" />
          </>
        ) : (
          <>
            <Chip size="sm" variant="flat" color="primary">
              Pendientes: {pendingInvites.length}
            </Chip>
            <Chip size="sm" variant="flat" color="secondary">
              Nubes compartidas: {memberMemberships.length}
            </Chip>
            <Chip size="sm" variant="flat" color="warning">
              Miembros en tu nube: {hostMemberships.length}
            </Chip>
          </>
        )}
      </div>

      <Tabs
        selectedKey={view}
        onSelectionChange={(key) => setView((String(key) as "requests" | "cloud") || "requests")}
        variant="underlined"
        classNames={{ panel: "pt-4" }}>
        <Tab
          key="requests"
          title={
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              <span>Solicitudes</span>
            </div>
          }>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <SectionCard title="Enviar invitación" icon={<Plus className="h-4 w-4" />}>
                <div className="space-y-3 md:max-w-md">
                  <Input
                    label="Usuario del invitado (opcional)"
                    labelPlacement="outside"
                    placeholder="Ej: gabi21"
                    value={inviteeUserIdInput}
                    onValueChange={setInviteeUserIdInput}
                    variant="bordered"
                    size="sm"
                    startContent={<UserRound className="h-3.5 w-3.5 text-default-400 shrink-0" />}
                  />
                  <p className="text-xs text-default-500">
                    Si lo dejas vacío, generas un enlace con código (token) para cualquiera que lo reciba.
                  </p>
                  <Button
                    color="primary"
                    variant="solid"
                    isLoading={inviteBusy}
                    onPress={handleCreateInvite}
                    className="w-full"
                    size="sm">
                    Crear invitación
                  </Button>

                  {lastCreatedInviteToken && (
                    <>
                      <Divider />
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-default-500 uppercase tracking-wide">
                          Enlace de invitación
                        </p>
                        <div className="rounded-xl bg-default-100 border border-default-200 p-3">
                          <p className="font-mono text-xs break-all text-foreground leading-relaxed">
                            {lastCreatedInviteToken}
                          </p>
                        </div>
                        <p className="text-xs text-default-500">
                          Pásaselo a tu amigo: puede pegarlo aquí para aceptar (sin configurar nada).
                        </p>
                        <Button
                          size="sm"
                          variant="flat"
                          color="default"
                          className="w-full"
                          startContent={<Copy className="h-3.5 w-3.5" />}
                          onPress={() => void handleCopyLastToken()}>
                          Copiar enlace
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </SectionCard>

              <SectionCard title="Aceptar invitación" icon={<Check className="h-4 w-4" />}>
                <div className="space-y-3 md:max-w-md">
                  <Input
                    label="Enlace o código de invitación"
                    labelPlacement="outside"
                    placeholder="Pega el enlace completo o el código"
                    value={inviteTokenInput}
                    onValueChange={setInviteTokenInput}
                    variant="bordered"
                    size="sm"
                    startContent={<Mail className="h-3.5 w-3.5 text-default-400 shrink-0" />}
                  />
                  <p className="text-xs text-default-500">
                    Si pegas un enlace (recomendado), la app descubre automáticamente la URL del servidor.
                  </p>
                  <Button
                    color="primary"
                    variant="solid"
                    isLoading={inviteBusy}
                    isDisabled={!inviteTokenInput.trim() || inviteBusy}
                    onPress={handleAcceptInviteByToken}
                    className="w-full"
                    size="sm"
                    startContent={!inviteBusy && <Check className="h-3.5 w-3.5" />}>
                    Aceptar invitación
                  </Button>
                </div>
              </SectionCard>
            </div>

            <SectionCard
              title="Invitaciones pendientes"
              icon={<Mail className="h-4 w-4" />}
              action={
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="light"
                    startContent={<RefreshCcw className="h-3.5 w-3.5" />}
                    onPress={() => void refreshInvitesState()}>
                    Actualizar ahora
                  </Button>
                </div>
              }>
              <p className="mb-3 text-xs text-default-500">Se actualiza sola mientras tengas abierta esta pestaña.</p>
              {pendingInvites.length === 0 ? (
                <EmptyState
                  message="No tienes invitaciones pendientes."
                  icon={<Mail className="h-5 w-5 text-default-400" />}
                />
              ) : (
                <div className="space-y-2">
                  {pendingInvites.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-default-200 bg-default-50 p-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={invite.hostUserId} size="sm" className="shrink-0" color="primary" isBordered />
                        <div>
                          <p className="text-sm font-medium">{invite.hostUserId}</p>
                          <p className="text-xs text-default-400">
                            Expira {new Date(invite.expiresAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          color="success"
                          variant="flat"
                          startContent={<Check className="h-3.5 w-3.5" />}
                          onPress={() => void handleRespondInvite(invite.id, "accept")}>
                          Aceptar
                        </Button>
                        <Button
                          size="sm"
                          color="danger"
                          variant="light"
                          startContent={<X className="h-3.5 w-3.5" />}
                          onPress={() => void handleRespondInvite(invite.id, "reject")}>
                          Rechazar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        </Tab>

        <Tab
          key="cloud"
          title={
            <div className="flex items-center gap-2">
              <Cloud className="h-4 w-4" />
              <span>Nube compartida</span>
            </div>
          }>
          <div className="grid gap-4 md:grid-cols-2">
            <SectionCard title="Nube activa para sincronización" icon={<Cloud className="h-4 w-4" />}>
              <div className="space-y-3">
                <p className="text-xs text-default-500">Selecciona qué nube usar para sincronizar tus saves.</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={activeCloudHostUserId ? "flat" : "solid"}
                    color={activeCloudHostUserId ? "default" : "primary"}
                    startContent={<Cloud className="h-3.5 w-3.5" />}
                    onPress={() => void handleUseHostCloud(null)}>
                    Mi nube
                  </Button>
                  {memberMemberships.map((m) => (
                    <Button
                      key={`active-${m.hostUserId}`}
                      size="sm"
                      variant={activeCloudHostUserId === m.hostUserId ? "solid" : "flat"}
                      color={activeCloudHostUserId === m.hostUserId ? "primary" : "default"}
                      onPress={() => void handleUseHostCloud(m.hostUserId)}>
                      {m.hostUserId}
                    </Button>
                  ))}
                </div>

                <Divider />

                <div>
                  <p className="text-xs font-medium text-default-500 uppercase tracking-wide mb-2">
                    Nubes donde eres miembro
                  </p>
                  {memberMemberships.length === 0 ? (
                    <EmptyState
                      message="No perteneces a ninguna nube compartida."
                      icon={<Cloud className="h-5 w-5 text-default-400" />}
                    />
                  ) : (
                    <div className="space-y-2">
                      {memberMemberships.map((m) => (
                        <div
                          key={`${m.hostUserId}-${m.memberUserId}`}
                          className="flex flex-col gap-2 rounded-lg border border-default-200 bg-default-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <Avatar name={m.hostUserId} size="sm" color="secondary" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">{m.hostUserId}</p>
                              <p className="text-[10px] text-default-400">Anfitrión</p>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-2">
                            {m.wsUrl && ourConfig?.cloudHostWsBaseUrls?.[m.hostUserId] !== m.wsUrl && (
                              <Button
                                size="sm"
                                variant="flat"
                                color="warning"
                                startContent={<RefreshCcw className="h-3.5 w-3.5" />}
                                onPress={() => void handleUseHostCloud(m.hostUserId)}>
                                Sincronizar conexión
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="flat"
                              color="primary"
                              startContent={<Eye className="h-3.5 w-3.5" />}
                              onPress={() => onViewCloudPeerProfile(m.hostUserId)}>
                              Ver perfil
                            </Button>
                            <Button
                              size="sm"
                              variant="light"
                              color="warning"
                              startContent={<LogOut className="h-3.5 w-3.5" />}
                              onPress={() => void handleLeaveMembership(m.hostUserId)}>
                              Salir
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Miembros en tu nube" icon={<UserRound className="h-4 w-4" />}>
              <div className="space-y-3">
                <p className="text-xs text-default-500">Usuarios que tienen acceso a tu nube como miembros.</p>
                {hostMemberships.length === 0 ? (
                  <EmptyState
                    message="No tienes miembros activos en tu nube."
                    icon={<UserRound className="h-5 w-5 text-default-400" />}
                  />
                ) : (
                  <div className="space-y-2">
                    {hostMemberships.map((m) => (
                      <div
                        key={`${m.hostUserId}-${m.memberUserId}`}
                        className="flex flex-col gap-2 rounded-lg border border-default-200 bg-default-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar name={m.memberUserId} size="sm" color="danger" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{m.memberUserId}</p>
                            <p className="text-[10px] text-default-400">Miembro</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            variant="flat"
                            color="primary"
                            startContent={<Eye className="h-3.5 w-3.5" />}
                            onPress={() => onViewCloudPeerProfile(m.memberUserId)}>
                            Ver perfil
                          </Button>
                          <Button
                            size="sm"
                            variant="light"
                            color="danger"
                            startContent={<Trash2 className="h-3.5 w-3.5" />}
                            onPress={() => void handleRemoveMember(m.memberUserId)}>
                            Eliminar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </Tab>
      </Tabs>
    </div>
  );
}

export function InvitesTabTitle({ pendingCount, statsLoading }: { pendingCount: number; statsLoading?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Mail className="h-4 w-4" />
      <span>Invitaciones</span>
      {statsLoading ? (
        <Skeleton className="h-5 w-6 rounded-md" />
      ) : pendingCount > 0 ? (
        <Chip size="sm" color="primary" variant="solid" className="h-4 min-w-4 px-1 text-[10px]">
          {pendingCount}
        </Chip>
      ) : null}
    </div>
  );
}

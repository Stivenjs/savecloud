import { Button, Card, CardBody, Input } from "@heroui/react";
import { Users } from "lucide-react";

interface FriendProfileCardProps {
  friendIdInput: string;
  onFriendIdChange: (value: string) => void;
  onLoadPress: () => void;
  loading: boolean;
  error: string | null;
}

export function FriendProfileCard({
  friendIdInput,
  onFriendIdChange,
  onLoadPress,
  loading,
  error,
}: FriendProfileCardProps) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Users size={20} className="text-default-500" />
          <h2 className="text-base font-semibold text-foreground">
            Ver perfil por User ID
          </h2>
        </div>
        <p className="text-sm text-default-600">
          El <strong>User ID</strong> es el identificador que cada usuario tiene
          en Configuración (junto a &quot;Tu User ID&quot;). Si un amigo te pasa
          el suyo, escríbelo aquí para ver sus juegos, copiar guardados a tu
          nube o añadir sus juegos a tu lista. Solo úsalo con personas de
          confianza.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Input
            label="User ID del amigo"
            placeholder="ej. nombre-amigo-123"
            value={friendIdInput}
            onValueChange={onFriendIdChange}
            variant="bordered"
            className="sm:max-w-xs"
          />
          <Button
            color="primary"
            onPress={onLoadPress}
            isLoading={loading}
            startContent={<Users size={18} />}
          >
            Cargar perfil
          </Button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </CardBody>
    </Card>
  );
}

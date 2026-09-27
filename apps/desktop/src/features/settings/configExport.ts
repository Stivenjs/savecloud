export type ConfigEncryptionDialogMode =
  | { kind: "export" }
  | { kind: "import"; importMode: "merge" | "replace" }
  | null;

export const CONFIG_PASSWORD_REQUIRED_MARKER = "SAVECLOUD_CONFIG_PASSWORD_REQUIRED";
export const CONFIG_EXPORT_MIN_PASSWORD_LENGTH = 12;

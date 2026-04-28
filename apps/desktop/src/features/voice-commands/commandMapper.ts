const VERBS = /^(abre|abrir|ejecuta|lanza|inicia|juega|open|launch)\s+/i;

export function parseVoiceCommand(text: string): { verb: "open"; target: string } {
  const trimmed = text.trim();
  if (VERBS.test(trimmed)) {
    return { verb: "open", target: trimmed.replace(VERBS, "").trim() };
  }

  return { verb: "open", target: trimmed };
}

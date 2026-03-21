const cache = new Map<string, HTMLAudioElement>();

function getAudio(src: string): HTMLAudioElement {
  if (!cache.has(src)) {
    const audio = new Audio(src);
    audio.preload = "auto";
    cache.set(src, audio);
  }
  return cache.get(src)!;
}

export function playSound(src: string, volume = 0.5) {
  try {
    const audio = getAudio(src);
    audio.currentTime = 0;
    audio.volume = volume;
    audio.play().catch(() => {});
  } catch {}
}

export const Sounds = {
  navigate: "/sounds/navigate.wav",
  confirm: "/sounds/confirm.wav",
  back: "/sounds/back.wav",
} as const;

export interface LevelProgress {
  level: number;
  nextLevel: number;
  progressToNextLevel: number;
  secondsToNextLevel: number;
}

export interface GamificationState {
  levelProgress: LevelProgress;
  weeklyPlaytimeSeconds: number;
  weekId: string;
  syncStreakDays: number;
  playStreakDays: number;
  uploadSuccessCount: number;
  achievementsUnlocked: string[];
  pendingAchievementToasts: string[];
  seenShortcutsHint: boolean;
  privacyNote: string;
}

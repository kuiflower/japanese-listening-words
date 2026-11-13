const SETTINGS_KEY = "jlw.settings.v2";
const FAVORITES_KEY = "jlw.favorites.v1";
const PROGRESS_KEY = "jlw.progress.v1";
const VOICE_TIP_KEY = "jlw.voiceTip.dismissed.v1";

export const defaultSettings = {
  intervalMs: 500,
  rate: 1,
  loops: 1,
  playChinese: false,
  listLoop: true,
  dictation: true,
  sleepMinutes: 0,
  filterType: "全部",
  jaVoiceURI: "",
};

export function loadSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadFavorites() {
  try {
    const arr = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function saveFavorites(set) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set]));
}

export function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveProgress(map) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
}

export function isVoiceTipDismissed() {
  return localStorage.getItem(VOICE_TIP_KEY) === "1";
}

export function dismissVoiceTip() {
  localStorage.setItem(VOICE_TIP_KEY, "1");
}

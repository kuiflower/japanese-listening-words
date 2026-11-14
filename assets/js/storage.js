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
  // iPhone 默认走系统日语默认（不指定 voice），才有机会用到网页列不出的 O-Ren/Otoya
  jaVoiceURI: "__system__",
  // 中文同理：优先系统中文默认
  zhVoiceURI: "__system__",
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

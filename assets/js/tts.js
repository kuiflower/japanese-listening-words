let voicesCache = [];
let speakSeq = 0;
let prefetched = null;
/** iOS：必须在用户手势的同步调用栈里 speak，才解锁后续播报 */
let gestureSpeak = false;
const voiceListeners = new Set();

function refreshVoices() {
  voicesCache = window.speechSynthesis?.getVoices?.() || [];
  return voicesCache;
}

function notifyVoicesChanged() {
  refreshVoices();
  voiceListeners.forEach((fn) => {
    try {
      fn(voicesCache);
    } catch {
      /* ignore */
    }
  });
}

/** 设置页等可订阅：音色列表异步就绪后刷新 UI */
export function onVoicesChanged(fn) {
  voiceListeners.add(fn);
  return () => voiceListeners.delete(fn);
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  refreshVoices();
  const synth = window.speechSynthesis;
  synth.onvoiceschanged = notifyVoicesChanged;
  if (typeof synth.addEventListener === "function") {
    synth.addEventListener("voiceschanged", notifyVoicesChanged);
  }
  // iOS 有时不会立刻触发事件，轮询几次
  let polls = 0;
  const pollId = setInterval(() => {
    polls += 1;
    const before = voicesCache.length;
    refreshVoices();
    if (voicesCache.length !== before) notifyVoicesChanged();
    if (voicesCache.length > 0 || polls >= 20) clearInterval(pollId);
  }, 250);
}

/** Apple 多语种「角色/新奇」声：会挂 ja-JP，但听起来像卡通，不适合练听力 */
const NOVELTY_JA_NAMES = [
  "eddy",
  "flo",
  "grandma",
  "grandpa",
  "reed",
  "rocko",
  "sandy",
  "shelley",
  "hattori",
  "jacques",
  "jester",
  "organ",
  "superstar",
  "trinoids",
  "whisper",
  "zarvox",
  "albert",
  "bad news",
  "bahh",
  "bells",
  "boing",
  "bubbles",
  "cellos",
  "deranged",
  "good news",
  "hysterical",
  "junior",
  "kathy",
  "pipe organ",
];

function voiceBlob(v) {
  return `${v.name || ""} ${v.voiceURI || ""} ${v.lang || ""}`.toLowerCase();
}

function isNoveltyVoice(v) {
  const n = voiceBlob(v);
  if (n.includes("eloquence") || n.includes("espeak") || n.includes("novelty")) return true;
  // Apple 角色声常见 URI：com.apple.voice.compact.ja-JP.Eddy 等
  if (/\/(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|hattori)\b/i.test(n)) return true;
  const name = String(v.name || "")
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, " ")
    .trim();
  return NOVELTY_JA_NAMES.some((bad) => name === bad || name.startsWith(`${bad} `));
}

function isJapaneseVoice(v) {
  if (isNoveltyVoice(v)) return false;
  const lang = String(v.lang || "")
    .toLowerCase()
    .replace(/_/g, "-");
  if (lang.startsWith("ja")) return true;
  const n = voiceBlob(v);
  return (
    n.includes("ja-jp") ||
    n.includes("japan") ||
    n.includes("日本語") ||
    n.includes("kyoko") ||
    n.includes("otoya") ||
    n.includes("o-ren") ||
    n.includes("oren") ||
    n.includes("nanami") ||
    n.includes("haruka") ||
    n.includes("google 日本語") ||
    n.includes("google日本語")
  );
}

function scoreJa(v) {
  if (!isJapaneseVoice(v)) return -1;
  const n = voiceBlob(v);
  let s = 80;

  // compact 仍列出，只是自动择优时靠后
  if (n.includes("compact")) s -= 25;

  if (n.includes("premium")) s += 70;
  else if (n.includes("enhanced")) s += 62;
  if (n.includes("neural") || n.includes("natural") || n.includes("online (natural)")) s += 58;

  if (n.includes("google")) s += 55;

  if (n.includes("microsoft") && (n.includes("nanami") || n.includes("keita") || n.includes("ayumi"))) s += 52;
  if (n.includes("microsoft") && n.includes("haruka")) s += 40;

  if (n.includes("kyoko")) s += 48;
  if (n.includes("o-ren") || n.includes("oren")) s += 36;
  if (n.includes("otoya")) s += 28;
  if (n.includes("siri")) s += 24;

  if (v.localService === false) s += 8;
  return s;
}

function scoreZh(v) {
  const n = `${v.name} ${v.lang}`.toLowerCase();
  const lang = v.lang.toLowerCase();
  let s = 0;
  if (!lang.startsWith("zh") && !lang.includes("cmn")) return -1;
  s += 80;
  if (n.includes("neural") || n.includes("natural")) s += 45;
  if (n.includes("enhanced") || n.includes("premium")) s += 40;
  if (n.includes("google")) s += 38;
  if (lang.includes("zh-cn") || lang.includes("cmn-cn") || n.includes("china")) s += 25;
  if (n.includes("xiaoxiao") || n.includes("yunxi") || n.includes("yaoyao")) s += 30;
  if (n.includes("tingting") || n.includes("meijia") || n.includes("sinji")) s += 22;
  if (n.includes("siri")) s += 18;
  if (n.includes("compact") || n.includes("eloquence")) s -= 15;
  return s;
}

export function listAllVoices() {
  return refreshVoices();
}

/** 同一人名只保留音质最好的一条，避免 Kyoko 出现两次 */
function voiceFamilyKey(v) {
  const n = voiceBlob(v);
  if (n.includes("otoya")) return "otoya";
  if (n.includes("kyoko")) return "kyoko";
  if (n.includes("o-ren") || /\boren\b/.test(n)) return "oren";
  if (n.includes("nanami")) return "nanami";
  if (n.includes("keita")) return "keita";
  if (n.includes("haruka")) return "haruka";
  if (n.includes("google") && (n.includes("日本語") || n.includes("japan") || (v.lang || "").toLowerCase().startsWith("ja"))) {
    return "google-ja";
  }
  return v.voiceURI || `${v.name}|${v.lang}`;
}

export function listJaVoices() {
  const best = new Map();
  refreshVoices()
    .filter((v) => scoreJa(v) >= 0)
    .forEach((v) => {
      const key = voiceFamilyKey(v);
      const prev = best.get(key);
      if (!prev || scoreJa(v) > scoreJa(prev)) best.set(key, v);
    });
  return [...best.values()].sort((a, b) => scoreJa(b) - scoreJa(a));
}

export function voiceKey(v) {
  if (!v) return "";
  return v.voiceURI || `${v.name}|${v.lang}`;
}

/** 当前设备「日语默认声」：优先 voice.default，否则按音质排序第一 */
export function getDefaultJaVoice() {
  const ja = listJaVoices();
  if (!ja.length) return null;
  const byFlag = ja.find((v) => v.default);
  if (byFlag) return byFlag;
  const globalDefault = refreshVoices().find((v) => v.default && scoreJa(v) >= 0);
  if (globalDefault) return globalDefault;
  return ja[0];
}

export function findJaVoiceByURI(want) {
  if (!want || want === "__system__") return null;
  return (
    listJaVoices().find(
      (v) => voiceKey(v) === want || v.name === want || `${v.name}|${v.lang}` === want,
    ) || null
  );
}

/**
 * 只返回「本机尚未出现在 getVoices 里」的推荐项。
 * 一旦检测到同族音色，不再展示硬编码推荐，改由真实名称按钮显示。
 */
export function getMissingJaRecommendations(platform = "other") {
  const present = new Set(listJaVoices().map((v) => voiceFamilyKey(v)));
  const catalog =
    platform === "apple"
      ? [
          { id: "otoya", family: "otoya", label: "Otoya" },
          { id: "oren", family: "oren", label: "O-Ren" },
        ]
      : platform === "android"
        ? [
            { id: "google-ja", family: "google-ja", label: "Google 日本語" },
            { id: "nanami", family: "nanami", label: "Nanami" },
          ]
        : [];
  return catalog
    .filter((item) => !present.has(item.family))
    .map((item) => ({ ...item, status: "missing" }));
}

/** 网页无法跳进系统设置，只返回手动路径 */
export function voiceSettingsPathHint(platform = "other") {
  if (platform === "apple") {
    return "设置 → 辅助功能 → 朗读内容 → 声音 → 日语";
  }
  if (platform === "android") {
    return "设置 → 系统 → 语言和输入法 → 文字转语音 → Google 文字转语音 → 安装日语";
  }
  return "请在系统设置中安装日语语音包";
}

/** 按钮文案：尽量用系统返回的原始名称 */
export function voiceShortLabel(v) {
  if (!v) return "未选择";
  let name = String(v.name || "").trim();
  if (!name) return voiceKey(v) || "未命名";
  // 去掉过长括号说明，但保留系统自带的质量词
  name = name
    .replace(/\s*Online\s*\(Natural\)/i, " Neural")
    .replace(/\s*\((compact|premium|enhanced|标准|增强|优质)\)\s*$/i, (_, t) => {
      const map = { compact: "标准", premium: "Premium", enhanced: "增强" };
      const key = String(t).toLowerCase();
      return ` · ${map[key] || t}`;
    })
    .trim();
  const low = voiceBlob(v);
  if (!/·/.test(name)) {
    if (low.includes(".premium") || /\bpremium\b/.test(low)) name += " · Premium";
    else if (low.includes(".enhanced") || /\benhanced\b/.test(low)) name += " · 增强";
    else if (low.includes(".compact") || /\bcompact\b/.test(low)) name += " · 标准";
  }
  return name;
}

/**
 * 校正设置里的 jaVoiceURI：去掉旧的「跟随系统/自动」占位，对齐本机真实音色。
 * 返回是否改写了 settings。
 */
export function syncJaVoiceSetting(settings = {}) {
  const jaList = listJaVoices();
  if (!jaList.length) return { settings, changed: false, voice: null };

  const want = settings.jaVoiceURI;
  let found = findJaVoiceByURI(want);
  if (!found) found = getDefaultJaVoice();
  const nextURI = voiceKey(found);
  if (want === nextURI) return { settings, changed: false, voice: found };
  return {
    settings: { ...settings, jaVoiceURI: nextURI },
    changed: true,
    voice: found,
  };
}

/** 设置页试听当前音色 */
export function previewJapaneseVoice(settings = {}) {
  if (!window.speechSynthesis) return;
  unlockTTSFromGesture();
  stopSpeaking();
  unlockTTSFromGesture();
  const { ja } = pickVoices(settings);
  const u = makeUtterance("観光シーズン", { lang: "ja-JP", voice: ja, rate: 1 });
  gestureSpeak = true;
  speakUtterance(u);
}

export function pickVoices(settings = {}) {
  const jaList = listJaVoices();
  const zhList = refreshVoices()
    .filter((v) => scoreZh(v) >= 0)
    .sort((a, b) => scoreZh(b) - scoreZh(a));

  const ja = findJaVoiceByURI(settings.jaVoiceURI) || getDefaultJaVoice();
  return {
    ja,
    zh: zhList[0] || null,
    jaName: voiceShortLabel(ja) || "未检测到日语声",
    zhName: voiceShortLabel(zhList[0]) || "系统默认中文",
    jaList,
  };
}

/**
 * 在点击/触摸的同步回调里调用。
 * iOS/Safari 要求真正的 speak() 落在用户手势同步栈内，不能先 await。
 */
export function unlockTTSFromGesture() {
  if (!window.speechSynthesis) return;
  gestureSpeak = true;
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.resume();
  } catch {
    /* ignore */
  }
}

export function warmUpTTS() {
  unlockTTSFromGesture();
}

export function stopSpeaking() {
  prefetched = null;
  speakSeq += 1;
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

function makeUtterance(text, { lang, voice, rate }) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  if (voice) u.voice = voice;
  u.pitch = lang.startsWith("ja") ? 1.02 : 1;
  return u;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runSpeak(u, { signal, mySeq }) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis || !u || signal?.aborted || mySeq !== speakSeq) {
      resolve();
      return;
    }

    let finished = false;
    let keepAlive = null;

    const done = () => {
      if (finished) return;
      finished = true;
      if (keepAlive) clearInterval(keepAlive);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };

    // 只结束 Promise，不要再 cancel——否则会掐掉紧接着开始的新播放
    const onAbort = () => done();
    signal?.addEventListener("abort", onAbort, { once: true });

    u.onend = done;
    u.onerror = done;

    try {
      window.speechSynthesis.resume();
    } catch {
      /* ignore */
    }
    window.speechSynthesis.speak(u);

    keepAlive = setInterval(() => {
      if (finished || mySeq !== speakSeq) {
        clearInterval(keepAlive);
        return;
      }
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      } catch {
        /* ignore */
      }
    }, 250);
  });
}

function speakUtterance(u, { signal } = {}) {
  if (!window.speechSynthesis || !u) return Promise.resolve();
  if (signal?.aborted) return Promise.resolve();

  const mySeq = speakSeq;
  const immediate = gestureSpeak;
  gestureSpeak = false;

  // 用户手势路径：同步 speak，不能先 delay（否则 iPhone 静音）
  if (immediate) return runSpeak(u, { signal, mySeq });

  // 连播下一条：cancel 后稍等，减轻 Chrome 静音
  return delay(50).then(() => {
    if (signal?.aborted || mySeq !== speakSeq) return;
    return runSpeak(u, { signal, mySeq });
  });
}

export function prefetchEntry(entry, settings) {
  if (!entry) {
    prefetched = null;
    return;
  }
  prefetched = {
    id: entry.id,
    jaText: entry.kana || entry.word,
    rate: Number(settings.rate) || 1,
  };
}

export async function speakEntry(entry, settings, { signal, usePrefetch = true } = {}) {
  const { ja, zh } = pickVoices(settings);
  const loops = Math.max(1, Number(settings.loops) || 1);
  const rate = Number(settings.rate) || 1;
  let jaText = entry.kana || entry.word;
  if (usePrefetch && prefetched?.id === entry.id && prefetched.jaText) {
    jaText = prefetched.jaText;
    prefetched = null;
  }
  const zhText = entry.meaning || "";

  for (let i = 0; i < loops; i += 1) {
    if (signal?.aborted) return;

    const jaUtter = makeUtterance(jaText, { lang: "ja-JP", voice: ja, rate });
    await speakUtterance(jaUtter, { signal });
    if (signal?.aborted) return;

    if (settings.playChinese && zhText) {
      const zhUtter = makeUtterance(zhText, { lang: "zh-CN", voice: zh, rate });
      await speakUtterance(zhUtter, { signal });
    }
  }
}

export function wait(ms, { signal } = {}) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

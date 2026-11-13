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

function isJapaneseVoice(v) {
  const lang = String(v.lang || "")
    .toLowerCase()
    .replace(/_/g, "-");
  if (lang.startsWith("ja")) return true;
  const n = `${v.name || ""} ${v.voiceURI || ""}`.toLowerCase();
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
  const n = `${v.name} ${v.lang} ${v.voiceURI || ""}`.toLowerCase();
  let s = 80;

  if (n.includes("eloquence") || n.includes("espeak") || n.includes("novelty")) s -= 60;
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

export function listJaVoices() {
  const seen = new Set();
  return refreshVoices()
    .filter((v) => scoreJa(v) >= 0)
    .sort((a, b) => scoreJa(b) - scoreJa(a))
    .filter((v) => {
      const key = v.voiceURI || `${v.name}|${v.lang}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function voiceShortLabel(v) {
  if (!v) return "系统默认";
  let name = v.name
    .replace(/^Google\s+/i, "")
    .replace(/^Microsoft\s+/i, "")
    .replace(/\s*Online\s*\(Natural\)/i, " Neural")
    .replace(/\s*\(.*?\)$/, "")
    .trim();
  const tags = [];
  const low = `${v.name} ${v.voiceURI || ""}`.toLowerCase();
  if (low.includes("premium") || low.includes(".premium")) tags.push("Premium");
  else if (low.includes("enhanced") || low.includes(".enhanced")) tags.push("增强");
  else if (low.includes("neural") || low.includes("natural")) tags.push("Neural");
  else if (low.includes("compact") || low.includes(".compact")) tags.push("标准");
  else if (low.includes("google")) tags.push("在线");
  if (v.localService === false && !tags.includes("在线")) tags.push("在线");
  return tags.length ? `${name} · ${tags[0]}` : name;
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

  const want = settings.jaVoiceURI;
  let ja = null;
  let jaName = "系统默认日语";

  // iPhone：优质/增强 Otoya 往往不出现在 getVoices() 里。
  // 不指定 voice、只设 lang，有机会走到系统「朗读内容」里选中的日语声。
  if (want === "__system__") {
    ja = null;
    jaName = "跟随系统（不指定）";
  } else if (want) {
    const found = jaList.find(
      (v) => v.voiceURI === want || `${v.name}|${v.lang}` === want || v.name === want,
    );
    ja = found || jaList[0] || null;
    jaName = voiceShortLabel(ja) || "系统默认日语";
  } else {
    ja = jaList[0] || null;
    jaName = voiceShortLabel(ja) || "自动择优";
  }

  return {
    ja,
    zh: zhList[0] || null,
    jaName,
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

let voicesCache = [];
let warmed = false;
let prefetched = null;

function refreshVoices() {
  voicesCache = window.speechSynthesis?.getVoices?.() || [];
  return voicesCache;
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    refreshVoices();
  };
}

function scoreJa(v) {
  const n = `${v.name} ${v.lang}`.toLowerCase();
  let s = 0;
  if (!v.lang.toLowerCase().startsWith("ja")) return -1;
  s += 80;
  // Prefer higher-quality / neural / enhanced voices when available
  if (n.includes("neural") || n.includes("natural") || n.includes("online (natural)")) s += 45;
  if (n.includes("enhanced") || n.includes("premium") || n.includes("quality")) s += 40;
  if (n.includes("google")) s += 38;
  if (n.includes("microsoft") && (n.includes("nanami") || n.includes("keita") || n.includes("haruka"))) s += 35;
  if (n.includes("kyoko")) s += 32;
  if (n.includes("o-ren") || n.includes("oren") || n.includes("otoya")) s += 28;
  if (n.includes("siri")) s += 22;
  if (n.includes("compact") || n.includes("eloquence")) s -= 15;
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
  if (n.includes("compact")) s -= 15;
  return s;
}

export function pickVoices() {
  const voices = refreshVoices();
  const jaList = voices.filter((v) => scoreJa(v) >= 0).sort((a, b) => scoreJa(b) - scoreJa(a));
  const zhList = voices.filter((v) => scoreZh(v) >= 0).sort((a, b) => scoreZh(b) - scoreZh(a));
  return {
    ja: jaList[0] || null,
    zh: zhList[0] || null,
    jaName: jaList[0]?.name || "系统默认",
    zhName: zhList[0]?.name || "系统默认",
  };
}

export function warmUpTTS() {
  if (!window.speechSynthesis || warmed) return;
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.resume();
    const u = new SpeechSynthesisUtterance("・");
    u.volume = 0.01;
    u.rate = 2;
    u.lang = "ja-JP";
    const { ja } = pickVoices();
    if (ja) u.voice = ja;
    u.onend = () => {
      warmed = true;
    };
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

export function stopSpeaking() {
  prefetched = null;
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
  // Slight pitch stability; some engines sound smoother
  u.pitch = 1;
  return u;
}

function speakUtterance(u, { signal } = {}) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis || !u) {
      resolve();
      return;
    }
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
      done();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    u.onend = done;
    u.onerror = done;
    try {
      window.speechSynthesis.resume();
    } catch {
      /* ignore */
    }
    window.speechSynthesis.speak(u);
  });
}

/** Prefetch next word audio into a ready utterance (like buffering). */
export function prefetchEntry(entry, settings) {
  if (!entry) {
    prefetched = null;
    return;
  }
  const { ja } = pickVoices();
  const rate = Number(settings.rate) || 1;
  const jaText = entry.kana || entry.word;
  prefetched = {
    id: entry.id,
    ja: makeUtterance(jaText, { lang: "ja-JP", voice: ja, rate }),
  };
}

export async function speakEntry(entry, settings, { signal, usePrefetch = true } = {}) {
  warmUpTTS();
  const { ja, zh } = pickVoices();
  const loops = Math.max(1, Number(settings.loops) || 1);
  const rate = Number(settings.rate) || 1;
  const jaText = entry.kana || entry.word;
  const zhText = entry.meaning || "";

  for (let i = 0; i < loops; i += 1) {
    if (signal?.aborted) return;

    let jaUtter;
    if (usePrefetch && prefetched?.id === entry.id && prefetched.ja && i === 0) {
      jaUtter = prefetched.ja;
      prefetched = null;
    } else {
      jaUtter = makeUtterance(jaText, { lang: "ja-JP", voice: ja, rate });
    }

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

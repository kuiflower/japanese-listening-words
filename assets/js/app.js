import {
  dismissVoiceTip,
  isVoiceTipDismissed,
  loadFavorites,
  loadProgress,
  loadSettings,
  saveFavorites,
  saveProgress,
  saveSettings,
} from "./storage.js?v=20";
import {
  findVoiceByFamily,
  getDefaultJaVoice,
  getMissingJaRecommendations,
  listAllVoices,
  listJaVoices,
  onVoicesChanged,
  pickVoices,
  prefetchEntry,
  previewJapaneseVoice,
  speakEntry,
  stopSpeaking,
  syncJaVoiceSetting,
  unlockTTSFromGesture,
  voiceKey,
  voiceSettingsPathHint,
  voiceShortLabel,
  wait,
} from "./tts.js?v=20";

const root = document.getElementById("app");
const data = window.APP_DATA || { sets: [] };

let settings = loadSettings();
let favorites = loadFavorites();
let progress = loadProgress();

let route = parseHash();
let study = null;
let toastTimer = null;
let sleepTimerId = null;
let sleepDeadline = 0;
let playAbort = null;
/** 自动播放时申请屏幕常亮，减少手机黑屏后 TTS/定时器被系统挂起 */
let wakeLock = null;
let wakeLockWanted = false;
let keepAliveVideo = null;
/** 翻页动画进行中，避免连滑叠动画 */
let studyAnimating = false;
let swipeGesture = null;

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "settings") return { name: "settings", from: parts[1] || "home" };
  if (parts[0] === "study") {
    return { name: "study", mode: parts[1] || "all", setId: parts[2] || "" };
  }
  return { name: "home" };
}

function navigate(hash) {
  location.hash = hash;
}

function allWords() {
  return data.sets.flatMap((s) =>
    (s.words || []).map((w) => ({ ...w, setId: s.id, setTitle: s.title })),
  );
}

function getSet(id) {
  return data.sets.find((s) => s.id === id);
}

function filterWords(list) {
  if (settings.filterType === "全部") return list;
  return list.filter((w) => w.type === settings.filterType);
}

function detectClient() {
  const ua = navigator.userAgent || "";
  const isApple =
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const platform = isApple ? "apple" : isAndroid ? "android" : "other";
  return { isApple, isAndroid, isMobile: isApple || isAndroid, platform };
}

function ensureSyncedJaVoice() {
  const { settings: next, changed } = syncJaVoiceSetting(settings);
  if (changed) {
    settings = next;
    saveSettings(settings);
  }
  return changed;
}

function voiceOptionButtonsHtml() {
  const { platform, isApple } = detectClient();
  const jaList = listJaVoices();
  const current = settings.jaVoiceURI || (isApple ? "__system__" : voiceKey(getDefaultJaVoice()));
  const listedKey = voiceKey(getDefaultJaVoice());

  const chips = [];
  if (isApple) {
    chips.push({
      kind: "pick",
      value: "__system__",
      label: "系统日语默认",
      active: current === "__system__",
    });
  }

  for (const v of jaList) {
    const value = voiceKey(v);
    chips.push({
      kind: "pick",
      value,
      label:
        value === listedKey && current !== "__system__"
          ? `${voiceShortLabel(v)} · 列表默认`
          : voiceShortLabel(v),
      active: current === value,
    });
  }

  for (const item of getMissingJaRecommendations(platform)) {
    chips.push({
      kind: "hint",
      status: "missing",
      id: item.id,
      label: `${item.label} · 未下载`,
    });
  }

  if (!chips.length) {
    return `<span class="sub" style="color:var(--text-dim);font-size:0.85rem">未检测到日语音色，请先按下方路径下载后点「刷新」</span>`;
  }

  return chips
    .map((chip) => {
      if (chip.kind === "pick") {
        return `<button type="button" class="option ${chip.active ? "active" : ""}" data-set="jaVoiceURI" data-value="${escapeAttr(chip.value)}">${escapeAttr(chip.label)}</button>`;
      }
      return `<button type="button" class="option voice-hint missing" data-voice-hint="${escapeAttr(chip.id)}">${escapeAttr(chip.label)}</button>`;
    })
    .join("");
}

function voiceDownloadGuideHtml() {
  const { isApple, isAndroid } = detectClient();
  if (isApple) {
    return `
      <div class="voice-guide">
        <strong>iPhone 想用 O-Ren / Otoya 时</strong>
        <ol>
          <li>系统 <strong>设置 → 辅助功能 → 朗读内容 → 声音 → 日语</strong>，下载并设为默认</li>
          <li>回到本站，音色选 <strong>系统日语默认</strong>（不要选 Kyoko）</li>
          <li>点试听：若仍是 Kyoko，说明该音色<strong>不交给网页</strong>，网页端无法单独点选</li>
        </ol>
        <p style="margin:8px 0 0">列表里能点的，才是网页真正可用的声。O-Ren/Otoya 优质档常只给系统朗读用。</p>
      </div>`;
  }
  if (isAndroid) {
    return `
      <div class="voice-guide">
        <strong>Android 下载日语声</strong>
        <ol>
          <li><strong>设置 → 系统 → 语言和输入法 → 文字转语音输出</strong>（部分机型在「辅助功能」）</li>
          <li>引擎选 <strong>Google 文字转语音</strong> → 安装语音数据 → <strong>日语</strong></li>
          <li>回到本站点 <strong>刷新音色列表</strong></li>
        </ol>
      </div>`;
  }
  return `
    <div class="voice-guide">
      <strong>电脑端</strong>：Chrome / Edge + 系统日语语音包；手机请用 Safari（iPhone）或 Chrome（Android）。
    </div>`;
}

function homeVoiceTipHtml() {
  if (isVoiceTipDismissed()) return "";
  const { isApple, isAndroid } = detectClient();
  const tip = isApple
    ? "若已下载 O-Ren/Otoya 但列表没有：到系统把日语默认设成它，本站选 <strong>系统日语默认</strong>。网页有时仍用不了优质档。"
    : isAndroid
      ? "请安装 Google 文字转语音的日语包，再到本站「设置」刷新音色。"
      : "手机练习时请先在系统下载日语朗读声，再到设置里刷新选择。";
  return `
    <div class="voice-tip" id="voiceTip">
      <div class="tip-title">想听更好听的日语？</div>
      <div class="tip-body">${tip}</div>
      <div class="tip-actions">
        <button type="button" class="option active" data-go="#/settings/home">去设置看步骤</button>
        <button type="button" class="option" id="dismissVoiceTipBtn">知道了</button>
      </div>
    </div>`;
}

function showToast(msg, ms = 1800) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

function clearSleepTimer() {
  if (sleepTimerId) clearTimeout(sleepTimerId);
  sleepTimerId = null;
  sleepDeadline = 0;
  clearInterval(window.__sleepTick);
}

function armSleepTimer() {
  clearSleepTimer();
  if (!settings.sleepMinutes) return;
  sleepDeadline = Date.now() + settings.sleepMinutes * 60 * 1000;
  sleepTimerId = setTimeout(() => {
    if (study?.auto) {
      study.auto = false;
      abortPlay();
      releaseWakeLock();
      render();
      showToast("睡觉模式：已自动停止播放");
    }
  }, settings.sleepMinutes * 60 * 1000);
}

function sleepLabel() {
  if (!sleepDeadline || !study?.auto) return "";
  const left = Math.max(0, sleepDeadline - Date.now());
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function typeChip(type) {
  return `<span class="chip">${type}</span>`;
}

function iconBack() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`;
}
function iconGear() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
}

function abortPlay() {
  if (playAbort) playAbort.abort();
  playAbort = null;
  stopSpeaking();
}

async function requestWakeLock() {
  wakeLockWanted = true;
  try {
    if (navigator.wakeLock?.request) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        // 系统可能自行释放；若仍在自动播放则稍后重申
        if (wakeLockWanted && study?.auto && document.visibilityState === "visible") {
          setTimeout(() => {
            if (wakeLockWanted && study?.auto) requestWakeLock();
          }, 800);
        }
      });
      return true;
    }
  } catch {
    /* 无权限 / 非 HTTPS 等 */
  }
  startKeepAliveFallback();
  return false;
}

function releaseWakeLock() {
  wakeLockWanted = false;
  try {
    wakeLock?.release?.();
  } catch {
    /* ignore */
  }
  wakeLock = null;
  stopKeepAliveFallback();
}

/** 无 Wake Lock 时：静音 canvas 视频流，部分安卓可延缓息屏（iOS 仍依赖系统锁屏设置） */
function startKeepAliveFallback() {
  if (keepAliveVideo) return;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#0c1118";
      ctx.fillRect(0, 0, 2, 2);
    }
    const stream = canvas.captureStream?.(1);
    if (!stream) return;
    const v = document.createElement("video");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.muted = true;
    v.playsInline = true;
    v.srcObject = stream;
    v.style.cssText =
      "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9px;bottom:0;z-index:-1;";
    document.body.appendChild(v);
    keepAliveVideo = v;
    v.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

function stopKeepAliveFallback() {
  if (!keepAliveVideo) return;
  try {
    const stream = keepAliveVideo.srcObject;
    stream?.getTracks?.().forEach((t) => t.stop());
    keepAliveVideo.pause();
    keepAliveVideo.srcObject = null;
    keepAliveVideo.remove();
  } catch {
    /* ignore */
  }
  keepAliveVideo = null;
}

function leaveStudyPlayback() {
  abortPlay();
  if (study) study.auto = false;
  clearSleepTimer();
  releaseWakeLock();
}

function nextIndexFrom(index) {
  if (!study?.list.length) return null;
  if (settings.listLoop) return (index + 1) % study.list.length;
  if (index >= study.list.length - 1) return null;
  return index + 1;
}

async function playCurrent({ autoAdvance = false } = {}) {
  if (!study || !study.list.length) return;
  const token = ++study.playToken;
  abortPlay();
  playAbort = new AbortController();
  const { signal } = playAbort;
  // 保持手势标记：abort 后仍须在同一同步栈里尽快 speak（iOS）
  unlockTTSFromGesture();

  // Auto loop: prefetch next word while current plays (reduces gap / stutter)
  while (!signal.aborted && token === study.playToken) {
    const entry = study.list[study.index];
    const nIdx = nextIndexFrom(study.index);
    if (nIdx != null) prefetchEntry(study.list[nIdx], settings);

    await speakEntry(entry, settings, { signal, usePrefetch: true });
    if (signal.aborted || token !== study.playToken) return;

    if (!(autoAdvance && study.auto)) return;

    await wait(settings.intervalMs, { signal });
    if (signal.aborted || token !== study.playToken || !study.auto) return;

    if (nIdx == null) {
      study.auto = false;
      clearSleepTimer();
      releaseWakeLock();
      showToast("已到列表末尾");
      patchStudyChrome();
      return;
    }

    // Advance UI first; next utterance was prefetched during current play
    study.index = nIdx;
    resetReveal();
    persistIndex();
    await showStudyEntry({ direction: "next", play: false });
    autoAdvance = true;
  }
}

function persistIndex() {
  if (route.mode === "set" && route.setId) {
    progress[route.setId] = study.index;
    saveProgress(progress);
  }
}

function resetReveal() {
  study.revealMeaning = !settings.dictation;
  study.revealExplain = !settings.dictation;
}

function movePrev() {
  if (!study?.list.length || studyAnimating) return;
  const prevIndex = study.index;
  if (settings.listLoop) {
    study.index = (study.index - 1 + study.list.length) % study.list.length;
  } else {
    study.index = Math.max(0, study.index - 1);
  }
  if (study.index === prevIndex && !settings.listLoop) return;
  resetReveal();
  persistIndex();
  showStudyEntry({ direction: "prev", play: true, autoAdvance: !!study.auto });
}

function moveNext({ fromAuto = false } = {}) {
  if (!study?.list.length || studyAnimating) return;
  const nIdx = nextIndexFrom(study.index);
  if (nIdx == null) {
    study.auto = false;
    clearSleepTimer();
    releaseWakeLock();
    showToast("已到列表末尾");
    patchStudyChrome();
    return;
  }
  study.index = nIdx;
  resetReveal();
  persistIndex();
  showStudyEntry({
    direction: "next",
    play: true,
    autoAdvance: !!study.auto || fromAuto,
  });
}

function toggleAuto() {
  if (!study?.list.length) return;
  study.auto = !study.auto;
  if (study.auto) {
    armSleepTimer();
    requestWakeLock();
    patchStudyChrome();
    armStudyProgressTicker();
    playCurrent({ autoAdvance: true });
  } else {
    clearSleepTimer();
    abortPlay();
    releaseWakeLock();
    patchStudyChrome();
    showToast("已切换为手动模式");
  }
}

function jumpToBan() {
  const raw = (study.jumpValue || "").trim();
  if (!raw) return;
  const normalized = raw
    .replace(/問題\s*/g, "")
    .replace(/番/g, "")
    .replace(/\s+/g, "");
  const idx = study.list.findIndex(
    (w) =>
      w.jumpId === normalized ||
      w.jumpId.startsWith(`${normalized}-`) ||
      String(w.ban) === normalized,
  );
  if (idx < 0) {
    showToast("未找到该题号，试试如 2-4");
    return;
  }
  study.index = idx;
  resetReveal();
  persistIndex();
  showStudyEntry({ direction: "next", play: true, autoAdvance: !!study.auto });
  showToast(`已跳到 ${study.list[idx].jumpId}`);
}

function toggleFavorite(id) {
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  saveFavorites(favorites);
  if (route.mode === "favorites") {
    const list = buildStudyList(route);
    study.list = list;
    if (!list.length) {
      study.index = 0;
      render();
      return;
    }
    if (study.index >= list.length) study.index = list.length - 1;
    const stage = document.querySelector(".card-stage");
    if (stage) {
      stage.innerHTML = studyCardHtml(study.list[study.index]);
      patchStudyChrome();
      return;
    }
  }
  const favBtn = document.getElementById("favBtn");
  if (favBtn && study?.list[study.index]?.id === id) {
    const on = favorites.has(id);
    favBtn.textContent = on ? "取消收藏" : "收藏";
    favBtn.classList.toggle("active", on);
    return;
  }
  render();
}

function buildStudyList(routeObj) {
  if (routeObj.mode === "favorites") {
    return filterWords(allWords().filter((w) => favorites.has(w.id)));
  }
  if (routeObj.mode === "set") {
    const set = getSet(routeObj.setId);
    return filterWords((set?.words || []).map((w) => ({ ...w, setId: set.id, setTitle: set.title })));
  }
  return filterWords(allWords());
}

function studyTitle(routeObj) {
  if (routeObj.mode === "favorites") return "收藏单词";
  if (routeObj.mode === "all") return "所有单词";
  return getSet(routeObj.setId)?.title || "题库单词";
}

function settingsBackHash() {
  const from = route.from || "home";
  if (from === "home") return "#/";
  if (from === "study-all") return "#/study/all";
  if (from === "study-favorites") return "#/study/favorites";
  if (from.startsWith("study-set-")) return `#/study/set/${from.slice("study-set-".length)}`;
  return "#/";
}

function settingsGoHash() {
  if (route.name !== "study") return "#/settings/home";
  if (route.mode === "all") return "#/settings/study-all";
  if (route.mode === "favorites") return "#/settings/study-favorites";
  if (route.mode === "set") return `#/settings/study-set-${route.setId}`;
  return "#/settings/home";
}

function ensureStudy() {
  const list = buildStudyList(route);
  const key =
    route.mode === "set" ? `set:${route.setId}` : route.mode === "favorites" ? "favorites" : "all";
  const startIndex =
    route.mode === "set" && progress[route.setId] != null
      ? Math.min(progress[route.setId], Math.max(0, list.length - 1))
      : 0;

  if (!study || study.key !== key) {
    abortPlay();
    study = {
      key,
      list,
      index: list.length ? startIndex : 0,
      auto: false,
      revealMeaning: !settings.dictation,
      revealExplain: !settings.dictation,
      jumpValue: "",
      playToken: 0,
    };
  } else {
    const currentId = study.list[study.index]?.id;
    study.list = list;
    const found = currentId ? list.findIndex((w) => w.id === currentId) : -1;
    study.index = found >= 0 ? found : Math.min(study.index, Math.max(0, list.length - 1));
  }
}

function renderHome() {
  const total = allWords().length;
  const favCount = favorites.size;
  const setsHtml = data.sets
    .map((s) => {
      const count = (s.words || []).length;
      const saved = progress[s.id];
      const cont = saved != null ? ` · 上次练到第 ${saved + 1} 词` : "";
      return `
        <button class="list-item" data-go="#/study/set/${s.id}">
          <div>
            <div class="title">${s.title}</div>
            <div class="sub">${count} 词 · ${s.level || "N2"}${cont}</div>
          </div>
          <span class="chip">开始</span>
        </button>`;
    })
    .join("");

  root.innerHTML = `
    <div class="shell">
      <div class="topbar">
        <div class="brand">
          <strong>听力单词强化</strong>
          <span>N2 · 读音与中文意思训练</span>
        </div>
        <button class="icon-btn" data-go="#/settings/home" aria-label="设置">${iconGear()}</button>
      </div>
      ${homeVoiceTipHtml()}
      <div class="hero-actions">
        <button class="hero-card" data-go="#/study/favorites">
          <div class="label">收藏单词</div>
          <div class="meta">${favCount} 个收藏</div>
        </button>
        <button class="hero-card primary" data-go="#/study/all">
          <div class="label">所有单词</div>
          <div class="meta">已抽取 ${total} 词</div>
        </button>
      </div>
      <h2 class="section-title">真题列表</h2>
      <div class="list">${setsHtml || `<div class="empty">暂无词库</div>`}</div>
    </div>`;
}

function renderStudy() {
  ensureStudy();
  const list = study.list;
  const entry = list[study.index];
  const settingsHash = settingsGoHash();

  if (!entry) {
    root.innerHTML = `
      <div class="shell study-shell">
        <div class="study-header">
          <button class="icon-btn" data-go="#/" aria-label="返回">${iconBack()}</button>
          <div class="center"><strong>${studyTitle(route)}</strong><span>暂无词条</span></div>
          <button class="icon-btn" data-go="${settingsHash}" aria-label="设置">${iconGear()}</button>
        </div>
        <div class="empty">
          ${route.mode === "favorites" ? "还没有收藏，去真题里点收藏吧" : "当前筛选下没有词条"}
          <br/>
          <button class="btn primary" data-go="#/">回首页</button>
        </div>
      </div>`;
    return;
  }

  const timer = sleepLabel();

  root.innerHTML = `
    <div class="shell study-shell">
      <div class="study-header">
        <button class="icon-btn" data-go="#/" aria-label="返回">${iconBack()}</button>
        <div class="center">
          <strong>${studyTitle(route)}</strong>
          <span id="studyProgress">${study.index + 1} / ${list.length}${
            timer ? ` · 睡觉 ${timer}` : ""
          }</span>
        </div>
        <button class="icon-btn" data-go="${settingsHash}" aria-label="设置">${iconGear()}</button>
      </div>

      <div class="jump-row">
        <input id="jumpInput" inputmode="text" enterkeyhint="go" placeholder="题号跳转，如 2-4" value="${
          study.jumpValue || ""
        }" />
        <button type="button" id="jumpBtn">跳转</button>
      </div>

      <div class="swipe-zone" id="swipeZone" aria-label="滑动切换题目">
        <div class="card-stage">
          ${studyCardHtml(entry)}
        </div>
      </div>
    </div>

    <div class="dock">
      <button class="dock-btn" id="prevBtn"><strong>上一个</strong><span>Prev</span></button>
      <button class="dock-btn main" id="replayBtn"><strong>再听一遍</strong><span>Replay</span></button>
      <button class="dock-btn" id="nextBtn"><strong>下一个</strong><span>Next</span></button>
    </div>`;

  armStudyProgressTicker();
}

function studyCardHtml(entry) {
  const fav = favorites.has(entry.id);
  return `
    <article class="card" id="studyCard">
      <div class="meta-row">
        ${typeChip(entry.type)}
        <span class="chip">来源：問題${entry.mondai} · ${entry.ban}番</span>
        ${
          settings.sleepMinutes && study.auto
            ? `<span class="timer-pill">睡觉 ${settings.sleepMinutes} 分</span>`
            : ""
        }
      </div>
      <div class="word-main">${entry.word}</div>
      <div class="kana">${entry.kana}</div>
      <div class="meaning">
        <span class="label">中文意思</span>
        <div class="body">${entry.meaning}</div>
        ${
          settings.dictation && !study.revealMeaning
            ? `<div class="mask" data-unmask="meaning">点击显示意思</div>`
            : ""
        }
      </div>
      <div class="explain">
        <span class="label">解释 · 来源句</span>
        <div class="body">
          <div class="source-ja">${entry.sourceJa}</div>
          <div>${entry.sourceZh}</div>
        </div>
        ${
          settings.dictation && !study.revealExplain
            ? `<div class="mask" data-unmask="explain">点击显示解释</div>`
            : ""
        }
      </div>
      <div class="action-row">
        <button class="btn primary ${study.auto ? "is-auto" : ""}" id="autoBtn">
          ${study.auto ? "暂停" : "自动播放"}
        </button>
        <button class="btn ghost ${fav ? "active" : ""}" id="favBtn">${
          fav ? "取消收藏" : "收藏"
        }</button>
      </div>
    </article>`;
}

function patchStudyChrome() {
  const progress = document.getElementById("studyProgress");
  if (progress && study) {
    const t = sleepLabel();
    progress.textContent = `${study.index + 1} / ${study.list.length}${
      t ? ` · 睡觉 ${t}` : ""
    }`;
  }
  const autoBtn = document.getElementById("autoBtn");
  if (autoBtn && study) {
    autoBtn.textContent = study.auto ? "暂停" : "自动播放";
    autoBtn.classList.toggle("is-auto", !!study.auto);
  }
}

function armStudyProgressTicker() {
  clearInterval(window.__sleepTick);
  if (!(study?.auto && sleepDeadline)) return;
  window.__sleepTick = setInterval(() => {
    if (!study?.auto) return;
    patchStudyChrome();
  }, 1000);
}

/** 切题：优先只更新卡片区 + 简单翻页动画，避免整页重绘 */
async function showStudyEntry({
  direction = "next",
  play = false,
  autoAdvance = false,
  animate = true,
} = {}) {
  if (!study?.list?.length) {
    render();
    return;
  }
  const stage = document.querySelector(".card-stage");
  const oldCard = document.getElementById("studyCard");

  if (!stage || route.name !== "study") {
    render();
    if (play) playCurrent({ autoAdvance });
    return;
  }

  const paint = () => {
    stage.innerHTML = studyCardHtml(study.list[study.index]);
    patchStudyChrome();
    armStudyProgressTicker();
  };

  if (!animate || !oldCard || studyAnimating) {
    paint();
    if (play) playCurrent({ autoAdvance });
    return;
  }

  studyAnimating = true;
  const exitClass = direction === "prev" ? "card-exit-right" : "card-exit-left";
  const enterClass = direction === "prev" ? "card-enter-left" : "card-enter-right";

  oldCard.classList.add(exitClass);
  await wait(170);
  if (route.name !== "study" || !study?.list?.length) {
    studyAnimating = false;
    return;
  }

  paint();
  const newCard = document.getElementById("studyCard");
  if (newCard) {
    newCard.classList.add(enterClass);
    void newCard.offsetWidth;
    newCard.classList.add("card-enter-active");
    newCard.classList.remove(enterClass);
    window.setTimeout(() => newCard.classList.remove("card-enter-active"), 220);
  }
  studyAnimating = false;

  if (play) playCurrent({ autoAdvance });
}

/**
 * 题号框以下、底栏以上整块滑动区：
 * 位移很小 = 点击（交给原有 click）；位移够大 = 滑动切题。
 */
function setupStudySwipeOnce() {
  if (window.__studySwipeReady) return;
  window.__studySwipeReady = true;

  const CLICK_SLOP = 14;
  const SWIPE_MIN = 52;

  const interactiveSel = "input, textarea, button, a, .mask, .action-row, .jump-row";

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (route.name !== "study") return;
      const zone = e.target.closest?.("#swipeZone");
      if (!zone) return;
      if (e.target.closest?.(interactiveSel)) {
        swipeGesture = null;
        return;
      }
      if (e.pointerType === "mouse" && e.button !== 0) return;
      swipeGesture = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        maxDist: 0,
      };
    },
    { passive: true },
  );

  document.addEventListener(
    "pointermove",
    (e) => {
      if (!swipeGesture || e.pointerId !== swipeGesture.id) return;
      const dx = e.clientX - swipeGesture.x0;
      const dy = e.clientY - swipeGesture.y0;
      swipeGesture.maxDist = Math.max(swipeGesture.maxDist, Math.hypot(dx, dy));
    },
    { passive: true },
  );

  const endGesture = (e) => {
    if (!swipeGesture || e.pointerId !== swipeGesture.id) return;
    const g = swipeGesture;
    swipeGesture = null;
    if (route.name !== "study" || studyAnimating || !study?.list?.length) return;

    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    const dist = Math.max(g.maxDist, Math.hypot(dx, dy));

    // 近似点击：不拦截，让 mask/空白区域的 click 正常发生
    if (dist < CLICK_SLOP) return;
    if (dist < SWIPE_MIN) return;

    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const horizontal = absX >= absY * 0.9;
    const vertical = absY > absX * 1.05;
    if (!horizontal && !vertical) return;

    unlockTTSFromGesture();
    if (horizontal) {
      if (dx < 0) moveNext({ fromAuto: false });
      else movePrev();
      return;
    }
    if (dy < 0) moveNext({ fromAuto: false });
    else movePrev();
  };

  document.addEventListener("pointerup", endGesture, { passive: true });
  document.addEventListener("pointercancel", () => {
    swipeGesture = null;
  }, { passive: true });
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function optionButtons(key, options, current, coerce = (v) => v) {
  return options
    .map((opt) => {
      const val = coerce(opt.value);
      const active = current === val ? "active" : "";
      return `<button type="button" class="option ${active}" data-set="${key}" data-value="${escapeAttr(opt.value)}">${escapeAttr(opt.label)}</button>`;
    })
    .join("");
}

function renderSettings() {
  const backHash = settingsBackHash();
  ensureSyncedJaVoice();
  const jaList = listJaVoices();
  const voices = pickVoices(settings);
  const allCount = listAllVoices().length;
  const defaultVoice = getDefaultJaVoice();
  root.innerHTML = `
    <div class="shell">
      <div class="topbar">
        <button class="icon-btn" data-go="${backHash}" aria-label="返回">${iconBack()}</button>
        <div class="brand"><strong>设置</strong><span>仅黑夜模式</span></div>
        <div style="width:44px"></div>
      </div>
      <div class="settings">
        <div class="setting-item">
          <div class="head"><strong>日语音色</strong><span>当前：${voices.jaName}</span></div>
          <div class="option-row">
            ${voiceOptionButtonsHtml()}
          </div>
          <div class="option-row" style="margin-top:4px">
            <button type="button" class="option" id="refreshVoicesBtn">刷新音色列表</button>
            <button type="button" class="option" id="previewVoiceBtn">试听当前音色</button>
          </div>
          <div style="margin-top:10px">${voiceDownloadGuideHtml()}</div>
          <div class="sub" style="color:var(--text-dim);font-size:0.82rem;line-height:1.45;margin-top:10px">
            本机日语 ${jaList.length} 个（系统默认：${
              defaultVoice ? voiceShortLabel(defaultVoice) : "无"
            }）· 全部音色 ${allCount} · 中文：${voices.zhName}
          </div>
        </div>
        <div class="setting-item">
          <div class="head"><strong>自动跳转间隔</strong><span>播完后再计</span></div>
          <div class="option-row">
            ${optionButtons(
              "intervalMs",
              [
                { value: "500", label: "0.5秒" },
                { value: "1000", label: "1秒" },
                { value: "1500", label: "1.5秒" },
                { value: "2000", label: "2秒" },
                { value: "3000", label: "3秒" },
              ],
              settings.intervalMs,
              Number,
            )}
          </div>
        </div>
        <div class="setting-item">
          <div class="head"><strong>播放语速</strong></div>
          <div class="option-row">
            ${optionButtons(
              "rate",
              [
                { value: "0.8", label: "0.8x" },
                { value: "1", label: "1.0x" },
                { value: "1.2", label: "1.2x" },
              ],
              settings.rate,
              Number,
            )}
          </div>
        </div>
        <div class="setting-item">
          <div class="head"><strong>每词循环遍数</strong><span>日文[+中文]为一遍</span></div>
          <div class="option-row">
            ${optionButtons(
              "loops",
              [
                { value: "1", label: "1遍" },
                { value: "2", label: "2遍" },
                { value: "3", label: "3遍" },
              ],
              settings.loops,
              Number,
            )}
          </div>
        </div>
        <div class="setting-item">
          <div class="head"><strong>播放中文翻译声音</strong><span>默认关闭</span></div>
          <div class="option-row">
            ${optionButtons(
              "playChinese",
              [
                { value: "true", label: "开" },
                { value: "false", label: "关" },
              ],
              settings.playChinese,
              (v) => v === "true" || v === true,
            )}
          </div>
        </div>
        <div class="setting-item">
          <div class="head"><strong>列表循环</strong></div>
          <div class="option-row">
            ${optionButtons(
              "listLoop",
              [
                { value: "true", label: "循环" },
                { value: "false", label: "到尾停止" },
              ],
              settings.listLoop,
              (v) => v === "true" || v === true,
            )}
          </div>
        </div>
        <div class="setting-item">
          <div class="head"><strong>意思/解释点击查看</strong><span>开启后遮挡，点击才显示</span></div>
          <div class="option-row">
            ${optionButtons(
              "dictation",
              [
                { value: "true", label: "开" },
                { value: "false", label: "关" },
              ],
              settings.dictation,
              (v) => v === "true" || v === true,
            )}
          </div>
        </div>
        <div class="setting-item">
          <div class="head"><strong>自动连播与熄屏</strong></div>
          <div class="sub" style="color:var(--text-dim);font-size:0.85rem;line-height:1.45">
            开启「自动播放」时会尽量申请屏幕常亮（需 HTTPS，如 GitHub Pages）。若仍黑屏，请到手机系统里把「自动锁定」调长，或把本站「添加到主屏幕」后打开。息屏后系统可能挂起网页，亮屏回来会尝试自动续播。
          </div>
        </div>
        <div class="setting-item">
          <div class="head"><strong>定时关闭（睡觉模式）</strong></div>
          <div class="option-row">
            ${optionButtons(
              "sleepMinutes",
              [
                { value: "0", label: "关" },
                { value: "15", label: "15分钟" },
                { value: "30", label: "30分钟" },
              ],
              settings.sleepMinutes,
              Number,
            )}
          </div>
        </div>
        <div class="setting-item">
          <div class="head"><strong>筛选类型</strong></div>
          <div class="option-row">
            ${optionButtons(
              "filterType",
              [
                { value: "全部", label: "全部" },
                { value: "高频词", label: "仅词" },
                { value: "固定句", label: "固定句" },
                { value: "复合词", label: "复合词" },
              ],
              settings.filterType,
            )}
          </div>
        </div>
      </div>
    </div>`;
}

function render() {
  route = parseHash();
  if (route.name === "settings") renderSettings();
  else if (route.name === "study") renderStudy();
  else renderHome();
}

document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) {
    e.preventDefault();
    if (route.name === "study") leaveStudyPlayback();
    navigate(go.getAttribute("data-go"));
    return;
  }

  const unmask = e.target.closest("[data-unmask]");
  if (unmask && study) {
    const kind = unmask.getAttribute("data-unmask");
    if (kind === "meaning") study.revealMeaning = true;
    if (kind === "explain") study.revealExplain = true;
    unmask.remove();
    return;
  }

  const setBtn = e.target.closest("[data-set]");
  if (setBtn) {
    const key = setBtn.getAttribute("data-set");
    let value = setBtn.getAttribute("data-value");
    if (["intervalMs", "loops", "sleepMinutes"].includes(key)) value = Number(value);
    else if (key === "rate") value = Number(value);
    else if (["playChinese", "listLoop", "dictation"].includes(key)) value = value === "true";
    settings = { ...settings, [key]: value };
    saveSettings(settings);
    if (key === "dictation" && study) resetReveal();
    if (key === "sleepMinutes" && study?.auto) armSleepTimer();
    if (key === "filterType") study = null;
    if (key === "jaVoiceURI") {
      unlockTTSFromGesture();
      previewJapaneseVoice(settings);
      if (value === "__system__") {
        showToast("已用系统日语默认。请确认系统里日语默认是 O-Ren/Otoya", 3600);
      } else {
        showToast("已切换并试听");
      }
    } else {
      showToast("已保存");
    }
    render();
    return;
  }

  if (e.target.closest("#dismissVoiceTipBtn")) {
    dismissVoiceTip();
    render();
    return;
  }

  const hintBtn = e.target.closest("[data-voice-hint]");
  if (hintBtn) {
    const id = hintBtn.getAttribute("data-voice-hint") || "";
    unlockTTSFromGesture();
    window.speechSynthesis?.getVoices?.();
    const found = findVoiceByFamily(id);
    if (found) {
      settings = { ...settings, jaVoiceURI: voiceKey(found) };
      saveSettings(settings);
      previewJapaneseVoice(settings);
      showToast(`已识别到 ${voiceShortLabel(found)}，已切换`);
      render();
      return;
    }
    const { platform } = detectClient();
    showToast(
      `网页仍未识别到该音色。请确认已下载后点刷新。路径：${voiceSettingsPathHint(platform)}`,
      4200,
    );
    return;
  }

  if (e.target.closest("#refreshVoicesBtn")) {
    unlockTTSFromGesture();
    window.speechSynthesis?.getVoices?.();
    ensureSyncedJaVoice();
    render();
    const ja = listJaVoices();
    const names = ja.map((v) => voiceShortLabel(v)).join("、") || "无";
    showToast(`日语 ${ja.length} 个：${names}`, 2800);
    return;
  }
  if (e.target.closest("#previewVoiceBtn")) {
    unlockTTSFromGesture();
    previewJapaneseVoice(settings);
    showToast("试听中");
    return;
  }

  if (e.target.closest("#replayBtn")) {
    unlockTTSFromGesture();
    playCurrent({ autoAdvance: !!study?.auto });
    return;
  }
  if (e.target.closest("#favBtn") && study?.list[study.index]) {
    toggleFavorite(study.list[study.index].id);
    return;
  }
  if (e.target.closest("#prevBtn")) {
    unlockTTSFromGesture();
    movePrev();
    return;
  }
  if (e.target.closest("#nextBtn")) {
    unlockTTSFromGesture();
    moveNext({ fromAuto: false });
    return;
  }
  if (e.target.closest("#autoBtn")) {
    unlockTTSFromGesture();
    toggleAuto();
    return;
  }
  if (e.target.closest("#jumpBtn")) {
    const input = document.getElementById("jumpInput");
    if (study) study.jumpValue = input?.value || "";
    jumpToBan();
  }
});

document.addEventListener("input", (e) => {
  if (e.target?.id === "jumpInput" && study) study.jumpValue = e.target.value;
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && document.activeElement?.id === "jumpInput") {
    e.preventDefault();
    if (study) study.jumpValue = document.activeElement.value || "";
    jumpToBan();
    return;
  }
  if (route.name !== "study" || !study?.list.length) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    unlockTTSFromGesture();
    movePrev();
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    unlockTTSFromGesture();
    moveNext({ fromAuto: false });
  } else if (e.key === " ") {
    e.preventDefault();
    unlockTTSFromGesture();
    toggleAuto();
  } else if (e.key === "r" || e.key === "R") {
    e.preventDefault();
    unlockTTSFromGesture();
    playCurrent({ autoAdvance: !!study.auto });
  } else if (e.key === "f" || e.key === "F") {
    e.preventDefault();
    toggleFavorite(study.list[study.index].id);
  }
});

window.addEventListener("hashchange", () => {
  leaveStudyPlayback();
  render();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (!study?.auto || route.name !== "study") return;
  requestWakeLock();
  // 息屏后 speechSynthesis / 定时器常被挂起，亮屏后若未在播则续播
  const synth = window.speechSynthesis;
  const speaking = !!(synth && (synth.speaking || synth.pending));
  if (!speaking) {
    unlockTTSFromGesture();
    playCurrent({ autoAdvance: true });
    showToast("已从熄屏恢复连播");
  }
});

document.addEventListener(
  "pointerdown",
  () => {
    try {
      window.speechSynthesis?.getVoices?.();
      unlockTTSFromGesture();
    } catch {
      /* ignore */
    }
  },
  { once: true },
);

onVoicesChanged(() => {
  ensureSyncedJaVoice();
  if (route.name === "settings") renderSettings();
});

ensureSyncedJaVoice();
setupStudySwipeOnce();
render();

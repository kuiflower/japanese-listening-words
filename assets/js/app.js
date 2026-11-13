import {
  loadFavorites,
  loadProgress,
  loadSettings,
  saveFavorites,
  saveProgress,
  saveSettings,
} from "./storage.js?v=3";
import { pickVoices, prefetchEntry, speakEntry, stopSpeaking, wait, warmUpTTS } from "./tts.js?v=3";

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

function showToast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
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

function leaveStudyPlayback() {
  abortPlay();
  if (study) study.auto = false;
  clearSleepTimer();
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
  warmUpTTS();

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
      showToast("已到列表末尾");
      render();
      return;
    }

    // Advance UI first; next utterance was prefetched during current play
    study.index = nIdx;
    resetReveal();
    persistIndex();
    render();
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
  if (!study?.list.length) return;
  if (settings.listLoop) {
    study.index = (study.index - 1 + study.list.length) % study.list.length;
  } else {
    study.index = Math.max(0, study.index - 1);
  }
  resetReveal();
  persistIndex();
  render();
  playCurrent({ autoAdvance: !!study.auto });
}

function moveNext({ fromAuto = false } = {}) {
  if (!study?.list.length) return;
  const nIdx = nextIndexFrom(study.index);
  if (nIdx == null) {
    study.auto = false;
    clearSleepTimer();
    showToast("已到列表末尾");
    render();
    return;
  }
  study.index = nIdx;
  resetReveal();
  persistIndex();
  render();
  playCurrent({ autoAdvance: !!study.auto || fromAuto });
}

function toggleAuto() {
  if (!study?.list.length) return;
  study.auto = !study.auto;
  if (study.auto) {
    armSleepTimer();
    render();
    playCurrent({ autoAdvance: true });
  } else {
    clearSleepTimer();
    abortPlay();
    render();
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
  render();
  playCurrent({ autoAdvance: !!study.auto });
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
    } else if (study.index >= list.length) {
      study.index = list.length - 1;
    }
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

  const fav = favorites.has(entry.id);
  const timer = sleepLabel();

  root.innerHTML = `
    <div class="shell study-shell">
      <div class="study-header">
        <button class="icon-btn" data-go="#/" aria-label="返回">${iconBack()}</button>
        <div class="center">
          <strong>${studyTitle(route)}</strong>
          <span>${study.index + 1} / ${list.length}${timer ? ` · 睡觉 ${timer}` : ""}</span>
        </div>
        <button class="icon-btn" data-go="${settingsHash}" aria-label="设置">${iconGear()}</button>
      </div>

      <div class="jump-row">
        <input id="jumpInput" inputmode="text" enterkeyhint="go" placeholder="题号跳转，如 2-4" value="${
          study.jumpValue || ""
        }" />
        <button type="button" id="jumpBtn">跳转</button>
      </div>

      <div class="card">
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
          <button class="btn primary" id="replayBtn">再听一遍</button>
          <button class="btn ghost ${fav ? "active" : ""}" id="favBtn">${
            fav ? "取消收藏" : "收藏"
          }</button>
        </div>
      </div>
    </div>

    <div class="dock">
      <button class="dock-btn" id="prevBtn"><strong>上一个</strong><span>Prev</span></button>
      <button class="dock-btn main" id="autoBtn"><strong>${
        study.auto ? "暂停" : "自动播放"
      }</strong><span>${study.auto ? "手动模式" : "连播"}</span></button>
      <button class="dock-btn" id="nextBtn"><strong>下一个</strong><span>Next</span></button>
    </div>`;

  if (study.auto && sleepDeadline) {
    clearInterval(window.__sleepTick);
    window.__sleepTick = setInterval(() => {
      const span = document.querySelector(".study-header .center span");
      if (!span || !study?.auto) return;
      const t = sleepLabel();
      span.textContent = `${study.index + 1} / ${study.list.length}${t ? ` · 睡觉 ${t}` : ""}`;
    }, 1000);
  }
}

function optionButtons(key, options, current, coerce = (v) => v) {
  return options
    .map((opt) => {
      const val = coerce(opt.value);
      const active = current === val ? "active" : "";
      return `<button type="button" class="option ${active}" data-set="${key}" data-value="${opt.value}">${opt.label}</button>`;
    })
    .join("");
}

function renderSettings() {
  const backHash = settingsBackHash();
  const voices = pickVoices();
  root.innerHTML = `
    <div class="shell">
      <div class="topbar">
        <button class="icon-btn" data-go="${backHash}" aria-label="返回">${iconBack()}</button>
        <div class="brand"><strong>设置</strong><span>仅黑夜模式</span></div>
        <div style="width:44px"></div>
      </div>
      <div class="settings">
        <div class="setting-item">
          <div class="head"><strong>当前音色</strong><span>系统可用中自动择优</span></div>
          <div class="sub" style="color:var(--text-dim);font-size:0.85rem;line-height:1.45">
            日文：${voices.jaName}<br/>中文：${voices.zhName}<br/>
            提示：iPhone/Safari 或装了高品质语音包时通常更自然；Chrome 常优先 Google 日语。
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
    render();
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
    render();
    showToast("已保存");
    return;
  }

  if (e.target.closest("#replayBtn")) {
    playCurrent({ autoAdvance: !!study?.auto });
    return;
  }
  if (e.target.closest("#favBtn") && study?.list[study.index]) {
    toggleFavorite(study.list[study.index].id);
    return;
  }
  if (e.target.closest("#prevBtn")) {
    movePrev();
    return;
  }
  if (e.target.closest("#nextBtn")) {
    moveNext({ fromAuto: false });
    return;
  }
  if (e.target.closest("#autoBtn")) {
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
    movePrev();
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    moveNext({ fromAuto: false });
  } else if (e.key === " ") {
    e.preventDefault();
    toggleAuto();
  } else if (e.key === "r" || e.key === "R") {
    e.preventDefault();
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

document.addEventListener(
  "pointerdown",
  () => {
    try {
      window.speechSynthesis?.getVoices?.();
      warmUpTTS();
    } catch {
      /* ignore */
    }
  },
  { once: true },
);

render();

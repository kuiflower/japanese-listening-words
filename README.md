# 日语听力单词强化（N2）

仅黑夜模式的词条听练站：读音 + 中文意思强化，不是做题站。

## 在线访问

https://kuiflower.github.io/japanese-listening-words/

## 本地打开

因使用 ES Module，请用本地静态服务打开（不要直接双击 `index.html`）：

```bash
cd japanese-listening-words
python3 -m http.server 5173
```

浏览器访问：http://127.0.0.1:5173/

手机同一 Wi-Fi 可用电脑局域网 IP 访问，例如：`http://192.168.x.x:5173/`

## 功能摘要

- 首页：收藏 / 所有单词 / 真题列表
- 练词：听写遮挡、题号跳转、再听、收藏、上一个 / 自动播放·暂停 / 下一个
- 暂停 = 手动模式；切词仍会播音
- 设置：间隔、语速、循环遍数、中文跟读、睡觉定时 15/30 分等
- 音频：浏览器 TTS（自动择优日语/中文音色）

## 词库

按真题套存放在 `data/sets/{年-月}-n2/`（`words.json` + `meta.json`）。  
听力原文抽取文本在 `data/raw/`（扫描件经 macOS Vision OCR）。

真题源目录（本机）：`/Volumes/Work/日语学习/本当の問題/N2真题`

更新词库后重新打包：

```bash
python3 scripts/validate_sets.py
python3 scripts/build_bundle.py
```

重新抽取某套听力原文文本：

```bash
python3 scripts/extract_listening_text.py
```

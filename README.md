# 日语听力单词强化（N2）

仅黑夜模式的词条听练站：读音 + 中文意思强化，不是做题站。

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

`data/sets/2026-07-n2/words.json`（当前 97 条）  
打包进 `assets/js/bundle.js` 供前端使用。更新词库后重新生成：

```bash
python3 -c "
import json
from pathlib import Path
words=json.loads(Path('data/sets/2026-07-n2/words.json').read_text())
meta=json.loads(Path('data/sets/2026-07-n2/meta.json').read_text())
Path('assets/js/bundle.js').write_text('window.APP_DATA = '+json.dumps({'sets':[{**meta,'words':words}]},ensure_ascii=False)+';\n')
"
```

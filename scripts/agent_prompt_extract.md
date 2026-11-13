# N2 listening vocab extraction

Project: `/Volumes/Work/workProject/project/japanese-listening-words`

## Inputs
- Transcript: `data/raw/{SET_ID}/listening.txt`
- Example: `data/sets/2026-07-n2/words.json` + `meta.json`

## Outputs (create folders as needed)
- `data/sets/{SET_ID}/words.json`
- `data/sets/{SET_ID}/meta.json`

## Rules
1. Source ONLY from listening transcript 問題1–5. Do not invent scenes.
2. If file is a combined 答案解析 PDF dump, use only 听力原文 / dialogue parts.
3. Prefer distinctive N2 listening nouns/verbs/adj, compounds, fixed phrases (work/daily/traffic/health/attitude).
4. Skip overly basic words unless memorable fixed phrase.
5. Target 70–95 entries per set. Quality over stuffing.
6. type ∈ {高频词, 固定句, 复合词}
7. Fields: id, word, kana, meaning, type, mondai, ban, jumpId, sourceJa, sourceZh
8. id like `2016-07-n2-001` (3-digit). jumpId like `1-1` or `5-2-1`.
9. kana must be correct (check 連濁). sourceZh translates sourceJa only (no tip notes).
10. sourceJa = short authentic fragment from transcript; fix obvious OCR typos in the fragment only.
11. meta.json keys: id, title, level, examDate, source, selectionCriteria, questionJumpFormat, entryCountNote
12. Write UTF-8 JSON indent=2 ensure_ascii=False.
13. Do not modify app JS/CSS; do not rebuild bundle; do not touch 2026-07-n2.

## Return
For each set: entry count + list of uncertain items needing human review.

# Audit & fix one batch of N2 vocab sets

Project: `/Volumes/Work/workProject/project/japanese-listening-words`

## For each SET_ID in the batch
1. Read `data/raw/{SET_ID}/listening.txt` and `data/sets/{SET_ID}/words.json`
2. Check every entry:
   - wrong kana (連濁, on/kun)
   - meaning wrong/too broad for context
   - `sourceJa` not faithful to transcript
   - `sourceZh` translates `sourceJa` only (no tip notes like 干扰项)
   - `jumpId` / `mondai` / `ban` consistent
3. FIX clear errors in `words.json` (UTF-8, indent=2, ensure_ascii=False)
4. Prefer fix over delete; delete only junk entries
5. Do NOT rebuild bundle; do NOT touch other years

## Return
Markdown table: set | fixed | deleted | remaining doubts  
Plus bullet list of each fix: `id` before → after

#!/usr/bin/env python3
"""Rebuild assets/js/bundle.js and data/sets/index.json from data/sets/*/."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SETS = ROOT / "data" / "sets"
BUNDLE = ROOT / "assets" / "js" / "bundle.js"
INDEX = SETS / "index.json"


def main():
    packed = []
    for meta_path in SETS.glob("*/meta.json"):
        folder = meta_path.parent
        words_path = folder / "words.json"
        if not words_path.exists():
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        words = json.loads(words_path.read_text(encoding="utf-8"))
        if not isinstance(words, list) or not words:
            continue
        packed.append((meta.get("examDate") or meta.get("id") or "", meta, words, folder))

    # newest exam first
    packed.sort(key=lambda x: x[0], reverse=True)

    sets = []
    index_sets = []
    for _exam, meta, words, folder in packed:
        sets.append({**meta, "words": words})
        index_sets.append(
            {
                "id": meta["id"],
                "title": meta.get("title", meta["id"]),
                "level": meta.get("level", "N2"),
                "path": f"{folder.name}/words.json",
                "metaPath": f"{folder.name}/meta.json",
                "count": len(words),
            }
        )

    INDEX.write_text(
        json.dumps(
            {
                "sets": index_sets,
                "allWordsDefinition": "所有已导入并完成抽取的词条合集（当前 = 上表各套合并）",
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    # frontend copy
    (ROOT / "assets" / "js" / "sets-index.json").write_text(INDEX.read_text(encoding="utf-8"), encoding="utf-8")
    BUNDLE.write_text(
        "window.APP_DATA = " + json.dumps({"sets": sets}, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    total = sum(len(s["words"]) for s in sets)
    print(f"bundle: {len(sets)} sets, {total} words -> {BUNDLE}")


if __name__ == "__main__":
    main()

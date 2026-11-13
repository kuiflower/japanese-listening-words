#!/usr/bin/env python3
"""Validate word set JSON quality before bundling."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "data" / "sets"
REQUIRED = ("id", "word", "kana", "meaning", "type", "mondai", "ban", "jumpId", "sourceJa", "sourceZh")
TYPES = {"高频词", "固定句", "复合词"}


def check_set(folder: Path) -> list[str]:
    errs = []
    meta_p = folder / "meta.json"
    words_p = folder / "words.json"
    if not meta_p.exists() or not words_p.exists():
        return [f"{folder.name}: missing meta/words"]
    meta = json.loads(meta_p.read_text(encoding="utf-8"))
    words = json.loads(words_p.read_text(encoding="utf-8"))
    if meta.get("id") != folder.name:
        errs.append(f"{folder.name}: meta.id mismatch")
    if not isinstance(words, list) or len(words) < 40:
        errs.append(f"{folder.name}: too few words ({0 if not isinstance(words, list) else len(words)})")
    ids = set()
    for i, w in enumerate(words if isinstance(words, list) else []):
        pref = f"{folder.name}[{i}]"
        for k in REQUIRED:
            if k not in w or w[k] in ("", None):
                errs.append(f"{pref}: missing {k}")
        if w.get("type") not in TYPES:
            errs.append(f"{pref}: bad type {w.get('type')}")
        if w.get("id") in ids:
            errs.append(f"{pref}: duplicate id {w.get('id')}")
        ids.add(w.get("id"))
        kana = str(w.get("kana") or "")
        # allow 〜/～ placeholders used in grammar-pattern headwords
        if not re.fullmatch(r"[\u3040-\u309F\u30A0-\u30FFー・〜～\sA-Za-z0-9]+", kana):
            errs.append(f"{pref}: kana looks wrong: {kana}")
        if not str(w.get("word") or "").strip():
            errs.append(f"{pref}: empty word")
        # jumpId basic
        j = str(w.get("jumpId") or "")
        if not re.match(r"^\d+-\d+", j):
            errs.append(f"{pref}: jumpId {j}")
    return errs


def main():
    all_errs = []
    for folder in sorted(ROOT.iterdir()):
        if folder.is_dir() and (folder / "words.json").exists():
            all_errs.extend(check_set(folder))
    if all_errs:
        print("VALIDATION FAILED")
        for e in all_errs[:80]:
            print(" -", e)
        if len(all_errs) > 80:
            print(f" ... +{len(all_errs)-80} more")
        sys.exit(1)
    print("VALIDATION OK")


if __name__ == "__main__":
    main()

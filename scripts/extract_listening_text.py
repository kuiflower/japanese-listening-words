#!/usr/bin/env python3
"""Extract JLPT N2 listening transcript text from exam PDFs (text layer or Vision OCR)."""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from pathlib import Path

import fitz

BASE = Path("/Volumes/Work/日语学习/本当の問題/N2真题")
OUT = Path(__file__).resolve().parents[1] / "data" / "raw"
OCR_BIN = Path("/tmp/N2VisionOCR")
TEXT_THRESHOLD = 800
DPI = 200


def session_id_from_dir(d: Path) -> str:
    # 2016.07 / 2026.7 / 2020.07疫情取消
    m = re.search(r"(20\d{2})\.(\d{1,2})", d.name)
    if not m:
        raise ValueError(d)
    y, mo = m.group(1), int(m.group(2))
    return f"{y}-{mo:02d}-n2"


def pick_source_pdf(session_dir: Path) -> Path | None:
    pdfs = list(session_dir.rglob("*.pdf"))
    if not pdfs:
        return None

    def score(p: Path) -> tuple:
        n = p.name
        s = 0
        if "听力原文" in n:
            s += 100
        if "答案解析+听力原文" in n or "答案解析＋听力原文" in n:
            s += 80
        if "答案" in n and "解析" in n and "原文" in n:
            s += 70
        if "真题答案" in n:
            s += 60
        if "解析" in n and "听力" in n:
            s += 40
        # prefer smaller dedicated transcript over huge combined if both exist
        if n.endswith("听力原文.pdf"):
            s += 20
        return (s, -p.stat().st_size)

    ranked = sorted(pdfs, key=score, reverse=True)
    best = ranked[0]
    if score(best)[0] < 40:
        # fall back: any 原文
        for p in ranked:
            if "原文" in p.name:
                return p
        return None
    return best


def pdf_text(doc: fitz.Document) -> str:
    parts = []
    for page in doc:
        parts.append(page.get_text("text"))
    return "\n".join(parts).strip()


def cjk_ratio(text: str) -> float:
    if not text:
        return 0.0
    cjk = sum(1 for ch in text if "\u3040" <= ch <= "\u30ff" or "\u4e00" <= ch <= "\u9fff")
    return cjk / max(len(text), 1)


def looks_like_real_japanese(text: str) -> bool:
    """Reject broken CID/embedded-font dumps that have length but little CJK."""
    if len(text) < TEXT_THRESHOLD:
        return False
    if cjk_ratio(text) < 0.08:
        return False
    # common listening markers
    markers = ("問題", "番", "男", "女", "正解")
    return sum(1 for m in markers if m in text) >= 2


def ocr_pdf(pdf: Path) -> str:
    if not OCR_BIN.exists():
        raise RuntimeError(f"OCR binary missing: {OCR_BIN}")
    doc = fitz.open(pdf)
    chunks = []
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        images = []
        for i, page in enumerate(doc):
            pix = page.get_pixmap(dpi=DPI)
            img = td_path / f"p{i:03d}.png"
            pix.save(img)
            images.append(img)
        # batch OCR in groups of 3 to limit memory
        for i in range(0, len(images), 3):
            batch = images[i : i + 3]
            r = subprocess.run(
                [str(OCR_BIN), *[str(x) for x in batch]],
                capture_output=True,
                text=True,
                timeout=300,
            )
            if r.returncode != 0:
                chunks.append(f"[OCR_ERROR page~{i}: {r.stderr[:200]}]")
            out = r.stdout
            # split by marker
            pages_text = out.split("-----PAGE-----")
            pages_text = [t.strip() for t in pages_text if t.strip()]
            chunks.extend(pages_text)
    doc.close()
    return "\n\n".join(chunks).strip()


def extract_one(session_dir: Path) -> dict:
    sid = session_id_from_dir(session_dir)
    pdf = pick_source_pdf(session_dir)
    out_dir = OUT / sid
    out_dir.mkdir(parents=True, exist_ok=True)
    meta = {
        "id": sid,
        "sessionDir": str(session_dir),
        "sourcePdf": str(pdf) if pdf else None,
        "method": None,
        "chars": 0,
    }
    if not pdf:
        meta["error"] = "no suitable pdf"
        (out_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        return meta

    doc = fitz.open(pdf)
    text = pdf_text(doc)
    pages = doc.page_count
    doc.close()
    method = "text-layer"
    if not looks_like_real_japanese(text):
        method = "vision-ocr"
        text = ocr_pdf(pdf)

    (out_dir / "listening.txt").write_text(text + "\n", encoding="utf-8")
    meta.update({"method": method, "chars": len(text), "pages": pages, "sourceName": pdf.name})
    (out_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return meta


def iter_sessions():
    for y in range(2016, 2027):
        yd = BASE / str(y)
        if not yd.exists():
            continue
        for d in sorted(yd.iterdir()):
            if not d.is_dir():
                continue
            if "疫情" in d.name:
                continue
            if not re.search(r"20\d{2}\.\d", d.name):
                continue
            yield d


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    results = []
    for d in iter_sessions():
        print(f"==> {d.relative_to(BASE)}", flush=True)
        try:
            meta = extract_one(d)
            print(f"    {meta.get('id')} {meta.get('method')} chars={meta.get('chars')} pdf={meta.get('sourceName')}", flush=True)
            results.append(meta)
        except Exception as e:
            print(f"    ERROR {e}", flush=True)
            results.append({"sessionDir": str(d), "error": str(e)})
    (OUT / "index.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print("DONE", len(results), "sessions", flush=True)


if __name__ == "__main__":
    main()

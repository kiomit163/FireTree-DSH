#!/usr/bin/env python3
"""Extract the four Qian volumes, hash them, and verify the quoted passages.

Usage:
    python extract.py --root "D:\\Qian" --check
    python extract.py --root "D:\\Qian" --json reference/qian/sources.json

Requires: python-docx (bundled with the DSH runtime).

Design rules:
- The DOCX files are never copied or redistributed; only hashes and short quotes
  are recorded.
- Verification is substring-based on whitespace-stripped text. It proves the
  phrase exists in the volume; it does not prove the full sentence is verbatim.
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

try:
    from docx import Document
except ImportError:
    sys.exit("python-docx is required: pip install python-docx")

# (label, phrase, expected volume substring, note)
QUOTES = [
    ("ocg-layers", "从可观测的整体系统到子系统", "文库3", "OCG 层次不可还原判据"),
    ("decomposition-loss", "要紧的东西都跑了", "文库3", "分解会丢要件"),
    ("convergence", "改得你说不出意见来了", "文库3", "收敛=异议穷尽"),
    ("re-evaluation", "任何一次解答都不可能是一劳永逸的", "文库3", "解答有时效"),
    ("overall-design-size", "几百人规模的总体设计部", "文库2", "总体设计部规模判据"),
    ("baseline-definition", "基线是在一个技术开发层次完成以后", "文库4", "基线定义（航天实践）"),
    ("review-as-process", "评审是在各层次上进行的一个过程", "文库4", "评审是过程（航天实践）"),
    ("human-machine", "如果完全靠机器能解决问题", "文库3", "人机结合的定义性论证"),
    ("machine-serves-human", "让计算机伺候人", "文库3", "人机结合"),
    ("unknown-before-design", "心中无数", "文库2", "预研门禁"),
    ("no-wading", "摸着石头过河", "文库3", "预置异常处置"),
    ("aggregate-opinions", "零金碎玉", "文库3", "意见需聚合"),
    ("diversity", "差异性程度排名靠前", "文库4", "差异度指标"),
    ("signature", "敢不敢签字", "文库3", "签字担责"),
    ("four-levels", "直接搞改造客观世界的学问", "文库2", "系统科学四台阶"),
    ("giant-system-limit", "大系统控制论是不能直接用来解决巨系统问题", "文库2", "方法边界"),
    ("two-lines", "两条指挥线", "文库2", "两条指挥线（低频短语）"),
    ("double-five", "双五条", "文库4", "航天质量实践（1 次）"),
    ("forum", "研讨厅", "文库3", "综合集成研讨厅"),
    ("metasynthesis", "综合集成", "文库3", "核心方法"),
]


def normalize(text: str) -> str:
    return re.sub(r"\s+", "", text.replace("\u3000", " "))


def extract(path: Path) -> dict:
    data = path.read_bytes()
    doc = Document(str(path))
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                parts.append(cell.text)
    raw = "\n".join(parts)
    return {
        "file": path.name,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "chars": len(raw),
        "paragraphs": len(doc.paragraphs),
        "_text": raw,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=r"D:\Qian")
    parser.add_argument("--json", help="write sources.json here")
    parser.add_argument("--check", action="store_true", help="verify against sources.json next to this script")
    args = parser.parse_args()

    root = Path(args.root)
    books = sorted(root.glob("*.docx"))
    if len(books) != 4:
        print(f"expected 4 DOCX volumes in {root}, found {len(books)}", file=sys.stderr)
        return 1

    out = {"method": "python-docx paragraphs + tables, utf-8", "volumes": []}
    texts = {}
    for book in books:
        info = extract(book)
        texts[info["file"]] = info.pop("_text")
        out["volumes"].append(info)

    # verify quotes
    results = []
    for label, phrase, expected, note in QUOTES:
        needle = normalize(phrase)
        hits = [name for name, text in texts.items() if needle in normalize(text)]
        ok = any(expected in name for name in hits) if expected else bool(hits)
        results.append(
            {
                "label": label,
                "phrase": phrase,
                "expected_volume": expected,
                "found_in": hits,
                "ok": ok,
                "note": note,
            }
        )
    out["quotes"] = results

    failed = [r for r in results if not r["ok"]]
    for r in results:
        mark = "OK  " if r["ok"] else "FAIL"
        print(f"{mark} {r['label']:<22} {r['phrase'][:28]:<30} {','.join(Path(h).name for h in r['found_in'])}")

    if args.json:
        Path(args.json).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {args.json}")

    if args.check:
        local = Path(__file__).with_name("sources.json")
        if not local.exists():
            print("no sources.json to check", file=sys.stderr)
            return 1
        expected = json.loads(local.read_text(encoding="utf-8"))
        mismatch = []
        for got, want in zip(out["volumes"], expected.get("volumes", [])):
            if got["file"] != want["file"] or got["sha256"] != want["sha256"]:
                mismatch.append((got["file"], got["sha256"], want.get("sha256")))
        if len(out["volumes"]) != len(expected.get("volumes", [])):
            mismatch.append(("volume count", len(out["volumes"]), len(expected.get("volumes", []))))
        if mismatch:
            for item in mismatch:
                print(f"MISMATCH {item}", file=sys.stderr)
            return 1
        print("sources.json matches the source files")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

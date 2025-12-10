#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
auto_fix_links.py
构建阶段安全修复：
1) href="${var}"  -> data-href="${var}" href="#"
2) 非根页面的锚点链接 "#id" -> "/#id"
不改变视觉与功能；仅面向静态检查友好。
"""

import argparse
import pathlib
import re
import sys

# --- 正则模式 ---
# 兼容单双引号与任意空白
RE_PLACEHOLDER_HREF = re.compile(
    r'href\s*=\s*(["\'])\$\{[^}]+\}\1', re.IGNORECASE
)

# e.g. href="#how" / href = '#how'
RE_LOCAL_ANCHOR = re.compile(
    r'href\s*=\s*(["\'])#([A-Za-z0-9_\-]+)\1', re.IGNORECASE
)

SKIP_DIRS = {".git", "node_modules", ".github"}


def is_root_index(html_path: pathlib.Path) -> bool:
    """是否站点根的 index.html"""
    # 允许 repo 根或 PUBLISH_DIR 根，构建时我们以执行目录为根
    return html_path.name == "index.html" and html_path.parent == pathlib.Path(".")


def sanitize_placeholders(text: str) -> tuple[str, int]:
    """href='${...}' -> data-href='${...}' href='#'"""
    def _repl(m: re.Match) -> str:
        val = m.group(0).split("=", 1)[1].strip()  # '"${url}"'（含引号）
        return f'data-href={val} href="#"'
    new_text, n = RE_PLACEHOLDER_HREF.subn(_repl, text)
    return new_text, n


def rewrite_local_anchors(text: str, page_is_root_index: bool, skip_anchor_rewrite: bool = False) -> tuple[str, int]:
    """非根页的 #id 改写为 /#id；根 index.html 保持不变；某些页面可以选择跳过改写"""
    if page_is_root_index or skip_anchor_rewrite:
        return text, 0

    def _repl(m: re.Match) -> str:
        quote = m.group(1)
        anchor = m.group(2)
        return f'href={quote}/#{anchor}{quote}'

    new_text, n = RE_LOCAL_ANCHOR.subn(_repl, text)
    return new_text, n


def process_html(html_path: pathlib.Path) -> tuple[bool, list[str]]:
    changed = False
    notes = []
    try:
        txt = html_path.read_text(encoding="utf-8", errors="ignore")
    except Exception as e:
        return False, [f"read-fail:{e}"]

    # 1) 占位符 href
    txt2, n1 = sanitize_placeholders(txt)
    if n1:
        changed = True
        notes.append(f"placeholder:{n1}")

    # 2) 本页锚点 -> 站点根锚点（仅非根页；reports/index.html 保持本地锚点不变）
    skip_anchor_rewrite = (html_path.name == "index.html" and html_path.parent.name == "reports")
    txt3, n2 = rewrite_local_anchors(txt2, is_root_index(html_path), skip_anchor_rewrite)
    if n2:
        changed = True
        notes.append(f"anchors:{n2}")

    if changed:
        try:
            html_path.write_text(txt3, encoding="utf-8")
        except Exception as e:
            return False, [f"write-fail:{e}"]

    return changed, notes


def walk_and_fix(root_dir: str) -> None:
    root = pathlib.Path(root_dir)
    total_changed = 0
    total_placeholder = 0
    total_anchor = 0

    for html in root.rglob("*.html"):
        if any(seg in SKIP_DIRS for seg in html.parts):
            continue
        changed, notes = process_html(html)
        if changed:
            total_changed += 1
            for note in notes:
                if note.startswith("placeholder:"):
                    total_placeholder += int(note.split(":")[1])
                elif note.startswith("anchors:"):
                    total_anchor += int(note.split(":")[1])

    print(
        f"OK: auto_fix_links sanitized "
        f"{total_placeholder} placeholder href(s) and "
        f"rewrote {total_anchor} local anchor link(s) "
        f"in {total_changed} file(s)"
    )


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    args = parser.parse_args(argv)
    walk_and_fix(args.root)


if __name__ == "__main__":
    sys.exit(main())

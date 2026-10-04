#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""App.css 的「样式归属」分析 / 标注 / 校验工具。

背景：`src/modules/skillsCss.ts` 的构建期裁剪依赖 App.css 里的 `@skill` 标记块：

    /* @skill: math_units */
    …该模块自己的规则（可能散在多处，每处一对标记）…
    /* @skill:end */

标记由本工具按「**归属判定**」自动生成，不要手写整份。

归属判据（逐条叶子规则取选择器里的 class）：
  1. 每个 class 的「使用方」= 源码里出现该 class 字面量的文件所属分组
     （`src/modules/<id>/` 下的文件 → 模块 id；其余 lib/services/components/stores/hooks/data/
     layouts/根下 tsx → `__kernel__`）。
  2. 一条规则的 class 使用方全在同一模块 ⇒ 该规则归该模块；含 `__kernel__` 或跨模块 ⇒ 留 App.css；
     源码里查不到任何 class ⇒ 留 App.css（保守：可能是动态拼出来的 class）。
  3. `@media` / `@supports` 块整块归属一致则整块搬，否则按内部规则细分。
  4. `@keyframes NAME` 归属 = 源码或 CSS 里 `animation[-name]:` 提到 NAME 的那个模块。

⚠️ 为什么是「标记 + 单一有序样式表」而不是「每个模块一个 css 文件」：
App.css 里模块的规则是**散段**的（36 个模块共 148 段，`ai_parse_result` 散了 24 处），
而 CSS 层叠依赖**规则顺序**。把散段合并进独立文件 = 改变加载位置；`--report` 会列出
「同特指度 + 共享 class + 被搬走的原本排在留下的之前」的规则对（实测 87 对），
它们在搬走后会从「输」变「赢」⇒ 静默的样式回归。

用法：
  python web/tools/cssSkillMark.py            # 只分析并打印报告，不改任何文件
  python web/tools/cssSkillMark.py --check    # 校验 App.css 现有标记与归属分析一致（CI/改 CSS 后跑）
  python web/tools/cssSkillMark.py --write    # 注入标记（已有标记则拒绝，避免重复注入）
"""
from __future__ import annotations

import argparse
import collections
import os
import re
import sys

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS_PATH = os.path.join(WEB, "src", "App.css")
SRC_DIR = os.path.join(WEB, "src")

OPEN_RE = re.compile(r"^[ \t]*/\* @skill: ([\w-]+) \*/[ \t]*$")
CLOSE_RE = re.compile(r"^[ \t]*/\* @skill:end \*/[ \t]*$")
ANIM_RE = re.compile(r"animation(?:-name)?\s*:\s*([^;}]+)")
KERNEL = "__kernel__"


# ── CSS 切块 ────────────────────────────────────────────────
def _scan_block(text: str, i: int, n: int) -> int:
    """text[i] == '{'；返回配对 '}' 的下标（越过注释与字符串里的花括号）。"""
    depth, j = 1, i + 1
    while j < n:
        c = text[j]
        if c == "/" and j + 1 < n and text[j + 1] == "*":
            k = text.find("*/", j + 2)
            j = n if k < 0 else k + 2
            continue
        if c in "\"'":
            q = c
            j += 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == q:
                    j += 1
                    break
                j += 1
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return j
        j += 1
    return -1


def top_items(text: str) -> list[dict]:
    """切成顶层项 `{kind:'block'|'raw', pre, head, body}`。

    ⚠️ 必须跳过注释与字符串里的花括号：本项目 CSS 有
    `/* 全局 button{width:100%} 的副作用… */` 这类注释，不跳过会把 `}` 当块结束 ⇒ 切块错位。
    """
    items: list[dict] = []
    i, n, start = 0, len(text), 0
    while i < n:
        c = text[i]
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            k = text.find("*/", i + 2)
            i = n if k < 0 else k + 2
            continue
        if c in "\"'":
            q = c
            i += 1
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == q:
                    i += 1
                    break
                i += 1
            continue
        if c == "{":
            close = _scan_block(text, i, n)
            if close < 0:
                break
            pre = text[start:i]
            items.append({"kind": "block", "pre": pre,
                          "head": pre.split("*/")[-1].strip(),
                          "body": text[i + 1:close],
                          "brace": i, "end": close + 1})
            i = close + 1
            start = i
            continue
        if c == "}":
            i += 1
            start = i
            continue
        i += 1
    if text[start:]:
        # 末尾的纯空白也保留为 raw 项，否则重建会丢掉文件结尾的换行
        items.append({"kind": "raw", "pre": "", "head": "", "body": text[start:],
                      "brace": start, "end": len(text)})
    return items


def item_text(it: dict) -> str:
    return it["body"] if it["kind"] == "raw" else it["pre"] + "{" + it["body"] + "}"


def classes_of(sel: str) -> set[str]:
    return set(re.findall(r"\.([A-Za-z_][\w-]*)", sel))


def leaves_of(body: str) -> list[tuple[str, str, list[str]]]:
    """把块体展开成 [(选择器, 规则体, at 路径)]。"""
    out: list[tuple[str, str, list[str]]] = []

    def walk(t: str, atp: list[str]) -> None:
        for it in top_items(t):
            if it["kind"] != "block":
                continue
            head, b = it["head"], it["body"]
            if head.startswith("@"):
                if head.startswith("@keyframes") or head.startswith("@-webkit-keyframes"):
                    out.append(("@KEYFRAMES " + head, b, atp + [head]))
                else:
                    walk(b, atp + [head])
            else:
                out.append((head, b, list(atp)))

    walk(body, [])
    return out


# ── 归属分析 ────────────────────────────────────────────────
def owner_of_path(path: str) -> str:
    rel = os.path.relpath(path, SRC_DIR).replace("\\", "/")
    m = re.match(r"modules/([^/]+)/", rel)
    return m.group(1) if m else KERNEL


def analyse(css_text: str) -> dict:
    files = []
    for root, dirs, fs in os.walk(SRC_DIR):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for f in fs:
            if f.endswith((".ts", ".tsx")) and not f.endswith(".test.ts"):
                files.append(os.path.join(root, f))
    texts = {f: open(f, encoding="utf-8").read() for f in files}

    items = top_items(css_text)
    all_cls: set[str] = set()
    for it in items:
        if it["kind"] != "block":
            continue
        for sel, _, _ in (leaves_of(it["body"]) or [(it["head"], it["body"], [])]):
            all_cls |= classes_of(sel)

    use: dict[str, set[str]] = collections.defaultdict(set)
    for f, t in texts.items():
        o = owner_of_path(f)
        toks = set(re.findall(r"[A-Za-z_][\w-]*", t))
        for c in all_cls & toks:
            use[c].add(o)

    def owner_of_rule(sel: str) -> str:
        cs = classes_of(sel)
        if not cs:
            return KERNEL
        owners: set[str] = set()
        for c in cs:
            owners |= use.get(c, set())
        if not owners:
            return KERNEL
        if len(owners) == 1 and KERNEL not in owners:
            return next(iter(owners))
        return KERNEL

    anim = collections.defaultdict(set)
    for f, t in texts.items():
        o = owner_of_path(f)
        for m in ANIM_RE.finditer(t):
            for tok in re.findall(r"[A-Za-z_][\w-]*", m.group(1)):
                anim[tok].add(o)
    for it in items:
        if it["kind"] != "block" or it["head"].startswith("@keyframes"):
            continue
        for sel, b, _ in (leaves_of(it["body"]) or [(it["head"], it["body"], [])]):
            o = owner_of_rule(sel)
            for m in ANIM_RE.finditer(b):
                for tok in re.findall(r"[A-Za-z_][\w-]*", m.group(1)):
                    anim[tok].add(o)

    def owner_of_keyframes(head: str) -> str:
        owners = anim.get(head.split()[-1].strip(), set())
        return next(iter(owners)) if len(owners) == 1 else KERNEL

    # 逐顶层项定归属
    owner: dict[int, str] = {}
    for idx, it in enumerate(items):
        if it["kind"] != "block":
            owner[idx] = KERNEL
            continue
        head = it["head"]
        if head.startswith("@keyframes") or head.startswith("@-webkit-keyframes"):
            owner[idx] = owner_of_keyframes(head)
        elif head.startswith("@"):
            owners = {owner_of_rule(s) for s, _, _ in leaves_of(it["body"])}
            owner[idx] = next(iter(owners)) if len(owners) == 1 and KERNEL not in owners else KERNEL
        else:
            owner[idx] = owner_of_rule(head)

    return {"items": items, "owner": owner, "owner_of_rule": owner_of_rule}


# ── 报告 ────────────────────────────────────────────────────
def specificity(sel: str) -> tuple[int, int, int]:
    sel = re.sub(r"::[A-Za-z-]+", "", sel)
    ids = len(re.findall(r"#[\w-]+", sel))
    cls = (len(re.findall(r"\.[\w-]+", sel)) + len(re.findall(r"\[[^\]]*\]", sel))
           + len(re.findall(r":(?!:)[A-Za-z-]+", sel)))
    els = len(re.findall(r"(?:^|[\s>+~,])([A-Za-z][\w-]*)", sel))
    return (ids, cls, els)


def report(a: dict, css_text: str) -> None:
    items, owner = a["items"], a["owner"]
    mods = collections.Counter(o for o in owner.values() if o != KERNEL)
    kept = sum(1 for o in owner.values() if o == KERNEL)
    print(f"顶层项 {len(items)} → 留 App.css {kept}，分给 {len(mods)} 个模块")

    sizes: dict[str, int] = collections.Counter()
    for i, it in enumerate(items):
        if owner[i] != KERNEL:
            sizes[owner[i]] += len(item_text(it).encode())
    for o, b in sorted(sizes.items(), key=lambda kv: -kv[1]):
        print(f"  {o:<32} {mods[o]:>4} 项 {b:>7} B")

    # 层叠顺序风险：搬走的规则原本排在留下的之前，且同特指度 + 共享 class
    seq = []
    for i, it in enumerate(items):
        if it["kind"] != "block":
            continue
        for sel, _, _ in (leaves_of(it["body"]) or [(it["head"], it["body"], [])]):
            if sel.startswith("@KEYFRAMES"):
                continue
            seq.append((i, owner[i], sel, specificity(sel), classes_of(sel)))
    risks = []
    for gi, (_, oi, sel_i, sp_i, cs_i) in enumerate(seq):
        if oi == KERNEL:
            continue
        for gj, (_, oj, sel_j, sp_j, cs_j) in enumerate(seq):
            if oj != KERNEL or gj <= gi or sp_i != sp_j or not (cs_i & cs_j):
                continue
            risks.append((oi, sel_i, sel_j))
    print(f"\n层叠顺序风险对（搬走的 ∩ 留下的，同特指度且共享 class）：{len(risks)}")
    print("  ⇒ 这正是「不做每模块一个 css 文件」的原因：合并散段会改变顺序，风险是静默的")
    for o, x, y in risks[:8]:
        print(f"    [{o}] {x[:46]:<46} ← 原在其前 → {y[:46]}")


# ── 校验 / 写入 ─────────────────────────────────────────────
def marker_line_owner(css_text: str) -> dict[int, str]:
    """第 i 行（0 基）处于哪个 @skill 块内（含标记行自身）。"""
    out: dict[int, str] = {}
    cur: str | None = None
    for i, line in enumerate(css_text.split("\n")):
        m = OPEN_RE.match(line)
        if m:
            cur = m.group(1)
            out[i] = cur
            continue
        if CLOSE_RE.match(line):
            out[i] = cur or "?"
            cur = None
            continue
        if cur:
            out[i] = cur
    return out


def check(a: dict, css_text: str) -> list[str]:
    """现有标记是否与归属分析一致。返回问题清单。"""
    problems: list[str] = []
    lines = css_text.split("\n")
    marked = marker_line_owner(css_text)
    blocks = []
    cur = None
    for i, line in enumerate(lines):
        m = OPEN_RE.match(line)
        if m:
            if cur is not None:
                problems.append(f"第 {i + 1} 行：@skill「{m.group(1)}」开标记嵌在「{cur}」里")
            cur = m.group(1)
            continue
        if CLOSE_RE.match(line):
            if cur is None:
                problems.append(f"第 {i + 1} 行：@skill:end 没有对应的开标记")
            cur = None
    if cur is not None:
        problems.append(f"@skill「{cur}」没有闭合")

    for idx, it in enumerate(a["items"]):
        if it["kind"] != "block":
            continue
        want = a["owner"][idx]
        got = marked.get(css_text.count("\n", 0, it["brace"]), KERNEL)
        if want == KERNEL and got == KERNEL:
            continue
        if want != KERNEL and got == want:
            continue
        where = css_text.count("\n", 0, it["brace"]) + 1
        head = it["head"].replace("\n", " ")[:60]
        if want == KERNEL and got != KERNEL:
            problems.append(f"第 {where} 行「{head}」应该是共享/kernel，却标成了「{got}」")
        elif want != KERNEL and got == KERNEL:
            problems.append(f"第 {where} 行「{head}」应归「{want}」，但没被标记")
        else:
            problems.append(f"第 {where} 行「{head}」应归「{want}」，却标成了「{got}」")
    return problems


def write(a: dict, css_text: str) -> int:
    if OPEN_RE.search(css_text) or CLOSE_RE.search(css_text):
        print("❌ App.css 里已有 @skill 标记 ⇒ 拒绝重复注入（要重做请先删掉标记行）")
        return 1
    items, owner = a["items"], a["owner"]
    pieces: list[str] = []
    i, n, nblocks = 0, len(items), 0
    while i < n:
        o = owner[i]
        j = i
        while j < n and owner[j] == o:
            j += 1
        if o == KERNEL:
            pieces.extend(item_text(items[k]) for k in range(i, j))
        else:
            assert items[i]["kind"] == "block", "标记只能挂在规则块前"
            parts = [item_text(items[k]) for k in range(i, j)]
            # ⚠️ pre 里含选择器本身，标记要插在 pre **最前面**且自带前导 \n，
            #    否则会落到 ".engine-row /* @skill */{" 这种位置。delete 标记行后必须与原文逐字节相同。
            parts[0] = f"\n/* @skill: {o} */" + items[i]["pre"] + "{" + items[i]["body"] + "}"
            parts[-1] += "\n/* @skill:end */"
            pieces.extend(parts)
            nblocks += 1
        i = j
    out = "".join(pieces)

    stripped = "\n".join(l for l in out.split("\n")
                         if not OPEN_RE.match(l) and not CLOSE_RE.match(l))
    if stripped != css_text:
        print("❌ 自检失败：删掉标记行后与原文不一致（拒绝写入）")
        return 1

    with open(CSS_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out)
    print(f"✅ 注入 {nblocks} 对标记，覆盖 {len({o for o in owner.values() if o != KERNEL})} 个模块；"
          f"{len(css_text.encode())} → {len(out.encode())} 字节（自检：删标记后与原文逐字节相同）")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="App.css 样式归属分析 / 标注 / 校验")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--check", action="store_true", help="校验现有标记与归属分析一致")
    g.add_argument("--write", action="store_true", help="注入标记（已有标记则拒绝）")
    g.add_argument("--report", action="store_true", help="只打印分析报告（默认）")
    args = ap.parse_args()

    css_text = open(CSS_PATH, encoding="utf-8").read()
    a = analyse(css_text)

    if args.check:
        problems = check(a, css_text)
        if problems:
            print(f"❌ 标记与归属分析不一致（{len(problems)} 处）：")
            for p in problems[:40]:
                print("   " + p)
            if len(problems) > 40:
                print(f"   …还有 {len(problems) - 40} 处")
            return 1
        print("✅ App.css 的 @skill 标记与归属分析完全一致")
        return 0

    if args.write:
        return write(a, css_text)

    report(a, css_text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

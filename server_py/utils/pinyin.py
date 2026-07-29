"""拼音解析 — 从 Go 版完整移植的声韵母/介母/声调逻辑"""

# 声母表
INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l",
            "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"]

# 整体认读音节
WHOLE_SYLLABLES = {
    "zhi", "chi", "shi", "ri", "zi", "ci", "si",
    "yi", "wu", "yu", "ye", "yue", "yuan",
    "yin", "yun", "ying",
}

# 声调符号映射
TONE_MARKS = {
    "a": ["ā", "á", "ǎ", "à", "a"],
    "o": ["ō", "ó", "ǒ", "ò", "o"],
    "e": ["ē", "é", "ě", "è", "e"],
    "i": ["ī", "í", "ǐ", "ì", "i"],
    "u": ["ū", "ú", "ǔ", "ù", "u"],
    "ü": ["ǖ", "ǘ", "ǚ", "ǜ", "ü"],
}


def parse_pinyin(pinyin: str) -> dict:
    """
    解析拼音字符串
    输入: "hao3", "zhong1", "lv4", "yi1"
    输出: {original, initial, medial, final, tone, display, is_overall}
    """
    pinyin = pinyin.strip().lower()
    if not pinyin:
        raise ValueError("空拼音")

    # 分离声调数字
    tone, body = _extract_tone(pinyin)

    # 检查整体认读音节
    is_overall = body in WHOLE_SYLLABLES

    # 分离声母、介母、韵母
    init, medial, fin = _split_pinyin(body)

    display = _apply_tone_mark(init + medial + fin, tone)

    return {
        "original": pinyin,
        "initial": init,
        "medial": medial,
        "final": fin,
        "tone": tone,
        "display": display,
        "is_overall": is_overall,
    }


def _extract_tone(pinyin: str) -> tuple[int, str]:
    if pinyin and pinyin[-1] in "12345":
        return int(pinyin[-1]), pinyin[:-1]
    return 0, pinyin


def _split_pinyin(body: str) -> tuple[str, str, str]:
    """分离声母、介母、韵母"""
    if not body:
        return "", "", ""

    # 零声母 y/w 处理
    if body not in WHOLE_SYLLABLES and len(body) > 1:
        first = body[0]
        if first == "y":
            converted = "i" + body[1:]
            m, f = _split_medial(converted)
            return "", m, f
        if first == "w":
            converted = "u" + body[1:]
            m, f = _split_medial(converted)
            return "", m, f

    # 提取声母
    for init in INITIALS:
        if body.startswith(init):
            rest = body[len(init):]
            if not rest:
                return init, "", ""
            m, f = _split_medial(rest)
            return init, m, f

    # 零声母
    m, f = _split_medial(body)
    return "", m, f


def _split_medial(rest: str) -> tuple[str, str]:
    """从韵母中分离介母"""
    if not rest:
        return "", ""
    first = rest[0]
    if first == "i" and _has_prefix(rest, ["iong", "iang", "iao", "ian", "ia"]):
        return "i", rest[1:]
    if first == "u" and _has_prefix(rest, ["uang", "uai", "uan", "uo", "ua"]):
        return "u", rest[1:]
    if first == "v" and _has_prefix(rest, ["van", "vong"]):
        return "v", rest[1:]
    return "", rest


def _has_prefix(s: str, prefixes: list[str]) -> bool:
    return any(s.startswith(p) for p in prefixes)


def _apply_tone_mark(pinyin: str, tone: int) -> str:
    """在正确的元音上标注声调"""
    if tone < 1 or tone > 5:
        return pinyin
    if tone == 5:
        return pinyin  # 轻声不标调

    pos = _find_tone_position(pinyin)
    if pos < 0:
        return pinyin

    ch = pinyin[pos]
    vowel = "ü" if ch == "v" else ch
    marks = TONE_MARKS.get(vowel)
    if marks and 0 <= tone - 1 < len(marks):
        return pinyin[:pos] + marks[tone - 1] + pinyin[pos + 1:]
    return pinyin


def _find_tone_position(pinyin: str) -> int:
    """找到标调元音的位置（a > o > e > i/u 并列标在后）"""
    pinyin = pinyin.replace("ü", "v")
    a_pos = o_pos = e_pos = i_pos = u_pos = -1

    for idx, ch in enumerate(pinyin):
        if ch == "a":
            a_pos = idx
        elif ch == "o":
            o_pos = idx
        elif ch == "e":
            e_pos = idx
        elif ch == "i":
            i_pos = idx
        elif ch == "u":
            u_pos = idx
        elif ch == "v" and u_pos < 0:
            u_pos = idx

    if a_pos >= 0:
        return a_pos
    if o_pos >= 0:
        return o_pos
    if e_pos >= 0:
        return e_pos
    # i/u 并列标在后
    if i_pos >= 0 and u_pos >= 0:
        return u_pos if u_pos > i_pos else i_pos
    if i_pos >= 0:
        return i_pos
    if u_pos >= 0:
        return u_pos
    return -1

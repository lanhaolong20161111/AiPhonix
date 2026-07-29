"""生成英文字母笔顺结构化数据（标准手写体）"""

import json
import os
import sys
import math

# 坐标系:
#   (0, 0) = 左上角, (1, 1) = 右下角
#   大写字母: cap_top=0.00, baseline=0.85
#   小写字母: ascender=0.00, x-height=0.50, baseline=0.85, descender=1.00


def pt(x, y):
    """归一化坐标点"""
    return {"x": round(x, 3), "y": round(y, 3)}


def stroke(points, type="line", label=""):
    """创建一个笔顺笔画"""
    return {"points": points, "type": type, "label": label}


# --- 发音数据（phonics） ---
PHONICS = {
    # 大写
    "A": {"sound": "/eɪ/", "example": "apple"},
    "B": {"sound": "/biː/", "example": "ball"},
    "C": {"sound": "/siː/", "example": "cat"},
    "D": {"sound": "/diː/", "example": "dog"},
    "E": {"sound": "/iː/", "example": "egg"},
    "F": {"sound": "/ɛf/", "example": "fish"},
    "G": {"sound": "/dʒiː/", "example": "girl"},
    "H": {"sound": "/eɪtʃ/", "example": "hat"},
    "I": {"sound": "/aɪ/", "example": "ice"},
    "J": {"sound": "/dʒeɪ/", "example": "jump"},
    "K": {"sound": "/keɪ/", "example": "kite"},
    "L": {"sound": "/ɛl/", "example": "lion"},
    "M": {"sound": "/ɛm/", "example": "monkey"},
    "N": {"sound": "/ɛn/", "example": "nose"},
    "O": {"sound": "/əʊ/", "example": "orange"},
    "P": {"sound": "/piː/", "example": "pig"},
    "Q": {"sound": "/kjuː/", "example": "queen"},
    "R": {"sound": "/ɑː/", "example": "rabbit"},
    "S": {"sound": "/ɛs/", "example": "sun"},
    "T": {"sound": "/tiː/", "example": "tree"},
    "U": {"sound": "/ʌ/", "example": "umbrella"},
    "V": {"sound": "/viː/", "example": "violin"},
    "W": {"sound": "/ˈdʌbəl juː/", "example": "water"},
    "X": {"sound": "/ɛks/", "example": "fox"},
    "Y": {"sound": "/waɪ/", "example": "yellow"},
    "Z": {"sound": "/ziː/", "example": "zebra"},
    # 小写复用同词
}

# 小写字母复用大写发音，特殊处理的覆盖
PHONICS_LOWER_OVERRIDE = {
    "a": {"sound": "/æ/", "example": "ant"},
    "e": {"sound": "/e/", "example": "elephant"},
    "i": {"sound": "/ɪ/", "example": "insect"},
    "o": {"sound": "/ɒ/", "example": "octopus"},
    "u": {"sound": "/ʌ/", "example": "umbrella"},
    "y": {"sound": "/j/", "example": "yarn"},
}


def _compute_direction(points):
    """从首尾点计算笔画方向"""
    if len(points) < 2:
        return "dot"
    dx = points[-1]["x"] - points[0]["x"]
    dy = points[-1]["y"] - points[0]["y"]
    adx, ady = abs(dx), abs(dy)

    # 极短距离视为点
    if math.sqrt(dx*dx + dy*dy) < 0.08:
        return "dot"

    if adx < 0.05 and ady < 0.05:
        return "dot"

    # 角度 (弧度)
    angle = math.atan2(dy, dx)

    if ady < adx * 0.3:
        return "right" if dx > 0 else "left"
    if adx < ady * 0.3:
        return "down" if dy > 0 else "up"

    # 对角线
    if angle > math.pi * 0.125 and angle <= math.pi * 0.625:
        return "down-right" if dx > 0 else "down-left"
    if angle <= -math.pi * 0.125 and angle >= -math.pi * 0.625:
        return "up-right" if dx > 0 else "up-left"
    if angle > 0:
        return "down-right" if dx > 0 else "down-left"
    return "up-right" if dx > 0 else "up-left"


def _voice_hint(direction, label):
    """生成语音提示文案"""
    hints = {
        "down": "向下写",
        "up": "向上写",
        "right": "向右写",
        "left": "向左写",
        "down-right": "向右下写",
        "down-left": "向左下写",
        "up-right": "向右上写",
        "up-left": "向左上写",
        "dot": "点一个点",
        "circle": "画一个圆圈",
        "curve": "画一条弧线",
    }
    return hints.get(direction, f"画{label}")


# --- 大写字母笔顺 ---
UPPER = {
    "A": [
        stroke([pt(0.5, 0.00), pt(0.20, 0.85)], "line", "左斜线"),
        stroke([pt(0.5, 0.00), pt(0.80, 0.85)], "line", "右斜线"),
        stroke([pt(0.28, 0.50), pt(0.72, 0.50)], "line", "横线"),
    ],
    "B": [
        stroke([pt(0.25, 0.00), pt(0.25, 0.85)], "line", "竖线"),
        stroke([pt(0.25, 0.00), pt(0.70, 0.15), pt(0.70, 0.35), pt(0.25, 0.42)], "curve", "上半圆"),
        stroke([pt(0.25, 0.42), pt(0.72, 0.52), pt(0.72, 0.72), pt(0.25, 0.85)], "curve", "下半圆"),
    ],
    "C": [
        stroke([pt(0.70, 0.02), pt(0.22, 0.10), pt(0.18, 0.45), pt(0.22, 0.78), pt(0.70, 0.83)], "curve", "圆弧"),
    ],
    "D": [
        stroke([pt(0.25, 0.00), pt(0.25, 0.85)], "line", "竖线"),
        stroke([pt(0.25, 0.00), pt(0.72, 0.12), pt(0.78, 0.45), pt(0.72, 0.75), pt(0.25, 0.85)], "curve", "圆弧"),
    ],
    "E": [
        stroke([pt(0.25, 0.00), pt(0.25, 0.85)], "line", "竖线"),
        stroke([pt(0.25, 0.00), pt(0.78, 0.00)], "line", "上横线"),
        stroke([pt(0.25, 0.42), pt(0.65, 0.42)], "line", "中横线"),
        stroke([pt(0.25, 0.85), pt(0.78, 0.85)], "line", "下横线"),
    ],
    "F": [
        stroke([pt(0.25, 0.00), pt(0.25, 0.85)], "line", "竖线"),
        stroke([pt(0.25, 0.00), pt(0.78, 0.00)], "line", "上横线"),
        stroke([pt(0.25, 0.42), pt(0.65, 0.42)], "line", "中横线"),
    ],
    "G": [
        stroke([pt(0.72, 0.02), pt(0.22, 0.10), pt(0.18, 0.45), pt(0.22, 0.78), pt(0.68, 0.83)], "curve", "圆弧"),
        stroke([pt(0.50, 0.50), pt(0.75, 0.50)], "line", "横线"),
    ],
    "H": [
        stroke([pt(0.20, 0.00), pt(0.20, 0.85)], "line", "左竖线"),
        stroke([pt(0.80, 0.00), pt(0.80, 0.85)], "line", "右竖线"),
        stroke([pt(0.20, 0.42), pt(0.80, 0.42)], "line", "横线"),
    ],
    "I": [
        stroke([pt(0.35, 0.00), pt(0.65, 0.00)], "line", "上横线"),
        stroke([pt(0.50, 0.00), pt(0.50, 0.85)], "line", "竖线"),
        stroke([pt(0.35, 0.85), pt(0.65, 0.85)], "line", "下横线"),
    ],
    "J": [
        stroke([pt(0.50, 0.00), pt(0.50, 0.65)], "line", "竖线"),
        stroke([pt(0.50, 0.65), pt(0.42, 0.78), pt(0.25, 0.78)], "curve", "弯钩"),
        stroke([pt(0.35, 0.00), pt(0.65, 0.00)], "line", "上横线"),
    ],
    "K": [
        stroke([pt(0.25, 0.00), pt(0.25, 0.85)], "line", "竖线"),
        stroke([pt(0.25, 0.42), pt(0.78, 0.00)], "line", "上斜线"),
        stroke([pt(0.25, 0.42), pt(0.78, 0.85)], "line", "下斜线"),
    ],
    "L": [
        stroke([pt(0.25, 0.00), pt(0.25, 0.85)], "line", "竖线"),
        stroke([pt(0.25, 0.85), pt(0.78, 0.85)], "line", "横线"),
    ],
    "M": [
        stroke([pt(0.15, 0.85), pt(0.15, 0.00)], "line", "左竖线"),
        stroke([pt(0.15, 0.00), pt(0.50, 0.65)], "line", "左斜线"),
        stroke([pt(0.50, 0.65), pt(0.85, 0.00)], "line", "右斜线"),
        stroke([pt(0.85, 0.00), pt(0.85, 0.85)], "line", "右竖线"),
    ],
    "N": [
        stroke([pt(0.20, 0.85), pt(0.20, 0.00)], "line", "左竖线"),
        stroke([pt(0.20, 0.00), pt(0.80, 0.85)], "line", "斜线"),
        stroke([pt(0.80, 0.85), pt(0.80, 0.00)], "line", "右竖线"),
    ],
    "O": [
        stroke([pt(0.50, 0.00), pt(0.80, 0.10), pt(0.85, 0.42), pt(0.80, 0.75), pt(0.50, 0.85), pt(0.20, 0.75), pt(0.15, 0.42), pt(0.20, 0.10), pt(0.50, 0.00)], "curve", "圆圈"),
    ],
    "P": [
        stroke([pt(0.25, 0.00), pt(0.25, 0.85)], "line", "竖线"),
        stroke([pt(0.25, 0.00), pt(0.72, 0.08), pt(0.78, 0.28), pt(0.68, 0.45), pt(0.25, 0.42)], "curve", "半圆"),
    ],
    "Q": [
        stroke([pt(0.50, 0.00), pt(0.80, 0.12), pt(0.85, 0.45), pt(0.78, 0.78), pt(0.50, 0.85), pt(0.22, 0.78), pt(0.15, 0.45), pt(0.20, 0.12), pt(0.50, 0.00)], "curve", "圆圈"),
        stroke([pt(0.65, 0.65), pt(0.85, 0.80)], "line", "尾巴"),
    ],
    "R": [
        stroke([pt(0.25, 0.00), pt(0.25, 0.85)], "line", "竖线"),
        stroke([pt(0.25, 0.00), pt(0.72, 0.08), pt(0.78, 0.28), pt(0.68, 0.45), pt(0.25, 0.42)], "curve", "半圆"),
        stroke([pt(0.30, 0.42), pt(0.78, 0.85)], "line", "斜线"),
    ],
    "S": [
        stroke([pt(0.72, 0.10), pt(0.30, 0.12), pt(0.22, 0.35), pt(0.30, 0.52), pt(0.70, 0.60), pt(0.78, 0.78), pt(0.60, 0.85), pt(0.25, 0.82)], "curve", "S形"),
    ],
    "T": [
        stroke([pt(0.15, 0.00), pt(0.85, 0.00)], "line", "上横线"),
        stroke([pt(0.50, 0.00), pt(0.50, 0.85)], "line", "竖线"),
    ],
    "U": [
        stroke([pt(0.20, 0.00), pt(0.20, 0.60)], "line", "左竖线"),
        stroke([pt(0.20, 0.60), pt(0.22, 0.75), pt(0.50, 0.82), pt(0.78, 0.75), pt(0.80, 0.60)], "curve", "底部弧线"),
        stroke([pt(0.80, 0.60), pt(0.80, 0.00)], "line", "右竖线"),
    ],
    "V": [
        stroke([pt(0.15, 0.00), pt(0.50, 0.82)], "line", "左斜线"),
        stroke([pt(0.50, 0.82), pt(0.85, 0.00)], "line", "右斜线"),
    ],
    "W": [
        stroke([pt(0.12, 0.00), pt(0.35, 0.85)], "line", "左斜线"),
        stroke([pt(0.35, 0.85), pt(0.50, 0.00)], "line", "右上斜线"),
        stroke([pt(0.50, 0.00), pt(0.65, 0.85)], "line", "右下斜线"),
        stroke([pt(0.65, 0.85), pt(0.88, 0.00)], "line", "右斜线"),
    ],
    "X": [
        stroke([pt(0.18, 0.00), pt(0.82, 0.85)], "line", "右斜线"),
        stroke([pt(0.82, 0.00), pt(0.18, 0.85)], "line", "左斜线"),
    ],
    "Y": [
        stroke([pt(0.20, 0.00), pt(0.50, 0.42)], "line", "左斜线"),
        stroke([pt(0.80, 0.00), pt(0.50, 0.42)], "line", "右斜线"),
        stroke([pt(0.50, 0.42), pt(0.50, 0.85)], "line", "竖线"),
    ],
    "Z": [
        stroke([pt(0.15, 0.00), pt(0.85, 0.00)], "line", "上横线"),
        stroke([pt(0.85, 0.00), pt(0.15, 0.85)], "line", "斜线"),
        stroke([pt(0.15, 0.85), pt(0.85, 0.85)], "line", "下横线"),
    ],
}

# --- 小写字母笔顺 ---
LOWER = {
    "a": [
        stroke([pt(0.30, 0.50), pt(0.55, 0.50), pt(0.65, 0.58), pt(0.65, 0.72), pt(0.55, 0.82), pt(0.30, 0.82), pt(0.20, 0.72), pt(0.20, 0.60), pt(0.30, 0.50)], "curve", "圆圈"),
        stroke([pt(0.30, 0.50), pt(0.50, 0.50), pt(0.55, 0.58), pt(0.55, 0.82)], "curve", "右边竖线"),
    ],
    "b": [
        stroke([pt(0.30, 0.00), pt(0.30, 0.82)], "line", "竖线"),
        stroke([pt(0.30, 0.50), pt(0.60, 0.50), pt(0.72, 0.60), pt(0.72, 0.75), pt(0.60, 0.85), pt(0.30, 0.82)], "curve", "圆圈"),
    ],
    "c": [
        stroke([pt(0.65, 0.50), pt(0.25, 0.55), pt(0.20, 0.70), pt(0.30, 0.82), pt(0.65, 0.80)], "curve", "圆弧"),
    ],
    "d": [
        stroke([pt(0.35, 0.50), pt(0.65, 0.50), pt(0.75, 0.60), pt(0.75, 0.75), pt(0.65, 0.85), pt(0.35, 0.82), pt(0.25, 0.72), pt(0.25, 0.60), pt(0.35, 0.50)], "curve", "圆圈"),
        stroke([pt(0.65, 0.82), pt(0.65, 0.00)], "line", "竖线"),
    ],
    "e": [
        stroke([pt(0.20, 0.65), pt(0.65, 0.65)], "line", "横线"),
        stroke([pt(0.65, 0.65), pt(0.65, 0.72), pt(0.55, 0.82), pt(0.30, 0.82), pt(0.20, 0.72), pt(0.22, 0.55), pt(0.35, 0.50), pt(0.60, 0.50), pt(0.72, 0.55)], "curve", "弧线"),
    ],
    "f": [
        stroke([pt(0.50, 0.85), pt(0.50, 0.08)], "line", "竖线"),
        stroke([pt(0.50, 0.08), pt(0.28, 0.12), pt(0.20, 0.25)], "curve", "上弯"),
        stroke([pt(0.30, 0.42), pt(0.75, 0.42)], "line", "横线"),
    ],
    "g": [
        stroke([pt(0.30, 0.50), pt(0.60, 0.50), pt(0.70, 0.58), pt(0.70, 0.70), pt(0.60, 0.82), pt(0.30, 0.82), pt(0.20, 0.72), pt(0.20, 0.58), pt(0.30, 0.50)], "curve", "圆圈"),
        stroke([pt(0.30, 0.82), pt(0.30, 0.95), pt(0.50, 1.00), pt(0.65, 0.95)], "curve", "下尾巴"),
    ],
    "h": [
        stroke([pt(0.25, 0.82), pt(0.25, 0.00)], "line", "竖线"),
        stroke([pt(0.25, 0.50), pt(0.55, 0.50), pt(0.72, 0.58), pt(0.75, 0.72), pt(0.72, 0.82), pt(0.50, 0.85), pt(0.25, 0.82)], "curve", "拱形"),
    ],
    "i": [
        stroke([pt(0.45, 0.50), pt(0.45, 0.82)], "line", "竖线"),
        stroke([pt(0.48, 0.35), pt(0.48, 0.28)], "line", "点"),
    ],
    "j": [
        stroke([pt(0.45, 0.50), pt(0.45, 0.82), pt(0.45, 0.92), pt(0.38, 0.98), pt(0.30, 0.95)], "curve", "竖线+下尾巴"),
        stroke([pt(0.48, 0.35), pt(0.48, 0.28)], "line", "点"),
    ],
    "k": [
        stroke([pt(0.25, 0.82), pt(0.25, 0.00)], "line", "竖线"),
        stroke([pt(0.30, 0.50), pt(0.75, 0.30)], "line", "上斜线"),
        stroke([pt(0.30, 0.50), pt(0.75, 0.80)], "line", "下斜线"),
    ],
    "l": [
        stroke([pt(0.42, 0.82), pt(0.42, 0.00)], "line", "竖线"),
    ],
    "m": [
        stroke([pt(0.15, 0.82), pt(0.15, 0.50)], "line", "左竖"),
        stroke([pt(0.15, 0.50), pt(0.35, 0.50), pt(0.48, 0.55), pt(0.48, 0.72), pt(0.38, 0.82), pt(0.15, 0.82)], "curve", "第一拱"),
        stroke([pt(0.38, 0.82), pt(0.38, 0.50)], "line", "中竖"),
        stroke([pt(0.38, 0.50), pt(0.58, 0.50), pt(0.75, 0.55), pt(0.78, 0.72), pt(0.70, 0.82), pt(0.50, 0.85), pt(0.38, 0.82)], "curve", "第二拱"),
    ],
    "n": [
        stroke([pt(0.20, 0.82), pt(0.20, 0.50)], "line", "左竖"),
        stroke([pt(0.20, 0.50), pt(0.45, 0.50), pt(0.65, 0.55), pt(0.72, 0.68), pt(0.68, 0.80), pt(0.50, 0.85), pt(0.20, 0.82)], "curve", "拱形"),
    ],
    "o": [
        stroke([pt(0.50, 0.50), pt(0.72, 0.55), pt(0.75, 0.68), pt(0.68, 0.82), pt(0.50, 0.85), pt(0.28, 0.82), pt(0.22, 0.68), pt(0.25, 0.55), pt(0.50, 0.50)], "curve", "圆圈"),
    ],
    "p": [
        stroke([pt(0.30, 0.50), pt(0.30, 0.82), pt(0.30, 0.95), pt(0.50, 1.00), pt(0.65, 0.92)], "line", "竖线"),
        stroke([pt(0.30, 0.50), pt(0.60, 0.50), pt(0.72, 0.58), pt(0.72, 0.72), pt(0.62, 0.82), pt(0.30, 0.82)], "curve", "圆圈"),
    ],
    "q": [
        stroke([pt(0.38, 0.50), pt(0.65, 0.50), pt(0.75, 0.58), pt(0.75, 0.70), pt(0.65, 0.82), pt(0.38, 0.82), pt(0.28, 0.72), pt(0.28, 0.58), pt(0.38, 0.50)], "curve", "圆圈"),
        stroke([pt(0.38, 0.82), pt(0.38, 0.95), pt(0.50, 1.00), pt(0.65, 0.95)], "curve", "下尾巴"),
    ],
    "r": [
        stroke([pt(0.20, 0.82), pt(0.20, 0.50)], "line", "竖线"),
        stroke([pt(0.20, 0.50), pt(0.45, 0.50), pt(0.62, 0.55), pt(0.68, 0.60)], "curve", "小拱"),
    ],
    "s": [
        stroke([pt(0.65, 0.50), pt(0.28, 0.55), pt(0.22, 0.65), pt(0.28, 0.75), pt(0.65, 0.78), pt(0.72, 0.85), pt(0.65, 0.88), pt(0.28, 0.85)], "curve", "S形"),
    ],
    "t": [
        stroke([pt(0.50, 0.85), pt(0.50, 0.00)], "line", "竖线"),
        stroke([pt(0.50, 0.00), pt(0.30, 0.05), pt(0.22, 0.15)], "curve", "上弯"),
        stroke([pt(0.30, 0.45), pt(0.72, 0.45)], "line", "横线"),
    ],
    "u": [
        stroke([pt(0.20, 0.50), pt(0.20, 0.72)], "line", "左竖"),
        stroke([pt(0.20, 0.72), pt(0.22, 0.82), pt(0.45, 0.85), pt(0.68, 0.82), pt(0.72, 0.72)], "curve", "底部弧线"),
        stroke([pt(0.72, 0.72), pt(0.72, 0.50)], "line", "右竖"),
    ],
    "v": [
        stroke([pt(0.18, 0.50), pt(0.50, 0.82)], "line", "左斜线"),
        stroke([pt(0.50, 0.82), pt(0.82, 0.50)], "line", "右斜线"),
    ],
    "w": [
        stroke([pt(0.12, 0.50), pt(0.30, 0.82)], "line", "左斜线"),
        stroke([pt(0.30, 0.82), pt(0.50, 0.50)], "line", "右上斜线"),
        stroke([pt(0.50, 0.50), pt(0.70, 0.82)], "line", "右下斜线"),
        stroke([pt(0.70, 0.82), pt(0.88, 0.50)], "line", "右斜线"),
    ],
    "x": [
        stroke([pt(0.22, 0.50), pt(0.78, 0.85)], "line", "右斜线"),
        stroke([pt(0.78, 0.50), pt(0.22, 0.85)], "line", "左斜线"),
    ],
    "y": [
        stroke([pt(0.18, 0.50), pt(0.50, 0.82)], "line", "左斜线"),
        stroke([pt(0.50, 0.82), pt(0.82, 0.50)], "line", "右斜线"),
        stroke([pt(0.50, 0.82), pt(0.50, 0.95), pt(0.35, 1.00), pt(0.20, 0.95)], "curve", "下尾巴"),
    ],
    "z": [
        stroke([pt(0.18, 0.50), pt(0.82, 0.50)], "line", "上横线"),
        stroke([pt(0.82, 0.50), pt(0.18, 0.85)], "line", "斜线"),
        stroke([pt(0.18, 0.85), pt(0.82, 0.85)], "line", "下横线"),
    ],
}


def build_letter(letter, case_type, stroke_list):
    """构建单个字母的数据结构（含方向、语音提示、发音）"""
    # 获取发音数据
    if case_type == "lowercase" and letter in PHONICS_LOWER_OVERRIDE:
        ph = PHONICS_LOWER_OVERRIDE[letter]
    else:
        ph = PHONICS.get(letter.upper(), {"sound": "", "example": ""})

    # 构建笔画
    strokes_out = []
    for i, s in enumerate(stroke_list):
        direction = _compute_direction(s["points"])
        # 曲线类型的特殊标记
        if s["type"] == "curve":
            pts = s["points"]
            if len(pts) >= 8 and abs(pts[0]["x"] - pts[-1]["x"]) < 0.15 and abs(pts[0]["y"] - pts[-1]["y"]) < 0.15:
                direction = "circle"
        strokes_out.append({
            "order": i + 1,
            "type": s["type"],
            "points": s["points"],
            "label": s["label"],
            "direction": direction,
            "voice_hint": _voice_hint(direction, s["label"]),
        })

    return {
        "letter": letter,
        "case": case_type,
        "stroke_count": len(stroke_list),
        "strokes": strokes_out,
        "phonics": ph,
        "animation": {
            "default_speed": 1.0,
            "pause_after_stroke_ms": 500,
        },
    }


def main():
    letters = []

    for ch in sorted(UPPER.keys()):
        letters.append(build_letter(ch, "uppercase", UPPER[ch]))

    for ch in sorted(LOWER.keys()):
        letters.append(build_letter(ch, "lowercase", LOWER[ch]))

    output = {
        "version": "1.0",
        "description": "英文字母手写笔顺数据（标准手写体）",
        "coordinate_system": {
            "origin": "top-left",
            "x_range": [0, 1],
            "y_range": [0, 1],
            "uppercase": {"cap_top": 0.00, "baseline": 0.85},
            "lowercase": {"ascender": 0.00, "x_height": 0.50, "baseline": 0.85, "descender": 1.00},
        },
        "stroke_types": {
            "line": "直线 — 用两个端点定义",
            "curve": "曲线 — 所有点平滑连接",
        },
        "letters": letters,
    }

    # 写入 JSON
    output_path = os.path.join(os.path.dirname(__file__), "..", "assets", "letter_strokes.json")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # 统计
    total_strokes = sum(l["stroke_count"] for l in letters)
    print(f"生成完成!")
    print(f"  大写字母: {sum(1 for l in letters if l['case'] == 'uppercase')} 个")
    print(f"  小写字母: {sum(1 for l in letters if l['case'] == 'lowercase')} 个")
    print(f"  总笔顺数: {total_strokes}")
    print(f"  文件: {output_path}")
    print(f"  大小: {os.path.getsize(output_path) / 1024:.1f} KB")

    # 打印每个字母的笔顺
    print(f"\n各字母笔顺:")
    for l in letters:
        strokes_detail = ", ".join(f"{s['order']}:{s['type']}" for s in l["strokes"])
        print(f"  {l['letter']} ({l['case'][0]}) → {l['stroke_count']} 笔: {strokes_detail}")


if __name__ == "__main__":
    main()

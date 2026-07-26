"""debug: 测试过滤逻辑"""
import re

texts = [
    "I'm Princess Sylvia!",
    "Big Muzzy.",
    "Good morning.",
    "Good evening.",
    "I'm clever.",
    "ys",
    "Big!",
    "I've got a computer.",
    "兰鲜",
    "Can I have a peach please, Daddy?",
    "A plum and some grapes.",
    "Plums! Plums! Plums!",
    "I love you.",
    "Off we go!",
    "A, E, I, O, U.",
]

for text in texts:
    has_english = bool(re.search(r'[a-zA-Z]{2,}', text))
    has_chinese = bool(re.search(r'[\u4e00-\u9fff]', text))
    is_valid = has_english and not has_chinese and len(text) >= 3
    print(f"  '{text}' → eng={has_english} chn={has_chinese} len={len(text)} valid={is_valid}")

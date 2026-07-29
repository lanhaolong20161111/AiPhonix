#!/usr/bin/env python3
"""为 english_vocabulary.json 每个单词添加 emoji"""
import json

with open("app/src/main/assets/english_vocabulary.json", "rb") as f:
    data = json.load(f)

EMOJI_MAP = {
    "air": "💨", "animal": "🐾", "apple": "🍎", "arm": "💪", "aunt": "👩",
    "baby": "👶", "banana": "🍌", "bear": "🐻", "big": "📏", "bird": "🐦",
    "black": "⚫", "blue": "🔵", "brother": "👦", "brown": "🟤", "cake": "🎂",
    "can": "🥫", "cat": "🐱", "colour": "🎨", "cousin": "👧", "cut": "✂️",
    "cute": "😊", "dad": "👨", "dog": "🐶", "draw": "✏️", "duck": "🦆",
    "ear": "👂", "eat": "🍽️", "eight": "8️⃣", "elephant": "🐘", "eye": "👁️",
    "family": "👪", "farm": "🌾", "fast": "🏃", "father": "👨", "fish": "🐟",
    "five": "5️⃣", "flower": "🌸", "four": "4️⃣", "fox": "🦊", "friend": "🤝",
    "garden": "🌻", "giraffe": "🦒", "give": "🎁", "go": "🚶", "good": "👍",
    "grandfather": "👴", "grandma": "👵", "grandmother": "👵", "grandpa": "👴",
    "grape": "🍇", "grass": "🌿", "green": "🟢", "hand": "🤚", "have": "📥",
    "help": "🆘",
    "like": "❤️", "lion": "🦁", "listen": "🎧", "make": "🔨", "me": "🙋",
    "miss": "👩‍🏫", "monkey": "🐵", "mother": "👩", "mouth": "👄",
    "mum": "👩", "name": "🏷️", "need": "❗", "new": "🆕", "nice": "😃",
    "nine": "9️⃣", "o'clock": "🕐", "old": "👴", "one": "1️⃣", "orange": "🍊",
    "panda": "🐼", "pet": "🐕", "pink": "🩷", "plant": "🌱", "purple": "🟣",
    "rabbit": "🐰", "red": "🔴", "say": "💬", "school": "🏫", "sea": "🌊",
    "seven": "7️⃣", "share": "🤲", "sister": "👧", "six": "6️⃣", "small": "🐭",
    "smile": "😄", "some": "🤷", "sun": "☀️", "tall": "🧍", "ten": "🔟",
    "them": "👥", "three": "3️⃣", "tiger": "🐯", "tree": "🌳", "two": "2️⃣",
    "uncle": "👨", "water": "💧", "white": "⚪", "year": "📅", "yellow": "🟡",
    "zoo": "🏛️",
}

# 更新
updated = 0
for w in data.get("words", []):
    word = w["word"].lower()
    if word in EMOJI_MAP:
        w["emoji"] = EMOJI_MAP[word]
        updated += 1
    else:
        # 没找到的留空
        w["emoji"] = ""
        print(f"  ⚠ No emoji for: {word}")

with open("app/src/main/assets/english_vocabulary.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"\n✅ Updated {updated} words with emoji")

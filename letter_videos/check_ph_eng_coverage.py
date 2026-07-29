#!/usr/bin/env python3
"""检查每个音标是否关联到了三年级上英语词汇"""
import json

with open("app/src/main/assets/wordbank.json", "rb") as f:
    data = json.load(f)

with open("app/src/main/assets/english_vocabulary.json", "rb") as f:
    eng = json.load(f)

# 字母→音素映射（与 ContentRepositoryImpl 一致）
letter_to_ph = {
    "a": "æ", "b": "b", "c": "k", "d": "d", "e": "e",
    "f": "f", "g": "g", "h": "h", "i": "ɪ", "j": "dʒ",
    "k": "k", "l": "l", "m": "m", "n": "n", "o": "ɒ",
    "p": "p", "q": "kw", "r": "r", "s": "s", "t": "t",
    "u": "ʌ", "v": "v", "w": "w", "x": "ks", "y": "j", "z": "z",
}

# 反向：音素 → 所有字母
ph_to_letters = {}
for letter, ph in letter_to_ph.items():
    ph_to_letters.setdefault(ph, []).append(letter)

# 英语词汇按首字母分组
letter_words = {}
for w in eng.get("words", []):
    fl = w["word"][0].lower()
    letter_words.setdefault(fl, []).append(w["word"])

phonemes = data.get("phonemes", [])
print(f"共 {len(phonemes)} 个音标\n")

has_words = []
no_words = []

for ph in phonemes:
    sym = ph["symbol"].strip("/")
    example_count = len(ph.get("exampleWords", []))
    
    # 当前 mapping 能否找到词汇？
    matching_letters = ph_to_letters.get(sym, [])
    eng_words = []
    for l in matching_letters:
        eng_words.extend(letter_words.get(l, []))
    eng_words = sorted(set(eng_words))
    
    if eng_words:
        has_words.append((sym, example_count, len(eng_words), eng_words[:3]))
    else:
        no_words.append((sym, example_count))

print(f"✅ 有关联词汇: {len(has_words)} 个")
print(f"❌ 无关联词汇: {len(no_words)} 个\n")

print("=== 无关联的音标 ===")
for sym, ec in no_words:
    example_sample = ", ".join(
        [w for w in data.get("phonemes", [])[0]["exampleWords"]] 
    )
    # find the actual example words for this phoneme
    for p in phonemes:
        if p["symbol"].strip("/") == sym:
            exs = p.get("exampleWords", [])
            print(f"  /{sym}/ (例词: {', '.join(exs)})")
            break

print()
print("=== 有关联的音标（示例）===")
for sym, ec, wc, samples in has_words:
    print(f"  /{sym}/ ({wc} 个词, 如 {', '.join(samples)})")

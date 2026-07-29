#!/usr/bin/env python3
"""验证 wordbank.json 中每个音标的 exampleWords 是否完全匹配用户提供的 124 行数据"""
import json, re, sys

# 用户数据：音标 → 5个例词（按用户粘贴的 124 行精确提取）
USER_MAP = {
    "iː": ["see","tea","bee","feet","tree"],
    "ɑː": ["car","star","farm","park","glass"],
    "ɔː": ["door","ball","horse","short","draw"],
    "ɜː": ["bird","girl","nurse","skirt","work"],
    "uː": ["zoo","food","moon","blue","school"],
    "ɪ":  ["sit","big","pig","fish","milk"],
    "e":  ["bed","pen","red","egg","desk"],
    "æ":  ["cat","bag","map","hat","apple"],
    "ʌ":  ["cup","bus","sun","duck","run"],
    "ɒ":  ["dog","hot","box","shop","frog"],
    "ʊ":  ["book","look","good","foot","cook"],
    "ə":  ["teacher","ruler","about","banana","doctor"],
    "eɪ": ["cake","name","day","play","rain"],
    "aɪ": ["bike","like","five","sky","light"],
    "ɔɪ": ["boy","toy","oil","coin","noise"],
    "aʊ": ["house","now","cow","brown","mouth"],
    "əʊ": ["home","nose","go","boat","snow"],
    "ɪə": ["ear","here","beer","near","clear"],
    "eə": ["pear","air","bear","chair","where"],
    "ʊə": ["sure","tour","poor","cure","pure"],
    "p":  ["pen","cap","map","pig","cup"],
    "b":  ["bed","bag","ball","bird","boy"],
    "t":  ["ten","cat","hat","tree","kite"],
    "d":  ["dog","desk","dad","door","duck"],
    "k":  ["cat","cup","car","kite","cake"],
    "ɡ":  ["go","pig","bag","girl","egg"],
    "f":  ["fish","five","farm","foot","fly"],
    "v":  ["van","five","live","vest","love"],
    "s":  ["sun","bus","six","star","glass"],
    "z":  ["zoo","nose","rose","bags","boys"],
    "θ":  ["thin","three","think","bath","mouth"],
    "ð":  ["this","that","they","mother","father"],
    "ʃ":  ["ship","fish","shop","short","sheep"],
    "ʒ":  ["pleasure","vision","measure"],
    "h":  ["hat","hand","house","happy","hill"],
    "tʃ": ["chair","chicken","watch","teach","lunch"],
    "dʒ": ["jump","juice","job","orange","bridge"],
    "tr": ["tree","train","trousers","trip","trap"],
    "dr": ["dress","drink","dream","drive","dragon"],
    "ts": ["cats","hats","boats","gates","pets"],
    "dz": ["beds","bags","hands","kids","birds"],
    "m":  ["map","mom","milk","mouth","man"],
    "n":  ["nose","pen","sun","nine","hand"],
    "ŋ":  ["sing","king","song","morning","pink"],
    "l":  ["leg","light","like","ball","school"],
    "r":  ["red","rice","run","rain","river"],
    "w":  ["we","water","white","window","wait"],
    "j":  ["yes","yellow","you","young","cute"],
}

with open("app/src/main/assets/wordbank.json", "rb") as f:
    data = json.load(f)

phonemes = data.get("phonemes", [])
errors = []
ok_count = 0

for ph in phonemes:
    sym = ph["symbol"].strip("/")  # e.g. "/iː/" → "iː"
    actual = ph.get("exampleWords", [])
    expected = USER_MAP.get(sym, [])
    
    if not expected:
        errors.append(f"⚠ 未在用户数据中找到音标 /{sym}/")
        continue
    
    actual_set = set(actual)
    expected_set = set(expected)
    
    missing = expected_set - actual_set
    extra = actual_set - expected_set
    
    if missing or extra:
        msg = f"❌ /{sym}/ 不匹配"
        if missing:
            msg += f" 缺: {sorted(missing)}"
        if extra:
            msg += f" 多: {sorted(extra)}"
        errors.append(msg)
    else:
        ok_count += 1

with open("verify_phoneme_words.txt", "w", encoding="utf-8") as f:
    f.write(f"共 {len(phonemes)} 个音标\n")
    f.write(f"✅ 完全匹配: {ok_count}\n")
    f.write(f"❌ 有差异: {len(errors)}\n\n")
    for e in errors:
        f.write(e + "\n")

print(f"OK: {ok_count}, Errors: {len(errors)}")
print(f"See verify_phoneme_words.txt for details")

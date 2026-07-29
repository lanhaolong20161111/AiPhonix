#!/usr/bin/env python3
"""生成完整准确的 音素→三上英语词汇 映射，写入 wordbank.json"""
import json

with open("app/src/main/assets/english_vocabulary.json", "rb") as f:
    eng = json.load(f)

# 构建单词查找表
word_map = {w["word"].lower(): w for w in eng.get("words", [])}

# 完整音素→词汇映射（基于规律+人工校对）
# 规则：对每个音素，列出 english_vocabulary.json 中属于该音标的单词
PHONEME_WORDS = {
    # === 长元音 ===
    "iː": ["eat", "sea", "see", "tree", "tea", "green", "meat", "need", "she", "we", "meet"],
    "ɑː": ["car", "star", "park", "arm", "far"],
    "ɔː": ["ball", "door", "tall", "draw", "horse", "more", "four", "all", "call", "your"],
    "ɜː": ["bird", "girl", "nurse", "work", "skirt", "turn"],
    "uː": ["blue", "school", "zoo", "food", "moon", "cool", "fruit", "two", "who", "you"],

    # === 短元音 ===
    "ɪ": ["big", "pig", "fish", "milk", "sit", "kid", "this", "with", "in", "it", "is", "six", "live", "hill", "window", "chicken", "pink"],
    "e": ["bed", "pen", "red", "egg", "desk", "ten", "leg", "help", "let", "tell", "get", "head", "bread", "elephant"],
    "æ": ["cat", "bag", "map", "hat", "apple", "dad", "hand", "man", "cap", "rat", "bat", "ant", "that"],
    "ʌ": ["cup", "bus", "sun", "duck", "run", "up", "under", "but", "much", "lunch", "jump", "mother", "brother", "bug"],
    "ɒ": ["dog", "hot", "box", "shop", "frog", "top", "fox", "mom", "clock", "not", "rock", "sock", "stop", "watch", "orange"],
    "ʊ": ["book", "look", "good", "foot", "cook", "put"],
    "ə": ["teacher", "ruler", "about", "banana", "doctor", "water", "sister", "brother", "paper", "over", "mother", "father"],

    # === 双元音 ===
    "eɪ": ["cake", "name", "day", "play", "rain", "say", "make", "take", "face", "baby", "table", "they", "eight", "train"],
    "aɪ": ["bike", "like", "five", "sky", "light", "ride", "time", "nice", "white", "my", "fly", "kite", "night", "eye", "rice"],
    "ɔɪ": ["boy", "toy", "oil", "coin", "noise", "voice"],
    "aʊ": ["house", "now", "cow", "brown", "mouth", "shout", "town", "down"],
    "əʊ": ["home", "nose", "go", "boat", "snow", "no", "old", "cold", "nose", "open", "goat", "yellow", "window"],
    "ɪə": ["ear", "here", "beer", "near", "clear", "hear"],
    "eə": ["pear", "air", "bear", "chair", "where", "wear", "there", "their"],
    "ʊə": ["sure", "tour", "poor", "cure", "pure"],

    # === 爆破音 ===
    "p": ["pen", "cap", "map", "pig", "cup", "panda", "pink", "apple", "help", "park", "play", "pet", "plane"],
    "b": ["bed", "bag", "ball", "bird", "boy", "baby", "banana", "bear", "boy", "bus", "big", "book", "brown"],
    "t": ["ten", "cat", "hat", "tree", "kite", "eat", "eight", "tea", "tell", "star", "two", "table", "foot", "teacher"],
    "d": ["dog", "desk", "dad", "door", "duck", "bed", "red", "bird", "hand", "doctor", "doll", "good", "bird"],
    "k": ["cat", "cup", "car", "kite", "cake", "book", "duck", "like", "pink", "school", "look", "black", "cook", "key"],
    "ɡ": ["go", "pig", "bag", "girl", "egg", "green", "big", "dog", "frog", "good", "gate", "glass", "give"],

    # === 摩擦音 ===
    "f": ["fish", "five", "farm", "foot", "fly", "face", "family", "four", "frog", "fox", "father", "fat", "feet"],
    "v": ["van", "five", "live", "vest", "love", "give", "have", "seven", "over", "very"],
    "s": ["sun", "bus", "six", "star", "glass", "see", "sky", "school", "snow", "sit", "snake", "sleep", "small"],
    "z": ["zoo", "nose", "rose", "bags", "boys", "eyes", "ears", "is", "has"],
    "θ": ["thin", "three", "think", "bath", "mouth", "teeth", "thank"],
    "ð": ["this", "that", "they", "mother", "father", "the", "them", "brother", "there"],
    "ʃ": ["ship", "fish", "shop", "short", "sheep", "she", "shirt", "shoe", "wash"],
    "ʒ": ["pleasure", "vision", "measure", "television"],
    "h": ["hat", "hand", "house", "happy", "hill", "have", "help", "horse", "home", "hot", "hello"],

    # === 破擦音 ===
    "tʃ": ["chair", "chicken", "watch", "teach", "lunch", "chocolate", "chat", "children"],
    "dʒ": ["jump", "juice", "job", "orange", "bridge", "jeep", "jam", "joy"],
    "tr": ["tree", "train", "trousers", "trip", "trap", "try", "true"],
    "dr": ["dress", "drink", "dream", "drive", "dragon", "draw", "dry"],
    "ts": ["cats", "hats", "boats", "gates", "pets", "ants", "nuts"],
    "dz": ["beds", "bags", "hands", "kids", "birds", "hands", "words"],

    # === 鼻音 ===
    "m": ["map", "mom", "milk", "mouth", "man", "moon", "meet", "make", "name", "time", "home", "much", "mouse"],
    "n": ["nose", "pen", "sun", "nine", "hand", "name", "now", "near", "need", "nine", "new", "nurse", "man", "run"],
    "ŋ": ["sing", "king", "song", "morning", "pink", "long", "thing", "morning", "drink"],

    # === 舌侧音 ===
    "l": ["leg", "light", "like", "ball", "school", "look", "love", "live", "all", "tell", "cold", "girl", "apple", "table", "blue"],

    # === 卷舌音 ===
    "r": ["red", "rice", "run", "rain", "river", "ride", "read", "rainbow", "rabbit", "rock", "room"],

    # === 半元音 ===
    "w": ["we", "water", "white", "window", "wait", "watch", "work", "where", "want", "what", "warm"],
    "j": ["yes", "yellow", "you", "young", "cute", "year", "your", "yummy"],
}

# 只保留确实存在于 english_vocabulary.json 中的词
for ph, words in PHONEME_WORDS.items():
    PHONEME_WORDS[ph] = sorted(set(w for w in words if w in word_map))

# 检查哪些音素没有任何匹配
missing = [ph for ph, ws in PHONEME_WORDS.items() if not ws]
if missing:
    print(f"WARNING: 以下音素在 english_vocabulary.json 中没有匹配词: {missing}")

# 更新 wordbank.json
with open("app/src/main/assets/wordbank.json", "rb") as f:
    wb = json.load(f)

updated = 0
for ph in wb.get("phonemes", []):
    sym = ph["symbol"].strip("/")
    if sym in PHONEME_WORDS:
        words = PHONEME_WORDS[sym]
        # 将词汇映射为 EnglishWord 格式的引用（只存 word 文本，app 端解析）
        ph["englishWordIds"] = words  
        if words:
            updated += 1
            print(f"  /{sym}/ -> {len(words)} words: {', '.join(words[:5])}...")
    else:
        ph["englishWordIds"] = []

with open("app/src/main/assets/wordbank.json", "w", encoding="utf-8") as f:
    json.dump(wb, f, ensure_ascii=False, indent=2)

print(f"\n✅ 更新了 {updated}/48 个音标的 englishWordIds")

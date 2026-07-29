#!/usr/bin/env python3
"""对比用户提供的 48 音标词汇表和当前 wordbank.json，找出缺失的词"""
import json

# 用户提供的全部词汇（提取每个音标下的单词）
user_all_words = {
    "see","tea","bee","feet","tree",
    "car","star","farm","park","glass",
    "door","ball","horse","short","draw",
    "bird","girl","nurse","skirt","work",
    "zoo","food","moon","blue","school",
    "sit","big","pig","fish","milk",
    "bed","pen","red","egg","desk",
    "cat","bag","map","hat","apple",
    "cup","bus","sun","duck","run",
    "dog","hot","box","shop","frog",
    "book","look","good","foot","cook",
    "teacher","ruler","about","banana","doctor",
    "cake","name","day","play","rain",
    "bike","like","five","sky","light",
    "boy","toy","oil","coin","noise",
    "house","now","cow","brown","mouth",
    "home","nose","go","boat","snow",
    "ear","here","beer","near","clear",
    "pear","air","bear","chair","where",
    "sure","tour","poor","cure","pure",
    "pen","cap","map","pig","cup",
    "bed","bag","ball","bird","boy",
    "ten","cat","hat","tree","kite",
    "dog","desk","dad","door","duck",
    "cat","cup","car","kite","cake",
    "go","pig","bag","girl","egg",
    "fish","five","farm","foot","fly",
    "van","five","live","vest","love",
    "sun","bus","six","star","glass",
    "zoo","nose","rose","bags","boys",
    "thin","three","think","bath","mouth",
    "this","that","they","mother","father",
    "ship","fish","shop","short","sheep",
    "pleasure","vision","measure",
    "hat","hand","house","happy","hill",
    "chair","chicken","watch","teach","lunch",
    "jump","juice","job","orange","bridge",
    "tree","train","trousers","trip","trap",
    "dress","drink","dream","drive","dragon",
    "cats","hats","boats","gates","pets",
    "beds","bags","hands","kids","birds",
    "map","mom","milk","mouth","man",
    "nose","pen","sun","nine","hand",
    "sing","king","song","morning","pink",
    "leg","light","like","ball","school",
    "red","rice","run","rain","river",
    "we","water","white","window","wait",
    "yes","yellow","you","young","cute",
}

# 加载当前词库
with open("app/src/main/assets/wordbank.json", "rb") as f:
    d = json.load(f)
current_words = {w["text"].lower() for w in d["words"]}

missing = sorted(user_all_words - current_words)
extra = sorted(current_words - user_all_words)

print(f"User list: {len(user_all_words)} unique words")
print(f"Current wordbank: {len(current_words)} unique words")
print(f"\n=== Missing from wordbank ({len(missing)}) ===")
for w in missing:
    print(f"  {w}")
print(f"\n=== Extra in wordbank (not in user list) ({len(extra)}) ===")
for w in extra:
    print(f"  {w}")

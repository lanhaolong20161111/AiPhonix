#!/usr/bin/env python3
"""重新解析所有词的完整 phonemes，含 AmE→BrE IPA 归一化"""

import json

PHONEMES_SORTED = sorted([
    "aɪ","aʊ","eə","eɪ","dʒ","tʃ","dr","dz","tr","ts",
    "ʊə","ɪə","əʊ","ɔɪ",
    "iː","uː","ɔː","ɜː","ɑː","ɒ",
    "æ","ð","ŋ","ɡ","ʃ","ʒ","θ",
    "ə","ʌ","ʊ","ɪ","e",
    "p","b","t","d","k","ɡ","f","v","s","z","h",
    "l","m","n","r","w","j",
], key=len, reverse=True)

# AmE → BrE IPA 归一化映射
AM2BR = {
    "oʊ": "əʊ",
    "ɝ": "ɜː",
}

def clean_ipa(raw: str) -> str:
    s = raw.strip().strip("/[]")
    s = s.replace("ˈ", "").replace("ˌ", "").replace(".", "").replace("(", "").replace(")", "")
    # 归一化
    for am, br in AM2BR.items():
        s = s.replace(am, br)
    return s

def parse_phonemes(ipa_str: str) -> list[str]:
    cleaned = clean_ipa(ipa_str)
    result = []
    i = 0
    while i < len(cleaned):
        matched = False
        for ph in PHONEMES_SORTED:
            if cleaned[i:i+len(ph)] == ph:
                result.append(ph)
                i += len(ph)
                matched = True
                break
        if not matched:
            # 将词尾非重读 'i' (U+0069) 映射为 'ɪ' (U+026A)
            if cleaned[i] == 'i' and (i > 0 and i == len(cleaned) - 1 or
                                       i > 0 and cleaned[i+1:i+2] in ('z', 's', 'n', 'ŋ', 'k', 't', 'd', 'l')):
                result.append("ɪ")
                i += 1
            elif cleaned[i] == 'i':
                # 其他非词尾 i，尝试映射
                result.append("ɪ")
                i += 1
            else:
                i += 1
    return result

def main():
    path = "app/src/main/assets/wordbank.json"
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    words = data.get("words", [])
    
    # 先修复数据问题：删除重复的 fox（letter=x 那个）
    fox_entries = [w for w in words if w["text"] == "fox"]
    if len(fox_entries) > 1:
        # 保留 letter="f" 的，删除 letter="x" 的
        to_remove = [w for w in fox_entries if w["letter"] == "x"]
        for r in to_remove:
            words.remove(r)
        print(f"Removed {len(to_remove)} duplicate fox entry (letter=x)")

    fixed = 0
    for w in words:
        ipa = w.get("ipa", "")
        if not ipa:
            continue
        old_ph = w.get("phonemes", [])
        new_ph = parse_phonemes(ipa)
        if new_ph != old_ph:
            w["phonemes"] = new_ph
            fixed += 1

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Done: fixed {fixed} words' phonemes")

    # 验证写到日志文件
    check = ["goat", "nose", "monkey", "fox", "tree", "see", "car", "hands", "book", "teacher", "light", "chair"]
    log_lines = [f"Done: fixed {fixed} words"]
    for w in words:
        if w["text"] in check:
            ph = ",".join(w["phonemes"])
            log_lines.append(f"{w['text']}: [{ph}]")
    with open("phonemes_fix_log2.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines))
    print(f"Log written to phonemes_fix_log2.txt")

if __name__ == "__main__":
    main()

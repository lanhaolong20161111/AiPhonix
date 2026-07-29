#!/usr/bin/env python3
"""Debug: check phonemes for specific words"""
import json

d = json.load(open("app/src/main/assets/wordbank.json", "rb"))
lines = []
for w in d["words"]:
    if w["text"] in ["see","tree","hands","car","door","ball","nurse","zoo","apple","jump"]:
        ph = ",".join(w.get("phonemes", []))
        lines.append(f"{w['text']}: phonemes=[{ph}]  ipa={w.get('ipa','')}")
    # Also check any word with exactly 1 phoneme that's not original
    if len(w.get("phonemes", [])) == 1 and w["text"] not in ["a"]:
        ph = ",".join(w.get("phonemes", []))
        lines.append(f"  SHORT: {w['text']}: phonemes=[{ph}]  ipa={w.get('ipa','')}")

with open("phonemes_check.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print(f"Wrote {len(lines)} lines to phonemes_check.txt")

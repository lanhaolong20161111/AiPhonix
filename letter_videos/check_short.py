#!/usr/bin/env python3
import json
d = json.load(open("app/src/main/assets/wordbank.json", "rb"))
short = [(w["text"], w.get("phonemes",[]), w.get("ipa","")) 
         for w in d["words"] if len(w.get("phonemes",[])) <= 1]
with open("phonemes_short.txt", "w", encoding="utf-8") as f:
    f.write(f"Total words: {len(d['words'])}, Short (<=1 phoneme): {len(short)}\n")
    for t, p, i in short:
        f.write(f"  {t}: phonemes={p} ipa={i}\n")
print(f"Found {len(short)} short words")

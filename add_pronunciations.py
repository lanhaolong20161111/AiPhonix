import json, sys

with open(r'app/src/main/assets/wordbank.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Pronunciation data per letter (from user's phonics table)
# Each letter gets its common pronunciations as IPA strings
pronunciations_map = {
    "a": ["/eɪ/", "/æ/"],
    "b": ["/b/"],
    "c": ["/k/", "/s/"],
    "d": ["/d/"],
    "e": ["/iː/", "/e/"],
    "f": ["/f/"],
    "g": ["/ɡ/", "/dʒ/"],
    "h": ["/h/"],
    "i": ["/aɪ/", "/ɪ/"],
    "j": ["/dʒ/"],
    "k": ["/k/"],
    "l": ["/l/"],
    "m": ["/m/"],
    "n": ["/n/"],
    "o": ["/əʊ/", "/ɒ/"],
    "p": ["/p/"],
    "q": ["/kw/"],
    "r": ["/r/"],
    "s": ["/s/", "/z/"],
    "t": ["/t/"],
    "u": ["/juː/", "/ʌ/"],
    "v": ["/v/"],
    "w": ["/w/"],
    "x": ["/ks/"],
    "y": ["/j/", "/i/", "/aɪ/"],
    "z": ["/z/"],
}

updated = 0
for letter in data.get("letters", []):
    ch = letter.get("char", "")
    if ch in pronunciations_map:
        letter["pronunciations"] = pronunciations_map[ch]
        updated += 1

with open(r'app/src/main/assets/wordbank.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"Updated {updated} letters with pronunciations")

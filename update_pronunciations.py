import json

IPA_DIR = r'app/src/main/assets/ipa'
WORD_BANK = r'app/src/main/assets/wordbank.json'

# Existing aac files
existing_files = set()
import os
for f in os.listdir(IPA_DIR):
    if f.endswith('.aac'):
        existing_files.add(f[:-4])

print(f"Total .aac files: {len(existing_files)}")
print(f"Including: kw={'kw' in existing_files}, ks={'ks' in existing_files}, ju={'ju' in existing_files}")

# Normalization map: some IPA symbols have Unicode variants
NORM = {'ɡ': 'g'}

with open(WORD_BANK, 'r', encoding='utf-8') as f:
    data = json.load(f)

for letter in data.get('letters', []):
    orig = letter.get('pronunciations', [])
    filtered = []
    for ipa in orig:
        cleaned = ipa.strip('/')
        clean_no_len = cleaned.replace('\u02d0', '')
        # normalize Unicode variants
        normalized = ''.join(NORM.get(c, c) for c in clean_no_len)
        # check: original, length-stripped, normalized
        if cleaned in existing_files or clean_no_len in existing_files or normalized in existing_files:
            filtered.append(ipa)
        else:
            print(f"  Removing {ipa} from {letter['char']} (no audio)")
    letter['pronunciations'] = filtered

with open(WORD_BANK, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("Done - wordbank.json updated")

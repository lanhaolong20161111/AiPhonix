import json, re

with open('C:/Users/lhl20/Desktop/android_cli_demos/.reasonix/attachments/clipboard-20260726-135749.067362-000001.txt', 'r', encoding='utf-8') as f:
    raw = f.read()

words = []
lines = raw.strip().split('\n')
i = 0
while i < len(lines):
    line = lines[i].strip()
    # skip headers and blank lines
    if not line or line.startswith('#'):
        i += 1
        continue
    # lines like "## A" are headers
    if line.startswith('## '):
        i += 1
        continue

    # Word line
    word = line
    i += 1
    if i >= len(lines): break

    # Phonetic line (starts with /)
    phonetic = lines[i].strip() if lines[i].strip().startswith('/') else ''
    if phonetic:
        i += 1
    if i >= len(lines): break

    # Meaning line
    meaning = lines[i].strip()
    if meaning.startswith('/') and not phonetic:
        # second phonetic? skip
        i += 1
        if i >= len(lines): break
        meaning = lines[i].strip()
    i += 1

    # parse multiple meanings separated by ；
    meanings = [m.strip() for m in meaning.split('；') if m.strip()]
    # also split by ；and ；
    if len(meanings) == 1 and '；' in meaning:
        meanings = [m.strip() for m in meaning.split('；') if m.strip()]

    words.append({
        'word': word,
        'phonetic': phonetic,
        'meanings': meanings
    })

# 按字母分组
by_letter = {}
for w in words:
    letter = w['word'][0].upper()
    by_letter.setdefault(letter, []).append(w)

# 先按字母排序，再按单词排序
sorted_words = []
for letter in sorted(by_letter.keys()):
    for w in sorted(by_letter[letter], key=lambda x: x['word'].lower()):
        sorted_words.append(w)

data = {
    'version': 1,
    'total': len(sorted_words),
    'words': sorted_words
}

out_path = 'C:/Users/lhl20/Desktop/android_cli_demos/AiPhonix/server/data/english_vocabulary.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f'已保存 {len(sorted_words)} 个英语词汇到 {out_path}')
for w in sorted_words[:5]:
    print(f'  {w["word"]} {w["phonetic"]} -> {w["meanings"]}')

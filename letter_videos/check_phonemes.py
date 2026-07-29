import json
with open('app/src/main/assets/wordbank.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
words = data.get('words', [])
for w in words:
    ph = w.get('phonemes', [])
    ph_str = ' + '.join(ph)
    print(f'{w["text"]:15s} -> {ph_str}')

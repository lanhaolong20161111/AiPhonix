import json
with open('AiPhonix/app/src/main/assets/wordbank.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
phonemes = data.get('phonemes', [])
for i, p in enumerate(phonemes):
    print(f'{i}: {p["symbol"]}')

import json
d = json.load(open('AiPhonix/app/src/main/assets/wordbank.json', encoding='utf-8'))
print('音素总数:', len(d['phonemes']))
for i, p in enumerate(d['phonemes']):
    print(f'  {i}: {p["symbol"]}')

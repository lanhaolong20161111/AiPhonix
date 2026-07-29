import json, sys
sys.stdout.reconfigure(encoding='utf-8')
with open('app/src/main/assets/wordbank.json', 'r', encoding='utf-8') as f:
    d = json.load(f)
ph = d.get('phonemes', [])
for p in ph:
    ew = p.get('exampleWords', [])
    print('{0:8s} -> {1}'.format(p['symbol'], ew))
print('\nTotal phonemes: {}'.format(len(ph)))
print('Total words: {}'.format(len(d.get('words', []))))

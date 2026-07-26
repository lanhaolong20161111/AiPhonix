import json, re

with open('C:/Users/lhl20/Desktop/android_cli_demos/.reasonix/attachments/clipboard-20260726-140035.152202-000003.txt', 'r', encoding='utf-8') as f:
    raw = f.read()

entries = []
blocks = raw.strip().split('\n---\n')

for block in blocks:
    lines = [l.strip() for l in block.strip().split('\n')]
    unit = ''
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith('# Unit'):
            unit = line.replace('#', '').strip()
            i += 1
            continue
        if not line:
            i += 1
            continue

        # English sentence
        eng = line
        i += 1
        while i < len(lines) and not lines[i]:
            i += 1
        if i >= len(lines): break

        # Chinese translation
        chn = lines[i]
        i += 1

        entries.append({
            'unit': unit,
            'english': eng,
            'chinese': chn
        })

data = {
    'version': 1,
    'total': len(entries),
    'units': []
}

# Group by unit
from collections import OrderedDict
unit_map = OrderedDict()
for e in entries:
    unit_map.setdefault(e['unit'], [])
    unit_map[e['unit']].append({'english': e['english'], 'chinese': e['chinese']})

for u, sentences in unit_map.items():
    data['units'].append({
        'unit': u,
        'sentences': sentences
    })

out_path = 'C:/Users/lhl20/Desktop/android_cli_demos/AiPhonix/server/data/english_sentences.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

# Also copy to app assets
import shutil
asset_path = 'C:/Users/lhl20/Desktop/android_cli_demos/AiPhonix/app/src/main/assets/english_sentences.json'
with open(asset_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f'已保存 {data["total"]} 个句子到:')
print(f'  服务端: {out_path}')
print(f'  客户端: {asset_path}')
for u in data['units']:
    print(f'  {u["unit"]}: {len(u["sentences"])} 句')
print()
for s in data['units'][0]['sentences'][:2]:
    print(f'  {s["english"]} → {s["chinese"]}')

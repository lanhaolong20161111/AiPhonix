import json
with open(r'C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\app\src\main\assets\chinese_wordbank.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
chars = data['chars'][:5]
for c in chars:
    print(f"char={c['text']} pinyin={c.get('pinyin','?')} tags={c['tags']}")
with_pinyin = sum(1 for c in data['chars'] if c.get('pinyin'))
total = len(data['chars'])
print(f"pinyin: {with_pinyin}/{total}")
missing = [c['text'] for c in data['chars'][:80] if not c.get('pinyin')]
print('sample missing:', ' '.join(missing[:30]))

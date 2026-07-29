import json
p = r'AiPhonix/server_py/data/char_image_index.json'
d = json.load(open(p, encoding='utf-8'))
for c in ['遮','掩','探','眉','吐']:
    match = [i for i in d['items'] if i['char'] == c]
    if match:
        print(f"  {c} -> {match[0]['image']} (grade={match[0]['grade']}, semester={match[0]['semester']})")
print(f"总计: {d['total']} 条")

import json
with open(r'C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server\data\char_info.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
samples = ['一','好','花','国','大','远','做','病','同','问','感','领','练','树','猫','雪','雷','爸','您','痛','铁','草','红','星','笑','笔']
for c in data:
    if c['char'] in samples:
        print(f"{c['char']}: radical={c['radical']}, strokes={c['stroke_count']}, structure={c['structure']}, words={c['words'][:3]}")

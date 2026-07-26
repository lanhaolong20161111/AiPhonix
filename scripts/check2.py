import json
with open(r'C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server\data\char_info.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
samples = ['一','好','花','国','大','远','做','病','同','星','您','感','领','树','猫','雪','雷','爸','痛','铁','草','红','笑','笔','问','这','过']
for c in data:
    if c['char'] in samples:
        print(f"{c['char']}: radical={c['radical']}, dec={c['decomposition']}, strokes={c['stroke_count']}, struct={c['structure']}")

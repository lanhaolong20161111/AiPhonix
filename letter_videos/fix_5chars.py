import json
p = r'C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py\data\char_image_index.json'
d = json.load(open(p, encoding='utf-8'))
for item in d['items']:
    if item['char'] in ['享','凑','弦','梯','汤']:
        item['grade'] = '二年级下'
        item['semester'] = '下'
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('已更新 5 条 → 二年级下')

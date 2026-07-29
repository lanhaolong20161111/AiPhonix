import json, re
p = r'C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py\data\char_image_index.json'
d = json.load(open(p, encoding='utf-8'))

text = open(r'C:\Users\lhl20\Desktop\android_cli_demos\.reasonix\attachments\clipboard-20260727-215506.348561-000003.txt', encoding='utf-8').read()
g2b = set(re.findall(r'[\u4e00-\u9fff]', text))

others = [item for item in d['items'] if item['char'] not in g2b]
for item in others:
    grade = item['grade']
    print(f"  {item['char']} -> {item['image']} (当前年级: {grade})")
print(f'共 {len(others)} 张')

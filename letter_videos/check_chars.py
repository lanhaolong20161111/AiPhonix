import json, re
text = open(r'C:\Users\lhl20\Desktop\android_cli_demos\.reasonix\attachments\clipboard-20260727-215506.348561-000003.txt', encoding='utf-8').read()
chars = set(re.findall(r'[\u4e00-\u9fff]', text))

check = ['享', '凑', '弦', '梯', '汤']
for c in check:
    if c in chars:
        print(f'  {c} → 在二年级下字表中')
    else:
        print(f'  {c} → 不在二年级下字表中')

# -*- coding: utf-8 -*-
import os, re, json

# 二年级下认字表原文
text = open(r'C:\Users\lhl20\Desktop\android_cli_demos\.reasonix\attachments\clipboard-20260727-215506.348561-000003.txt', encoding='utf-8').read()

# 服务器已有的87张图片（全量）
idx = json.load(open(r'C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py\data\char_image_index.json', encoding='utf-8'))
existing = {item['char'] for item in idx['items']}

lines_out = []
for line in text.strip().split('\n'):
    line = line.strip()
    if not line:
        lines_out.append('')
        continue
    parts = []
    for ch in re.findall(r'[\u4e00-\u9fff]', line):
        if ch in existing:
            parts.append('__' + ch + '__')
        else:
            parts.append(ch)
    lines_out.append(' '.join(parts))

out = '\n'.join(lines_out)
with open(r'C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\letter_videos\二年级下认字表_带下划线.txt', 'w', encoding='utf-8') as f:
    f.write(out)
print('done, wrote ' + str(len([l for l in lines_out if l])) + ' lines')

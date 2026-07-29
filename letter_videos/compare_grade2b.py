# -*- coding: utf-8 -*-
import os, re

text = open(r'C:\Users\lhl20\Desktop\android_cli_demos\.reasonix\attachments\clipboard-20260727-215506.348561-000003.txt', encoding='utf-8').read()
chars_set = set(re.findall(r'[\u4e00-\u9fff]', text))
chars = sorted(chars_set)
print(f'二年级下认字表总字数: {len(chars)}')

img_dir = r'C:\Users\lhl20\Desktop\word_images'
existing = set()
for f in os.listdir(img_dir):
    m = re.search(r'[\u4e00-\u9fff]', f)
    if m:
        existing.add(m.group())
print(f'已有图片的字: {len(existing)}')

have = sorted(existing & chars_set)
missing = sorted(chars_set - existing)

print(f'匹配到的字数: {len(have)}')
print(f'缺少图片的字数: {len(missing)}')
print()

print('=' * 50)
print('带下划线的二年级下认字表（有图=下划线）')
print('=' * 50)
for line in text.strip().split('\n'):
    line = line.strip()
    if not line:
        print()
        continue
    parts = []
    for ch in re.findall(r'[\u4e00-\u9fff]', line):
        if ch in existing:
            parts.append('__' + ch + '__')
        else:
            parts.append(ch)
    print(' '.join(parts))

print()
print('已有图片的字:', ', '.join(have))
print()
print('缺少图片的字:', ', '.join(missing))

"""查 更加 在服务器上的状态"""
import json, os

idx = json.load(open('server_py/data/char_image_index.json', encoding='utf-8'))
for it in idx['items']:
    if it['char'] == '更加':
        print(f"索引: {it}")

fs = 'server_py/data/char_images/更加.png'
print(f"文件存在: {os.path.exists(fs)}")
print(f"文件大小: {os.path.getsize(fs) if os.path.exists(fs) else 0}")

wd = r'C:\Users\lhl20\Desktop\word_images\更加.png'
print(f"word_images文件存在: {os.path.exists(wd)}")
print(f"word_images文件大小: {os.path.getsize(wd) if os.path.exists(wd) else 0}")

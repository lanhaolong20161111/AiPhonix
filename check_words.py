"""查剩余词语"""
import json

fb = json.load(open('server_py/data/char_image_feedback.json', encoding='utf-8'))
need = [r for r in fb if r.get('needs_regen') and r['type'] == '词']

print(f"二年级上词: {len([r for r in need if r['grade']=='二年级' and r['semester']=='上'])}")
print(f"三年级上词: {len([r for r in need if r['grade']=='三年级' and r['semester']=='上'])}")
print(f"其他词: {len([r for r in need if r['grade']!='二年级' or r['semester']!='上'])}")
print()

print("三年级上词:")
for r in need:
    if r['grade']=='三年级' and r['semester']=='上':
        print(f"  {r['char']}")

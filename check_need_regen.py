import json
with open("server_py/data/char_image_feedback.json", encoding="utf-8") as f:
    fb = json.load(f)
regen = [r for r in fb if r.get("needs_regen")]
print(f"需重新配图: {len(regen)} 个")
for r in regen:
    print(f"  {r['char']} ({r.get('grade','')}{r.get('semester','')}, {r.get('type','')})")

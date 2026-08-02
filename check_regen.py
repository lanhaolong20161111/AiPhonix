import json
with open("server_py/data/char_image_feedback.json", encoding="utf-8") as f:
    feedbacks = json.load(f)
regen = [fb for fb in feedbacks if fb.get("needs_regen", False)]
print(f'需要重新配图的字数: {len(regen)}')
for fb in regen:
    print(f'  {fb["char"]} ({fb["grade"]}{fb["semester"]}, {fb["type"]})')

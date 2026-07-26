"""为 wordbank.json 中所有字/词添加拼音"""
import json
from pypinyin import pinyin, Style, lazy_pinyin

SRC = r"C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\app\src\main\assets\chinese_wordbank.json"

with open(SRC, encoding="utf-8") as f:
    data = json.load(f)

# 单字拼音（带声调）
print("处理汉字拼音...")
for item in data["chars"]:
    ch = item["text"]
    py = pinyin(ch, style=Style.TONE3, neutral_tone_with_five=True)
    item["pinyin"] = py[0][0] if py else ""

# 词语拼音（空格分隔，带声调）
print("处理词语拼音...")
for item in data["words"]:
    w = item["text"]
    py_list = lazy_pinyin(w, style=Style.TONE3, neutral_tone_with_five=True)
    item["pinyin"] = " ".join(py_list)

# 统计多音字
from collections import Counter
multi_pron = Counter()
for item in data["chars"]:
    ch = item["text"]
    all_py = pinyin(ch, style=Style.TONE3, heteronym=True)
    if len(all_py[0]) > 1:
        multi_pron[ch] = all_py[0]

# 写回
with open(SRC, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"\n完成！")
print(f"  汉字: {len(data['chars'])} 个（含拼音）")
print(f"  词语: {len(data['words'])} 条（含拼音）")
print(f"  多音字: {len(multi_pron)} 个")
if multi_pron:
    print("\n多音字示例:")
    for ch, pys in list(multi_pron.items())[:10]:
        print(f"  {ch} -> {', '.join(pys)}")

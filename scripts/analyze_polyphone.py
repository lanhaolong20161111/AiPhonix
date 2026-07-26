import json
import requests
from pypinyin import pinyin, Style

# 1. 加载字库
with open('AiPhonix/app/src/main/assets/chinese_wordbank.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# 2. 用 pypinyin 找出多音字
chars = data.get('chars', [])
multi_chars = {}
for item in chars:
    ch = item['text']
    all_py = pinyin(ch, style=Style.TONE3, heteronym=True)
    if len(all_py[0]) > 1:
        unique_py = sorted(set(all_py[0]))
        if len(unique_py) > 1:
            multi_chars[ch] = unique_py

print(f'pypinyin 检测到 {len(multi_chars)} 个多音字')

# 3. 分批调用 LLM，请它筛选常见多音字并给出词语
all_chars_list = list(multi_chars.keys())

# 按每批 200 个字切割
batch_size = 150
batches = [all_chars_list[i:i+batch_size] for i in range(0, len(all_chars_list), batch_size)]
print(f'分 {len(batches)} 批调用 LLM')

all_results = {}
for batch_idx, batch in enumerate(batches):
    chars_str = '、'.join(batch)
    prompt = (
        '你是小学语文教学专家。以下是一组汉字，请判断哪些是小学阶段（一到六年级）常见的多音字。\n'
        '对每个常见多音字，请给出：\n'
        '1. 所有常见读音（用数字声调）\n'
        '2. 每个读音下的1-2个常用词语\n'
        '3. 小学最常用的是哪个读音\n\n'
        '只返回 JSON 格式（不要其他文字），格式如下：\n'
        '{"多音字": {"字": {"pronunciations": ["音1", "音2"], '
        '"words": {"音1": ["词1", "词2"], "音2": ["词3"]}, '
        '"primary": "音1", "note": "说明"}}}'
        '\n如果不是常见多音字，不要包含在结果中。\n\n'
        f'汉字列表：{chars_str}'
    )

    print(f'  第 {batch_idx+1}/{len(batches)} 批 ({len(batch)} 字)...')
    try:
        resp = requests.post(
            'http://localhost:8080/api/v1/llm/chat',
            json={'message': prompt},
            timeout=120
        )
        if resp.status_code == 200:
            reply = resp.json().get('reply', '')
            # 尝试提取 JSON
            import re
            json_match = re.search(r'\{.*\}', reply, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                duoyin = result.get('多音字', {})
                for ch, info in duoyin.items():
                    all_results[ch] = info
                print(f'    -> 得到 {len(duoyin)} 个多音字')
            else:
                print(f'    -> 无法解析回复: {reply[:100]}')
        else:
            print(f'    -> HTTP {resp.status_code}: {resp.text[:100]}')
    except Exception as e:
        print(f'    -> 请求失败: {e}')

print(f'\n总共得到 {len(all_results)} 个常见多音字')

# 4. 保存结果
output = {
    'version': 1,
    'description': '小学常见多音字及其读音与常用词语',
    'chars': all_results
}
with open('AiPhonix/server/data/polyphone_chars.json', 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f'已保存到 server/data/polyphone_chars.json')

# 打印结果
print('\n=== 多音字分析结果 ===')
for ch, info in sorted(all_results.items()):
    pys = ' / '.join(info.get('pronunciations', []))
    wds = '; '.join([f'{k}: {",".join(v)}' for k, v in info.get('words', {}).items()])
    pri = info.get('primary', '')
    print(f'  {ch}  [{pys}] 常用: {pri}  词: {wds}')

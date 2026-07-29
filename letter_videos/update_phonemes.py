"""解析用户提供的 48 音标词汇表，更新 wordbank.json"""
import json, re, sys

# ── 原始文本（从用户粘贴内容提取）──
RAW = r"""
# 48个国际音标+小学高频词汇（单词尽量不重复，全为课内基础词）
## 第一部分：20个元音
### 一、长元音（5个）
1. /iː/
see /siː/看见、tea /tiː/茶、bee /biː/蜜蜂、feet /fiːt/脚、tree /triː/树
2. /ɑː/
car /kɑː(r)/汽车、star /stɑː(r)/星星、farm /fɑːm/农场、park /pɑːk/公园、glass /ɡlɑːs/玻璃杯
3. /ɔː/
door /dɔː(r)/门、ball /bɔːl/球、horse /hɔːs/马、short /ʃɔːt/短的、draw /drɔː/画画
4. /ɜː/
bird /bɜːd/小鸟、girl /ɡɜːl/女孩、nurse /nɜːs/护士、skirt /skɜːt/短裙、work /wɜːk/工作
5. /uː/
zoo /zuː/动物园、food /fuːd/食物、moon /muːn/月亮、blue /bluː/蓝色、school /skuːl/学校
### 二、短元音（7个）
6. /ɪ/
sit /sɪt/坐、big /bɪɡ/大的、pig /pɪɡ/猪、fish /fɪʃ/鱼、milk /mɪlk/牛奶
7. /e/
bed /bed/床、pen /pen/钢笔、red /red/红色、egg /eɡ/鸡蛋、desk /desk/书桌
8. /æ/
cat /kæt/猫、bag /bæɡ/书包、map /mæp/地图、hat /hæt/帽子、apple /ˈæpl/苹果
9. /ʌ/
cup /kʌp/杯子、bus /bʌs/公交、sun /sʌn/太阳、duck /dʌk/鸭子、run /rʌn/跑
10. /ɒ/
dog /dɒɡ/狗、hot /hɒt/热、box /bɒks/盒子、shop /ʃɒp/商店、frog /frɒɡ/青蛙
11. /ʊ/
book /bʊk/书、look /lʊk/看、good /ɡʊd/好、foot /fʊt/脚、cook /kʊk/烹饪
12. /ə/
teacher /ˈtiːtʃə(r)/老师、ruler /ˈruːlə(r)/尺子、about /əˈbaʊt/关于、banana /bəˈnɑːnə/香蕉、doctor /ˈdɒktə(r)/医生
### 三、双元音（8个）
13. /eɪ/
cake /keɪk/蛋糕、name /neɪm/名字、day /deɪ/天、play /pleɪ/玩、rain /reɪn/下雨
14. /aɪ/
bike /baɪk/自行车、like /laɪk/喜欢、five /faɪv/五、sky /skaɪ/天空、light /laɪt/灯光
15. /ɔɪ/
boy /bɔɪ/男孩、toy /tɔɪ/玩具、oil /ɔɪl/油、coin /kɔɪn/硬币、noise /nɔɪz/噪音
16. /aʊ/
house /haʊs/房子、now /naʊ/现在、cow /kaʊ/奶牛、brown /braʊn/棕色、mouth /maʊθ/嘴巴
17. /əʊ/
home /həʊm/家、nose /nəʊz/鼻子、go /ɡəʊ/走、boat /bəʊt/小船、snow /snəʊ/雪
18. /ɪə/
ear /ɪə(r)/耳朵、here /hɪə(r)/这里、beer /bɪə(r)/啤酒、near /nɪə(r)/附近、clear /klɪə(r)/清楚
19. /eə/
pear /peə(r)/梨、air /eə(r)/空气、bear /beə(r)/熊、chair /tʃeə(r)/椅子、where /weə(r)/哪里
20. /ʊə/
sure /ʃʊə(r)/当然、tour /tʊə(r)/旅行、poor /pʊə(r)/贫穷、cure /kjʊə(r)/治愈、pure /pjʊə(r)/纯净
## 第二部分：28个辅音
### 一、爆破音6个（3对清浊）
21. /p/ 清
pen /pen/钢笔、cap /kæp/帽子、map /mæp/地图、pig /pɪɡ/猪、cup /kʌp/杯子
22. /b/ 浊
bed /bed/床、bag /bæɡ/书包、ball /bɔːl/球、bird /bɜːd/鸟、boy /bɔɪ/男孩
23. /t/ 清
ten /ten/十、cat /kæt/猫、hat /hæt/帽子、tree /triː/树、kite /kaɪt/风筝
24. /d/ 浊
dog /dɒɡ/狗、desk /desk/书桌、dad /dæd/爸爸、door /dɔː(r)/门、duck /dʌk/鸭子
25. /k/ 清
cat /kæt/猫、cup /kʌp/杯子、car /kɑː(r)/汽车、kite /kaɪt/风筝、cake /keɪk/蛋糕
26. /ɡ/ 浊
go /ɡəʊ/走、pig /pɪɡ/猪、bag /bæɡ/书包、girl /ɡɜːl/女孩、egg /eɡ/鸡蛋
### 二、摩擦音10个（5对清浊）
27. /f/ 清
fish /fɪʃ/鱼、five /faɪv/五、farm /fɑːm/农场、foot /fʊt/脚、fly /flaɪ/飞
28. /v/ 浊
van /væn/货车、five /faɪv/五、live /lɪv/居住、vest /vest/背心、love /lʌv/爱
29. /s/ 清
sun /sʌn/太阳、bus /bʌs/公交、six /sɪks/六、star /stɑː(r)/星星、glass /ɡlɑːs/玻璃杯
30. /z/ 浊
zoo /zuː/动物园、nose /nəʊz/鼻子、rose /rəʊz/玫瑰、bags /bæɡz/包、boys /bɔɪz/男孩们
31. /θ/ 清
thin /θɪn/瘦、three /θriː/三、think /θɪŋk/思考、bath /bɑːθ/洗澡、mouth /maʊθ/嘴巴
32. /ð/ 浊
this /ðɪs/这个、that /ðæt/那个、they /ðeɪ/他们、mother /ˈmʌðə(r)/妈妈、father /ˈfɑːðə(r)/爸爸
33. /ʃ/ 清
ship /ʃɪp/轮船、fish /fɪʃ/鱼、shop /ʃɒp/商店、short /ʃɔːt/短、sheep /ʃiːp/绵羊
34. /ʒ/ 浊
pleasure /ˈpleʒə(r)/快乐、vision /ˈvɪʒn/视力、measure /ˈmeʒə(r)/测量
35. /h/ 清
hat /hæt/帽子、hand /hænd/手、house /haʊs/房子、happy /ˈhæpi/开心、hill /hɪl/小山
### 三、破擦音6个（3对清浊）
36. /tʃ/ 清
chair /tʃeə(r)/椅子、chicken /ˈtʃɪkɪn/小鸡、watch /wɒtʃ/手表、teach /tiːtʃ/教、lunch /lʌntʃ/午餐
37. /dʒ/ 浊
jump /dʒʌmp/跳、juice /dʒuːs/果汁、job /dʒɒb/工作、orange /ˈɒrɪndʒ/橙子、bridge /brɪdʒ/桥
38. /tr/ 清
tree /triː/树、train /treɪn/火车、trousers /ˈtraʊzəz/裤子、trip /trɪp/旅行、trap /træp/陷阱
39. /dr/ 浊
dress /dres/连衣裙、drink /drɪŋk/喝、dream /driːm/梦、drive /draɪv/驾驶、dragon /ˈdræɡən/龙
40. /ts/ 清
cats /kæts/猫、hats /hæts/帽子、boats /bəʊts/小船、gates /ɡeɪts/大门、pets /pets/宠物
41. /dz/ 浊
beds /bedz/床、bags /bæɡz/书包、hands /hændz/手、kids /kɪdz/小孩、birds /bɜːdz/小鸟
### 四、鼻音3个
42. /m/
map /mæp/地图、mom /mɒm/妈妈、milk /mɪlk/牛奶、mouth /maʊθ/嘴巴、man /mæn/男人
43. /n/
nose /nəʊz/鼻子、pen /pen/钢笔、sun /sʌn/太阳、nine /naɪn/九、hand /hænd/手
44. /ŋ/
sing /sɪŋ/唱歌、king /kɪŋ/国王、song /sɒŋ/歌曲、morning /ˈmɔːnɪŋ/早上、pink /pɪŋk/粉色
### 五、舌侧音1个
45. /l/
leg /leɡ/腿、light /laɪt/灯光、like /laɪk/喜欢、ball /bɔːl/球、school /skuːl/学校
### 六、卷舌音1个
46. /r/
red /red/红色、rice /raɪs/米饭、run /rʌn/跑、rain /reɪn/下雨、river /ˈrɪvə(r)/小河
### 七、半元音2个
47. /w/
we /wiː/我们、water /ˈwɔːtə(r)/水、white /waɪt/白色、window /ˈwɪndəʊ/窗户、wait /weɪt/等待
48. /j/
yes /jes/是的、yellow /ˈjeləʊ/黄色、you /juː/你、young /jʌŋ/年轻、cute /kjuːt/可爱
"""

# ── 解析 ──
phoneme_lines = []
current_symbol = None
current_words = []

for line in RAW.split('\n'):
    line = line.strip()
    if not line:
        continue
    # 匹配音标行: "1. /iː/" 或 "38. /tr/ 清"
    m = re.match(r'^\d+\.\s*(/[^/]+/)\s*', line)
    if m:
        if current_symbol:
            phoneme_lines.append((current_symbol, current_words))
        current_symbol = m.group(1)
        current_words = []
    elif current_symbol and '、' in line:
        # 单词行: "see /siː/看见、tea /tiː/茶、..."
        parts = line.replace('、', '\t').split('\t')
        for part in parts:
            part = part.strip()
            if not part:
                continue
            wm = re.match(r'(\w+)\s*(/[^/]+/)\s*(.+)', part)
            if wm:
                word = wm.group(1)
                ipa = wm.group(2)
                trans = wm.group(3)
                current_words.append((word, ipa, trans))

if current_symbol:
    phoneme_lines.append((current_symbol, current_words))

# ── 更新 wordbank.json ──
with open('app/src/main/assets/wordbank.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# 更新 phonemes 的 exampleWords
phoneme_updates = {}
for sym, words in phoneme_lines:
    # sym like "/iː/"
    example_words = [w[0] for w in words]  # just word text
    phoneme_updates[sym] = example_words

old_count = 0
for ph in data.get('phonemes', []):
    sym = ph['symbol']
    if sym in phoneme_updates:
        ph['exampleWords'] = phoneme_updates[sym]
        old_count += 1

print(f'更新了 {old_count}/{len(phoneme_updates)} 个音标的 exampleWords')

# 添加新单词到 words 列表
existing_texts = {w['text'].lower() for w in data.get('words', [])}
new_words_added = 0
for sym, words in phoneme_lines:
    for word_text, ipa, trans in words:
        if word_text.lower() in existing_texts:
            continue
        letter = word_text[0].lower() if word_text else '?'
        # 简单 phoneme 推导（只把当前音标作为 phoneme 列表）
        bare_phoneme = sym.strip('/')
        entry = {
            "text": word_text,
            "ipa": ipa,
            "letter": letter,
            "phonemes": [bare_phoneme],
            "emoji": None,
            "difficulty": 1,
            "translation": trans,
        }
        data['words'].append(entry)
        existing_texts.add(word_text.lower())
        new_words_added += 1

print(f'新增了 {new_words_added} 个单词到 words 列表')

with open('app/src/main/assets/wordbank.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print('Done: wordbank.json updated')

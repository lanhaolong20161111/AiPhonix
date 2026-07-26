"""补回遗漏的26个常见多音字到 polyphone_chars.json"""
import json

# 遗漏的字
MISSING = {
    '中': [('zhong1', ['中间','中心','中午']), ('zhong4', ['中奖','中毒','看中'])],
    '乐': [('le4', ['快乐','欢乐','乐园']), ('yue4', ['音乐','乐器','音乐'])],
    '会': [('hui4', ['开会','会议','学会']), ('kuai4', ['会计','财会'])],
    '传': [('chuan2', ['传说','传统','传播']), ('zhuan4', ['自传','传记'])],
    '似': [('si4', ['似乎','相似','类似']), ('shi4', ['似的'])],
    '佛': [('fo2', ['佛像','佛教','佛祖']), ('fu2', ['仿佛'])],
    '任': [('ren4', ['任务','任何','担任']), ('ren2', ['任姓'])],
    '作': [('zuo4', ['作业','工作','作文']), ('zuo1', ['作坊'])],
    '供': [('gong1', ['提供','供应','供给']), ('gong4', ['供品','供认','供奉'])],
    '俩': [('lia3', ['他俩','咱俩','俩人']), ('liang3', ['伎俩'])],
    '冠': [('guan1', ['皇冠','鸡冠']), ('guan4', ['冠军','夺冠'])],
    '几': [('ji3', ['几个','几年','几次']), ('ji1', ['几乎','茶几'])],
    '削': [('xiao1', ['削皮','削铅笔']), ('xue1', ['剥削','削减'])],
    '勾': [('gou1', ['勾画','勾引','勾销']), ('gou4', ['勾当'])],
    '塞': [('sai1', ['塞子','塞满','堵塞']), ('sai4', ['边塞','要塞']), ('se4', ['阻塞','搪塞'])],
    '恶': [('e4', ['凶恶','恶劣']), ('e3', ['恶心']), ('wu4', ['可恶','厌恶'])],
    '晕': [('yun1', ['晕倒','晕车','头晕']), ('yun4', ['晕船','日晕'])],
    '曲': [('qu3', ['歌曲','乐曲','曲调']), ('qu1', ['弯曲','曲线','曲折'])],
    '更': [('geng4', ['更加','更好','更快']), ('geng1', ['更改','更新','更正'])],
    '率': [('lv4', ['效率','频率','概率']), ('shuai4', ['率领','率队','直率'])],
    '症': [('zheng4', ['症状','病症','急症']), ('zheng1', ['症结'])],
    '监': [('jian1', ['监督','监视','监考']), ('jian4', ['太监','国子监'])],
    '脏': [('zang1', ['脏话','脏乱','脏的']), ('zang4', ['心脏','内脏','肝脏'])],
    '调': [('diao4', ['声调','调查','腔调']), ('tiao2', ['调整','调节','调皮'])],
    '迫': [('po4', ['压迫','迫使','急迫']), ('pai3', ['迫击炮'])],
    '丧': [('sang4', ['丧失','丧气']), ('sang1', ['丧事','丧礼'])],
}

with open('AiPhonix/server/data/polyphone_chars.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

chars = data['chars']
for ch, readings in MISSING.items():
    readings_data = {}
    for py, words in readings:
        if words:
            readings_data[py] = words[:5]
    if readings_data:
        primary = max(readings_data.keys(), key=lambda k: len(readings_data[k]))
        chars[ch] = {
            'pronunciations': sorted(readings_data.keys()),
            'words': dict(readings_data),
            'primary': primary
        }

data['version'] = 3
data['chars'] = dict(sorted(chars.items()))

with open('AiPhonix/server/data/polyphone_chars.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f'补回 26 个字后，总数: {len(chars)}')

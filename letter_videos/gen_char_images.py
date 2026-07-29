#!/usr/bin/env python3
"""为识字表生成单个汉字图片"""
import os, re, sys
from PIL import Image, ImageDraw, ImageFont

# ── 配置 ──
FONT_PATH = r'C:\Windows\Fonts\simhei.ttf'
OUT_DIR = r'C:\Users\lhl20\Desktop\char_images'
IMG_SIZE = 120          # 正方形图片边长
FONT_SIZE = 80          # 字号
BG_COLOR = (255,255,255,0)  # 透明背景
TEXT_COLOR = 'black'

# 识字表原文
text = '''咏 贺 妆 丝 裁 剪 莺 拂 堤 醉 趁
脱 袄 遮 掩 探 眉 吐 芽 符 解 触 杜 鹃
裹 颈 寄 粒 破 漏 懊 丧 啊 巧 绚 狐 狸 籽 礼
邓 坛 龄 格 致 勃 挖 额 汗 仍 肯 茁 移 挥 扶
亭 咨 询 剧 塔 餐 厅 厕
迹 曾 冒 蒙 瞧 泞 窝 顺 荆 棘 瓣 莹 觅 需 献
糕 尝 嘛 磨 粉 糖 料 甘 蔗 汁 熬 销 售 的 确 应
弱 末 亚 簇 拥 随 芬 芳 突 紧 递 摸 显

娇 掀
程 魔 术 建 筑 发 演 营 务 判 饲 养
州 谣 华 涌 耸 隔 峡 与 陆 各 谊 浓 齐 奋 繁
传 统 贴 宵 巷 潮 祭 扫 艾 堂 乞 郎 饼 赏 菊
甲 骨 漂 贵 饰 品 携 易 损 钱 币 财 赚 赔 购
拌 菠 煎 腐 茄 烤 葱 炖 蘑 菇 蒸 饺 炸 酱 粥 蛋
津 酸 溜 辣 乎 喷 腻 绵 脆 邦
梦 躺 聊 蹦 郁 囱 般 精 境 叮 咛
匹 郊 微 泛 波 纹 异 恋 舍 求 株 拾 骑

骄 傲 渡 荫 蔽 阿 姨 撑 便 冈 懂 案 倒 翁 橡 枪 控 坦 克 航 模 型
寓 则 亡 补 牢 圈 叼 修 堵 悔 实 焦 筋 喘 费 截
室 而 幅 哈 审 肃 晌 嘻 悦 诲
棚 驮 坊 挡 伯 浅 刚 淹 哩 叹 唉 蹄 既
厨 柜 厢 商 厦 洞 穴 窟 窿 窖 窄
甫 鸣 含 岭 泊 晓 净 寺 宋 毕 竟
压 蝉 蜘 蛛 响 哗 渐
慌 针 辨 忠 导 盏 永 闯 碰 稠 稀 渠
宇 宙 稳 必 须 固 杯 重 态 即 使 饮 挤 浴 桶 简
博 馆 览 技 育 究 哨 诊 律
耷 遇 咦 竖 竿 舞 痛 烦 扇
店 寂 寞 罩 牌 编 顾 夫 完 脖 趴 袜 匆

蜈  蚣
烂 换 搬 喝 坑 舒 集 播 茵 砍 灌 缺 栽 泳 愣
量 昆 怜 另 仿 佛 尽 并 任 何 纺 竭 规 待 醒 挣 愉
扫 帚 抹 拖 簸 箕 玻 璃 垃 圾
射 桑 值 熔 类 箭 翻 跨 搭 裂 窜 炎 滋 润 腾
帝 创 帽 启 召 按 设 材 断 替 其 待 段 互 供 善
洪 滥 毁 毒 伤 难 继 续 败 训 疏 努 驱 恢 功 绩
钩 铲 橙 柿 源 涨 炬 灿 垮 坟'''

# 已有图片的字（跳过不生成）
img_dir = r'C:\Users\lhl20\Desktop\word_images'
have_images = set()
for f in os.listdir(img_dir):
    name, ext = os.path.splitext(f)
    if ext.lower() in ('.png','.jpg','.jpeg'):
        m = re.search(r'[\u4e00-\u9fff]', name)
        if m:
            have_images.add(m.group())

# 提取所有不重复汉字
all_chars = set(re.findall(r'[\u4e00-\u9fff]', text))
need_chars = sorted(all_chars - have_images)

print(f'识字表共 {len(all_chars)} 个不同汉字')
print(f'已有图片: {len(have_images & all_chars)} 个')
print(f'需要生成: {len(need_chars)} 个')

# 创建输出目录
os.makedirs(OUT_DIR, exist_ok=True)

# 加载字体
font = ImageFont.truetype(FONT_PATH, FONT_SIZE)

# 批量生成
ok = 0
fail = 0
for i, char in enumerate(need_chars):
    try:
        img = Image.new('RGBA', (IMG_SIZE, IMG_SIZE), BG_COLOR)
        draw = ImageDraw.Draw(img)
        draw.text((IMG_SIZE // 2, IMG_SIZE // 2), char,
                  font=font, fill=TEXT_COLOR, anchor='mm')
        img.save(os.path.join(OUT_DIR, f'{char}.png'))
        ok += 1
    except Exception as e:
        print(f'  失败 [{char}]: {e}')
        fail += 1

    if (i + 1) % 50 == 0 or i == len(need_chars) - 1:
        print(f'  进度: {i+1}/{len(need_chars)}')

print()
print(f'生成完成! ✅ {ok} 个, ❌ {fail} 个')
print(f'输出目录: {OUT_DIR}')

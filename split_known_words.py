"""将 word_images 中左右各半的图切成左右两半，用 ARK 视觉模型识别上半部分文字后重命名"""
import os, base64, sys
from PIL import Image
from volcenginesdkarkruntime import Ark

api_key = os.environ.get("ARK_API_KEY", "")
if not api_key:
    print("请设置 ARK_API_KEY")
    sys.exit(1)

client = Ark(base_url="https://ark.cn-beijing.volces.com/api/v3", api_key=api_key)

# 我们已知这些图对应的词语列表（29个二年级下词）
words_list = ["新奇","任何","事情","怎样","以前","灵巧","开始","决心","从此","忽然","启发","号召","民众","自由","道理","根本","果然","提供","百姓","必须","反而","仍然","治服","继续","采用","奔波","平常","平时","难道"]

# 29张图，每张左右各一个，按文件序号对应
src_dir = r"C:\Users\lhl20\Desktop\word_images"
files = sorted(f for f in os.listdir(src_dir) if f.endswith(".png") and f.startswith("儿童汉字插图设计"))
assert len(files) == 29, f"期望29张，实际{len(files)}"

# 按顺序，每张图对应 words_list 中前后两个词
for i, fname in enumerate(files):
    path = os.path.join(src_dir, fname)
    img = Image.open(path).convert("RGBA")
    w, h = img.size

    # 切左右
    left = img.crop((0, 0, w // 2, h))
    right = img.crop((w // 2, 0, w, h))

    for side_idx, (word_expected, side_img) in enumerate([(words_list[i*2], left), (words_list[i*2+1], right)]):
        dst_name = f"{word_expected}.png"
        dst = os.path.join(src_dir, dst_name)
        if os.path.exists(dst):
            print(f"  [{i+1}/29] {dst_name} 已存在，跳过")
            continue
        side_img.save(dst)
        print(f"  [{i+1}/29] 左={words_list[i*2]} 右={words_list[i*2+1]} -> 保存 {dst_name}")

print(f"\n完成！请在 word_images 目录检查")

"""
Tesseract OCR 识别语文字词表图片（仅汉字，不识别拼音）
从上到下逐行识别，提高准确率
"""
import sys, os
from pathlib import Path

# 设置 tesseract 路径
os.environ['TESSDATA_PREFIX'] = os.path.join(os.environ['USERPROFILE'], 'tessdata')
TESSERACT_CMD = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from PIL import Image, ImageFilter, ImageEnhance
import pytesseract
pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD

input_dir = Path(r"C:\Users\lhl20\Desktop\语文字词表")
output_file = input_dir / "ocr_output.txt"
images = sorted(input_dir.glob("*.jpg"))

print(f"找到 {len(images)} 张图片\n")

def preprocess(image):
    """图像预处理：转灰度、增强对比度、二值化"""
    img = image.convert('L')
    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(2.0)
    img = img.point(lambda x: 0 if x < 140 else 255)
    return img

def ocr_image(img_path):
    """逐行识别图片中的汉字"""
    img = Image.open(img_path)
    # 先全图识别看布局
    w, h = img.size
    # 从顶部到底部每行切割识别
    custom_config = r'--psm 6 -c tessedit_char_whitelist=0123456789你我他大小上下左右中天地人父母兄弟姐妹山水火日月星风云雨雪花草树木虫鱼鸟龙凤龟马牛羊鸡狗猪鸭鹅春夏秋冬东南西北前后左右里外白黑红绿黄蓝紫青灰金木水土石田禾苗竹米瓜果桃李杏枣糖盐油酒饭菜桌椅门窗房间衣帽鞋袜裤被床书笔纸墨画字词句文章诗歌舞乐音声光色香味道温饱冷暖快乐悲伤喜怒哀惊怕爱恨情仇思忆忘想知认学教读写说听看问答来去进出走跑跳飞站坐躺睡穿脱洗擦打扫切煮烧蒸炒炖煎烤酸甜苦辣咸鲜嫩硬软轻重快慢长短高低胖瘦美丑好坏真假善恶对错多少早晚先后新旧古今中外一二三四五六七八九十百千万亿'

    # 转换为灰度
    grey = img.convert('L')
    
    # 用简体中文 + 英文识别
    texts = []
    data = pytesseract.image_to_data(grey, lang='chi_sim+eng', config='--psm 6', output_type=pytesseract.Output.DICT)
    
    prev_top = -1
    current_line = []
    for i in range(len(data['text'])):
        if data['text'][i].strip():
            top = data['top'][i]
            if prev_top != -1 and abs(top - prev_top) > 15:
                texts.append(' '.join(current_line))
                current_line = []
            current_line.append(data['text'][i].strip())
            prev_top = top
    if current_line:
        texts.append(' '.join(current_line))
    
    return texts if texts else ['[未识别到文字]']

all_text = []

for i, img_path in enumerate(images, 1):
    short = img_path.name[:60]
    try:
        lines = ocr_image(img_path)
        print(f"[{i}/{len(images)}] {short}")
        print(f"  -> {len(lines)} 行")
        all_text.append(f"===== 图片{i}: {img_path.name} =====")
        all_text.extend(lines)
        all_text.append("")
    except Exception as e:
        print(f"[{i}/{len(images)}] {short}  [FAIL] {e}")
        import traceback; traceback.print_exc()

output_file.write_text("\n".join(all_text), encoding="utf-8")
print(f"\n✅ 完成！结果 -> {output_file}")

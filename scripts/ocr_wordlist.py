""" 
识别 '语文字词表' 目录下所有图片，将文字保存到 output.txt
"""
import os, sys
from pathlib import Path

os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'

from paddleocr import PaddleOCR

input_dir = Path(r"C:\Users\lhl20\Desktop\语文字词表")
output_file = Path(r"C:\Users\lhl20\Desktop\语文字词表\ocr_output.txt")

print(f"输入目录: {input_dir}")
print(f"输出文件: {output_file}")

images = sorted(input_dir.glob("*.jpg"))
print(f"找到 {len(images)} 张图片")

ocr = PaddleOCR(lang='ch', use_textline_orientation=True)

all_text = []
for i, img_path in enumerate(images, 1):
    short = img_path.name[:60]
    print(f"\n[{i}/{len(images)}] {short} ...")
    try:
        result = ocr.ocr(str(img_path))
        page_text = []
        lines = result[0] if result and result[0] else []
        for line in lines:
            text, conf = line[1][0], line[1][1]
            page_text.append(text)
            print(f"  [{conf:.2f}] {text}")
        all_text.append(f"===== 图片{i}: {img_path.name} =====")
        all_text.extend(page_text)
        all_text.append("")
    except Exception as e:
        print(f"  FAIL: {e}")
        all_text.append(f"===== 图片{i}: {img_path.name} [FAIL] =====")
        all_text.append("")

output_file.write_text("\n".join(all_text), encoding="utf-8")
print(f"\n✅ 完成，共 {len(images)} 张 -> {output_file}")

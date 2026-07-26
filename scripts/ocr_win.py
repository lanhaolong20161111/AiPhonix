"""
Windows 内置 OCR 识别语文字词表图片
"""
import sys, asyncio
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from winrt.windows.media.ocr import OcrEngine
from winrt.windows.graphics.imaging import BitmapDecoder
from winrt.windows.storage import StorageFile

input_dir = Path(r"C:\Users\lhl20\Desktop\语文字词表")
output_file = input_dir / "ocr_output.txt"
images = sorted(input_dir.glob("*.jpg"))

print(f"找到 {len(images)} 张图片\n")

engine = OcrEngine.try_create_from_user_profile_languages()

all_text = []

async def ocr_one(img_path):
    file = await StorageFile.get_file_from_path_async(str(img_path))
    stream = await file.open_read_async()
    decoder = await BitmapDecoder.create_async(stream)
    sb = await decoder.get_software_bitmap_async()
    result = await engine.recognize_async(sb)
    return [line.text for line in result.lines]

for i, img_path in enumerate(images, 1):
    short = img_path.name[:60]
    try:
        texts = asyncio.run(ocr_one(img_path))
        print(f"[{i}/{len(images)}] {short}")
        print(f"  -> {len(texts)} 行:")
        for t in texts:
            print(f"    {t}")
        all_text.append(f"===== 图片{i}: {img_path.name} =====")
        all_text.extend(texts)
        all_text.append("")
    except Exception as e:
        print(f"[{i}/{len(images)}] {short}  [FAIL] {e}")

output_file.write_text("\n".join(all_text), encoding="utf-8")
print(f"\n[DONE] 结果 -> {output_file}")

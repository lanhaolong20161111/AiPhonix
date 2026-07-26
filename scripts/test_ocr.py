"""快速测试 PaddleOCR 在一帧上的表现"""
from paddleocr import PaddleOCR
import os

tmp = os.environ["TEMP"] + r"\ocr_test"

ocr = PaddleOCR(lang="en", engine="onnxruntime",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False)

for fname in ["test_crop.png", "test_120s.png"]:
    path = tmp + "\\" + fname
    print(f"\n=== {fname} ===")
    try:
        r = ocr.predict(path)
        for res in r:
            texts = res["rec_texts"]
            scores = res["rec_scores"]
            print(f"  texts: {texts}")
            print(f"  scores: {[float(s) for s in scores]}")
    except Exception as e:
        print(f"  Error: {e}")
        import traceback; traceback.print_exc()

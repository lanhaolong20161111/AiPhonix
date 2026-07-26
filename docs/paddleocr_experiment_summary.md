# 2026-07-22 PaddleOCR 字幕提取实验总结

## 目标
为 Big Muzzy 视频提取与画面100%一致的字幕，解决 whisper ASR 文字不匹配问题。

## 环境
- **PaddleOCR 3.7.0**（ONNX Runtime 引擎，无需 PaddlePaddle/GPU）
- **模型**：PP-OCRv6_medium（自动下载到 `~/.paddlex/official_models/`）
- **视频**：`youtube_playlist/Big_Muzzy_Ep01.mp4` (15分钟)
- **测试视频**：`test_2min.mp4`（前2分钟）

---

## 实验记录

### 实验1：纯 OCR @ 2fps（全片）❌
- 脚本：`scripts/paddleocr_subtitle.py`
- 1807帧 → 703变化帧 → OCR → 全部 empty
- **根因**：crop 25% 太小 + API 调用错误（`res.text` → 应为 `res["rec_texts"]`）

### 实验2：纯 OCR @ 2fps（修复后）❌
- 修复：crop 35%、正确 API
- 519 变化帧 → 210 条文字变化 → **SRT 输出 0 条**
- **根因**：`end_t - t = 0`（去重逻辑 bug，未去重的条目时长=0）

### 实验3：纯 OCR @ 2fps（2分钟测试）✅
- 脚本：`scripts/test_2min_ocr.py`
- 240帧 → 122变化帧 → **13条字幕**（7条正确）
- 正确：✔ `"I'm the King!"` ✔ `"I'm the Queen!"` ✔ `"Thank you, Corvax."` ✔ `"Hi! I'm Muzzy."`
- 错误：✘ 版权声明误检 ✘ `"Gueo"` 乱码 ✘ `"多哥要家"` 中文乱码
- **丢词**：`"Hello, I'm Bob"` 丢失（屏幕停留 < 0.5s，2fps 跳过）

### 实验4：混合方案（whisper文字 + OCR精确定时）✅ 但效果不好
- 脚本：`scripts/hybrid_subtitle.py`
- whisper 8条 × OCR 时间窗口匹配 → **8/8 正确**
- 4条时间戳被 OCR 精确修正（偏差 ±1-2s）
- 用户反馈：**效果不好**

### 实验5：纯 OCR @ 4fps（待完成）🔄
- 脚本：`scripts/ocr_4fps.py`
- 状态：**bash-23 已完成，结果待查看**

---

## 关键发现
1. ✅ PaddleOCR ONNX 引擎可用，无需 PaddlePaddle
2. ✅ OCR API：`res["rec_texts"]` / `res["rec_scores"]`
3. ⚠️ 画面文字 ≠ ASR 文字（画面是精简版），这是核心矛盾
4. ⚠️ 屏幕字幕停留时间有时 < 0.5s，需 ≥4fps
5. ⚠️ 需过滤：版权声明、水印（`TamNgoaiNgu.com`）、中文乱码

---

## 待办
- [ ] 查看 bash-23 的 4fps OCR 结果
- [ ] 如果效果不好 → 尝试 small.en 模型 / 更严过滤
- [ ] 跑完整 15 分钟的流水线

---

## 脚本清单
```
scripts/
├── paddleocr_subtitle.py     # 全片 OCR（有bug）
├── test_2min_ocr.py          # 2分钟 OCR 测试
├── ocr_4fps.py               # 4fps 纯 OCR（当前）
├── hybrid_subtitle.py        # 混合方案
├── split_srt_sentences.py    # whisper SRT 切分
├── cv_subtitle_align.py      # CV 帧差精确定时
├── test_ocr.py               # PaddleOCR API 测试
└── test_filter.py            # 过滤逻辑测试
```

---

## 字幕文件对照
| 文件 | 来源 | 大小 | 质量 |
|---|---|---|---|
| `_en-orig.srt` | YouTube 官方 | 21KB | 文本有 foreign/重复 |
| `_wcpp.srt` | whisper.cpp 原始 | 8.5KB | 长段落连串 |
| `_en.srt` | whisper+切分 | 6.8KB | 干净但文字≠画面 |
| `_cv.srt` | CV帧差精确定时 | 6.7KB | 时间准但文字≠画面 |
| `test_2min_ocr.srt` | 纯OCR 2fps | 0.8KB | 7/13正确 |
| `test_2min_hybrid.srt` | 混合方案 | 0.5KB | 8/8完整但效果不好 |

"""
从 youtube_playlist 所有字幕文件中提取所有英文词汇，去重后输出到桌面。
"""
import os
import re
import sys

SRC_DIR = r"C:\Users\lhl20\Desktop\youtube_playlist"
OUTPUT  = r"C:\Users\lhl20\Desktop\all_words.txt"

def is_text_line(line: str) -> bool:
    """判断是否为字幕正文（跳过序号行、时间戳行、空行）。"""
    stripped = line.strip()
    if not stripped:
        return False
    if stripped.isdigit():
        return False
    if "-->" in stripped and re.search(r"\d{2}:\d{2}:\d{2}", stripped):
        return False
    return True

def extract_words(text: str) -> list[str]:
    """从文本中提取所有英文单词，转小写。"""
    tokens = re.findall(r"[a-zA-Z]+(?:'[a-zA-Z]+)?", text)
    return [w.lower() for w in tokens if len(w) >= 1]

def main():
    all_words: set[str] = set()

    for fname in sorted(os.listdir(SRC_DIR)):
        if not fname.lower().endswith((".srt", ".vtt")):
            continue
        fpath = os.path.join(SRC_DIR, fname)
        try:
            with open(fpath, encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if is_text_line(line):
                        all_words.update(extract_words(line))
            print(f"  OK {fname}  ({len(all_words)} unique words so far)")
        except Exception as e:
            print(f"  FAIL {fname}: {e}")

    sorted_words = sorted(all_words)
    with open(OUTPUT, "w", encoding="utf-8") as out:
        for w in sorted_words:
            out.write(w + "\n")

    print(f"\n✅ 完成！共 {len(sorted_words)} 个单词 → {OUTPUT}")

if __name__ == "__main__":
    main()

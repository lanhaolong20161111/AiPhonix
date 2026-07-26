import re

path = r"C:\Users\lhl20\Desktop\android_cli_demos\.reasonix\attachments\clipboard-20260723-105840.428283-000001.srt"
with open(path, "r", encoding="utf-8") as f:
    text = f.read()

blocks = re.split(r"\n\n+", text.strip().replace("\r\n", "\n"))
ts_re = re.compile(r"(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3})")

out = []
idx = 1
for b in blocks:
    lines = [l.strip() for l in b.split("\n") if l.strip()]
    if not lines:
        continue
    ts_line = None
    for i, l in enumerate(lines):
        if ts_re.search(l):
            ts_line = i
            break
    if ts_line is None:
        continue
    m = ts_re.search(lines[ts_line])
    start, end = m.group(1), m.group(2)
    inline = ts_re.sub("", lines[ts_line]).strip()
    after = " ".join(lines[ts_line+1:]).strip()
    # 后续行也可能有内嵌时间戳，再次去掉
    after = ts_re.sub("", after).strip()
    txt = (inline + " " + after).strip()
    if not txt:
        txt = "(empty)"
    out.append(f"{idx}\n{start} --> {end}\n{txt}")
    idx += 1

out_path = path.replace(".srt", "_clean.srt")
with open(out_path, "w", encoding="utf-8") as f:
    f.write("\n\n".join(out))

print(f"Done: {len(out)} entries -> {out_path}")

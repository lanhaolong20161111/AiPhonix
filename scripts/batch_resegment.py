"""批量重切 Big Muzzy Ep02-12：Silero VAD 停顿对齐 + 每集切词审计。

每集只做一次 Silero 推理：语音区间同时用于
  1) 生成停顿对齐 SRT（resegment，silences 预计算传入）
  2) 审计新 SRT 的句首/句尾切词数（语音区间当真值，TOL=150ms）

输出: <dir>/Big_Muzzy_EpNN.en.p.srt
用法: python batch_resegment.py <workdir> <ep1> <ep2> ...
  例: python batch_resegment.py "C:\\...\\youtube_playlist" 02 03 04
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from resegment_srt import (
    detect_speech_silero,
    parse_srt,
    resegment,
    silences_from_speech,
)

TOL = 0.15  # 审计容差（秒）


def audit(units, speech):
    """句首/句尾切进语音段内部（距边缘 >TOL）的数量与样例"""
    end_cut, start_cut, end_list = 0, 0, []
    for s, e, text in units:
        es, ss = e / 1000, s / 1000
        for a, b in speech:
            if a + TOL < es < b - TOL:
                end_cut += 1
                end_list.append((round(es, 2), text[:38]))
                break
        for a, b in speech:
            if a + TOL < ss < b - TOL:
                start_cut += 1
                break
    return end_cut, start_cut, end_list


def main():
    workdir = sys.argv[1]
    eps = sys.argv[2:]
    print(f"批量重切 {len(eps)} 集: Ep{', Ep'.join(eps)}\n")
    rows = []
    for ep in eps:
        mp4 = os.path.join(workdir, f"Big_Muzzy_Ep{ep}.mp4")
        srt_in = os.path.join(workdir, f"Big_Muzzy_Ep{ep}.en.srt")
        srt_out = os.path.join(workdir, f"Big_Muzzy_Ep{ep}.en.p.srt")
        if not (os.path.exists(mp4) and os.path.exists(srt_in)):
            print(f"Ep{ep}: !! 缺源文件，跳过")
            continue
        print(f"===== Ep{ep} =====")
        speech = detect_speech_silero(mp4)
        blocks = parse_srt(srt_in)
        silences = silences_from_speech(speech, blocks[-1][1] / 1000)
        rc = resegment(mp4, srt_in, srt_out, -35, 0.35, "silero",
                       silences=silences, quiet=True)
        if rc != 0:
            print(f"Ep{ep}: !! 重切失败")
            continue
        units = parse_srt(srt_out)
        end_cut, start_cut, end_list = audit(units, speech)
        durs = sorted((u[1] - u[0]) / 1000 for u in units)
        print(f"Ep{ep}: {len(blocks)} 块 → {len(units)} 单元 | "
              f"时长中位 {durs[len(durs)//2]:.1f}s 最长 {durs[-1]:.1f}s | "
              f"审计: 尾切 {end_cut} / 首切 {start_cut}")
        for t, x in end_list[:3]:
            print(f"        尾切样例 {t}s {x}")
        rows.append((ep, len(units), end_cut, start_cut))

    print("\n===== 汇总 =====")
    print("Ep   单元  尾切  首切")
    for ep, n, ec, sc in rows:
        print(f"{ep}   {n:4d}  {ec:4d}  {sc:4d}")


if __name__ == "__main__":
    main()

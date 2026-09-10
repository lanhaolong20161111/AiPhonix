from PIL import Image
import os
d = r'C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py\data\uploads'
# 找 13:11 那批 6 个 crop,按高度分组
for fn in sorted(os.listdir(d)):
    if not fn.startswith('crop_'): continue
    p = os.path.join(d, fn)
    t = os.path.getmtime(p)
    if t < 0: continue
    with Image.open(p) as im:
        w,h = im.size
    # 只处理高度 170~180(块3)
    if 170 <= h <= 180:
        print(f'=== {fn} {w}x{h} ===')
        im = Image.open(p).convert('L'); px=im.load()
        # 打印底部 20 行墨迹
        for yy in range(h-20, h):
            cnt=sum(1 for xx in range(w) if px[xx,yy]<230)
            if cnt>2: print(f'  y={yy}(相对): {cnt} 有墨迹')
        print('  (底部20行除以上未列出的均为空白)')

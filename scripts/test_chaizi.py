from hanzi_chaizi import HanziChaizi
c = HanziChaizi()
for ch in ['好','花','国','做','星','病','同','您','感','远','笑','笔','雪','雷','领','猫','一','大','人','树','林','想']:
    result = c.query(ch)
    print(f"{ch}: {result}")

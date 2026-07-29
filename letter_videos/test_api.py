import urllib.request, json
r = urllib.request.urlopen('http://192.168.1.7:8080/api/v1/char-images')
d = json.load(r)
print(f"总{len(d['items'])}个字, 前5:", [i['char'] for i in d['items'][:5]])
print(f"第一个图片:", d['items'][0]['image'])

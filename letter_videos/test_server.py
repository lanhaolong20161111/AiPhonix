import urllib.request, json
r = urllib.request.urlopen('http://192.168.1.7:8080/api/v1/char-images')
d = json.load(r)
print(f'OK, 共{d["total"]}张图片')
print(f'前3个: {[i["char"] for i in d["items"][:3]]}')

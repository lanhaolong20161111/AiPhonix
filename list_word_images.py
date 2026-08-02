import os
d = r"C:\Users\lhl20\Desktop\word_images"
files = [f for f in os.listdir(d)]
for f in files:
    print(repr(f))
    print("  bytes:", f.encode("utf-8"))

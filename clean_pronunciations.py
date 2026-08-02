import json

with open(r'app/src/main/assets/wordbank.json','r',encoding='utf-8') as f:
    data = json.load(f)

# .aac files that exist in assets/ipa/
existing = {'ɒ','ɑ','æ','aɪ','aʊ','b','ɔ','ɔɪ','d','ð','dr','dz','dʒ','e','ə','eə','eɪ','əʊ','ɜ','f','g','h','ɪ','i','ɪə','j','k','l','m','n','ŋ','p','r','s','ʃ','t','tr','ts','tʃ','ʊ','u','ʊə','v','ʌ','w','z','ʒ','θ'}

for letter in data.get('letters', []):
    orig = letter.get('pronunciations', [])
    filtered = []
    for ipa in orig:
        clean = ipa.strip('/')
        if clean in existing:
            filtered.append(ipa)
        else:
            print(f"  Removing {ipa.encode('ascii','replace').decode()} from {letter['char']} (no audio)")
    letter['pronunciations'] = filtered

with open(r'app/src/main/assets/wordbank.json','w',encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print('Done')

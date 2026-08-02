import json, subprocess, os

IPA_DIR = r'app/src/main/assets/ipa'
WORD_BANK = r'app/src/main/assets/wordbank.json'

# Missing sounds and how to compose them
compose = {
    'kw': ['k', 'w'],     # /kw/ for Q
    'ks': ['k', 's'],     # /ks/ for X
    'ju': ['j', 'u'],     # /juː/ — use uː.aac for length
}

with open(WORD_BANK, 'r', encoding='utf-8') as f:
    data = json.load(f)

def aac_path(name):
    return os.path.join(IPA_DIR, f'{name}.aac')

def temp_wav(name):
    return os.path.join(IPA_DIR, f'temp_{name}.wav')

created = []
for target, parts in compose.items():
    if os.path.exists(aac_path(target)):
        print(f'{target}.aac already exists, skipping')
        continue
    # Check source files exist
    src_wavs = []
    ok = True
    for p in parts:
        if not os.path.exists(aac_path(p)):
            # try p + 'ː'
            p2 = p + 'ː'
            if os.path.exists(aac_path(p2)):
                p = p2
            else:
                print(f'  Missing source: {p}.aac')
                ok = False
                break
        # Decode to WAV
        wav = temp_wav(p)
        subprocess.run(['ffmpeg', '-y', '-i', aac_path(p), '-ac', '1', '-ar', '44100', wav],
                       capture_output=True, text=True)
        if not os.path.exists(wav):
            print(f'  Failed to decode {p}.aac')
            ok = False
            break
        src_wavs.append(wav)
        created.append(wav)
    if not ok:
        continue

    # Concatenate WAV files
    concat_list = os.path.join(IPA_DIR, 'concat_list.txt')
    with open(concat_list, 'w') as f:
        for w in src_wavs:
            f.write(f"file '{os.path.basename(w)}'\n")
    created.append(concat_list)

    out_aac = aac_path(target)
    cmd = ['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', concat_list,
           '-ac', '1', '-ar', '44100', '-b:a', '64k', out_aac]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode == 0 and os.path.exists(out_aac):
        print(f'Created {target}.aac ({len(parts)} parts)')
    else:
        print(f'  Failed to create {target}.aac: {r.stderr[:200]}')

# Clean up temp files
for f in created:
    try: os.remove(f)
    except: pass

# Now update wordbank.json with the new sounds
# files that exist now
existing_files = set()
for f in os.listdir(IPA_DIR):
    if f.endswith('.aac'):
        existing_files.add(f[:-4])

for letter in data.get('letters', []):
    orig = letter.get('pronunciations', [])
    filtered = []
    for ipa in orig:
        clean = ipa.strip('/').replace('ː', '')
        if clean in existing_files or (clean + 'ː') in existing_files:
            filtered.append(ipa)
        else:
            print(f'  Removing {ipa} from {letter["char"]} (still no audio)')
    letter['pronunciations'] = filtered

with open(WORD_BANK, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print('Done')

import json, os

WORD_BANK = r'app/src/main/assets/wordbank.json'
IPA_DIR = r'app/src/main/assets/ipa'

# Get existing audio files
existing = set()
for f in os.listdir(IPA_DIR):
    if f.endswith('.aac'):
        existing.add(f[:-4])
print(f"Existing .aac files: {len(existing)}")

# Normalization for Unicode IPA variants
NORM = {'ɡ': 'g', 'ʒ': 'z'}  # ɡ→g for script g, ʒ→z for ezh

def has_audio(ipa_symbol):
    """Check if a phoneme string like '/iː/' or '/ɡ/' has a matching audio file."""
    cleaned = ipa_symbol.strip('/')
    # Check direct match
    if cleaned in existing:
        return True
    # Remove length mark
    no_len = cleaned.replace('\u02d0', '')
    if no_len in existing:
        return True
    # Normalize Unicode variants
    normalized = ''.join(NORM.get(c, c) for c in no_len)
    if normalized in existing:
        return True
    return False

# All pronunciations with their expected symbols
PRONUNCIATIONS = {
    "a": ["/eɪ/", "/æ/"],
    "b": ["/b/"],
    "c": ["/k/", "/s/"],
    "d": ["/d/"],
    "e": ["/iː/", "/e/"],
    "f": ["/f/"],
    "g": ["/ɡ/", "/dʒ/"],
    "h": ["/h/"],
    "i": ["/aɪ/", "/ɪ/"],
    "j": ["/dʒ/"],
    "k": ["/k/"],
    "l": ["/l/"],
    "m": ["/m/"],
    "n": ["/n/"],
    "o": ["/əʊ/", "/ɒ/"],
    "p": ["/p/"],
    "q": ["/kw/"],
    "r": ["/r/"],
    "s": ["/s/", "/z/"],
    "t": ["/t/"],
    "u": ["/juː/", "/ʌ/"],
    "v": ["/v/"],
    "w": ["/w/"],
    "x": ["/ks/"],
    "y": ["/j/", "/i/", "/aɪ/"],
    "z": ["/z/"],
}

with open(WORD_BANK, 'r', encoding='utf-8') as f:
    data = json.load(f)

missing = []
for letter in data.get('letters', []):
    ch = letter.get('char', '')
    expected = PRONUNCIATIONS.get(ch, [])
    # Only keep expected ones that have audio
    valid = [ipa for ipa in expected if has_audio(ipa)]
    if not valid:
        missing.append(ch)
    letter['pronunciations'] = valid
    print(f"  {ch}: {valid}")

with open(WORD_BANK, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

if missing:
    print(f"\nWARNING: No audio for: {missing}")
print("Done - all pronunciations regenerated")

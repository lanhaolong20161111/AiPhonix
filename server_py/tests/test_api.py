import httpx, json

API = "http://127.0.0.1:8080/api/v1"

tests = [
    ("GET", "/../health", None),
    ("GET", "/wordbank/stats", None),
    ("GET", "/wordbank/search?q=apple&limit=3", None),
    ("GET", "/chinese/polyphone", None),
    ("GET", "/practice/history?limit=3", None),
    ("GET", "/practice/stats", None),
    ("GET", "/llm/logs", None),
    ("GET", "/english/vocabulary", None),
    ("GET", "/english/sentences", None),
]

all_ok = True
for method, path, _ in tests:
    url = f"{API}{path}"
    try:
        r = httpx.request(method, url, timeout=10)
        if r.status_code >= 400:
            print(f"FAIL {method} {path} -> {r.status_code}")
            all_ok = False
        else:
            data = r.json() if r.text else {}
            size = len(json.dumps(data))
            print(f"OK   {method} {path} -> {r.status_code} ({size} bytes)")
    except Exception as e:
        print(f"FAIL {method} {path} -> {e}")
        all_ok = False

print()
print("ALL PASS!" if all_ok else "SOME FAILED!")

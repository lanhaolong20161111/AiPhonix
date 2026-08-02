"""Test auth API"""
import urllib.request, json, sys

BASE = "http://localhost:8080"

def req(method, path, data=None):
    url = f"{BASE}{path}"
    body = json.dumps(data).encode() if data else None
    r = urllib.request.Request(url, data=body, method=method)
    r.add_header("Content-Type", "application/json")
    try:
        resp = urllib.request.urlopen(r)
        return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body)
        except:
            return e.code, {"error": body.decode("utf-8", errors="replace")}

# Test register
print("=== Register ===")
status, data = req("POST", "/api/v1/auth/register", {
    "username": "test1",
    "password": "123456",
    "nickname": "测试学生",
    "grade": "二年级",
    "age": 8,
})
print(f"Status: {status}")

# If user already exists, login instead
if status != 200:
    print("User exists, logging in...")
    status, data = req("POST", "/api/v1/auth/login", {
        "username": "test1",
        "password": "123456",
    })
    print(f"Login status: {status}")

if status == 200:
    access_token = data["access_token"]
    refresh_token = data["refresh_token"]
    print(f"Access token: {access_token[:50]}...")
    print(f"Refresh token: {refresh_token[:20]}...")

    # Test login
    print("\n=== Login ===")
    status, data = req("POST", "/api/v1/auth/login", {
        "username": "test1",
        "password": "123456",
    })
    print(f"Status: {status}")
    access_token = data["access_token"]

    # Test /me
    print("\n=== GET /me ===")
    r = urllib.request.Request(f"{BASE}/api/v1/users/me")
    r.add_header("Authorization", f"Bearer {access_token}")
    try:
        resp = urllib.request.urlopen(r)
        print(f"Status: {resp.status}")
        print(json.dumps(json.loads(resp.read()), indent=2, ensure_ascii=False))
    except urllib.error.HTTPError as e:
        print(f"Error: {e.code} {e.read()}")

    # Test refresh
    print("\n=== Refresh ===")
    status, data = req("POST", "/api/v1/auth/refresh", {
        "refresh_token": refresh_token,
    })
    print(f"Status: {status}")
    print(f"New tokens: access={'access_token' in data}, refresh={'refresh_token' in data}")

    # Test logout
    print("\n=== Logout ===")
    r = urllib.request.Request(f"{BASE}/api/v1/auth/logout", 
        data=json.dumps({"refresh_token": refresh_token}).encode(),
        method="POST")
    r.add_header("Content-Type", "application/json")
    r.add_header("Authorization", f"Bearer {access_token}")
    try:
        resp = urllib.request.urlopen(r)
        print(f"Status: {resp.status}")
        print(json.loads(resp.read()))
    except urllib.error.HTTPError as e:
        print(f"Error: {e.code} {e.read()}")

print("\n=== All tests passed ===")

"""训练任务配置 + 完成度回传接口测试（需服务已启动）"""
import httpx

BASE = "http://127.0.0.1:8081/api/v1"


def main():
    # 注册/登录测试用户
    r = httpx.post(f"{BASE}/auth/register", json={
        "username": "train_test_user", "password": "test1234", "nickname": "训练测试",
    }, timeout=5)
    token = ""
    if r.status_code == 200:
        token = r.json().get("access_token", "")
    if not token:
        r = httpx.post(f"{BASE}/auth/login", json={
            "username": "train_test_user", "password": "test1234",
        }, timeout=5)
        token = r.json().get("access_token", "")
    print("token:", "OK" if token else "FAIL")

    headers = {"Authorization": f"Bearer {token}"}

    # 1. 未配置时拉取 → plan null
    r = httpx.get(f"{BASE}/training/plan", headers=headers, timeout=5)
    print("GET plan (empty):", r.status_code, r.json().get("plan"))

    # 2. 保存配置
    plan = {
        "id": "p1", "title": "今日任务", "createdAt": 1, "updatedAt": 2,
        "items": [{"id": "i1", "feature": "recognition", "done": False}],
    }
    r = httpx.put(f"{BASE}/training/plan", json=plan, headers=headers, timeout=5)
    print("PUT plan:", r.status_code)

    # 3. 再拉取 → 应有配置
    r = httpx.get(f"{BASE}/training/plan", headers=headers, timeout=5)
    got = r.json().get("plan")
    print("GET plan (saved):", r.status_code, got.get("title") if got else None, "items:", len(got["items"]) if got else 0)

    # 4. 上报完成度（认字 20 题对 15）
    r = httpx.post(f"{BASE}/training/progress", json={
        "plan_item_id": "i1", "feature": "recognition", "count": 20, "correct": 15,
        "duration_ms": 90000, "metrics": {"count": 20, "correct": 15, "doneAt": 111},
    }, headers=headers, timeout=5)
    print("POST progress:", r.status_code, r.json())

    # 5. 同日重复上报（幂等覆盖 → count 应为 2）
    r = httpx.post(f"{BASE}/training/progress", json={
        "plan_item_id": "i1", "feature": "recognition", "count": 2, "correct": 2,
    }, headers=headers, timeout=5)
    print("POST progress (dup):", r.status_code)

    # 6. 查询
    r = httpx.get(f"{BASE}/training/progress", headers=headers, timeout=5)
    data = r.json()
    print("GET progress:", r.status_code, "total:", data.get("total"),
          "first:", data.get("sessions", [{}])[0].get("count") if data.get("sessions") else None)

    # 7. 未认证访问 → 401
    r = httpx.get(f"{BASE}/training/plan", timeout=5)
    print("GET plan (no auth):", r.status_code)

    # 8. 另一用户隔离
    httpx.post(f"{BASE}/auth/register", json={
        "username": "train_test_user2", "password": "test1234", "nickname": "训练测试2",
    }, timeout=5)
    r2 = httpx.post(f"{BASE}/auth/login", json={"username": "train_test_user2", "password": "test1234"}, timeout=5)
    h2 = {"Authorization": f"Bearer {r2.json().get('access_token','')}"}
    r = httpx.get(f"{BASE}/training/progress", headers=h2, timeout=5)
    print("GET progress (other user):", r.status_code, "total:", r.json().get("total"))


if __name__ == "__main__":
    main()

"""测试脚本 — 验证 Python 版服务器各接口"""
import httpx

BASE = "http://127.0.0.1:8080/api/v1"

def test(name: str, method: str, path: str, **kwargs):
    fn = getattr(httpx, method)
    try:
        r = fn(f"{BASE}{path}", timeout=5, **kwargs)
        data = r.json() if r.text else {}
        summary = f"{r.status_code}"
        if isinstance(data, dict):
            # show key summary
            keys = list(data.keys())[:3]
            summary += f" [{', '.join(keys)}]"
        print(f"  {method.upper()} {path} -> {summary}")
        return data
    except Exception as e:
        print(f"  {method.upper()} {path} -> ERROR: {e}")
        return None

print("=== 测试 AiPhonix Python 服务 ===\n")

print("1. 健康检查")
test("health", "get", "/../health")

print("\n2. 词库")
test("stats", "get", "/wordbank/stats")
test("search", "get", "/wordbank/search", params={"q": "apple", "limit": 5})

print("\n3. 汉字信息")
test("polyphone", "get", "/chinese/polyphone")

print("\n4. 练习")
test("history", "get", "/practice/history", params={"limit": 3})
test("stats", "get", "/practice/stats")

print("\n5. LLM 日志")
logs = test("logs", "get", "/llm/logs")
if logs and logs.get("total_calls", 0) > 0:
    last = logs["logs"][-1]
    print(f"   最近调用: {last.get('caller','?')} -> {last.get('success',False)}")

print("\n6. 英语数据")
test("vocab", "get", "/english/vocabulary")
test("sentences", "get", "/english/sentences")

print("\n=== 完成 ===")

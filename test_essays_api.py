"""测试口述作文 API 端点"""
import json
import urllib.request
import urllib.error

BASE = "http://localhost:8080/api/v1"

def post(path, data):
    url = f"{BASE}{path}"
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"error": e.code, "body": e.read().decode("utf-8")[:500]}

# 1. 获取题目列表
print("=== GET /essays ===")
result = json.loads(urllib.request.urlopen(f"{BASE}/essays", timeout=10).read())
print(f"  共 {len(result['essays'])} 篇题目 ✓")
for e in result["essays"][:3]:
    print(f"  - [{e['id']}] {e['title']} (grade {e['gradeLevel']})")

# 2. 生成结构
print("\n=== POST /essays/structure ===")
struct = post("/essays/structure", {
    "title": "我最喜欢的一个地方",
    "content": "请说说你最喜欢的一个地方。可以是一个公园、一个房间，或者任何你觉得特别的地方。",
    "gradeLevel": 2,
})
if "sections" in struct:
    for s in struct["sections"]:
        print(f"  - {s['label']}: {s['guide']}")
    print(f"  ✓ 生成 {len(struct['sections'])} 个段落")
else:
    print(f"  ✗ 失败: {struct}")

# 3. 请求提示
print("\n=== POST /essays/hint ===")
hint = post("/essays/hint", {
    "title": "我最喜欢的一个地方",
    "content": "请说说你最喜欢的一个地方。",
    "sectionLabel": "开头",
    "sectionGuide": "说说这个地方的名字和位置",
    "studentText": "",
    "hintType": "开不了头",
    "stuckDurationMs": 5000,
})
if "hint" in hint:
    print(f"  ✓ 提示: {hint['hint']}")
else:
    print(f"  ✗ 失败: {hint}")

# 4. 评分
print("\n=== POST /essays/score ===")
score = post("/essays/score", {
    "title": "我最喜欢的一个地方",
    "content": "请说说你最喜欢的一个地方。",
    "sections": [
        {"label": "开头", "guide": "介绍这个地方"},
        {"label": "内容", "guide": "说说有什么"},
        {"label": "感受", "guide": "你心里怎么想的"},
    ],
    "sectionTexts": [
        "我最喜欢的地方是我家的阳台。",
        "我家的阳台种了很多花，有红色的、黄色的、紫色的。我每天都会给它们浇水。",
        "我觉得在阳台上看书很开心。",
    ],
    "finalText": "我最喜欢的地方是我家的阳台。我家的阳台种了很多花...",
})
if "feedback" in score:
    print(f"  ✓ 反馈: {score['feedback'][:80]}...")
else:
    print(f"  ✗ 失败: {score}")

# 5. 润饰
print("\n=== POST /essays/format ===")
fmt = post("/essays/format", {
    "sections": [
        {"label": "开头", "guide": "介绍这个地方"},
        {"label": "内容", "guide": "说说有什么"},
        {"label": "感受", "guide": "你心里怎么想的"},
    ],
    "sectionTexts": [
        "我最喜欢的地方是我家的阳台",
        "我家的阳台种了很多花有红色的黄色的紫色的我每天都会给它们浇水",
        "我觉得在阳台上看书很开心",
    ],
})
if "formatted" in fmt:
    print(f"  ✓ 润饰结果: {fmt['formatted'][:80]}...")
else:
    print(f"  ✗ 失败: {fmt}")

print("\n所有端点测试完成！")

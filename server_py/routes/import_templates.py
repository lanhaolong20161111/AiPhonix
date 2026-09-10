"""导入提示词模板下发 API

模板 = 用户复制去自己的 LLM 的提示词（LLM 费用外移模式）。
设计要点（防静态提取，见项目记忆 user-import-pipeline-architecture）：
- L1：模板零打包进客户端 APK，全部在服务端
- L2：客户端按需拉取单个模板（?id=），不一次性下发全部
- 模板只是提示词文本，真正的护城河是客户端本地加工解析器（ImportProcessor）

后续加固（暂未做）：AES-GCM 加密下发 + 服务端存储加密。
"""
import json
import os
import threading
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

router = APIRouter()

_TEMPLATES_PATH = os.path.join("data", "import_templates.json")


class TemplateHandler:
    def __init__(self, data_dir: str):
        self._lock = threading.Lock()
        self._path = os.path.join(data_dir, "import_templates.json")
        self._version = 0
        self._templates: list[dict] = []
        self._by_id: dict[str, dict] = {}
        self._load()

    def _load(self):
        if not os.path.exists(self._path):
            self._templates = []
            self._by_id = {}
            return
        try:
            with open(self._path, encoding="utf-8") as f:
                data = json.load(f)
            items = data.get("templates", []) if isinstance(data, dict) else data
            self._version = data.get("version", 0) if isinstance(data, dict) else 0
            self._templates = items
            self._by_id = {t.get("id"): t for t in items if t.get("id")}
        except Exception:
            self._templates = []
            self._by_id = {}

    def get_all(self) -> list[dict]:
        with self._lock:
            return list(self._templates)

    def get_one(self, template_id: str) -> Optional[dict]:
        with self._lock:
            return self._by_id.get(template_id)

    def version(self) -> int:
        with self._lock:
            return self._version


handler: Optional[TemplateHandler] = None


def init(data_dir: str = "data"):
    global handler
    handler = TemplateHandler(data_dir)


@router.get("/import-templates")
async def get_import_templates(
    id: Optional[str] = Query(None, description="模板 id；不传则返回全部"),
):
    """获取导入提示词模板列表（或单个模板）"""
    if handler is None:
        init()
    if handler is None:
        raise HTTPException(status_code=500, detail="模板模块未初始化")
    if id:
        tpl = handler.get_one(id)
        if not tpl:
            return {"status": "not_found", "template": None}
        return {"status": "ok", "version": handler.version(), "template": tpl}
    return {"status": "ok", "version": handler.version(), "templates": handler.get_all()}

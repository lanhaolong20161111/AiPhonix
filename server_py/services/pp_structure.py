"""PaddleOCR AI Studio PP-StructureV3 外部 API — 官方 jobs 接口封装

提交图片 → 轮询任务状态 → 完成后下载 jsonl 结果，返回页面排版信息。
用于复杂版面（表格/方格/序号/特殊符号/多栏）识别的 PP-StructureV3 通道。

官方示例：https://paddleocr.aistudio-app.com 的 PP-StructureV3 页面
接口：POST {job_url} 提交 → GET {job_url}/{jobId} 轮询 → GET resultUrl.jsonUrl 下载结果
结果 JSONL 每行：{"result": {"layoutParsingResults": [{"markdown": {"text": ...}}]}}
"""

import asyncio
import json
import logging
import os
import time

import httpx

from config import PPStructureConfig

logger = logging.getLogger(__name__)

# 轮询停止判断的等待上限（单位：轮询次数内）
MAX_POLLS = 60


class PPStructureError(RuntimeError):
    """PP-StructureV3 调用失败"""


class PPStructureService:
    def __init__(self, config: PPStructureConfig):
        self.config = config

    @property
    def enabled(self) -> bool:
        return bool(self.config.token)

    async def _submit(self, client: httpx.AsyncClient, image_path: str) -> str:
        """提交任务，返回 jobId"""
        headers = {"Authorization": f"bearer {self.config.token}"}
        optional = {
            "useDocOrientationClassify": False,
            "useDocUnwarping": False,
            "useChartRecognition": False,
        }
        data = {
            "model": self.config.model,
            "optionalPayload": json.dumps(optional),
        }
        with open(image_path, "rb") as f:
            files = {"file": (os.path.basename(image_path), f, "application/octet-stream")}
            resp = await client.post(self.config.job_url, headers=headers, data=data, files=files)
        if resp.status_code != 200:
            raise PPStructureError(f"提交失败 HTTP {resp.status_code}: {resp.text[:500]}")
        body = resp.json()
        job_id = (body.get("data") or {}).get("jobId")
        if not job_id:
            raise PPStructureError(f"响应缺少 jobId: {resp.text[:500]}")
        return job_id

    async def _poll(self, client: httpx.AsyncClient, job_id: str) -> str:
        """轮询任务直到 done，返回 jsonl 下载 URL。超时/失败抛异常。"""
        headers = {"Authorization": f"bearer {self.config.token}"}
        deadline = time.monotonic() + self.config.max_wait
        while time.monotonic() < deadline:
            resp = await client.get(f"{self.config.job_url}/{job_id}", headers=headers)
            if resp.status_code != 200:
                raise PPStructureError(f"轮询失败 HTTP {resp.status_code}: {resp.text[:500]}")
            body = resp.json()
            data = body.get("data") or {}
            state = data.get("state", "")
            if state == "done":
                url = ((data.get("resultUrl") or {}) or {}).get("jsonUrl", "")
                if not url:
                    raise PPStructureError("任务完成但缺少 resultUrl.jsonUrl")
                return url
            if state == "failed":
                raise PPStructureError(f"任务失败: {data.get('errorMsg', '未知错误')}")
            # pending / running / 其他 → 继续等
            await asyncio.sleep(self.config.poll_interval)
        raise PPStructureError(f"任务超时（>{self.config.max_wait}s）")

    async def _download_jsonl(self, client: httpx.AsyncClient, url: str) -> list[dict]:
        resp = await client.get(url, timeout=self.config.timeout + 30)
        resp.raise_for_status()
        lines: list[dict] = []
        for line in resp.text.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                lines.append(json.loads(line))
            except json.JSONDecodeError:
                logger.warning("PP-Structure 结果行解析失败，跳过: %.120s", line)
        return lines

    async def parse_layout(self, image_path: str) -> list[dict]:
        """识别图片，返回每页的结构信息。

        返回结构：[{"markdown": str, "images": dict, "pruned_result": dict}, ...]
        每页一个元素；pruned_result 含 parsing_res_list（每块 bbox/order/内容）与页面宽高。
        失败抛 PPStructureError。
        """
        if not self.enabled:
            raise PPStructureError("PP-StructureV3 未配置 token")
        timeout = httpx.Timeout(self.config.timeout, connect=15.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            job_id = await self._submit(client, image_path)
            logger.info("PP-StructureV3 任务已提交: job_id=%s", job_id)
            jsonl_url = await self._poll(client, job_id)
            pages = await self._download_jsonl(client, jsonl_url)
        logger.info("PP-StructureV3 识别完成: pages=%d", len(pages))

        out: list[dict] = []
        for page in pages:
            result = page.get("result") or {}
            for res in result.get("layoutParsingResults", []) or []:
                md = (res.get("markdown") or {}) or {}
                text = md.get("text", "") or ""
                entry: dict = {
                    "markdown": text,
                    "images": md.get("images", {}) or {},
                    "pruned_result": res.get("prunedResult") or res.get("pruned_result") or {},
                }
                out.append(entry)
        return out


_service: PPStructureService | None = None


def init(config: PPStructureConfig):
    global _service
    _service = PPStructureService(config)


def get_service() -> PPStructureService:
    global _service
    if _service is None:
        _service = PPStructureService(PPStructureConfig())
    return _service

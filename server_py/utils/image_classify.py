"""图片类型预分类 — 纯图像特征判断（不调 LLM，免费毫秒级）

用于识别前决定走哪条识图通道，最大化效果 + 节省成本：
- screenshot: 是否浏览器/手机截图（含 UI 残留条，需先裁剪）
- table: 是否含表格/多栏复杂版面（需走 PP-StructureV3 等结构识别）
- vertical_text: 是否竖排文字（汉字卡等）
- 手写: 是否手写内容（更强模型）

依赖：PIL / OpenCV（server_py 环境已具备）。
"""

import logging

logger = logging.getLogger(__name__)

# 竖排文字判定：文字连通域高/宽比
VERTICAL_ASPECT = 1.6


class ImageClass:
    """图片分类结果"""

    def __init__(
        self,
        is_screenshot: bool = False,
        has_table: bool = False,
        is_vertical: bool = False,
        is_handwritten: bool = False,
        width: int = 0,
        height: int = 0,
        crop_box: tuple | None = None,
    ):
        self.is_screenshot = is_screenshot
        self.has_table = has_table
        self.is_vertical = is_vertical
        self.is_handwritten = is_handwritten
        self.width = width
        self.height = height
        self.crop_box = crop_box  # (left, top, right, bottom) 需裁剪的区域（去掉截图 UI 条）

    @property
    def complexity(self) -> str:
        """复杂度分级：low（纯文字/字卡）/ medium（多段文字）/ high（表格/复杂版面）"""
        if self.has_table:
            return "high"
        if self.width > 600 or self.height > 600:
            return "medium"
        return "low"

    def to_dict(self) -> dict:
        return {
            "is_screenshot": self.is_screenshot,
            "has_table": self.has_table,
            "is_vertical": self.is_vertical,
            "is_handwritten": self.is_handwritten,
            "width": self.width,
            "height": self.height,
            "crop_box": self.crop_box,
            "complexity": self.complexity,
        }


def classify_image(image_path: str) -> ImageClass:
    """对图片做类型预分类。图像读取失败时返回默认（不裁剪、不检测）。"""
    try:
        from PIL import Image as PILImage
        import cv2
        import numpy as np

        # 1. 读取并获取尺寸
        with PILImage.open(image_path) as opened:
            w, h = opened.size
            rgb = np.array(opened.convert("RGB"))
    except Exception as e:
        logger.warning("图片预分类失败（按默认处理）: %s", e)
        return ImageClass()

    res = ImageClass(width=w, height=h)

    # 2. 截图检测：顶部/底部是否有连续近纯色条（浏览器地址栏/状态栏）
    #    判定：顶部 5% 或底部 5% 行几乎纯色（像素方差极小），且与中间区域差异大
    crop_box = _detect_screenshot_band(rgb)
    if crop_box is not None:
        res.is_screenshot = True
        res.crop_box = crop_box
        # 裁剪后再做后续分析（去除 UI 残留干扰）
        top = crop_box[1]
        bottom = crop_box[3]
        rgb = rgb[top:bottom, :, :]

    # 3. 表格检测：用 Canny 边缘 + Hough 直线，统计长水平/垂直线
    try:
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        res.has_table = _detect_table_lines(gray)
    except Exception as e:
        logger.debug("表格检测跳过: %s", e)

    # 4. 竖排文字检测：灰度图二值化后统计连通域平均宽高比
    try:
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        res.is_vertical = _detect_vertical_text(gray)
    except Exception as e:
        logger.debug("竖排检测跳过: %s", e)

    # 5. 手写检测（简单启发：边缘密度 vs 笔画粗细分布）
    try:
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        res.is_handwritten = _detect_handwriting(gray)
    except Exception as e:
        logger.debug("手写检测跳过: %s", e)

    return res


def _detect_screenshot_band(rgb) -> tuple | None:
    """检测截图顶部/底部的浏览器/状态栏残留条。

    判定：顶部或底部有连续近纯色带（行像素方差极小），且其后内容变化明显。
    覆盖两种截图：
    - 手机状态栏（顶部纯黑/纯白细条）
    - 浏览器地址栏（顶部有色条）
    返回裁剪框 (0, top, w, h)；未检测到返回 None。
    """
    try:
        import numpy as np

        h, w = rgb.shape[:2]
        if h < 50:
            return None

        gray = rgb.mean(axis=2)  # (h, w)

        def is_flat_row(y: int) -> bool:
            return float(np.std(gray[y])) < 8.0

        def scan_flat(start: int, direction: int) -> int:
            """从 start 开始沿 direction(+1下/-1上)扫描连续纯色带，返回带结束索引"""
            y = start
            while 0 <= y < h - 1 and is_flat_row(y):
                y += direction
            return y

        # 顶部：找纯色带
        top_band = int(h * 0.12)  # 最多检查顶部 12%
        if is_flat_row(0):
            top_end = scan_flat(0, 1)
            # 纯色带至少有高度，且其后有明显内容（内容区方差大）
            if top_end >= h * 0.015:
                # 验证带后紧邻内容非纯色（有文字/图形）
                next_start = min(top_end, h - 1)
                if next_start < h - 2 and float(np.std(gray[next_start])) > 15:
                    return (0, top_end, w, h)
                # 若紧邻也 flat，但带本身占比小且后面有大内容 → 也裁剪
                if top_end < h * 0.05 and top_end >= h * 0.015:
                    return (0, top_end, w, h)

        # 底部：找纯色带（状态栏/导航）
        if is_flat_row(h - 1):
            bottom_start = scan_flat(h - 1, -1)
            band_h = h - 1 - bottom_start
            if band_h >= h * 0.015:
                return (0, 0, w, bottom_start + 1)

        return None
    except Exception as e:
        logger.debug("截图带检测异常: %s", e)
        return None


def _detect_table_lines(gray) -> bool:
    """检测水平/垂直长直线数量，判断是否含表格。

    表格特征：多条水平线 + 多条垂直线交叉成网格（如试卷表格/查字典表）。
    用形态学提取长直线（比 Hough 更稳，避免文字笔画边缘误判）。
    要求水平线 ≥4 且垂直线 ≥4，且都形成"多行多列"。
    """
    try:
        import cv2
        import numpy as np

        h, w = gray.shape
        # 二值化
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

        # 水平线：用细长核开运算提取长横线
        horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, w // 20), 1))
        horiz_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horiz_kernel)
        # 垂直线：细长核开运算提取长竖线
        vert_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(20, h // 20)))
        vert_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vert_kernel)

        # 统计长直线条数（连通域数）
        def count_lines(img):
            n, _, stats, _ = cv2.connectedComponentsWithStats(img)
            long = 0
            for i in range(1, n):
                x, y, bw, bh, area = stats[i]
                if bw >= w * 0.5 or bh >= h * 0.3:
                    long += 1
            return long

        n_h = count_lines(horiz_lines)
        n_v = count_lines(vert_lines)
        # 表格：多行多列（>=3 水平 + >=3 垂直）；字卡/单边框不触发
        return n_h >= 3 and n_v >= 3
    except Exception as e:
        logger.debug("表格线条检测异常: %s", e)
        return False


def _detect_vertical_text(gray) -> bool:
    """检测竖排文字：二值化后文字连通域呈瘦高形状。"""
    try:
        import cv2
        import numpy as np

        # 二值化
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        # 形态学合并相邻笔画
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        binary = cv2.dilate(binary, kernel, iterations=1)
        # 连通域分析
        n, labels, stats, _ = cv2.connectedComponentsWithStats(binary)
        tall_count = 0
        total = 0
        for i in range(1, n):
            x, y, bw, bh, area = stats[i]
            if area < 50:
                continue
            total += 1
            if bh > bw * VERTICAL_ASPECT:
                tall_count += 1
        # 大量瘦高连通域 → 竖排（或单个大字卡）
        return total > 0 and tall_count / total > 0.5
    except Exception as e:
        logger.debug("竖排检测异常: %s", e)
        return False


def _detect_handwriting(gray) -> bool:
    """简单手写启发：边缘密度高 + 笔画较粗（手写笔画不均匀）。

    用 Canny 边缘占比粗略判断；印刷体边缘规整，手写边缘密度偏高。
    """
    try:
        import cv2
        import numpy as np

        edges = cv2.Canny(gray, 40, 120)
        density = float(np.count_nonzero(edges)) / edges.size
        # 手写/低质量拍照通常边缘密度 > 0.1；印刷清晰图通常 < 0.08
        return density > 0.10
    except Exception as e:
        logger.debug("手写检测异常: %s", e)
        return False


def crop_to_box(image_path: str, crop_box: tuple) -> str:
    """按裁剪框裁出页面内容区域，返回新路径（用于截图去 UI 残留）。"""
    try:
        from PIL import Image as PILImage
        import os

        with PILImage.open(image_path) as opened:
            left, top, right, bottom = crop_box
            cropped = opened.crop((left, top, right, bottom))
            if cropped.mode in ("RGBA", "LA", "P"):
                cropped = cropped.convert("RGB")
            out = os.path.join(
                os.path.dirname(image_path),
                os.path.splitext(os.path.basename(image_path))[0] + ".crop.jpg",
            )
            cropped.save(out, "JPEG", quality=90)
            return out
    except Exception as e:
        logger.warning("裁剪失败，使用原图: %s", e)
        return image_path

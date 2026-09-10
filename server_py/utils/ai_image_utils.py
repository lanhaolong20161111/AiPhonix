"""AiPhonix 图片处理工具（从胖路由拆分出来的自包含函数）。

这些函数只依赖标准库/PIL，不依赖路由模块的全局变量，可被多个路由复用。
"""

import logging

logger = logging.getLogger(__name__)


def auto_orient(image_path: str) -> str:
    """EXIF 方向自动校正：按照片 Orientation 标签旋转像素，让图始终"正向"。

    手机（尤其 iPhone）拍/导出的图常以旋转后的像素存储、靠 EXIF 指示正确方向，
    若不做校正，识图/区域切割会把图当横置/倒置，导致上下方向错乱、切块错位。
    凡是保存的输入图都应在识别前过一遍这里。原地覆盖保存同路径。
    """
    try:
        from PIL import Image as PILImage, ImageOps
        import os
        with PILImage.open(image_path) as im:
            im = ImageOps.exif_transpose(im)
            if "exif" in im.info:
                im.info.pop("exif", None)
            # 统一转 RGB 后保存为 JPEG；若原后缀是 .png 等与 JPEG 冲突会写出 0 字节损坏文件，
            # 因此这里把输出路径强制改为 .jpg 后缀，避免格式/后缀不匹配
            base, _ = os.path.splitext(image_path)
            out_path = base + ".jpg"
            if im.mode in ("RGBA", "LA", "P"):
                im = im.convert("RGB")
            im.save(out_path, "JPEG", quality=92)
        return out_path
    except Exception as e:
        logger.warning("图片 EXIF 方向校正跳过: %s", e)
        return image_path


def compress_image(image_path: str, img_max_edge: int, img_quality: int, image_dir: str) -> str:
    """等比压缩图片到最长边 img_max_edge（JPEG），返回新路径；失败返回原路径。

    image_dir：压缩图保存目录；输出文件名为 <原名>.compressed.jpg。
    """
    try:
        import os
        from PIL import Image as PILImage

        with PILImage.open(image_path) as opened:
            im = opened.convert("RGB")
            im.thumbnail((img_max_edge, img_max_edge), PILImage.Resampling.LANCZOS)
            out = os.path.join(
                image_dir,
                os.path.splitext(os.path.basename(image_path))[0] + ".compressed.jpg",
            )
            im.save(out, "JPEG", quality=img_quality)
            return out
    except Exception as e:
        logger.warning("图片压缩失败，使用原图: %s", e)
        return image_path

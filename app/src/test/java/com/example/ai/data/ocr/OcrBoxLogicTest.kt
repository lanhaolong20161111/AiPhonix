package com.example.ai.data.ocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * OCR 框选引擎单测。**期望值全部来自把 web 源码原样复制到 node 跑的探针**
 * （`web/_ocrpick_probe.mjs`，一次性，已删），不是按语义推导 —— 这一层专门用来钉住
 * 「画新框 / 调整已有框」两套不同门槛、吸附的严格大于 + 首个胜出、把手命中半径这些
 * 单看代码很容易写错、写错了又看不出错的地方。
 */
class OcrBoxLogicTest {

    private fun rect(x: Float, y: Float, w: Float, h: Float) = PickRect(x, y, w, h)

    // ───────────────────────── handlePoints ─────────────────────────

    @Test
    fun `八个把手的位置与顺序与 web handlePoints 一致`() {
        val pts = OcrBoxLogic.handlePoints(rect(10f, 20f, 100f, 50f))
        assertEquals(OcrBoxLogic.HANDLE_NAMES, pts.map { it.name })
        val expect = mapOf(
            "nw" to (10f to 20f),
            "n" to (60f to 20f),
            "ne" to (110f to 20f),
            "e" to (110f to 45f),
            "se" to (110f to 70f),
            "s" to (60f to 70f),
            "sw" to (10f to 70f),
            "w" to (10f to 45f),
        )
        for (p in pts) {
            val (ex, ey) = expect.getValue(p.name)
            assertEquals("handle ${p.name} x", ex, p.x, 1e-4f)
            assertEquals("handle ${p.name} y", ey, p.y, 1e-4f)
        }
    }

    // ───────────────────────── intersectRatio / snapRect ─────────────────────────

    @Test
    fun `吸附比例与 web intersectRatio 一致`() {
        val b = rect(0f, 0f, 100f, 20f)
        assertEquals(1f, OcrBoxLogic.intersectRatio(rect(0f, 0f, 100f, 20f), b), 1e-6f)
        assertEquals(0.5f, OcrBoxLogic.intersectRatio(rect(50f, 0f, 100f, 20f), b), 1e-6f)
        // 零面积 → 0（web 显式判 area<=0 || userArea<=0）
        assertEquals(0f, OcrBoxLogic.intersectRatio(rect(0f, 0f, 0f, 0f), b), 1e-6f)
        // 完全不相交 → 0
        assertEquals(0f, OcrBoxLogic.intersectRatio(rect(200f, 200f, 10f, 10f), b), 1e-6f)
    }

    @Test
    fun `吸附要求占比严格大于 0_35 且按文字行顺序首个胜出`() {
        val blocks = listOf(
            rect(10f, 10f, 100f, 20f),
            rect(10f, 40f, 100f, 20f),
            rect(10f, 200f, 60f, 30f),
        )
        // 基本落在第一行
        assertEquals(blocks[0], OcrBoxLogic.snapRect(rect(12f, 12f, 96f, 16f), blocks))
        // 第二行
        assertEquals(blocks[1], OcrBoxLogic.snapRect(rect(12f, 41f, 96f, 18f), blocks))
        // 谁都不沾（占比都不足 0.35）
        assertNull(OcrBoxLogic.snapRect(rect(12f, 100f, 96f, 18f), blocks))
        // ★ 同时压住前两行：比例都是 0.4 > 0.35 ⇒ **第一个**（不是"最大的"）胜出
        assertEquals(blocks[0], OcrBoxLogic.snapRect(rect(10f, 10f, 100f, 50f), blocks))
        // 大框套小行：占比都很小 ⇒ 不吸附（证明不是"包住就吸"）
        assertNull(OcrBoxLogic.snapRect(rect(0f, 0f, 200f, 200f), blocks))
        // 小框完全落在第一行内 ⇒ 占比 1
        assertEquals(blocks[0], OcrBoxLogic.snapRect(rect(12f, 12f, 20f, 12f), blocks))
        // 高为 0 的退化框 ⇒ 占比 0 ⇒ 不吸附
        assertNull(OcrBoxLogic.snapRect(rect(12f, 12f, 96f, 0f), blocks))
        // 没有文字行 ⇒ 恒 null
        assertNull(OcrBoxLogic.snapRect(rect(12f, 12f, 96f, 16f), emptyList()))
    }

    // ───────────────────────── hitCrop ─────────────────────────

    private fun hitFixture() = listOf(
        OcrCrop(1, rect(100f, 100f, 80f, 40f)),
        // 与 1 重叠：后画的压住先画的 ⇒ 从后往前遍历先命中 2
        OcrCrop(2, rect(101f, 101f, 80f, 40f)),
        // 太小（边长 < 8）⇒ 应被整框跳过
        OcrCrop(3, rect(300f, 300f, 4f, 4f)),
    )

    private fun hit(x: Float, y: Float) = OcrBoxLogic.hitCrop(x, y, hitFixture())

    @Test
    fun `几何命中先查把手再查内部且从后往前遍历`() {
        // 四个角 / 四条边中点都命中 #2 的对应把手
        assertEquals("nw", (hit(100f, 100f) as OcrBoxLogic.Hit.Resize).handle)
        assertEquals(2, (hit(100f, 100f) as OcrBoxLogic.Hit.Resize).cropKey)
        assertEquals("w", (hit(100f, 120f) as OcrBoxLogic.Hit.Resize).handle)
        assertEquals("n", (hit(140f, 100f) as OcrBoxLogic.Hit.Resize).handle)
        assertEquals("e", (hit(180f, 120f) as OcrBoxLogic.Hit.Resize).handle)
        assertEquals("s", (hit(140f, 140f) as OcrBoxLogic.Hit.Resize).handle)
        // 把手半径 18：距离 7.07 / 9.06 都算命中；距离 19.03 / 21.02 不算
        assertEquals("nw", (hit(106f, 106f) as OcrBoxLogic.Hit.Resize).handle)
        assertEquals("nw", (hit(107f, 107f) as OcrBoxLogic.Hit.Resize).handle)
        assertEquals("n", (hit(140f, 110f) as OcrBoxLogic.Hit.Resize).handle)
        // (118,107) 落在 #2 内部窄带（y 恰好等于 101+6，严格不等式不成立）⇒ 继续往外找到 #1
        assertEquals(1, (hit(118f, 107f) as OcrBoxLogic.Hit.Move).cropKey)
        // 内部命中 #2
        assertEquals(2, (hit(140f, 120f) as OcrBoxLogic.Hit.Move).cropKey)
        assertEquals(2, (hit(118f, 133f) as OcrBoxLogic.Hit.Move).cropKey)
        // ★ (118,118) 离 #2 的 w 把手只有 17.26 ≤ 18 ⇒ 判成缩放而不是内部平移
        assertEquals("w", (hit(118f, 118f) as OcrBoxLogic.Hit.Resize).handle)
        // 太小的框被跳过（否则 (300,300) 会命中 #3 的 nw）
        assertNull(hit(300f, 300f))
        assertNull(hit(500f, 500f))
    }

    // ───────────────────────── resizeRect ─────────────────────────

    @Test
    fun `缩放按把手方向改边且永不翻转`() {
        val orig = rect(100f, 200f, 80f, 40f)
        val sx = 140f
        val sy = 220f
        fun r(handle: String, cx: Float, cy: Float) = OcrBoxLogic.resizeRect(handle, sx, sy, cx, cy, orig)

        val cases = listOf(
            Triple("nw", 120f to 200f, rect(80f, 180f, 100f, 60f)),
            Triple("nw", 160f to 240f, rect(120f, 220f, 60f, 20f)),
            Triple("n", 140f to 200f, rect(100f, 180f, 80f, 60f)),
            Triple("n", 140f to 260f, rect(100f, 230f, 80f, 10f)),
            Triple("ne", 180f to 200f, rect(100f, 180f, 120f, 60f)),
            Triple("ne", 120f to 230f, rect(100f, 210f, 60f, 30f)),
            Triple("e", 200f to 220f, rect(100f, 200f, 140f, 40f)),
            Triple("e", 100f to 220f, rect(100f, 200f, 40f, 40f)),
            Triple("se", 200f to 260f, rect(100f, 200f, 140f, 80f)),
            Triple("se", 130f to 210f, rect(100f, 200f, 70f, 30f)),
            Triple("s", 140f to 300f, rect(100f, 200f, 80f, 120f)),
            Triple("s", 140f to 150f, rect(100f, 200f, 80f, 10f)),
            Triple("sw", 90f to 260f, rect(50f, 200f, 130f, 80f)),
            Triple("sw", 160f to 200f, rect(120f, 200f, 60f, 20f)),
            Triple("w", 90f to 220f, rect(50f, 200f, 130f, 40f)),
            Triple("w", 190f to 220f, rect(150f, 200f, 30f, 40f)),
            // 拉到极端方向：被「另一边 − 10」/「max(边长+d, 10)」兜住，仍不翻转
            Triple("w", 9999f to 220f, rect(170f, 200f, 10f, 40f)),
            Triple("e", -9999f to 220f, rect(100f, 200f, 10f, 40f)),
            Triple("n", 140f to 9999f, rect(100f, 230f, 80f, 10f)),
            Triple("s", 140f to -9999f, rect(100f, 200f, 80f, 10f)),
        )
        for ((handle, cur, expect) in cases) {
            assertEquals("handle=$handle cur=$cur", expect, r(handle, cur.first, cur.second))
        }
    }

    @Test
    fun `平移只改左上角且尺寸不变`() {
        val orig = rect(100f, 200f, 80f, 40f)
        assertEquals(rect(120f, 190f, 80f, 40f), OcrBoxLogic.moveRect(orig, 20f, -10f))
        // 允许移出画面（web 靠指针本身被 clamp 在容器内兜底，这里不额外裁）
        assertEquals(rect(-10f, 150f, 80f, 40f), OcrBoxLogic.moveRect(orig, -110f, -50f))
    }

    // ───────────────────────── 成框 / 调整的两套门槛 ─────────────────────────

    @Test
    fun `画新框起止点归一化并给出正的宽高`() {
        assertEquals(rect(100f, 200f, 100f, 100f), OcrBoxLogic.drawRect(200f, 300f, 100f, 200f))
        assertEquals(rect(100f, 200f, 8f, 8f), OcrBoxLogic.drawRect(100f, 200f, 108f, 208f))
        // 反向拖拽（从右下往左上）结果相同
        assertEquals(rect(100f, 200f, 100f, 100f), OcrBoxLogic.drawRect(100f, 200f, 200f, 300f))
    }

    @Test
    fun `成框门槛是严格大于 8 而调整门槛是大于等于 8`() {
        // 新框：8x8 不成框（web `r.w > 8 && r.h > 8`）
        assertFalse(OcrBoxLogic.isDrawAccepted(rect(0f, 0f, 8f, 8f)))
        assertFalse(OcrBoxLogic.isDrawAccepted(rect(0f, 0f, 9f, 8f)))   // 高不够
        assertTrue(OcrBoxLogic.isDrawAccepted(rect(0f, 0f, 9f, 9f)))
        assertTrue(OcrBoxLogic.isDrawAccepted(rect(0f, 0f, 100f, 100f)))

        // 调整已有框：8x8 成立（web `!(r.w < 8 || r.h < 8)`）
        assertFalse(OcrBoxLogic.isAdjustAccepted(rect(0f, 0f, 7f, 40f)))
        assertTrue(OcrBoxLogic.isAdjustAccepted(rect(0f, 0f, 8f, 8f)))
        assertTrue(OcrBoxLogic.isAdjustAccepted(rect(0f, 0f, 9f, 40f)))

        // 吸附门槛比成框更低：2x2 以上就尝试吸附
        assertFalse(OcrBoxLogic.allowsSnap(rect(0f, 0f, 8f, 0f)))
        assertTrue(OcrBoxLogic.allowsSnap(rect(0f, 0f, 8f, 8f)))

        // 两套门槛在 8 边界上确实不同 —— 这是最容易写错的地方
        assertTrue(OcrBoxLogic.isAdjustAccepted(rect(0f, 0f, 8f, 8f)))
        assertFalse(OcrBoxLogic.isDrawAccepted(rect(0f, 0f, 8f, 8f)))
    }

    @Test
    fun `调整后的变化判定阈值是 1 像素`() {
        val orig = rect(100f, 200f, 80f, 40f)
        assertFalse(OcrBoxLogic.isChanged(orig, rect(100f, 200f, 80f, 40f)))
        assertTrue(OcrBoxLogic.isChanged(orig, rect(102f, 200f, 80f, 40f)))
        assertTrue(OcrBoxLogic.isChanged(orig, rect(101.5f, 201.5f, 81.5f, 41.5f)))
        // 恰好 1 像素不算变化（严格大于 1）
        assertFalse(OcrBoxLogic.isChanged(orig, rect(101f, 200f, 80f, 40f)))
    }

    // ───────────────────────── 显示坐标 → 原图像素 ─────────────────────────

    @Test
    fun `显示坐标换算成原图像素与 web recognizeRect 一致`() {
        fun check(r: PickRect, dw: Float, dh: Float, iw: Int, ih: Int, ex: Int, ey: Int, ew: Int, eh: Int, ok: Boolean) {
            val got = OcrBoxLogic.toCropPx(r, dw, dh, iw, ih)
            assertEquals("sx of $r", ex, got.x)
            assertEquals("sy of $r", ey, got.y)
            assertEquals("sw of $r", ew, got.w)
            assertEquals("sh of $r", eh, got.h)
            assertEquals("ok of $r", ok, got.ok)
        }
        check(rect(20f, 40f, 60f, 25f), 100f, 200f, 3024, 4032, 605, 806, 1814, 504, true)
        check(rect(80f, 180f, 40f, 30f), 100f, 200f, 3024, 4032, 2419, 3629, 605, 403, true)
        check(rect(90f, 190f, 40f, 30f), 100f, 200f, 3024, 4032, 2722, 3830, 302, 202, true)
        check(rect(0f, 0f, 88f, 88f), 100f, 200f, 3024, 4032, 0, 0, 2661, 1774, true)
        // 框拉到图外 → 宽高被夹小到 4 以下 ⇒ 判失败（web 报「框选区域太小」）
        check(rect(99.9f, 199.9f, 5f, 5f), 100f, 200f, 3024, 4032, 3021, 4030, 3, 2, false)
        check(rect(20f, 40f, 0f, 25f), 100f, 200f, 3024, 4032, 605, 806, 0, 504, false)
        check(rect(20f, 40f, 60f, 0.1f), 100f, 200f, 3024, 4032, 605, 806, 1814, 2, false)
        // 另一组比例（160x320 的小图，缩放比 1.6 / 3.2）
        check(rect(1f, 1f, 8f, 8f), 100f, 100f, 160, 320, 2, 3, 13, 26, true)
    }

    @Test
    fun `换算的尺寸参数非法时直接判失败`() {
        val r = rect(10f, 10f, 50f, 50f)
        assertFalse(OcrBoxLogic.toCropPx(r, 0f, 200f, 100, 100).ok)
        assertFalse(OcrBoxLogic.toCropPx(r, 100f, 0f, 100, 100).ok)
        assertFalse(OcrBoxLogic.toCropPx(r, 100f, 100f, 0, 100).ok)
        assertFalse(OcrBoxLogic.toCropPx(r, 100f, 100f, 100, 0).ok)
    }

    // ───────────────────────── 文本拼接 ─────────────────────────

    @Test
    fun `结果文本按框顺序换行拼接并跳过空框`() {
        val crops = listOf(
            OcrCrop(1, rect(0f, 0f, 10f, 10f), CropStatus.DONE, " 第一行 "),
            OcrCrop(2, rect(0f, 0f, 10f, 10f), CropStatus.PENDING, ""),
            OcrCrop(3, rect(0f, 0f, 10f, 10f), CropStatus.DONE, "第二行"),
            OcrCrop(4, rect(0f, 0f, 10f, 10f), CropStatus.DONE, "  "),
        )
        assertEquals("第一行\n第二行", OcrBoxLogic.combineCropTexts(crops))
        assertEquals("", OcrBoxLogic.combineCropTexts(emptyList()))
    }

    @Test
    fun `多图拼接练字用单空格练词练句用真换行`() {
        // ★ 按 web **意图**实现：web 源码里 `/\\s+/` 与 `join("\\n")` 是双反斜杠（真 bug），
        //   多图导入词/句会插入字面 `\n`。Android 按真实空白集切分 + 真换行连接。
        assertEquals("日 月 水 火", OcrBoxLogic.joinOcrTexts(OcrJoinMode.SPACE_SEPARATED, listOf("", "日 月", "水 火")))
        assertEquals("日 月", OcrBoxLogic.joinOcrTexts(OcrJoinMode.SPACE_SEPARATED, listOf("", "日 月")))
        assertEquals("已有内容 新的 内容", OcrBoxLogic.joinOcrTexts(OcrJoinMode.SPACE_SEPARATED, listOf("已有内容", "新的 内容")))
        // 全角空格 U+3000 也要被切开（JS 空白集；Kotlin 默认 `\s` 不认）
        assertEquals("日 月 水", OcrBoxLogic.joinOcrTexts(OcrJoinMode.SPACE_SEPARATED, listOf("", "日\u3000月 水")))
        // 换行连接用真换行（与 web 的字面 `\n` 不同）
        assertEquals("春天 朋友\n认真 仔细", OcrBoxLogic.joinOcrTexts(OcrJoinMode.LINE_SEPARATED, listOf("", "春天 朋友", "认真 仔细")))
        assertEquals("我喜欢。\n你也好？", OcrBoxLogic.joinOcrTexts(OcrJoinMode.LINE_SEPARATED, listOf("", "我喜欢。", "你也好？")))
        // 空白项被丢弃
        assertEquals("", OcrBoxLogic.joinOcrTexts(OcrJoinMode.LINE_SEPARATED, listOf("", "  ", "\n")))
    }

    @Test
    fun `删除按钮就地贴在框内右上角并让开 ne 把手`() {
        val box = rect(100f, 100f, 80f, 40f)
        val del = OcrBoxLogic.deleteButtonRect(box)
        // 完全落在框内（Compose 里超出父边界的子元素收不到手势）
        assertEquals(144f, del.x, 1e-4f)
        assertEquals(102f, del.y, 1e-4f)
        assertEquals(22f, del.w, 1e-4f)
        assertEquals(22f, del.h, 1e-4f)
        assertTrue(del.right <= box.right)
        // 与 ne 把手（180,100）中心距 = hypot(25, -13) ≈ 28.2 > 18 ⇒ 不会误判成缩放
        val neCenter = (del.x + del.w / 2f) to (del.y + del.h / 2f)
        assertTrue(kotlin.math.hypot(neCenter.first - box.right, neCenter.second - box.y) > OcrBoxLogic.HANDLE_HIT)
        // 框很窄时删除按钮不许跑到框左边之外
        val narrow = rect(100f, 100f, 20f, 40f)
        assertEquals(100f, OcrBoxLogic.deleteButtonRect(narrow).x, 1e-4f)
    }

    @Test
    fun `归一化坐标按预览尺寸换成显示坐标`() {        val norm = listOf(OcrNormBlock(PickRect(0.1f, 0.2f, 0.5f, 0.1f), "第一行"))
        val disp = OcrBoxLogic.toDisplay(norm, 200f, 400f)
        assertEquals(1, disp.size)
        assertEquals(20f, disp[0].rect.x, 1e-4f)
        assertEquals(80f, disp[0].rect.y, 1e-4f)
        assertEquals(100f, disp[0].rect.w, 1e-4f)
        assertEquals(40f, disp[0].rect.h, 1e-4f)
        assertEquals("第一行", disp[0].text)
    }

    // ───────────────────────── 状态派生（OcrPickState） ─────────────────────────

    @Test
    fun `面板提示与底部三档文案与 web 一致`() {
        val empty = OcrPickState(open = true)
        assertFalse(empty.canConfirm)
        assertTrue(empty.hintText.endsWith("（未检测到文字行，将保持自由框选。）"))
        assertEquals("还没有可导入的文字，请框选内容并点「开始识别」", empty.footerText)
        assertEquals(0, empty.footerLevel)

        val loading = empty.copy(blocksLoading = true)
        assertTrue(loading.hintText.endsWith(" 正在检测文字行以便自动吸附…"))

        val hasBlocks = empty.copy(blocks = listOf(OcrTextBlock(rect(0f, 0f, 1f, 1f), "行")))
        assertTrue(hasBlocks.hintText.endsWith(" 画新框会自动吸附到最近的文字行（绿框）。"))

        val pending = empty.copy(draft = "已识别的内容", crops = listOf(
            OcrCrop(1, rect(0f, 0f, 9f, 9f), CropStatus.PENDING),
            OcrCrop(2, rect(0f, 0f, 9f, 9f), CropStatus.PENDING),
            OcrCrop(3, rect(0f, 0f, 9f, 9f), CropStatus.DONE, "好"),
        ))
        assertTrue(pending.canConfirm)
        assertEquals("有 2 个区域未识别，将忽略它们、直接导入已识别内容", pending.footerText)
        assertEquals(1, pending.footerLevel)

        val busy = pending.copy(crops = listOf(OcrCrop(1, rect(0f, 0f, 9f, 9f), CropStatus.BUSY)))
        assertEquals("部分区域仍在识别中…将使用已识别内容导入", busy.footerText)
        assertEquals(2, busy.footerLevel)

        val clean = pending.copy(crops = emptyList())
        assertEquals("", clean.footerText)
        assertEquals(3, clean.footerLevel)
    }

    @Test
    fun `框列表的展示文案与编号后缀与 web 一致`() {
        val busy = OcrCrop(1, rect(0f, 0f, 9f, 9f), CropStatus.BUSY)
        assertEquals("⏳ 识别中…", busy.displayText)
        assertEquals("…", busy.badgeSuffix)
        val pend = OcrCrop(1, rect(0f, 0f, 9f, 9f), CropStatus.PENDING)
        assertEquals("⏸ 待识别", pend.displayText)
        assertEquals("⏸", pend.badgeSuffix)
        val err = OcrCrop(1, rect(0f, 0f, 9f, 9f), CropStatus.ERROR, err = "该区域未识别到文字")
        assertEquals("❌ 该区域未识别到文字", err.displayText)
        assertEquals("⚠", err.badgeSuffix)
        val done = OcrCrop(1, rect(0f, 0f, 9f, 9f), CropStatus.DONE, "春天")
        assertEquals("春天", done.displayText)
        assertEquals("✓", done.badgeSuffix)
    }

    @Test
    fun `引擎枚举的展示顺序与未知值回落与 web 一致`() {
        assertEquals(
            listOf(OcrEngine.AUTO, OcrEngine.DOUBAO, OcrEngine.PADDLE),
            OcrEngine.ORDER,
        )
        assertEquals("🤖 自动(默认)", OcrEngine.AUTO.label)
        assertEquals("⚡ 豆包(快)", OcrEngine.DOUBAO.label)
        assertEquals("📐 PaddleOCR(准)", OcrEngine.PADDLE.label)
        assertEquals(OcrEngine.PADDLE, OcrEngine.from("paddle"))
        assertEquals(OcrEngine.AUTO, OcrEngine.from("nonsense"))
        assertEquals(OcrEngine.AUTO, OcrEngine.from(null))
        // AUTO 的 wire 值就是 web localStorage 里存的那个字符串
        assertEquals("auto", OcrEngine.AUTO.wire)
    }
}

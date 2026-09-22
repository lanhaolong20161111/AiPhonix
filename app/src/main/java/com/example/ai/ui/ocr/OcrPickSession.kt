package com.example.ai.ui.ocr

import com.example.ai.data.aichinese.AiChineseRepository
import com.example.ai.data.ocr.CropStatus
import com.example.ai.data.ocr.OcrBoxLogic
import com.example.ai.data.ocr.OcrCrop
import com.example.ai.data.ocr.OcrEngine
import com.example.ai.data.ocr.OcrEngineStore
import com.example.ai.data.ocr.OcrModule
import com.example.ai.data.ocr.OcrPickState
import com.example.ai.data.ocr.OcrPlatform
import com.example.ai.data.ocr.OcrNormBlock
import com.example.ai.data.ocr.PickRect
import com.example.ai.util.stripPinyin
import com.example.ai.util.stripPinyinKeepDelimiters
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 「拍照/相册 → 自由框选 → 识别 → 导入」的**可复用会话状态机**，逐条对齐 web
 * `web/src/components/OcrPickSheet.tsx`。
 *
 * 为什么不是 ViewModel 而是普通状态持有者（`AGENTS.md` 明确允许）：
 * 每日语文 / 每日英语 / AI 英语对话三处都要用同一套框选面板，但**各自的"导入到哪个字段"
 * 不同** —— 那部分留在各自的 ViewModel 里；这里只负责「一张图的一次框选识别会话」。
 * 生命周期由调用方的 `viewModelScope` 决定，导入回调 [onImport] 由调用方注入。
 *
 * ★ 与 UI 的分工：**拖拽的几何计算（命中/缩放/平移/吸附）全在这里**，composable 只负责
 * 把指针坐标原样转进来（`onPointerDown/Move/Up`）与按状态渲染。这样做是为了避开 Compose
 * 的老坑：手势回调 `pointerInput` 的 lambda 不会随重组更新，闭包里读到的会是**过期的状态**。
 *
 * ★ 与 web 一致的三条关键时序：
 * 1. 框选/调整**不自动识别**，必须点「开始识别」才把所有 `PENDING` 的框一起送出去；
 * 2. 调整已有框会把该框**打回 `PENDING` 并清空文本**（否则会拿旧文字冒充新框的结果）；
 * 3. 底部可编辑文本只在**识别结果拼接串变化时**被覆盖 —— 用户手改的内容在"没有新识别结果"
 *    时不会被冲掉（web 用 `useEffect(deps=[resultText])` 达到同样效果）。
 */
class OcrPickSession(
    private val repository: AiChineseRepository,
    private val platform: OcrPlatform?,
    private val engineStore: OcrEngineStore?,
    private val scope: CoroutineScope,
    /** 点「✓ 导入」时回调，参数是编辑后的纯文本；多图排队等业务逻辑由调用方处理 */
    private val onImport: (String) -> Unit,
) {

    private val _state = MutableStateFlow(OcrPickState())
    val state: StateFlow<OcrPickState> = _state.asStateFlow()

    /** 规范图（显示 + 裁剪同源）。**故意不在 close 时 recycle**：位图可能还在同一帧被绘制，
     *  立刻回收会触发 "trying to use a recycled bitmap"；改为下次 [start] 时回收上一张，
     *  以及 [release] 时回收。 */
    private var canonical: OcrPlatform.Canonical? = null

    /**
     * 给 UI 显示的规范图。用 Compose 的 `mutableStateOf` 暴露，面板才会在换图时重组
     * （`OcrPickState` 刻意不含 `Bitmap`，那个文件保持纯数据、不引 Android API）。
     */
    var image: android.graphics.Bitmap? by mutableStateOf(null)
        private set

    /** 下一个框的编号（web `keyRef`，从 1 开始） */
    private var keySeq = 1

    /** 当前拖拽会话（web `editRef` + `rectRef`） */
    private var drag: DragSession? = null

    /** 检测到的文字行（归一化坐标，随预览尺寸换算成显示坐标） */
    private var normBlocks: List<OcrNormBlock> = emptyList()

    private var detectJob: Job? = null

    /** 上一次「按框顺序拼接」的结果，用来判断 draft 该不该被覆盖（web 的 resultText） */
    private var lastCombined = ""

    private sealed interface DragSession {
        data class Draw(val startX: Float, val startY: Float) : DragSession
        data class Move(val key: Int, val orig: PickRect, val startX: Float, val startY: Float) : DragSession
        data class Resize(val key: Int, val orig: PickRect, val handle: String, val startX: Float, val startY: Float) : DragSession
        /** Android 特有的"点中删除按钮"（web 是独立按钮 + stopPropagation） */
        data class Delete(val key: Int) : DragSession
    }

    // ───────────────────────── 会话生命周期 ─────────────────────────

    /**
     * 开一次框选会话（web `OcrPickSheet` 挂载 + `useEffect([file])`）。
     *
     * 先解码出规范图（EXIF 转正 + ≤1600px + JPEG），拿到真实像素尺寸后再去检测文字行。
     */
    fun start(
        bytes: ByteArray,
        title: String,
        module: OcrModule = OcrModule.CHINESE,
        stripPinyin: Boolean = false,
        spaceChars: Boolean = false,
    ) {
        val p = platform
        canonical?.bitmap?.let { if (!it.isRecycled) it.recycle() }
        canonical = null
        image = null
        drag = null
        detectJob?.cancel()
        normBlocks = emptyList()
        keySeq = 1
        lastCombined = ""

        if (p == null) {
            _state.value = OcrPickState(open = true, title = title, error = "当前环境不支持图片处理")
            return
        }
        _state.value = OcrPickState(
            open = true,
            title = title,
            module = module,
            engine = engineStore?.read() ?: OcrEngine.AUTO,
            stripPinyin = stripPinyin,
            spaceChars = spaceChars,
            starting = true,
            blocksLoading = true,
        )
        scope.launch {
            val c = p.canonicalize(bytes)
            if (c == null) {
                if (!_state.value.open) return@launch
                _state.value = _state.value.copy(starting = false, blocksLoading = false, error = "图片读取失败，请换一张更清晰的照片试试")
                return@launch
            }
            if (!_state.value.open) {
                c.bitmap.recycle()
                return@launch
            }
            canonical = c
            image = c.bitmap
            _state.value = _state.value.copy(imageW = c.width, imageH = c.height, starting = false)
            detectBlocks()
        }
    }

    /** 关闭面板（web `onClose`）。不回收规范图（可能仍在绘制），只清空会话状态。 */
    fun close() {
        drag = null
        detectJob?.cancel()
        _state.value = OcrPickState()
    }

    /** 页面销毁时调用（VM `onCleared`），真正回收规范图 */
    fun release() {
        close()
        image = null
        canonical?.bitmap?.let { if (!it.isRecycled) it.recycle() }
        canonical = null
    }

    /** 切换识别模型 —— 立即落盘（web 的 zustand store 持久化），只影响下一次「开始识别」 */
    fun setEngine(engine: OcrEngine) {
        engineStore?.write(engine)
        _state.value = _state.value.copy(engine = engine)
    }

    fun onDraftChange(text: String) {
        _state.value = _state.value.copy(draft = text)
    }

    /** 预览区尺寸（composable `onSizeChanged` 回传）—— 文字行要从归一化坐标换算成显示坐标 */
    fun onStageSize(width: Float, height: Float) {
        if (width <= 0f || height <= 0f) return
        val s = _state.value
        if (s.stageW == width && s.stageH == height) return
        _state.value = s.copy(stageW = width, stageH = height)
        recomputeBlocks()
    }

    // ───────────────────────── 指针事件（几何全在这） ─────────────────────────

    fun onPointerDown(x: Float, y: Float) {
        val s = _state.value
        // 删除按钮优先（web 的 ✕ 是真按钮，pointerdown 会 stopPropagation）
        val delKey = s.crops.lastOrNull { OcrBoxLogic.deleteButtonRect(it.rect).contains(x, y) }?.key
        if (delKey != null) {
            drag = DragSession.Delete(delKey)
            _state.value = s.copy(currentRect = null, snapTo = null)
            return
        }
        val hit = OcrBoxLogic.hitCrop(x, y, s.crops)
        when (hit) {
            is OcrBoxLogic.Hit.Resize -> {
                val c = s.crops.firstOrNull { it.key == hit.cropKey } ?: return
                drag = DragSession.Resize(hit.cropKey, c.rect, hit.handle, x, y)
                _state.value = s.copy(currentRect = null, snapTo = null)
            }
            is OcrBoxLogic.Hit.Move -> {
                val c = s.crops.firstOrNull { it.key == hit.cropKey } ?: return
                drag = DragSession.Move(hit.cropKey, c.rect, x, y)
                _state.value = s.copy(currentRect = null, snapTo = null)
            }
            null -> {
                // 画新框：web 立刻把 currentRect 置成零尺寸框
                drag = DragSession.Draw(x, y)
                _state.value = s.copy(currentRect = PickRect(x, y, 0f, 0f), snapTo = null)
            }
        }
    }

    fun onPointerMove(x: Float, y: Float) {
        when (val d = drag) {
            is DragSession.Resize -> {
                val r = OcrBoxLogic.resizeRect(d.handle, d.startX, d.startY, x, y, d.orig)
                _state.value = _state.value.copy(currentRect = r, snapTo = null)
            }
            is DragSession.Move -> {
                val r = OcrBoxLogic.moveRect(d.orig, x - d.startX, y - d.startY)
                _state.value = _state.value.copy(currentRect = r, snapTo = null)
            }
            is DragSession.Draw -> {
                val r = OcrBoxLogic.drawRect(d.startX, d.startY, x, y)
                // 吸附**只**在画新框时生效，且门槛是 w>2 && h>2
                val snapped = if (OcrBoxLogic.allowsSnap(r)) {
                    OcrBoxLogic.snapRect(r, _state.value.blocks.map { it.rect })
                } else {
                    null
                }
                _state.value = _state.value.copy(currentRect = snapped ?: r, snapTo = snapped)
            }
            is DragSession.Delete, null -> Unit
        }
    }

    fun onPointerUp() {
        val d = drag ?: return
        drag = null
        val cur = _state.value.currentRect
        _state.value = _state.value.copy(currentRect = null, snapTo = null)
        when (d) {
            is DragSession.Delete -> removeCrop(d.key)
            is DragSession.Draw -> {
                if (cur != null && OcrBoxLogic.isDrawAccepted(cur)) {
                    val key = keySeq++
                    withCrops(_state.value.crops + OcrCrop(key, cur, CropStatus.PENDING))
                }
            }
            is DragSession.Move -> applyAdjust(d.key, d.orig, cur)
            is DragSession.Resize -> applyAdjust(d.key, d.orig, cur)
        }
    }

    /** 调整已有框：**门槛是 `>= 8`（与画新框的 `> 8` 不同）**，再有变化才打回待识别并清空文本 */
    private fun applyAdjust(key: Int, orig: PickRect, r: PickRect?) {
        if (r == null) return
        if (!OcrBoxLogic.isAdjustAccepted(r)) return
        if (!OcrBoxLogic.isChanged(orig, r)) return
        withCrops(
            _state.value.crops.map {
                if (it.key == key) it.copy(rect = r, status = CropStatus.PENDING, text = "", err = "") else it
            },
        )
    }

    fun removeCrop(key: Int) {
        withCrops(_state.value.crops.filter { it.key != key })
    }

    fun clearCrops() {
        withCrops(emptyList())
    }

    // ───────────────────────── 识别 ─────────────────────────

    /** 点「⚡ 开始识别」：一次性把所有待识别的框送去识别（web `confirmRecognition`） */
    fun recognizePending() {
        val toDo = _state.value.crops.filter { it.status == CropStatus.PENDING }
        if (toDo.isEmpty()) return
        _state.value = _state.value.copy(
            crops = _state.value.crops.map {
                if (it.status == CropStatus.PENDING) it.copy(status = CropStatus.BUSY, err = "") else it
            },
            error = "",
        )
        for (c in toDo) recognizeCrop(c.key, c.rect)
    }

    private fun recognizeCrop(key: Int, rect: PickRect) {
        val s = _state.value
        val c = canonical
        fun fail(msg: String) {
            if (!_state.value.open) return
            withCrops(_state.value.crops.map { if (it.key == key) it.copy(status = CropStatus.ERROR, err = msg) else it })
        }
        val p = platform
        if (c == null || p == null) return fail("图片未就绪")
        if (rect.w < OcrBoxLogic.MIN_BOX_SIDE || rect.h < OcrBoxLogic.MIN_BOX_SIDE) return fail("框选区域无效")
        val px = OcrBoxLogic.toCropPx(rect, s.stageW, s.stageH, c.width, c.height)
        if (!px.ok) return fail("框选区域太小")
        val module = s.module
        val engine = s.engine
        scope.launch {
            val bytes = p.cropToJpeg(c, px.x, px.y, px.w, px.h)
            if (!_state.value.open) return@launch
            if (bytes == null) return@launch fail("裁剪失败，请重试")
            val text = try {
                val res = repository.parseImage(bytes, mode = module.mode, engine = engineQuery(engine))
                // web: (r.text || blocks.map(text).join("\n")).trim()
                val raw = res.text.ifBlank { res.blocks.joinToString("\n") { it.text } }
                clean(raw.trim())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                return@launch fail(e.message ?: "识别失败，请重试")
            }
            if (!_state.value.open) return@launch
            if (text.isEmpty()) return@launch fail("该区域未识别到文字")
            withCrops(
                _state.value.crops.map {
                    if (it.key == key) it.copy(status = CropStatus.DONE, text = text, err = "") else it
                },
            )
        }
    }

    /** 点「✓ 导入」：把编辑后的文本交给调用方（web 的 `onConfirm(text)` 分支） */
    fun confirm() {
        val t = _state.value.draft.trim()
        if (t.isEmpty()) return
        onImport(t)
    }

    // ───────────────────────── 内部 ─────────────────────────

    /**
     * 统一的「替换 crops」入口：顺带决定底部文本要不要跟着变。
     *
     * 只在「按框顺序拼接的结果」发生变化时才覆盖 draft —— 用户手改的内容不会因为
     * 无关操作（删掉一个还没识别的空框等）被冲掉。
     */
    private fun withCrops(newCrops: List<OcrCrop>) {
        val combined = OcrBoxLogic.combineCropTexts(newCrops)
        val overwrite = combined != lastCombined
        if (overwrite) lastCombined = combined
        _state.value = _state.value.copy(
            crops = newCrops,
            draft = if (overwrite) combined else _state.value.draft,
        )
    }

    /** 识别结果清洗（web `clean`）：去拼音时按「练字 / 练词练句」两套规则 */
    private fun clean(s: String): String {
        val st = _state.value
        if (!st.stripPinyin) return s
        return if (st.spaceChars) stripPinyin(s, separate = true) else stripPinyinKeepDelimiters(s)
    }

    /** 服务端 `engine` 参数：`auto` 不传（web `if (engine && engine !== "auto")`） */
    private fun engineQuery(engine: OcrEngine): String =
        if (engine == OcrEngine.AUTO) "" else engine.wire

    private fun detectBlocks() {
        val c = canonical ?: return
        detectJob?.cancel()
        _state.value = _state.value.copy(blocksLoading = true)
        detectJob = scope.launch {
            val res = try {
                repository.detectTextBlocks(c.jpeg)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                null
            }
            if (!_state.value.open) return@launch
            // 失败(null) 与「检测到 0 行」都落到"保持自由框选"（提示文案本来就同一条）
            // 顺带把仓储层的 DetectTextBlock（带 nx/ny/nw/nh 四个字段）折成 OcrModels 的 OcrNormBlock，
            // 让 OcrModels 保持「不依赖任何业务仓储」的纯数据定位。
            normBlocks = res?.map { OcrNormBlock(PickRect(it.nx, it.ny, it.nw, it.nh), it.text) } ?: emptyList()
            _state.value = _state.value.copy(blocksLoading = false)
            // 预览尺寸还没量到时先记着，等 onStageSize 再换算
            recomputeBlocks()
        }
    }

    private fun recomputeBlocks() {
        val s = _state.value
        if (s.stageW <= 0f || s.stageH <= 0f || normBlocks.isEmpty()) return
        _state.value = s.copy(blocks = OcrBoxLogic.toDisplay(normBlocks, s.stageW, s.stageH))
    }
}

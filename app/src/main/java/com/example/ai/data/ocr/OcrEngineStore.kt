package com.example.ai.data.ocr

import android.content.Context
import android.content.SharedPreferences

/**
 * 识别引擎选择的本地持久化 —— 对齐 web `web/src/stores/ocrEngineStore.ts`。
 *
 * web 把选择存在 localStorage 的 `aiphonix_ocr_engine`（取值 `auto` / `paddle` / `doubao`），
 * 全局共享：在某页选了模型，刷新/切页/进框选面板都沿用同一选择。Android 用同名 key 存在
 * 自己的 SharedPreferences 里，由 `AppContainer` 持有后构造注入（与 `ttsCache` 同套路）。
 *
 * 未知/损坏的值一律回落 `AUTO`（web `readInitial` 同口径）。
 */
class OcrEngineStore(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun read(): OcrEngine = OcrEngine.from(prefs.getString(KEY, null))

    fun write(engine: OcrEngine) {
        prefs.edit().putString(KEY, engine.wire).apply()
    }

    private companion object {
        const val FILE = "aiphonix_ocr_engine_prefs"

        /** 沿用 web localStorage 的 key 名，便于对照排查 */
        const val KEY = "aiphonix_ocr_engine"
    }
}

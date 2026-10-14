package com.example.ai.data.sentencedoctor

import android.content.Context
import android.content.SharedPreferences

/**
 * 句子小医生 · 「已掌握」记录的本地持久化 —— 对齐 web 的 `localStorage["sd_solved_v1"]`。
 *
 * 只存**已掌握**的题号（`p:f1:0` / `f:f1:2` 这种），不存画笔笔迹与中间态：
 * web 也只持久化这一份，画笔是「当次随手画的」，换页即散。
 *
 * ⚠️ 记账口径：**记上就不再因为改动而撤销**（除非按「重来」）——
 * 孩子做对过就值得留痕，后面手滑点乱不该把成绩抹掉。
 *
 * 存的是 StringSet（web 存 `{key: true}` 的 JSON 对象），语义等价、且不用自己解析 JSON。
 */
class SentenceDoctorStore(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun loadSolved(): Set<String> = prefs.getStringSet(KEY, null)?.toSet() ?: emptySet()

    fun saveSolved(keys: Set<String>) {
        prefs.edit().putStringSet(KEY, keys).apply()
    }

    private companion object {
        const val FILE = "aiphonix_sentence_doctor_prefs"

        /** 沿用 web localStorage 的 key 名，便于对照排查 */
        const val KEY = "sd_solved_v1"
    }
}

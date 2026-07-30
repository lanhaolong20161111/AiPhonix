package com.k2fsa.sherpa.onnx.dictation

/**
 * Legacy hint level enum — kept for WritingSession.hintLevel field compatibility
 * and DictationActivity RadioGroup mapping. The hint engine now uses
 * [HintStrategy] instead.
 */
enum class HintLevel(val value: Int, val label: String) {
    NONE(1,  "无提示"),
    WORD(2,  "词语"),
    HALF(3,  "半句"),
    STRUCT(4, "段落");

    companion object {
        fun fromValue(v: Int): HintLevel =
            entries.firstOrNull { it.value == v } ?: NONE
    }
}

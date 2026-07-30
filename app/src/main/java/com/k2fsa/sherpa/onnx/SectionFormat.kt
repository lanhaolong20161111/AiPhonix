package com.k2fsa.sherpa.onnx

/** Map section index to a display prefix (①-⑤ or numeric). */
fun formatSectionPrefix(index: Int): String = when (index) {
    0 -> "①"
    1 -> "②"
    2 -> "③"
    3 -> "④"
    4 -> "⑤"
    else -> "${index + 1}"
}

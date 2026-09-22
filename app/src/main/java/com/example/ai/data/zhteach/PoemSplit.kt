package com.example.ai.data.zhteach

/**
 * 古诗原文切句（对齐 web `SpeechComposePage.tsx` 里内联的那行正则，不是独立模块）。
 *
 * ⚠️ 本文件是项目里**第三套**中文切句口径，三者互不等价，不可互换：
 *   1. [PoemSplit]         —— 本文件：按 `，。！？；：` 断，标点**归前句**，换行直接丢弃；
 *   2. [ArticleSplit]      —— 按句末标点（。！？!?；;…）断，并吸收紧跟的收尾引号，换行强制断句；
 *   3. `data.dailyzh.DailyTextSplit.sentences` —— 只按 `；;\n` 断。
 *
 * 之所以不能用 [ArticleSplit]：古诗的「，」是**句内**停顿（七言律诗一句两顿），
 * 古诗练习要把每个「，」顿都当作一行来跟读，而 [ArticleSplit] 不把逗号当句末标点。
 *
 * 与 web 一致的取舍：
 * - 半角 `,` `.` **不切**（不在字符集合里），故混排半角标点的古诗会整段一句；
 * - 换行只是"被跳过"，不产生空行；
 * - 无标点的整行原样作为一句。
 */
object PoemSplit {

    /** 切分标点：中文逗号 / 句号 / 叹号 / 问号 / 分号 / 冒号（+ 换行作为分隔但被丢弃） */
    private val VERSE = Regex("[^，。！？；：\n]+[，。！？；：]?")

    /** 按古诗的顿/句切分原文；结果已 trim 并丢弃空段 */
    fun split(raw: String): List<String> =
        VERSE.findAll(raw).map { it.value.trim() }.filter { it.isNotEmpty() }.toList()
}

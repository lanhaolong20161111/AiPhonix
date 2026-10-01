package com.example.ai.ui.icon

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 图标数据体检。
 *
 * 图形本身的「好不好看」单测管不了，但**数据合法性**能管：坐标是否越界、尺寸是不是零、
 * 多边形点数是不是偶数……这些错了在真机上只会表现成「这个图标不见了」，极难定位。
 */
class MathIconsTest {

    private val all = MathIcons.ALL

    /** 取出一个图标的所有数值（坐标 / 尺寸 / 半径 / 线宽）。 */
    private fun numbersOf(p: IconPrim): List<Float> = when (p) {
        is IconPrim.C -> listOf(p.cx, p.cy, p.r)
        is IconPrim.R -> listOf(p.x, p.y, p.w, p.h)
        is IconPrim.Rr -> listOf(p.x, p.y, p.w, p.h, p.rad)
        is IconPrim.L -> listOf(p.x1, p.y1, p.x2, p.y2, p.w)
        is IconPrim.P -> p.pts.toList()
    }

    @Test
    fun `图标清单不能是空的`() {
        assertTrue("图标数量太少：${all.size}", all.size >= 20)
    }

    @Test
    fun `每个图标至少有一个图元，且键与属性名对得上`() {
        for ((name, prims) in all) {
            assertTrue("$name 没有图元", prims.isNotEmpty())
            // 生成器把每个图标同时挂成 val 和 ALL 的条目，两边必须是同一个对象
            val byProp = when (name) {
                "card" -> MathIcons.card
                "coin" -> MathIcons.coin
                "papers" -> MathIcons.papers
                "ruler" -> MathIcons.ruler
                "nail" -> MathIcons.nail
                "grid" -> MathIcons.grid
                "pin" -> MathIcons.pin
                "hand" -> MathIcons.hand
                "switch" -> MathIcons.switch
                "door" -> MathIcons.door
                "childArms" -> MathIcons.childArms
                "podium" -> MathIcons.podium
                "desk" -> MathIcons.desk
                "track" -> MathIcons.track
                "walk" -> MathIcons.walk
                "bus" -> MathIcons.bus
                "clip" -> MathIcons.clip
                "peanut" -> MathIcons.peanut
                "bean" -> MathIcons.bean
                "sack" -> MathIcons.sack
                "bottle" -> MathIcons.bottle
                "apple" -> MathIcons.apple
                "kid" -> MathIcons.kid
                "car" -> MathIcons.car
                "rowSticks" -> MathIcons.rowSticks
                "bundle" -> MathIcons.bundle
                "bundleChain" -> MathIcons.bundleChain
                "arrowLeft" -> MathIcons.arrowLeft
                "zeroTail" -> MathIcons.zeroTail
                "zeroMid" -> MathIcons.zeroMid
                "plusHead" -> MathIcons.plusHead
                else -> error("$name 是 ALL 里的键，但没有对应的 val 属性 —— 生成脚本漏了？")
            }
            assertEquals("$name 的 val 与 ALL 条目不一致", byProp, prims)
        }
    }

    @Test
    fun `units 页要用的参照物图标一个都不能少`() {
        // 长度
        val length = listOf("card", "coin", "papers", "ruler", "nail", "grid", "pin", "hand", "switch", "door", "childArms", "podium", "desk", "track", "walk", "bus")
        // 质量
        val mass = listOf("clip", "peanut", "bean", "sack", "bottle", "apple", "kid", "car")
        for (n in length + mass) {
            assertNotNull("缺少图标 $n", MathIcons[n])
        }
        assertEquals("图标总数与预期不符（新增/删除图标时请同步这里与 web 端）", 31, all.size)
    }

    @Test
    fun `mulOne 页要用的图标一个都不能少`() {
        // 题型卡 + 规律卡：小棒 / 捆 / 向左箭头 / 0 / 头顶进位
        val names = listOf("rowSticks", "bundle", "bundleChain", "arrowLeft", "zeroTail", "zeroMid", "plusHead")
        for (n in names) {
            assertNotNull("缺少图标 $n", MathIcons[n])
        }
    }

    @Test
    fun `所有数值都落在 0 到 100 的坐标系里`() {
        for ((name, prims) in all) {
            for (p in prims) {
                for (v in numbersOf(p)) {
                    assertTrue("$name 的图元里有越界数值 $v（坐标系是 0..100）", v in 0f..100f)
                }
            }
        }
    }

    @Test
    fun `圆半径和矩形宽高必须是正数`() {
        for ((name, prims) in all) {
            for (p in prims) {
                when (p) {
                    is IconPrim.C -> assertTrue("$name 的圆半径必须是正的：${p.r}", p.r > 0f)
                    is IconPrim.R -> assertTrue("$name 的矩形宽高必须是正的：${p.w}x${p.h}", p.w > 0f && p.h > 0f)
                    is IconPrim.Rr -> {
                        assertTrue("$name 的圆角矩形宽高必须是正的：${p.w}x${p.h}", p.w > 0f && p.h > 0f)
                        assertTrue("$name 的圆角半径不能是负数：${p.rad}", p.rad >= 0f)
                        // 圆角不能超过较短边的一半，否则 Compose 与浏览器会画出不同形状
                        val half = minOf(p.w, p.h) / 2f
                        assertTrue("$name 的圆角 ${p.rad} 超过了短边的一半 $half", p.rad <= half + 0.01f)
                    }
                    is IconPrim.L -> assertTrue("$name 的线宽必须是正的：${p.w}", p.w > 0f)
                    is IconPrim.P -> Unit
                }
            }
        }
    }

    @Test
    fun `线段不能退化成零长度`() {
        for ((name, prims) in all) {
            for (p in prims) {
                if (p is IconPrim.L) {
                    val dx = p.x2 - p.x1
                    val dy = p.y2 - p.y1
                    assertTrue("$name 有一条零长度线段 (${p.x1},${p.y1})", dx * dx + dy * dy > 0.01f)
                }
            }
        }
    }

    @Test
    fun `多边形的点数必须是偶数且至少两个点`() {
        for ((name, prims) in all) {
            for (p in prims) {
                if (p is IconPrim.P) {
                    assertTrue("$name 的多边形点数是奇数：${p.pts.size}", p.pts.size % 2 == 0)
                    assertTrue("$name 的多边形点太少：${p.pts.size / 2}", p.pts.size >= 4)
                }
            }
        }
    }

    @Test
    fun `每个图标都画得够大，不会缩在角落看不见`() {
        for ((name, prims) in all) {
            var minX = Float.MAX_VALUE
            var maxX = -Float.MAX_VALUE
            var minY = Float.MAX_VALUE
            var maxY = -Float.MAX_VALUE
            fun mark(x: Float, y: Float) {
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
            }
            for (p in prims) {
                when (p) {
                    is IconPrim.C -> {
                        mark(p.cx - p.r, p.cy - p.r)
                        mark(p.cx + p.r, p.cy + p.r)
                    }
                    is IconPrim.R -> {
                        mark(p.x, p.y)
                        mark(p.x + p.w, p.y + p.h)
                    }
                    is IconPrim.Rr -> {
                        mark(p.x, p.y)
                        mark(p.x + p.w, p.y + p.h)
                    }
                    is IconPrim.L -> {
                        mark(p.x1, p.y1)
                        mark(p.x2, p.y2)
                    }
                    is IconPrim.P -> {
                        var i = 0
                        while (i + 1 < p.pts.size) {
                            mark(p.pts[i], p.pts[i + 1])
                            i += 2
                        }
                    }
                }
            }
            val w = maxX - minX
            val h = maxY - minY
            assertTrue("$name 太窄（$w），缩到 40dp 上会看不清", w >= 30f)
            assertTrue("$name 太扁（$h），缩到 40dp 上会看不清", h >= 30f)
            assertTrue("$name 超出画布左边：$minX", minX >= -0.01f)
            assertTrue("$name 超出画布右边：$maxX", maxX <= 100.01f)
        }
    }

    @Test
    fun `名字打错时返回 null，而不是抛异常`() {
        assertNull("拼错的名字必须安静地返回 null", MathIcons["does_not_exist"])
        assertNull(MathIcons[""])
        assertNotNull(MathIcons["card"])
    }

    @Test
    fun `outline 图元只用于挖空，必须至少存在一个非 outline 的底`() {
        for ((name, prims) in all) {
            val hasOutline = prims.any { p ->
                when (p) {
                    is IconPrim.C -> p.outline
                    is IconPrim.R -> p.outline
                    is IconPrim.Rr -> p.outline
                    is IconPrim.P -> p.outline
                    is IconPrim.L -> false
                }
            }
            if (hasOutline) {
                val hasBase = prims.any { p ->
                    when (p) {
                        is IconPrim.C -> !p.outline
                        is IconPrim.R -> !p.outline
                        is IconPrim.Rr -> !p.outline
                        is IconPrim.P -> !p.outline
                        is IconPrim.L -> true
                    }
                }
                assertTrue("$name 全是 outline 图元，挖空挖成了空白", hasBase)
            }
        }
    }
}

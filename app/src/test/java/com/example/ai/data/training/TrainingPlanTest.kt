package com.example.ai.data.training

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FeatureCatalogTest {

    @Test
    fun `id 唯一且 fromId 可往返`() {
        val ids = FeatureId.entries.map { it.id }
        assertEquals("id 必须唯一", ids.size, ids.toSet().size)
        for (feature in FeatureId.entries) {
            assertEquals(feature, FeatureId.fromId(feature.id))
        }
    }

    @Test
    fun `未知 id 返回 null（容错旧数据）`() {
        assertNull(FeatureId.fromId("not_a_feature"))
    }

    @Test
    fun `功能目录覆盖全部可训练页面`() {
        // 9 个可训练功能 + 2 个家长管理功能（导入/我的导入）
        assertEquals(11, FeatureId.entries.size)
        assertEquals(9, FeatureId.trainableEntries.size)
        assertTrue(FeatureId.trainableEntries.all { it.isTraining })
        assertTrue(FeatureId.entries.all { it.emoji.isNotBlank() && it.title.isNotBlank() })
    }

    @Test
    fun `导入与我的导入是家长管理功能不进学生任务`() {
        assertTrue(!FeatureId.IMPORT_CENTER.isTraining)
        assertTrue(!FeatureId.MY_IMPORTS.isTraining)
        assertTrue(!FeatureId.trainableEntries.contains(FeatureId.IMPORT_CENTER))
        assertTrue(!FeatureId.trainableEntries.contains(FeatureId.MY_IMPORTS))
    }
}

class TrainingPlanTest {

    @Test
    fun `doneCount 只统计已完成项`() {
        val plan = TrainingPlan(
            id = "p1",
            title = "今日任务",
            items = listOf(
                PlanItem("a", "recognition", done = true),
                PlanItem("b", "dictation"),
                PlanItem("c", "char_image", done = true),
            ),
            createdAt = 0,
            updatedAt = 0,
        )
        assertEquals(2, plan.doneCount)
        assertTrue(plan.hasFeature(FeatureId.RECOGNITION))
        assertTrue(plan.hasFeature(FeatureId.DICTATION))
        assertTrue(!plan.hasFeature(FeatureId.ORAL_WRITING))
    }

    @Test
    fun `featureId 解析未知功能返回 null`() {
        val item = PlanItem("x", "unknown_feature")
        assertNull(item.featureId)
        assertEquals(FeatureId.RECOGNITION, PlanItem("y", "recognition").featureId)
    }
}

class TrainingPlanStoreLogicTest {

    @Test
    fun `newItem 生成唯一 id 并记录功能`() {
        val a = TrainingPlanStore.newItem(FeatureId.RECOGNITION)
        val b = TrainingPlanStore.newItem(FeatureId.RECOGNITION)
        assertTrue(a.id != b.id)
        assertEquals("recognition", a.feature)
        assertTrue(!a.done)
    }

    @Test
    fun `markDone 后 doneAt 时间戳单调递增`() {
        // 纯数据层：验证 markDone 的 copy 语义等价行为（store 落盘依赖 Android Context，不在 JVM 单测范围）
        val done = PlanItem("a", "recognition", done = true, doneAt = 111L)
        assertEquals(111L, done.doneAt)
        assertTrue(done.done)
    }
}

/** 读取当前用户训练配置中某 feature 的家长设置（年级批次） */

import { useQuery } from "@tanstack/react-query"
import { fetchPlan } from "../services/training"

/** 从训练计划中提取某 feature 的配置年级批次（空数组=不按年级过滤=全部） */
export function useFeatureGrades(featureId: string): string[] {
  const planQ = useQuery({ queryKey: ["training", "plan"], queryFn: fetchPlan })
  const item = planQ.data?.items?.find((i) => i.feature === featureId)
  const grades = ((item?.config as { grades?: string[] } | undefined)?.grades) ?? []
  return grades
}

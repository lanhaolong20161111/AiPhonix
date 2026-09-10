/** 课件库客户端 — 语/数/英课件图片（类型来自共享契约层 @contracts） */
import { api } from "./api"
import type { CoursewareItem, CoursewareListResponse, CoursewareModule } from "@contracts"

export type { CoursewareItem, CoursewareModule }

/** 列出某科目课件（最新在前） */
export async function listCourseware(module: CoursewareModule): Promise<CoursewareListResponse> {
  return api<CoursewareListResponse>(`/courseware?module=${encodeURIComponent(module)}`, { method: "GET" })
}

/** 上传一张课件图（FormData: file + module + title） */
export async function uploadCourseware(fd: FormData): Promise<CoursewareItem> {
  return api<CoursewareItem>("/courseware", { method: "POST", body: fd, timeoutMs: 60000 })
}

/** 删除一条课件（记录 + 服务端文件） */
export async function deleteCourseware(id: number): Promise<{ status: string }> {
  return api<{ status: string }>(`/courseware/${id}`, { method: "DELETE" })
}

/** 以带鉴权的 fetch 下载课件原图（弹层选中后用：api() 自动注入 Bearer）。
 *  注意：item.url 是含 /api/v1 前缀的完整路径，而 api() 会再拼一次 API_BASE，
 *  直接传会变成 /api/v1/api/v1/... → 404 {"detail":"Not Found"}。
 *  这里用 file_name 重新构造不带前缀的路由路径。 */
export async function fetchCoursewareImage(item: CoursewareItem): Promise<Blob> {
  return api<Blob>(`/courseware/file/${encodeURIComponent(item.file_name)}`, {
    method: "GET",
    responseType: "blob",
  })
}

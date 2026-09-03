/** 上传记录客户端 — 类型来自共享契约层 @contracts（不再手写 DTO） */
import { api } from "./api"
import type { UploadPhotoResponse, UploadRecord } from "@contracts"

/** 兼容旧页面里 UploadItem 的名字 */
export type UploadItem = UploadRecord

export async function uploadPhoto(fd: FormData): Promise<UploadPhotoResponse> {
  return api<UploadPhotoResponse>("/uploads/photo", { method: "POST", body: fd })
}

export async function uploadText(payload: { text: string; note: string; origin: string }): Promise<{ id: number; status: string }> {
  return api<{ id: number; status: string }>("/uploads/text", { method: "POST", body: payload })
}

export async function listUploads(limit = 20): Promise<{ items: UploadRecord[] }> {
  return api<{ items: UploadRecord[] }>(`/uploads?limit=${limit}`, { method: "GET" })
}

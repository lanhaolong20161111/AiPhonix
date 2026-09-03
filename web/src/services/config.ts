/** 全局配置 — 服务端地址等 */

/**
 * API 基础地址（同源 `/api/v1`，实际后端由部署决定）。
 * - 开发环境：Vite dev server 代理 `/api` → server_ts（本地 3001，better-sqlite3 + 本地 FS）。
 * - 生产环境：前端挂 Cloudflare Pages/Assets，同源 `/api` → server_cf（Cloudflare Worker，D1+R2）。
 * - 旧 server_py（FastAPI/8080）已于 2026-08 退役，不再作为后端。
 */
export const API_BASE = "/api/v1"

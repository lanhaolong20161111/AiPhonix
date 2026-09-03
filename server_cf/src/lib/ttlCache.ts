/**
 * 跨 isolate 数据新鲜度辅助：带 TTL 的懒加载单飞缓存（🟠6）
 *
 * 解决「模块级缓存装载一次永不刷新」→ 数据源（R2 JSON / D1）更新后各 isolate 长期陈旧的问题：
 * - 首请求装载；超过 ttl 后重读，数据变更最多延迟 ttl 生效
 * - 装载失败即失效（value=null），下次请求重试——避免坏数据/坏文件焊死到 isolate 回收
 * - refresh()：本地写完后调用，值已最新，重置计时避免刚写完又触发一次重读
 *
 * 用法：
 *   const store = ttlCache(loader, 60_000)
 *   const data = await store.get()       // 懒加载 + TTL 重读
 *   store.refresh()                      // 本地修改后调用
 */
export function ttlCache<T>(loader: () => Promise<T>, ttlMs: number) {
  let value: T | null = null
  let loadedAt = 0
  let inflight: Promise<T> | null = null

  const get = (): Promise<T> => {
    if (value !== null && Date.now() - loadedAt < ttlMs) return Promise.resolve(value)
    if (!inflight) {
      inflight = loader()
        .then((v) => {
          value = v
          loadedAt = Date.now()
          return v
        })
        .catch((e) => {
          value = null
          loadedAt = 0
          throw e
        })
        .finally(() => {
          inflight = null
        })
    }
    return inflight
  }

  /** 本地写完后调用：值已是最新，重置计时避免马上重读 */
  const refresh = (): void => {
    loadedAt = Date.now()
  }

  return { get, refresh }
}
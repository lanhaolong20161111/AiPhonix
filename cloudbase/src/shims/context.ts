/**
 * ExecutionContext 的等价物。
 *
 * server_cf 用到了两处能力（共 17 处调用）：
 *   · `c.executionCtx.waitUntil(promise)` —— 响应发出后继续跑的后台任务
 *     （请求日志落库、上传后异步 OCR、语文异步补注音、ai-chat 会话回写）
 *   · `c.executionCtx?.waitUntil` —— ai_chinese.ts 里对「挂载失败」做了 try/catch 降级
 *
 * Node 进程不会在响应结束时就死，所以 waitUntil 只需要「保活引用 + 吞异常」：
 * 若不持有 promise 引用，Node 仍会跑完它（不像 workerd 会掐掉），但异常会变成
 * unhandledRejection —— 这里统一捕获并打日志，与 Worker 里「未处理任务失败不影响响应」一致。
 */
export class ExecutionContextShim {
  #pending = new Set<Promise<unknown>>()
  #failed = 0

  /** 对齐 ExecutionContext.waitUntil */
  waitUntil(promise: Promise<unknown>): void {
    const p = Promise.resolve(promise)
      .catch((e: unknown) => {
        this.#failed++
        console.error("[ctx] waitUntil 后台任务失败:", e)
      })
      .finally(() => {
        this.#pending.delete(p)
      })
    this.#pending.add(p)
  }

  /** Node 无对应语义：错误已由 app.onError 统一返回 5xx，故为空实现 */
  passThroughOnException(): void {
    /* noop */
  }

  get pending(): number {
    return this.#pending.size
  }

  get failed(): number {
    return this.#failed
  }

  /** 优雅退出：等后台任务收尾（超时即放弃，避免把 SIGTERM 拖成强杀） */
  async drain(timeoutMs = 15_000): Promise<void> {
    if (this.#pending.size === 0) return
    await Promise.race([
      Promise.allSettled([...this.#pending]),
      new Promise((r) => setTimeout(r, timeoutMs).unref?.()),
    ])
  }
}

/** 构建期裁剪开关 `VITE_SKILLS` 的**单一真源**（解析规则 + 永不裁剪清单）。
 *
 * 三个消费方必须口径一致，否则会出现「页面在、路由没了」或「页面在、样式没了」这类空白页：
 *   - `registry.ts`    决定保留哪些模块（路由 / 首页磁贴 / 打卡目录）
 *   - `skillsCss.ts`   决定 App.css 里哪些样式块不许被裁掉
 *   - `vite.config.ts` 决定 catalog 里哪些 `import()` 换成桩（进而不再产出该 chunk）
 *
 * 语义：
 *   - 未设置 / 空串 / 纯空白 ⇒ `null` = 不裁剪（默认，行为与改造前完全一致）
 *   - 逗号分隔的模块 id     ⇒ 只保留这些 + `ALWAYS_ON_SKILLS`
 */

/** 无论怎么裁剪都要保留的页面：内核页 + 登录/注册/占位（用户总得进得来） */
export const ALWAYS_ON_SKILLS: readonly string[] = ["home", "login", "register", "placeholder"]

/** 解析 `VITE_SKILLS`；返回 null 表示「不裁剪」。 */
export function parseEnabledSkills(raw: string | undefined | null): string[] | null {
  if (typeof raw !== "string" || raw.trim() === "") return null
  return raw.split(",").map((s) => s.trim()).filter(Boolean)
}

/** 某个页面在给定开关下是否保留（开关为 null 时全保留）。 */
export function isSkillEnabled(id: string, enabled: string[] | null): boolean {
  if (enabled === null) return true
  return enabled.includes(id) || ALWAYS_ON_SKILLS.includes(id)
}

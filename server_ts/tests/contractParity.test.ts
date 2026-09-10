/** P2-10b 契约漂移护栏。
 *
 * 历史与设计变更（2026-09）：
 *   原方案是 server_cf `export * from server_ts`（纯转发 → 天然同一实例，不可能漂移）。
 *   但 server_cf 不在 pnpm 工作区，其 node_modules/zod 是真实目录，而 server_ts 的是
 *   junction（pnpm 符号链接）；wrangler 的 esbuild 在 Windows 上拒绝穿越 junction
 *   （Cannot read directory "../server_ts/node_modules/zod": untrusted mount point），
 *   `wrangler deploy` 直接构建失败。故 server_cf 改为**自包含副本**。
 *   代价：两端 schema 需手工同步，于是本测试从「同一对象」改为「结构指纹一致」——
 *   任何字段/类型漂移都会红，且不依赖两端 zod 安装为同一实例（小版本可能不同，
 *   例如 server_cf 装到 3.25.x 而 server_ts 锁在 3.23.x，两者内部属性本就不同）。
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as tsContracts from "../src/contracts/index.js"
import * as cfContracts from "../../server_cf/src/contracts/index.js"

type AnyContracts = Record<string, unknown>

/** 递归提取 zod 3 schema 的结构指纹：只保留表达契约形状的信息（字段名/类型/枚举值/
 * 嵌套关系），忽略 zod 版本差异注入的内部字段（`~standard`、`_cached`、`_def` 闭包细节）。 */
function fingerprint(schema: unknown): unknown {
  const def = (schema as { _def?: Record<string, any> } | null | undefined)?._def
  if (!def || typeof def !== "object") return { t: "unknown" }
  const t: string = (def.typeName as string) ?? "unknown"
  const objectShape = (): [string, unknown][] => {
    const s = (def.shape as () => Record<string, unknown>)()
    return Object.keys(s)
      .sort()
      .map((k) => [k, fingerprint(s[k])])
  }
  switch (t) {
    case "ZodObject":
      return { t, shape: objectShape() }
    case "ZodArray":
      return { t, item: fingerprint(def.type) }
    case "ZodRecord":
      return { t, key: fingerprint(def.keyType), value: fingerprint(def.valueType) }
    case "ZodEnum":
      return { t, values: [...((def.values as unknown[]) ?? [])].sort() }
    case "ZodNativeEnum":
      return { t, values: Object.keys((def.values as object) ?? {}).sort() }
    case "ZodLiteral":
      return { t, value: def.value }
    case "ZodNullable":
    case "ZodOptional":
    case "ZodDefault":
    case "ZodReadonly":
    case "ZodCatch":
    case "ZodBranded":
      return { t, inner: fingerprint(def.innerType ?? def.type) }
    case "ZodUnion":
      return { t, options: ((def.options as unknown[]) ?? []).map((o) => fingerprint(o)) }
    case "ZodEffects":
      return { t, inner: fingerprint(def.schema) }
    case "ZodTuple":
      return { t, items: ((def.items as unknown[]) ?? []).map((i) => fingerprint(i)) }
    default:
      return { t }
  }
}

/** 所有以 Schema 结尾的导出（即真正的契约定义）。 */
function schemaNames(m: AnyContracts): string[] {
  return Object.keys(m)
    .filter((k) => k.endsWith("Schema"))
    .sort()
}

describe("contract parity (P2-10b)", () => {
  it("两端导出的契约名称集合一致", () => {
    const ts = Object.keys(tsContracts).sort()
    const cf = Object.keys(cfContracts).sort()
    assert.deepEqual(cf, ts, "导出名称不一致即漂移")
  })

  it("曾漂移字段 weights 在双端解析行为一致", () => {
    const fixture = { weights: { a: "1", b: "2" } }
    const ra = (tsContracts as AnyContracts).PracticeWeightsResponseSchema.safeParse(fixture)
    const rb = (cfContracts as AnyContracts).PracticeWeightsResponseSchema.safeParse(fixture)
    assert.equal(rb.success, ra.success)
    if (ra.success && rb.success) assert.deepEqual(rb.data, ra.data)
  })

  it("每个 schema 的结构在两端完全一致（自包含副本必须同步）", () => {
    const names = schemaNames(tsContracts as unknown as AnyContracts)
    assert.ok(names.length > 0, "两端应至少导出一个 *Schema")
    for (const n of names) {
      assert.deepEqual(
        fingerprint((cfContracts as AnyContracts)[n]),
        fingerprint((tsContracts as AnyContracts)[n]),
        `schema ${n} 双端结构不一致 —— server_cf 的自包含副本需与 server_ts 同步`,
      )
    }
  })
})

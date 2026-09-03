import { defineConfig } from "drizzle-kit"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
// 反向生成：从现有 SQLite app.db 读 schema
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: join(HERE, "../server_py/data/app.db"),
  },
  verbose: true,
  strict: true,
})

import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
// ⚠️ tsconfig.node.json 是 nodenext，相对 import 必须带扩展名（allowImportingTsExtensions 已开）
import { filterCssBySkills } from './src/modules/skillsCss.ts'
import { isSkillEnabled, parseEnabledSkills } from './src/modules/skillsSwitch.ts'

/**
 * 按 `VITE_SKILLS` 裁剪 App.css 里标了归属的样式块（标记由 web/_css_mark.py 生成）。
 *
 * 未设开关 ⇒ `enabled === null` ⇒ 原样返回 ⇒ 产出与改造前**逐字节相同**。
 * 详见 src/modules/skillsCss.ts 顶部注释（为什么不做“每模块一个 css 文件”）。
 */
function skillsCss(enabled: string[] | null): Plugin {
  return {
    name: 'aiphonix-skills-css',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0].replace(/\\/g, '/')
      if (!file.endsWith('/src/App.css')) return null
      const out = filterCssBySkills(code, enabled)
      if (out === code) return null
      console.log(`[skills-css] App.css ${code.length} → ${out.length} 字符`)
      return { code: out, map: null }
    },
  }
}

/**
 * 按 `VITE_SKILLS` 把未启用模块的 `load: () => import("./x/index")` 换成桩。
 *
 * 为什么要动这一步：注册表里的裁剪只决定「注册哪些路由」，catalog 里的 `import()` 仍在包里 ——
 * rollup 会照样给 48 个模块各产一个 chunk，PWA 还会把它们全部预缓存（约 1.6MB）。
 * 换掉 `import()` 才能真正把未启用的 chunk 从产物里去掉。
 *
 * 安全护栏（宁可构建失败，也不要静默少裁/多裁）：
 *   - 每个 `load:` 行都必须匹配预期写法，否则直接抛错；
 *   - 只在 catalog 上生效，且开关未设时完全不动。
 */
function skillsCatalog(enabled: string[] | null): Plugin {
  return {
    name: 'aiphonix-skills-catalog',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0].replace(/\\/g, '/')
      if (enabled === null || !file.endsWith('/src/modules/catalog.ts')) return null

      const LOAD_OK = /^(\s*)load: \(\) => import\("\.\/[^"]+"\)\.then\(\(m\) => \(\{ default: m\.\w+ \}\)\),$/
      const lines = code.split('\n')
      const stubbed: string[] = []
      let currentId: string | null = null

      const out = lines.map((line) => {
        const idm = line.match(/^\s*id: "([^"]+)",$/)
        if (idm) currentId = idm[1]
        if (/^\s*load: /.test(line) && !LOAD_OK.test(line)) {
          throw new Error(`[skills-catalog] catalog 的 load 写法变了，裁剪逻辑需要同步：${line.trim()}`)
        }
        if (!LOAD_OK.test(line) || currentId === null) return line
        if (isSkillEnabled(currentId, enabled)) return line
        stubbed.push(currentId)
        return `${line.match(LOAD_OK)![1]}load: () => Promise.resolve({ default: () => null }),`
      })

      if (stubbed.length === 0) {
        throw new Error('[skills-catalog] 一个模块都没被关掉 —— 检查 VITE_SKILLS 里的 id 是否拼错')
      }
      console.log(`[skills-catalog] 关掉 ${stubbed.length} 个模块的 chunk：${stubbed.join(', ')}`)
      return { code: out.join('\n'), map: null }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 用 loadEnv 而不是 process.env：这样 .env 文件里写的 VITE_SKILLS 也生效，
  // 与 registry.ts 读 import.meta.env.VITE_SKILLS 的口径一致。
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const enabled = parseEnabledSkills(env.VITE_SKILLS)

  return {
    resolve: {
      dedupe: ["react", "react-dom", "motion", "framer-motion", "lucide-react"],
      alias: {
        shiki: fileURLToPath(new URL('./src/lib/stubs/shikiStub.ts', import.meta.url)),
      },
    },
    base: "/web/",
    build: {
      // 由外部切换目录清空产物；避免 vite prepare-out-dir 触发 safe-delete bulk 保护
      emptyOutDir: false,
    },
    plugins: [
      skillsCss(enabled),
      skillsCatalog(enabled),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        // 注册逻辑改由 src/main.tsx 完全接管（含 controllerchange 自动刷新 + 定期检查更新），
        // 关闭默认注入的纯注册脚本 registerSW.js，避免双份注册。
        injectRegister: false,
        manifest: {
          name: "AiPhonix",
          short_name: "AiPhonix",
          description: "AI 语文英语学习助手",
          lang: "zh-CN",
          start_url: "/web/",
          display: "standalone",
          theme_color: "#2563eb",
          background_color: "#f4f6f8",
          icons: [
            {
              src: "/web/favicon.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
          maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
          // 新 SW 安装后立即 skipWaiting + claim clients，确保部署后旧 SW 不卡在 waiting。
          // （autoUpdate 模式下双保险：workbox 自动 skipWaiting + main.tsx 发 SKIP_WAITING message）
          skipWaiting: true,
          clientsClaim: true,
        },
      }),
    ],
    server: {
      host: "0.0.0.0",
      port: 5173,
      // 自签名 HTTPS：手机/平板通过局域网 IP 访问时需要 secure context
      // 才能调用麦克风（getUserMedia）。证书由 scripts/gen_cert.py 生成。
      https: {
        key: fs.readFileSync("certs/key.pem"),
        cert: fs.readFileSync("certs/cert.pem"),
      },
      // 同源代理：前端请求 /api /letter-clips → 转发到 server_py，
      // 避免 https 页面发起 http 请求被浏览器 Mixed Content 策略拦截。
      // 注意：字幕采集接口(/api/v1/subtitle-capture/*) 只在 TS 后端实现，
      // 需单独代理到 TS_SERVER_PORT。整体切到 TS 服务后默认 8080（与通用 /api 一致）；
      // 若未来 TS 跑在 3001、PY 跑在 8080 的混合模式，设 TS_SERVER_PORT=3001 仍可工作。
      proxy: {
        "/api/v1/subtitle-capture": {
          target: `http://127.0.0.1:${process.env.TS_SERVER_PORT || 18002}`,
          changeOrigin: true,
        },
        "/api": {
          target: "http://127.0.0.1:18002",
          changeOrigin: true,
        },
        "/letter-clips": {
          target: "http://127.0.0.1:18002",
          changeOrigin: true,
        },
        "/videos": {
          target: "http://127.0.0.1:18002",
          changeOrigin: true,
        },
      },
    },
  }
})

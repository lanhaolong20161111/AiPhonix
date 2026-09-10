import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
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
})

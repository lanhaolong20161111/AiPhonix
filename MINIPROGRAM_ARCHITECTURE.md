# AiPhonix 微信小程序版本 — 架构方案（2026-08-28 调研）

> 目标：把现有 Web 端（`web/` React 19 + Vite，后端 Cloudflare Workers `server_cf/`）的架构迁移一份微信小程序版本。
> 本文是**启动实施前的架构评估**：技术选型、页面/能力映射、可复用资产、硬约束风险、分期计划。
> 结论先行：**可行，推荐 Taro(React) 技术栈复用现有逻辑层；最大硬约束是「接口域名必须 ICP 备案」和「教育类目资质」**，这两点是前置决策项，不解决不能上线。

---

## 1. 现状盘点（迁移的"存量资产"）

| 层 | 现状 | 小程序可复用性 |
|---|---|---|
| 页面 | 31 个 `pages/*.tsx`（共 7501 行）+ 33 条路由 | ❌ 视图层重写（WXML/Taro 组件） |
| 组件 | 12 个 `components/`（PinyinChips/PhonemeChips/SoeDetail/AiChatPanel/BlockText 等） | ⚠️ 逻辑可搬，视图重写 |
| hooks | 6 个（useSoeScore/useTts/useAiChat 等） | ⚠️ 中等改动（音频 API 换 wx 系） |
| lib | 15 个纯逻辑（pinyin.ts/arpabet.ts/srtParser.ts/swipeSnap.ts/chars.ts 等） | ✅ 几乎原样复用 |
| services | 18 个 API 客户端（api.ts 统一封装 JWT 注入 + 401 刷新重试） | ✅ 换请求适配器后原样复用 |
| stores | Zustand ×2（authStore 含 refresh_token 刷新、qaStore/parseSessionStore localStorage 持久化） | ✅ 换 storage 适配器 |
| 后端 | Cloudflare Worker（Hono + D1 + R2），`/api/v1/*` 全套 | ✅ **完全复用，零改动** |
| 静态数据 | wordbank/char_sentences/char_examples 等 JSON（几百 KB）+ alphabet_audio 180KB | ✅ 小程序包内或云端按需取 |

**关键架构事实**：SOE 评测是「**录音→base64→REST POST /soe/evaluate**」模式（不是前端直连腾讯 WebSocket），这在小程序里是**最理想**的形态——`wx.getRecorderManager` 原生支持 `format:'pcm', sampleRate:16000, numberOfChannels:1`，与现有 `/soe/evaluate` 入参完全对齐。

---

## 2. 技术选型：推荐 Taro（React）

| 方案 | 评价 |
|---|---|
| **Taro 4（React）✅ 推荐** | 团队 React 技术栈直接沿用；`services/`、`lib/`、`stores/`、hooks 的业务逻辑基本原样搬；Zustand/TanStack Query 均可在 Taro React 下工作；一份代码可编小程序 + H5（Web 端未来可收敛） |
| 原生小程序（WXML/WXSS/JS） | 性能最好、无编译层黑盒；但视图层 31 页全部手写，逻辑层 import 也要逐个改造模块系统，工作量大且团队栈不符 |
| uni-app（Vue） | 需换 Vue 思维，现有 React 资产复用率低，排除 |

**原则**：视图层用 Taro 组件重写（无法避免），但**逻辑层零重写**是选 Taro 的核心理由——`lib/` 15 个文件 + `services/` 18 个文件的算法和协议代码是本项目最值钱的部分（拼音拆分、arpabet 音素映射、SRT 解析、JWT 刷新、SOE 协议）。

---

## 3. 硬约束与风险（先决策，后动工）

### 🔴 约束 1：request/downloadFile 合法域名必须 ICP 备案
- 小程序真机请求的域名必须在微信后台配置白名单，而白名单要求域名**已 ICP 备案**。
- `aiphonix-api.xinyi7lan.workers.dev` **无法备案** → 生产环境小程序**不能直连**。
- 可选解法（按推荐排序）：
  1. **自有域名 + ICP 备案 + Cloudflare 自定义域**指向现有 Worker（`api.aiphonix.cn` 之类）。后端零改动，只是加一个 custom domain 路由。备案需企业/个人主体 + 约 1~2 周。
  2. 经腾讯云 CloudBase「云接入/云函数」反代 Worker（tcloudbase.com 默认域名的白名单可用性需在微信后台实测验证，不保证长期政策）。
  3. 开发期可用「不校验合法域名」模式（开发者工具 + 开发/体验版真机），**仅限自用测试**。
- **这是立项第 0 步**：没有备案域名，小程序无法对公众发布。

### 🔴 约束 2：小程序类目与资质
- 面向小学生的人工智能语音学习内容属于**教育类目**，微信对「在线教育」类目有资质要求（企业主体 + ICP 备案/办学相关许可，K12 学科类培训另有政策限制）。
- 个人主体小程序**不能选教育类目**。如果只是自家用（给自己孩子），可以用「工具类目」+ 不公开发布（体验版成员模式），规避大部分资质问题——**这与当前产品的实际使用场景（自家用）是匹配的**。
- 需要用户决策：小程序主体是个人还是企业？公开上线还是家庭成员体验版？

### 🟡 约束 3：功能级差异（小程序做不到/要换做法）
| Web 功能 | 小程序约束 | 对策 |
|---|---|---|
| 字幕采集页的 **B站 iframe 预览** | 小程序无 iframe；web-view 组件要求业务域名备案且 B站不允许被嵌 | 该功能**保留 Web 端**，小程序不迁移（或用 B站开放平台小程序播放器组件，另行调研） |
| PWA / Service Worker 离线缓存 | 无对应概念 | 无需迁移；静态 JSON 打进包或首次启动下载到 `wx.setStorage` |
| `<video>` 视频跟读（本地文件/R2 直链） | `<video>` 组件支持网络视频，但域名同样要进 downloadFile 白名单 | 视频/音频资源走同一备案域名即可 |
| 全局 `<audio>` audioManager 互斥 | `wx.createInnerAudioContext` + 全局单例管理 | 等价实现 |
| localStorage | `wx.setStorageSync`（10MB 上限） | Zustand persist 加 storage adapter |
| CSS（Tailwind 4） | 小程序 WXSS，Taro 支持编译期处理；Tailwind 需 weapp-tailwindcss 插件 | 建议直接写普通 SCSS，页面样式量不大 |

### 🟢 能力对照（核心链路全部有等价物）
| Web 实现 | 小程序等价 | 备注 |
|---|---|---|
| `pcmRecorder.ts`：getUserMedia + AudioWorklet 重采样 16k PCM | `wx.getRecorderManager({format:'pcm', sampleRate:16000, numberOfChannels:1})` | onFrameRecorded 分片回调 → 累积 → 停止后合并，喂给现有 `soeApi.evaluate` |
| `soeApi.ts`：PCM→base64→`POST /soe/evaluate` | 原样复用（wx.request） | 服务端零改动 |
| `useTts.ts` + `/tts/synthesize` 音频播放 | InnerAudioContext 播远程 mp3 | 域名白名单 |
| `wx.chooseMedia` 拍照/选图 → FormData `POST /uploads` | `wx.chooseMedia` + `wx.uploadFile` | 识题拍照链路 |
| React Router 33 条路由 | 小程序 pages + navigateTo/redirectTo | tabBar 建议：首页 / 评测历史 / 我的（文本式自定义 tabBar） |
| swipeSnap 横滑翻页 | `swiper` 组件或 touch 事件 | 字卡/字母/音素页 |

---

## 4. 页面迁移映射（分期打包）

小程序主包限 2MB、整包 20MB → 按业务分包：

| 分包 | 页面（对应 web 页面） | 优先级 |
|---|---|---|
| 主包 | 登录/注册、**首页**（新分组卡片版）、评测历史 SoeHistory | P0 |
| 拼音分包 | 拼音练习、拼音表、拼音详情 | P0 |
| 字词分包 | 看图识字词句（entry + practice 字卡页）、认字、默写、词语 | P0（核心闭环） |
| 英语分包 | 英语学习、字母索引/详情、音素索引/详情、发音评分 | P1 |
| AI 分包 | AI 语文、AI 数学/作业、识别结果页、AI 陪练、口述作文、AI 历史 | P2 |
| 视频分包 | 视频跟读 | P2 |
| 不迁移 | 字幕截图采集（B站依赖）、soe-demo | —（留 Web） |

静态资源策略：`wordbank.json` 等数据文件从 R2 按需拉取并缓存（`wx.setStorage`），**不打进包**；`alphabet_audio`（180KB）可进包或走网络。

---

## 5. 分期实施计划（估算）

- **Phase 0 · 前置决策与基建**（人工为主，1~2 周，可与其他阶段并行）
  确定主体/类目策略 → 注册小程序拿 AppID → 域名备案 → Cloudflare Worker 挂 custom domain → 微信后台配 request/downloadFile 合法域名。
- **Phase 1 · 骨架 + 核心闭环**（P0，约 2~3 周）
  Taro 脚手架；`api.ts` 换 `wx.request` 适配器（JWT/401 刷新逻辑原样保留）；authStore storage 适配；登录页 + 首页 + 拼音分包 + 字词分包（看图识字字卡 + 录音评测全链路真机跑通）。**这一阶段结束即出现第一个可用版本**（自用体验版）。
- **Phase 2 · 英语分包**（约 1~1.5 周）：字母/音素/词汇/发音评分，PhonemeChips 音素点读 + TTS。
- **Phase 3 · AI 分包**（约 2 周）：拍照识题（uploadFile）、识别结果块级交互（BlockText/BlockAsk 简化版）、AI 对话（SSE 流式 → wx.request chunked 或轮询降级，需专项验证）。
- **Phase 4 · 视频跟读 + 打磨**（约 1 周）：视频分包、分享卡片、分包预下载、体积优化。

总量级：**单人约 7~10 周**出全功能版；若只做自用核心闭环（Phase 0+1），**2~3 周可用**。

---

## 6. 待用户拍板的问题

1. **主体与发布范围**：个人主体 + 体验版（家人自用，最快）？还是企业主体 + 公开上线（需要资质）？
2. **域名**：是否愿意购入域名并做 ICP 备案（约 ¥50/年 + 1~2 周）？这是公开上线的硬前提。
3. **范围确认**：字幕截图采集确认留在 Web 端不迁移？
4. **AI 对话流式**：小程序端是否需要和 Web 一样的流式输出体验（需专项攻克 chunked transfer），还是接受整段返回？

---

## 7. 复用清单（迁移时直接搬的代码）

- `lib/`：pinyin.ts、arpabet.ts、srtParser.ts、chars.ts、pinyinMnemonic 相关、mnemonicPref.ts、charImageProgress.ts（storage 换 wx）、aiHistory.ts（同上）
- `services/`：全部 18 个（仅 api.ts 底层 fetch→wx.request、config.ts API_BASE 改绝对地址）
- `stores/`：authStore（storage adapter）、qaStore、parseSessionStore
- `hooks/`：useSoeScore（录音层替换为 RecorderManager，协议层不动）、useTts（播放层替换）、useTrainingConfig、usePronStyle、useBlockSpeaking（播放层替换）
- 后端 `server_cf/`：**零改动**（加 custom domain 即可）

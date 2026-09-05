# 视频跟读页（Video Practice）功能路线图 — 交接日志

> 本文档供后续 coding agent 接手使用，**自包含**：读完即可动手，无需翻历史会话。
> 最后更新：2026-09-05 — 方案 B 半自动高亮已实施（commit `21086af`）；自动跟读下线（commit `9194a4b`），改为纯手动模式 + 给出 5 种替代方案。

---

## 0. 交接总览

| 项目 | 状态 |
|---|---|
| 页面 | `web/src/pages/VideoPracticePage.tsx`（模块入口 `/module/video_practice`） |
| 已上线功能 | 纯手动跟读（自动跟读 2026-09-05 下线，原因：SRT 时间戳与配音节奏不齐 + VAD 在配乐下不稳） |
| 待实现（本日志） | 6 个功能，详见 §2，用户已确认全选 |
| 依赖数据 | 12 集 Big Muzzy（`/videos/Big_Muzzy_Ep01~12.mp4` + `.en.srt`） |
| 评测链路 | 录音 → `useSoeScore` → `/api/v1/soe/evaluate`（腾讯 SOE，引擎 `16k_en`，scene `sentence`） |

---

## 1. 现状：已实现功能（接手前必读）

### 1.1 自动跟读核心循环
- 播放 → `onTimeUpdate` 检测换句 → 进入 `waiting` 状态 → **VAD 静音检测**（不是立刻暂停）→ 测到语音真正结束才 `pause()` → `captureSentence()` 录音 → `finishCapture()` 评分 → 总分 **> 70** 自动续播，否则停在当前句等「重读/跳过」→ 循环至视频结束。
- 关键常量（文件顶部）：
  - `AUTO_PASS_SCORE = 70`（达标线）
  - `REC_MIN_MS = 3000` / `REC_MAX_MS = 8000`（录音时长上下限）
  - `SILENCE_RMS = 0.03`、`SILENCE_PEAK_RATIO = 0.35`、`SILENCE_PEAK_MIN = 0.06`、`SILENCE_HOLD_MS = 180`、`SILENCE_WAIT_MS = 1500`（VAD 参数，可调）
- 状态机 `AutoStatus = "idle" | "playing" | "waiting" | "recording" | "paused" | "done"`。
- 引用：`prevEntryRef`（上一句）、`completedRef: Set<number>`（已过关/已跳过的 SRT 块号）、`busyRef`（防并发）、`captureRef`（当前评测句）。

### 1.2 VAD（语音结束检测）技术要点
- 模块级单例：`wiredMedia: WeakSet<HTMLMediaElement>`（`createMediaElementSource` 对同一元素只能调用一次）、`sharedCtx / sharedAnalyser / sharedData`（`AudioContext` 全局单例）。
- **必须**：`analyser.fftSize = 2048`；`analyser.connect(ctx.destination)` 否则视频无声；数据数组长度 = `fftSize`（不是 `frequencyBinCount`）。
- **必须**：建图 + `ctx.resume()` 放在用户手势内（`startAuto` 里 `await` 之前），否则 RMS 恒 0 误判静音。
- `armSilenceWait(entry, isLast)`：rAF 循环读 RMS，绝对阈值或峰值回落 35% 判定静音，持续 180ms 触发暂停；1.5s 超时回退时间戳逻辑。
- 卸载不 `close()` 共享 ctx（StrictMode 双挂载会接线失效——`createMediaElementSource` 二次调用抛异常）。

### 1.3 字幕处理（`web/src/lib/srtParser.ts`）
- `parseSrt`：解析 SRT 块。
- `toSentences`：把以逗号等非句末标点结尾的相邻块**合并成完整句子**（解决半句误暂停），上限 6 块 / 20s。
- `findCurrentSubtitle(subtitles, ms)`：时间戳定位。
- **字幕暂留**：`onTimeUpdate` 里句间间隙（`sub === null`）**不**清空 `currentSub`，保留上一句直到下一句出现（已上线）。

### 1.4 模式切换与 UI
- 「自动跟读 / 手动跟读」分段切换；状态条 `video-status-pill`（level-ok/rec/wait/bad）。
- 评分明细：`SoeDetail` 组件（每词/音素得分）；颜色规则：≥80 绿、60-79 黄、<60 红。
- 按钮区按 `autoStatus` 分叉：idle→开始跟读 / waiting→等待提示 / needRetry→重读+跳过 / 其他→继续播放。

### 1.5 已知边界（接手时别踩）
- 最后一句话：`onEnded` 里若 `busyRef` 为真则交给 `finishCapture` 收尾，否则补评测最后一句。
- `onSeeked` 重置 `prevEntryRef` 并 `cancelSilenceWait()`，防止跳转后误触发。
- `selectVideo` 全量重置自动跟读状态 + `soe.reset()`。
- 手机测试需 https（dev 自签 `https://192.168.1.10:5173/web/`）或生产 https；PWA service worker 缓存旧 chunk，改代码后手机需**硬刷新/清缓存**。

---

## 2. 待实现功能（用户已确认全部要做）

> 优先级排序即建议实现顺序。每个功能给出「需求 / 技术要点 / 注意坑」。

### 2.1 🔁 重听原音（单句回放）— 最高价值，先做
**需求**：录音前/后加「🔊 再听一遍这句」按钮，seek 到该句 `startMs` 播放到 `endMs` 自动暂停，让学生先听准再模仿。
**技术要点**：
- `video.currentTime = entry.startMs / 1000` → `video.play()`。
- 到 `endMs` 自动暂停：新加一个 ref（如 `replayUntilRef: number | null`），在 `onTimeUpdate` 里检查 `video.currentTime * 1000 >= replayUntilRef.current` 则 `video.pause()` 并清空 ref。
- 注意 `onTimeUpdate` 开头有 `if (waitingRef.current) return`——重听时若正处于 waiting 状态会卡住，需先 `cancelSilenceWait()`。
- 播放原音期间不应触发录音流程：可用 `replayUntilRef` 非空作为「正在重听」标志，跳过自动跟读分支。
- 按钮位置：字幕区按钮行，自动模式 `needRetry` 分支（重读/跳过旁）和正常播放态都放一个「🔊 听原音」。

### 2.2 📋 逐句进度列表 + 跳转
**需求**：整集句子列表，✅绿=过关 / ❌红=未达标 / ⬜灰=未做，点任一句 seek 到该句开头播放，随时回练。
**技术要点**：
- 状态：`sentenceScores: Record<number, number>` 或 `Map<index, score>`，`finishCapture` 时写入；`completedRef` 已有「跳过/过关」集合，可合并判断。
- 收起/展开：本地 `useState` 布尔 + 一个「📋 句子列表」切换按钮。
- 跳转实现：`video.currentTime = entry.startMs / 1000; prevEntryRef.current = null`（避免把跳过的句子当刚读完）；若在录音中先终止。
- 列表渲染：`subtitles.map`，状态颜色用语义色（绿 `#2E7D32` / 红 `#B71C1C` / 灰），**文字必须纯黑 `#000`**（AGENTS.md 字体颜色强约束）。
- 当前播放句高亮（可复用 `.level-ok` 类或浅蓝 `#90CAF9`）。

### 2.3 📊 本集成绩总结
**需求**：视频结束（`done` 状态）时展示总结卡：完成 X/Y 句、平均分、通过率、未达标句子列表 + 一键重练。
**技术要点**：
- 数据源同 §2.2 的 `sentenceScores` / `completedRef`，在 `finishCapture` 的 `done` 分支或 `onEnded` 后渲染。
- 「重练错句」：重置 `completedRef` 中未达标句子的状态，seek 到第一句错句，重新进入自动跟读循环。
- 平均分 = 所有已评分句子的分数均值；通过率 = 达标句数 / 总句数。
- 样式：复用 `.card`、`.pron-score` 系列；总结卡可用 `lastScore !== null && autoStatus === "done"` 条件渲染。

### 2.4 🐢 语速调节
**需求**：0.75× / 1× / 1.25× 切换，听不清可放慢。
**技术要点**：
- 一个 `useState<number>(1)`（如 `playbackRate`），按钮切换时 `videoRef.current.playbackRate = rate`。
- 换视频/重新播放时**记得重置**（`video.playbackRate = 1` 或保持当前选择——建议保持用户选择，在 `selectVideo` 后重新设置）。
- UI：模式卡下方加一排小按钮，当前档位高亮。
- 与录音无冲突（录音是麦克风，不受播放速率影响）。

### 2.5 🔀 A/B 对比回放（原音 vs 我的录音）
**需求**：录完先播原音，再播学生自己的录音，自己听差距。
**技术要点**（**需改 `web/src/hooks/useSoeScore.ts`**）：
- 现状：`useSoeScore.stop()` 内部 `recorder.stop()` 拿到 `pcm: Uint8Array`（16kHz/16bit/mono，**无 WAV 头**），评分后即丢弃，不对外暴露。
- 改法 A（推荐）：`useSoeScore` 增加一个可选回调 `onAudio?: (pcm: Uint8Array) => void` 或返回 `lastPcm`，把 PCM 交回页面。
- PCM → 可播放：需拼 WAV 头（44 字节 RIFF header，16kHz/16bit/mono）→ `Blob` → `URL.createObjectURL` → `<audio>` 播放。可新建 `web/src/lib/pcmToWav.ts`（纯函数，建议配单测）。
- 页面：`captureSentence` 录音停止后拿到 `pcmUrl` 存 ref；「🔀 对比听」按钮先 `replaySentence(entry)`（复用 §2.1）再播学生录音。
- 注意：SOE 需要 `Int8Array/Uint8Array` PCM，WAV 只是**回放用**，不影响评分。
- **不要破坏现有调用方**：`useSoeScore` 被多个页面使用（发音评分、认字、默写、拼音等），改动必须向后兼容（回调可选，默认不触发）。

### 2.6 💾 进度记忆（断点续练）
**需求**：localStorage 记住「上次练到哪集哪句」，下次进入自动定位并可一键续练。
**技术要点**：
- key 建议：`videoPractice.progress`，值 `{ episode: "Ep04", index: 7 }` 之类 JSON。
- 写入时机：`finishCapture`（每句评分完）或 `onTimeUpdate` 换句时（注意节流，别每帧写）。
- 读取时机：`selectVideo` 加载字幕完成后，若存有该集进度，弹出「继续上次？」或在列表页显示徽标。
- 切换视频 / 视频播完（`done`）时更新或清除。
- localStorage 是纯前端，无需服务端配合；注意 PWA 下 localStorage 可用。

---

## 3. 接手须知（环境 / 流程 / 规范）

### 3.1 验证方式
- 用户用 **Android Chrome 手机**测：生产 `https://aiphonix-api.xinyi7lan.workers.dev/web/module/video_practice`（改代码后需**硬刷新/清缓存**，PWA SW 会缓存旧 chunk）。
- dev：`https://192.168.1.10:5173/web/`（自签证书首次需「高级→继续前往」）。
- 单测：`npx tsx --test src/lib/srtParser.test.ts`（当前 10 个测试，全绿）。

### 3.2 构建 / 部署（铁律）
- 前端改动：`npx tsc -b`（0 错误）→ 测试 → 部署。
- 部署**只能**用 `AiPhonix/server_cf/scripts/deploy_web.ps1`（在 `server_cf` 目录下运行 `& scripts/deploy_web.ps1`）；**禁止裸 wrangler**。
- 部署前**必须清空代理环境变量**：`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`（含小写），否则 wrangler 连 Cloudflare 会 `fetch failed`。
- 部署是**排他操作**：一次只能一人执行，串行。
- `npm run lint` 是 oxlint，会扫到 `dist.old*` 压缩产物产生大量噪音（991+ errors 属预期），**不是阻塞项**；只看 `npx tsc -b`。

### 3.3 模块边界（AGENTS.md 铁律）
- **Agent A 只能改 `AiPhonix/web/` 下的文件**。改 `useSoeScore.ts`（web/hooks）在边界内 ✅。
- 若需改服务端（SOE 接口、字幕数据、新增翻译接口）→ 发起需求单给 Agent B（server_cf）；共享契约 `shared/contracts` 归 Agent C，不得私自改。
- 新增数据（如 Big Muzzy 单词点查词库）放 `web/public/`。

### 3.4 样式规范（AGENTS.md 强约束）
- 正文文字**纯黑 `#000`**（白/浅底一律纯黑），禁止低对比灰。
- 语义色仅限：正确=绿 `#2E7D32`、错误=红 `#B71C1C`、播放中高亮=浅蓝 `#90CAF9`。
- 背景允许浅色（米黄 `#FFF3D6`、浅绿 `#E8F5E9` 等），其上文字必须纯黑。
- 全局 `button { width: 100% }` 副作用：横向按钮组必须覆盖 `width: auto`。

### 3.5 常见坑速查
- **StrictMode 双挂载**：`useRef` 保留旧值；cleanup 置 false 的标志必须在 setup 阶段重置，否则二次挂载后功能永久失效。
- **`createMediaElementSource` 同元素二次调用抛异常** → 一律走 `wiredMedia` WeakSet 守卫。
- **AudioContext suspended → RMS=0** → 建图/恢复必须在用户手势内。
- **浏览器 autoplay 策略**：非手势 `play()` 会被拒（NotAllowedError）→ `startAuto` 已在手势内申请麦克风 + 建图；新增的自动播放路径同理。
- **不要泄露硬编码 SeedASR key**（`94509df0-...`，仅本地测试用）。

---

## 4. 待办清单（Checklist）

- [x] 2.1 🔁 重听原音：`replayUntilRef` + 按钮 + 跳过 waiting
- [x] 2.2 📋 逐句列表：`sentenceScores` + 展开面板 + 点击跳转
- [x] 2.3 📊 成绩总结：done 状态总结卡 + 错句重练
- [x] 2.4 🐢 语速调节：playbackRate 状态 + 按钮组 + 换集重置
- [x] 2.5 🔀 A/B 回放：`useSoeScore` 暴露 PCM（向后兼容）+ `pcmToWav.ts` + 对比按钮
- [x] 2.6 💾 进度记忆：localStorage 读写 + 续练入口
- [ ] 收尾：tsc 0 错误 → 单测绿 → **部署** → 手机硬刷新验证

### 4.1 实现备注（2026-09-05 接手补全）

接手时页面只有脚手架：§2 的 state/refs 已声明但全部未接线（`tsc` 报 10 个
`TS6133 未使用` + `loadProgress` 未定义）。已补齐实现：

- `useSoeScore` **早已暴露** `lastPcm` / `lastPcmRef`（向后兼容，默认不影响其它调用方），
  `web/src/lib/pcmToWav.ts` 也已存在（含单测）→ §2.5 只需在页面侧接线，未改 hook。
- §2.1 的坑已规避：`replaySentence` 首行 `cancelSilenceWait()`，否则重听期间的静音
  会被 VAD 误判成「读完了」而触发录音；`suppressSeekRef` 保证程序内 seek 不被 `onSeeked` 打断。
- §2.4 语速在换集后会重置 → 用 `onLoadedMetadata` 重新套用 `rateRef`。
- §2.6 进度「整集练完」时清除（video ended / 最后一句跳过 / 补评测完成 三处）。
- 样式遵循 §3.4：正文纯黑 `#000`，语义色仅用绿 `#2E7D32`（走 `.state-pass` 浅绿底）、
  红 `#B71C1C`（走 `.state-fail` 浅红底）、当前句高亮浅蓝 `#90CAF9`；
  横向按钮组全部显式 `width: auto` 覆盖全局 `button{width:100%}`。

### 4.2 部署记录（2026-09-05）

**已部署生产** ✅ Version ID `651cc00f-ad8d-47cf-90ba-a6682141b6b6`。

部署前发现并修复了一个会导致「清理成果回吐 + 产物膨胀」的隐患：

- `server_cf/scripts/build_web_assets.ps1` 是 `web/dist/*` → `static_assets/web/` 的整体拷贝，
  而 `web/dist` 因 vite `emptyOutDir:false` 累积了 **842 个孤儿**（995 文件 / 14MB，
  含 `char_examples.json.bak`）。谁跑一次部署脚本，这批孤儿就上线一次。
- 修法：`vite build --emptyOutDir` 就地重建 `web/dist`（**不要用 shell `rm -rf` 清目录**，
  safe-delete 会拦截且回收站操作失败；让 vite 自己清空 outDir 更可靠）。
- 效果：PWA precache 从 **1957 entries / 30MB** 降到 **118 entries / 1.34MB**。

部署用 `wrangler deploy --env=""`（**不能用裸 `wrangler deploy`**：多环境 `wrangler.toml`
下裸 deploy 会删除生产 worker `aiphonix-api`）。`deploy.ps1` / `deploy_web.ps1` 内部用的
正是裸 deploy，此场景下未使用。

验证：线上 chunk `VideoPracticePage-CJ32Ts97.js` 与本地 **md5 一致**（`bd88ebd1…`），
含 §2 全部文案（听原音 / 对比听 / 通过率 / 语速 / 继续上次 / 句子列表 / `videoPractice.progress`）。
站点健康：`/web/index.html`=307、`char_examples.json`=200、`sw.js`=200；
12 个历史幽灵键仍为 SPA fallback（`text/html`），staging 未受影响。

### 4.3 自动跟读下线 + 替代方案（2026-09-05 commit `9194a4b`）

**为什么下线**：原自动跟读靠 `onTimeUpdate` + SRT 时间戳触发「读完一句自动暂停 +
VAD 静音检测 + 自动录音 + 评分后自动续播」。问题：
- SRT 时间戳与配音节奏不齐（豆包 SeedASR AUC 生成的 `Ep04-12` 时间戳误差 ±500ms），
  自动暂停经常卡在半句话，学生要听两三遍才能反应过来；
- VAD 静音检测在背景音乐下不够稳，Big Muzzy 配乐全程 30%+ 音量，
  绝对静音阈值经常超时回退时间戳逻辑（最长 1.5s 等待 + 录音 3-8s），
  跟读节奏拖得很长；
- 自动续播前若麦克风权限失效，无明显提示，学生以为录了但其实没声音。

**用户决策**（2026-09-05）：删除整套自动跟读逻辑。`VideoPracticePage.tsx` 净减
**382 行**（70 insert / 452 delete）。`VideoPracticePage-DyE4F97o.js` 11.9KB / 4.4KB gzip。

**当前实现**：纯手动模式
- 视频正常播放 / 暂停由用户控制；
- 字幕区始终显示当前句 + 大「🎤 跟读这句」按钮；
- 录音开始时**自动暂停视频**，评分后**不**自动续播（避免再踩自动续播的坑）；
- 评分写入 `sentenceScores` + localStorage 续练进度；
- 视频播完后才出总结卡（`videoEnded && summary.scored > 0`）。

**替代方案调研**（用户问「再想看如何解决这个问题」）：

| 方案 | 体验 | 实现成本 | 推荐度 |
|---|---|---|---|
| **A. 现状（手动+常驻大按钮）** | 稳定可控，学生自定节奏 | 已实现 | ⭐⭐⭐ 兜底必保留 |
| **B. 半自动高亮：当前字幕常驻高亮+底部「现在跟读？」提示** | 视频继续播，学生自选要不要跟读 | 低（CSS+文案） | ⭐⭐⭐⭐ 推荐 |
| **C. 弹窗询问：字幕换句时弹「这句跟读吗？」** | 类似卡牌游戏「暂停→决策」 | 中（Modal + 防打扰开关） | ⭐⭐ |
| **D. 段落级：3-5 句一组暂停 +「这组跟读吗？」** | 减少打扰，一次决策一组 | 中（需要合并 SRT 块） | ⭐⭐ |
| **E. 纯语音驱动：保留 VAD 但只在字幕边界且真静音才暂停** | 自动但更准 | 高（VAD 调参+SRT 校准） | ⭐ 风险大 |

**建议下一步**：方案 B（半自动高亮）。具体改动 30 行内：
1. `.video-subtitle` 加 `active` 类（当前句高亮黄底，结束句淡灰）；
2. 字幕下方加一行 `<div className="video-suggest">💡 听完一句点「跟读这句」，录完自动暂停视频</div>`；
3. 录音按钮加 🎯 图标提示「立即录音」（可选）。

如果后续收集到学生反馈「想更自动」，再考虑方案 E（VAD 重调 + SRT 重对齐）。

### 4.4 方案 B 已实施（2026-09-05 commit `21086af`）

按 §4.3 方案 B 实施落地，**部署生产 Version `6757b4de-c9cb-4eb2-ac78-95a63b8aa5f1`**：

- `App.css` 新增 `.video-subtitle.active`（浅黄底渐变 + 橙色 `#F59E0B` 左边竖条，0.3s 渐变）；
- 新增 `.video-suggest` 提示样式（`#FEF3C7` 浅黄底 + `#92400E` 棕字 12px）；
- `VideoPracticePage.tsx` 给 `.video-subtitle` 加条件 active className
  （仅当「有当前句 + 未录音 + 未评分」时激活，避免录音中频繁变色打扰）；
- 字幕下方加 `<div className="video-suggest">💡 听完一句点「跟读这句」录音，录完视频自动暂停</div>`；
- 录音按钮文案 `🎤 跟读这句` → `🎯 跟读这句`（强调"立即录音"动作感）。

验证：线上 `VideoPracticePage-uKBZfIni.js` md5 与本地一致（`c355d045…`），含全部新文案。
改动：App.css +20 行、VideoPracticePage.tsx +7/-3。**仅在未录音未评分时显示提示**，避免频繁刷文案打扰。

### 4.5 测评对象切分方案演进全记录（2026-09-05，终选：Silero VAD 离线重切）

本节回答一个问题：**为什么最终形态是「Silero VAD 离线重切 SRT + 运行时纯手动」**。
历经 5 代方案，每代的死因/短板都有实测证据，接手者不要走回头路。

#### 4.5.1 方案对比总表

| # | 方案 | 核心思路 | 实测结果 | 死因 / 短板 | 状态 |
|---|---|---|---|---|---|
| 1 | **运行时 VAD 自动跟读** | 浏览器实时算 RMS，静音即停录、自动卡句评分 | Ep04-12 大量卡半句话、超时回退 | ①配乐下 RMS 降不到静音线，VAD 误触发；②SRT 时间戳 ±500ms 误差放大成体验事故；③每次播放都要重新算，错误不可修、不可验证 | ❌ 已删（`9194a4b`） |
| 2 | **原始 SRT 直切** | whisper.cpp（Ep01-03）/ 豆包 SeedASR（Ep04-12）产出的块直接当测评对象 | 连句被腰斩：whisper 每 12 词硬切一刀；换人短句又可能被并 | ASR 的 utterance 边界 ≠「一口气」边界；时间戳按字符比例估算，误差 ±500ms | ❌ 仅作原料 |
| 3 | **前端标点合并（toSentences）** | 按 `.!?…` 把 SRT 块合并成整句粒度 | 修复了部分连句，但纯文本规则 | 看不见声音：①换人说话无标点区别，A 说完 B 紧接会被并进一个测评对象；②时间戳误差原样保留，「听原音」切尾音 | ❌ 被 v1 取代（仅老 SRT 兜底） |
| 4 | **energy 停顿重切（v1→v4）** | 离线 `ffmpeg silencedetect` 扫静音区间 → 混合规则（停顿+标点）分组 → 方向敏感吸附 → 尾部二次扫描 | Ep01 158 块 → 138 单元，质量大幅改善；两轮用户实测抓出 2 类切词并修复 | 能量法**分不清人声和音乐**：唱歌段把拖唱判成"没有静音"，只能靠保护垫兜底。以 Silero 语音区间为真值审计：**句尾切词 18 处 / 句首切词 12 处** | ⚠️ 保留为 `--vad energy` 备选 |
| 5 | **Silero VAD 离线重切（现行）** | 神经网络 VAD（2.3MB ONNX）离线推理出「人声区间」→ 补集为静音 → 复用 v4 全部吸附/分组/切分逻辑 | 同一真值审计：**句尾切词 5 / 句首切词 5（降 72%）**；903s 音频全管线 22s 单核 | 剩余 5 处切词集中在说唱重叠段（多人同时说话，VAD 也难分），可人工微调 | ✅ **现行**（`5c58f8b`） |

#### 4.5.2 为什么方案 5 效果最好 —— 三层原因

**① 神经网络 VAD 解决了能量法的盲区（根本原因）**

`silencedetect` 只回答"总能量是否低于阈值"，而 Big Muzzy 的难点恰恰是**唱歌段：人声被配乐盖住、拖音渐弱**——总能量一直很高，能量法判定"没有停顿"，句尾只能靠估算+保护垫瞎猜。Silero 是在数万小时标注数据上训练的神经网络，学到的特征是"这里是不是**人的语音**"，能把音乐掩盖下的单词音节峰（实测 "grapes" 尾音节仅 0.19s、概率 0.8）从配乐里拎出来。Ep01 两处用户实测切词（"Two hundred"、"some grapes"）**全部发生在歌段**，全部是能量法的盲区，全部被 Silero 修复。

**② 「离线」形态消灭了方案 1 的不可控性（架构原因）**

同样是 VAD，方案 1 死在**运行时**：浏览器里实时算，配乐干扰、设备差异、每次播放结果都不同，错了没有任何修复手段。方案 5 把同样的检测**挪到构建时**：跑一次、可全量审计（用另一版 SRT 交叉检验切词数）、可调参重跑、可人工抽查——同样算法从"不可控"变成"可验证"。**决定成败的不是算法本身，而是算法被放在管线里的哪个位置。**

**③ 时间戳有了声学锚点（精度原因）**

ASR/whisper 的时间戳是"按字符数比例估算"的，与真实语音可差 1.3s+。有了 Silero 语音区间后，句尾吸附到"语音结束"（静音起点）、句首吸附到"语音开始"（静音终点），估算误差在容差内全部被拉回真实边界；超出容差的（歌段拖唱）由尾部二次扫描兜底——延伸到"下一单元起点之前的最后一个静音起点"，安全性有严格保证（下一单元起点已吸附到语音开始，中间静音必属本单元拖尾）。

#### 4.5.3 复盘：三个实现坑（ONNX v5.1）

1. v5.1 签名是 `input[N,s] / state[2,N,128] / sr`，非旧文档的 h/c 分离输入；
2. **ONNX 图不管理上下文**：官方 Python 包装在模型外拼 64 样本历史，须自行复刻——漏拼概率全 0、语音区间 0 段；
3. `MIN_SPEECH=0.20s` 会滤掉唱歌段单词音节峰（grapes 尾峰仅 0.192s），须降到 0.10s。

#### 4.5.4 客观审计方法（推荐复用）

人耳抽查效率低且有主观性。方法：用 Silero 语音区间当"真值"，遍历 SRT 每个单元，统计句首/句尾落进语音段内部（距边缘 >150ms）的数量。切词数从 30 → 10 的下降是**可量化、可复现**的。剩余 10 处（5 尾 + 5 首）集中在说唱重叠段，属多人同时说话的固有问题，靠人工微调个别单元。

#### 4.5.5 当前生产状态（2026-09-05 晚）

- Ep01：Silero 版 138 单元已上 R2（`static/videos/Big_Muzzy_Ep01.en.srt`），`SRT_CACHE_VER=5`；
- 生产 Version `0775be79`，chunk `VideoPracticePage-GxfKAmtZ.js` md5 `654abec2…` 线上一致；
- 用户实测反馈：「效果好太多」；**待办：批量跑 Ep02-12**（`python scripts/resegment_srt.py <mp4> <srt> <out> --vad silero`，然后 `wrangler r2 object put … --remote` + bump `SRT_CACHE_VER`）。

---

*本日志由 Web 端开发会话生成（2026-07）。后续接手 agent 完成某功能后请更新对应 checkbox 与「最后更新」日期。
最近更新：2026-09-05 晚 — §4.5 记录切分方案五代演进，终选 Silero VAD 离线重切。*

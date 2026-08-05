# 会话交接文档 2026-08-04（夜间导出）

> 用途：新会话快速接手。本文件聚焦「当前状态 + 本会话改动 + 待办」，历史记忆全文见 `memory-export-20260804.md`（11:03 导出，47 条）与操作日志 `log-after-operation-2026-08-04.md`（revision=7，已含本会话全部记录）。

## 一、当前状态速查（新会话第一件事）

| 项目 | 值 |
|---|---|
| 项目根 | `C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix` |
| Android 包 | `com.example.ai`，Compose + Navigation 3 + 手动 DI + OkHttp，**禁用 Room**（files/ JSON 存储） |
| 服务端 | `server_py\`（FastAPI + uvicorn 0.0.0.0:8080，`python main.py` 启动，**带 StatReload 自动重载**） |
| **宿主机 IP** | **`192.168.1.3`（DHCP 动态！** 曾为 .7，本会话已把 App 内 6 处硬编码改为 .3） |
| 设备 | `4HPJM7W48XNR9XLV`（OPPO ColorOS，易锁屏断 adb） |
| APK | `app\build\outputs\apk\debug\app-debug.apk`（最新已装，含全部改动） |
| 客户端密钥 | 无（全部在服务端：百度 TTS / DeepSeek / 腾讯 SOE / 讯飞已归档） |
| 单测 | 78/78 通过（`gradlew :app:testDebugUnitTest`） |

## 二、本会话完成的工作（按时间线）

1. **断网提示全面补齐**（用户需求：必须联网的按钮断网要有提示；本地降级要告知"在用本地数据"）—— 24 处提示文案全部在代码里（grep 已验证）：
   - 看图识字：图片加载失败占位（SubcomposeAsyncImage）、发音播放失败 snackbar
   - 口述作文：生成结构/提示/润色/评分失败横幅
   - 导入中心：免费 AI 生成错误内联显示
   - TTS 全链路：`TtsEngine.speak` 返回 Boolean，10 处调用点失败 Toast「朗读失败，请检查网络」
   - 考试题库缓存命中提示、识字认读 3 处降级提示、词语造句默认句提示、我的学习/学习报告断网提示
2. **宿主机 IP 变化事故 + 修复**：用户报「加载题目失败」→ DHCP 把宿主 IP 从 192.168.1.7 变 192.168.1.3 → App 6 处硬编码改 .3（ServiceModule / BaiduTtsCache / ScoreClient / RecognitionViewModel / WordInfoRepository / network_security_config.xml）→ 编译装机 → 实机验证口述作文题目正常加载。
3. **TTS 断网闪退修复**：explore 审计 21 处网络调用，唯一崩溃链 = `BaiduTtsCache.download` 的 `execute()` 无 try-catch（断网 IOException → 未捕获协程闪退，影响认读/默写/词语/看图识字/视频quiz 页）。双保险修复：`BaiduTtsCache.download` 包 try-catch + `TtsEngine.speak` 回退分支包 try-catch。**断网实测词语页不闪退 ✅**。
4. 更早（本日 11:03 前，见导出文件）：文章跟读模块、看图识字离线反馈队列+自动同步、口述作文模块。

## 三、⚠️ 用户当前未解决的疑问（新会话优先跟进）

用户贴出断网提示改动表，说「**好像并没有按照你说的这些执行**」。静态验证：24 处文案全在代码里，且 2 处已断网实测亲眼可见（我的学习/词语页）。可能原因：
- 断网时看图识字**列表加载失败页直接挡住**，进不到卡片页 → 图片/发音提示无从显示（设计如此）
- 部分提示触发条件苛刻（权重接口失败才提示、需本地有题库缓存才显示缓存提示）
- 真机若有系统 TTS 引擎，朗读走离线路径不失败 → 无 Toast
**下一步**：问用户具体断网测了哪个页面、看到什么，再针对性排查（勿盲改）。

## 四、关键坑（血泪教训）

1. **🚫 禁止 `netsh interface ipv4 add address "WLAN" ...` 加别名 IP** —— 触发 WLAN 适配器重置 → 宿主机断网 + uvicorn 被杀，用户因此发火。恢复 = delete 别名地址。IP 变了就走改代码路线。
2. **宿主 bash「WaitDelay expired before I/O complete」是误报**：命令实际成功（exit 可能非零），adb 输出有效。连续失败会触发 loop guard 禁言警告，但可继续用。
3. **DHCP 会变 IP**：根治 = 路由器 MAC 绑定（用户已知，未做）。
4. **`multi_edit` 原子性**：同文件多 edit 有一个失败会整体回滚，注意逐个确认。

## 五、服务端关键端点

- `GET /api/v1/essays`（口述作文题目）
- `POST /api/v1/tts/synthesize`（body `{text, speaker:"5118", speed:5}`，speaker 必须字符串）
- `POST /api/v1/char-images/feedback`（看图识字反馈，离线队列自动补发）
- `POST /api/v1/llm/chat`（DeepSeek，5 元/天预算守卫）
- `POST /api/v1/soe/evaluate`（腾讯 SOE 服务端代理）
- 数据：`server_py/data/`（app.db、char_image_index.json、char_images/、char_audio/）、`cache/tts/`

## 六、设备实测路径备忘

- 口述作文入口：首页 → 语文练习卡片（约 [120,1218][960,1506]）→ 口述作文卡片（约 [132,1881][822,2025]）
- 词语练习入口：语文练习 → 词语（进入即自动 TTS 朗读）
- 断网模拟：`adb shell svc wifi disable; svc data disable`（测完 `svc wifi enable; svc data enable`）

## 七、遗留待办

- [ ] 用户疑问「断网提示没执行」的实测排查（见第三节）
- [ ] 路由器 MAC 绑定固定 IP（根治 DHCP 漂移）
- [ ] 学习报告/图片失败等提示仅静态确认，未逐一断网实测

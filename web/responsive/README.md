# Responsive Layout Audit — 响应式排版审计

基于 **Playwright + DOM 几何检测** 的自动化响应式审计，不依赖视觉模型评判"好不好看"，
只测"事实"：溢出、越界、负坐标、文字/图片溢出、触控目标、max-width 约束。

## 运行

```bash
npm run audit          # 跑全量审计（11 页 × 5 视口 ≈ 2.5 分钟，需 Vite dev 5173 + 后端 8080 在跑）
npm run audit:score    # 跑完并打印 分数 / P1 数
```

首次使用需先装浏览器：`npx playwright install chromium`

## 产物

| 输出 | 位置 |
|---|---|
| 控制台汇总 + JSON 报告 | `responsive/reports/latest.json`（`pass.json` 供脚本判断门槛） |
| 每页×视口截图 | `responsive/shots/*.png` |
| 通过门槛 | `pass.json`：`P1 === 0` 才算通过 |

## 配置（responsive/audit.config.ts）

- `VIEWPORTS`：三档标准尺寸（375/390/430、768/820/1024、1280/1440/1920）
- `DEFAULT_VIEWPORTS`：每页默认跑的档（移动 3 + 平板 820 + 桌面 1440）
- `PAGES`：页面清单（真实路由），每页可配 `expect`（Layout Contract 轻量版）：
  ```ts
  { name: "首页", url: "/web/home", expect: { mobileColumns: 1, maxContentWidth: 1280 } }
  ```
- 测试账号：`TEST_USER`（webtest/test1234，自动 UI 登录一次，共享 context）

## 规则（responsive/rules.ts，可增删）

| | 规则 | 级别 |
|---|---|---|
| R001 | 页面横向溢出 | P1 |
| R002 | 元素越出视口（横向/fixed） | P1 |
| R003 | 负坐标元素 | P1 |
| R004 | fixed 元素遮挡风险 | P2 |
| R005 | 触控目标 < 44×44（移动端） | P2 |
| R006 | 文字被裁剪/溢出 | P2 |
| R007 | 图片撑破容器 | P1 |
| R008 | 移动端多列过挤/违反单列契约 | P2 |
| R009 | 桌面内容缺 max-width | P3 |

评分：组合级（页×视口）干净=100 / 有 P3=85 / 有 P2=60 / 有 P1=0，取平均。

## 设计取舍

- **不做** Vision LLM 全自动评判：视觉模型对"拥挤/留白/层级"判断主观且贵，截图 + 报告留给人抽查。
- **不做** axe-core（第二阶段）：可访问性正交于此，别混进布局审计。
- DOM 采集与规则判断分离：`captureDOM()` 在页面跑（page.evaluate 只序列化函数体，勿引外部变量），规则在 Node 侧跑。
- 已知豁免：页面根容器（HTML/BODY/#root/全宽纵向容器）与横向滚动容器（scroll-snap 翻页）内的元素不算越界。
import { MATH_ICONS, DEFAULT_LINE_W, isOutline, type MathIconTone } from "../lib/mathIcons"

/**
 * 数学页共用的矢量简笔画图标（内联 SVG，无第三方依赖）。
 *
 * 颜色全部走 `currentColor`，所以任何主题/任何父级文字色下都自适应 ——
 * 调用方只要给个 color（或让父级文字色接管）即可。
 * tone 只控制"填充的实心程度"：
 *   soft（默认） 淡填充，物品类
 *   ink          实心，人/手类主体
 *   accent       强调填充，用于"当前正在讲的那个"
 *
 * 带 `"o"` 标记的图元只描边不填充，用来「挖空」（指甲盖、车窗…）。见 mathIcons.ts。
 */
const FILL_OPACITY: Record<MathIconTone, number> = { soft: 0.13, ink: 0.85, accent: 0.24 }
const STROKE_W: Record<MathIconTone, number> = { soft: 3, ink: 3, accent: 3.6 }

export interface MathIconProps {
  /** MATH_ICONS 里的键；打错时整个图标不渲染（而不是崩） */
  name: string
  /** 屏幕像素边长，默认 56 */
  size?: number
  /** 覆盖图标自带的 tone */
  tone?: MathIconTone
  className?: string
  style?: React.CSSProperties
  /** 无障碍标签；不传则视为纯装饰 */
  label?: string
}

export function MathIcon({ name, size = 56, tone, className, style, label }: MathIconProps) {
  const spec = MATH_ICONS[name]
  if (!spec) return null

  const t: MathIconTone = tone ?? spec.tone ?? "soft"
  const strokeW = STROKE_W[t]
  const base = FILL_OPACITY[t]

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      style={{ display: "block", flex: "0 0 auto", ...style }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {spec.prims.map((p, i) => {
        // 线段只有描边，不参与填充
        if (p[0] === "l") {
          return (
            <line
              key={i}
              x1={p[1]}
              y1={p[2]}
              x2={p[3]}
              y2={p[4]}
              stroke="currentColor"
              strokeWidth={p[5] ?? DEFAULT_LINE_W}
              strokeLinecap="round"
              fill="none"
            />
          )
        }

        const outline = isOutline(p)
        const common = {
          fill: "currentColor",
          fillOpacity: outline ? 0 : base,
          stroke: "currentColor",
          strokeWidth: strokeW,
        }

        if (p[0] === "p") {
          const pts: number[] = p[1]
          const d: string[] = []
          for (let k = 0; k + 1 < pts.length; k += 2) d.push(`${pts[k]},${pts[k + 1]}`)
          return p[2] ? (
            <polygon key={i} points={d.join(" ")} strokeLinejoin="round" {...common} />
          ) : (
            <polyline
              key={i}
              points={d.join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeW}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )
        }
        if (p[0] === "c") return <circle key={i} cx={p[1]} cy={p[2]} r={p[3]} {...common} />
        if (p[0] === "r")
          return <rect key={i} x={p[1]} y={p[2]} width={p[3]} height={p[4]} rx={0} {...common} />
        return <rect key={i} x={p[1]} y={p[2]} width={p[3]} height={p[4]} rx={p[5]} {...common} />
      })}
    </svg>
  )
}

export default MathIcon

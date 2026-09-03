/** HTML 表格安全渲染工具 — 只放行表格相关标签与属性，防 XSS */

const ALLOWED_TAGS = new Set([
  "table", "thead", "tbody", "tfoot", "caption",
  "tr", "td", "th", "br", "colgroup", "col", "span", "div", "p",
])
const ALLOWED_ATTRS = new Set(["colspan", "rowspan", "align", "scope", "width", "height", "style"])

/**
 * 清洗模型生成的表格 HTML：用浏览器 DOM 解析，移除非法标签/脚本/事件属性，
 * 只保留表格相关结构与 colspan/rowspan 合并信息。清洗失败返回 null。
 */
export function sanitizeTableHtml(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html")
  if (!doc.body) return null

  const walk = (node: Node) => {
    const children = Array.from(node.childNodes)
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element
        const tag = el.tagName.toLowerCase()
        if (!ALLOWED_TAGS.has(tag)) {
          // 非白名单元素：保留其文本，移除元素本身（展开文本）
          el.replaceWith(document.createTextNode(el.textContent ?? ""))
          continue
        }
        // 只保留白名单属性（colspan/rowspan 是最关键的合并信息）
        for (const attr of Array.from(el.attributes)) {
          if (attr.name.toLowerCase().startsWith("on")) {
            el.removeAttribute(attr.name)
            continue
          }
          if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) {
            el.removeAttribute(attr.name)
          }
        }
        walk(el)
      } else if (child.nodeType === Node.COMMENT_NODE) {
        child.parentNode?.removeChild(child)
      }
    }
  }
  walk(doc.body)

  const cleaned = doc.body.innerHTML
  // 若清洗后没有实际表格，视为无效
  return /<table[\s>]/i.test(cleaned) ? cleaned : null
}

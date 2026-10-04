/** 占位页 — 尚未迁移的模块入口 */

import { useParams, useNavigate } from "react-router-dom"
import { featureById } from "../../services/training"

export function PlaceholderPage() {
  const { featureId } = useParams<{ featureId: string }>()
  const navigate = useNavigate()
  const feature = featureId ? featureById(featureId) : undefined

  return (
    <div className="page">
      <header>
        <h1>{feature ? `${feature.emoji} ${feature.title}` : "模块"}</h1>
        <p>该模块正在迁移到 Web，敬请期待</p>
      </header>
      <div className="card" style={{ textAlign: "center", padding: "40px 16px" }}>
        <div style={{ fontSize: 48 }}>🚧</div>
        <p style={{ color: "#6b7280" }}>{feature?.subtitle ?? "功能开发中"}</p>
      </div>
      <button onClick={() => navigate(-1)}>← 返回</button>
    </div>
  )
}

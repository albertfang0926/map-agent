# 地图智能体（f-agent）设计文档

- **日期**：2026-07-08
- **项目**：f-agent —— 对话式地图智能体
- **状态**：设计已确认，待拆实现计划

---

## 1. 定位

**对话式地图智能体**：用户用自然语言对话，智能体查找地点、规划路线、智能推荐与行程编排、回答地理知识问答。Web 应用形态——左侧聊天窗 + 右侧地图实时渲染标记/路线/POI。

- **智能体深度**：深度智能体（多步推理 + 工具编排 + 记忆）
- **项目性质**：学习 / 原型（重架构清晰、可演示，不强求生产级扩缩容）
- **核心架构选型**：自建最小 Agent 循环（ReAct + function calling），不用框架，最大化学习价值

---

## 2. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 后端语言 | TypeScript (Node.js) | 与前端统一语言，类型贯通 |
| 后端框架 | Hono | 超轻量、现代、Web 标准，SSE/流式支持好，DX 极佳，几乎零魔法 |
| LLM | DeepSeek + GLM（双适配器，可切换） | 国内可用、function calling 支持好；agent 核心对厂商无感 |
| 地图服务 | 高德 AMap | 服务端 API（POI/路线/地理编码）+ 前端 JS SDK 渲染 |
| 长期记忆 | SQLite（better-sqlite3） | 零服务、文件级，原型足够 |
| 短期记忆 | 内存（会话级） | 快速、够用 |
| HTTP 客户端 | 原生 fetch（Node 18+） | 调用高德服务端 API |
| 前端框架 | Vue 3（Composition API）+ Vite | 轻量、组合式、生态成熟 |
| 前端状态 | Pinia | Vue 官方推荐 |
| 通信 | SSE 流式 + REST | agent 思考/工具过程实时推送；SSE 比 WebSocket 简单，单向推送够用 |
| 参数校验 | zod | 工具入参 schema 校验，同时生成 TS 类型，前后端共享 |
| 测试 | Vitest | TS/Vue 生态统一 |

### 三个关键"可插拔"边界

**LLM、地图服务、记忆存储**均通过抽象接口隔离，换实现不影响上层 agent 逻辑。这是"暂不锁定服务商"选择的落地——首个实现用 DeepSeek + 高德，后续可平替。

---

## 3. 架构与模块分解

```
f-agent/
├── server/                      # 后端 (TS + Hono)
│   ├── src/
│   │   ├── agent/               # 智能体核心（大脑）
│   │   │   ├── core.ts          #   ReAct 循环：思考→调用工具→观察→继续
│   │   │   ├── prompts.ts       #   系统提示词模板
│   │   │   └── planner.ts       #   复杂任务的任务拆解（行程规划等）
│   │   ├── tools/               # 工具集（智能体的"手脚"）
│   │   │   ├── base.ts          #   Tool 统一接口 + zod schema
│   │   │   ├── poi.ts           #   POI 搜索 / 周边查询
│   │   │   ├── routing.ts       #   路线规划（多模式/多途经点）
│   │   │   ├── geocode.ts       #   地理编码 / 逆地理编码
│   │   │   ├── knowledge.ts     #   地理知识问答
│   │   │   └── recommend.ts     #   智能推荐 / 行程编排
│   │   ├── maps/                # 地图适配器（隔离具体服务商）
│   │   │   ├── base.ts          #   MapProvider 抽象接口
│   │   │   └── amap.ts          #   高德实现
│   │   ├── memory/              # 记忆系统
│   │   │   ├── short_term.ts    #   会话级对话缓冲（内存）
│   │   │   └── long_term.ts     #   长期：偏好/收藏/历史（SQLite）
│   │   ├── llm/                 # LLM 客户端（可插拔）
│   │   │   ├── base.ts          #   LLM 抽象接口
│   │   │   ├── deepseek.ts      #   DeepSeek 实现
│   │   │   └── glm.ts           #   GLM 实现
│   │   ├── api/                 # Hono 路由 & SSE
│   │   │   └── server.ts
│   │   └── config.ts            # 配置 & API Key
│   └── package.json
└── web/                         # 前端 (Vue 3 + Vite)
    ├── src/
    │   ├── components/          # ChatPanel / MapPanel / ToolCallBubble / TracePanel
    │   ├── composables/         # useAgentStream (SSE) / useMap (高德 SDK)
    │   └── stores/              # Pinia: chatStore / mapStore / settingsStore
    └── package.json
```

**模块边界原则**：每个模块职责单一、接口清晰、可独立理解与测试。agent 核心只依赖 `llm/`、`tools/`、`memory/` 的抽象接口，不直接耦合具体厂商。

---

## 4. 核心功能清单

### A. 地点查找 / POI 搜索（`tools/poi.ts`）
- 关键词搜索：「找三里屯附近的咖啡馆」
- 周边搜索：「我当前位置 500 米内的餐厅」
- 类型/分类筛选：美食 / 酒店 / 景点 / 加油站…
- 批量打点：搜索结果一键渲染到右侧地图
- 详情展开：点击 POI 看评分、营业时间、电话

### B. 路线规划（`tools/routing.ts`）
- 多交通方式：驾车 / 公交 / 步行 / 骑行
- 多途经点：A→B→C→D 顺序规划
- 距离与时间估算：每段耗时、总里程
- 路线渲染：地图上画出折线 + 途经标记

### C. 智能推荐 / 行程规划（`tools/recommend.ts` + `agent/planner.ts`）
- 偏好推荐：「周末带小朋友去哪玩」——结合时间/天气/预算
- 多日行程编排：「上海三日游」——多步任务，由 planner 拆成"景点搜索→排序→分段→配路线"
- 约束满足：预算、时长、步行距离上限
- 按天可视化：地图上不同颜色区分第 1/2/3 天路线

### D. 地理知识问答（`tools/knowledge.ts` + `tools/geocode.ts`）
- 百科属性：「太湖面积多大」「成都人口」
- 空间关系：「杭州在南京的什么方向」「这三个城市哪个最近」
- 正/逆地理编码：「太湖的坐标」/「经度 120.2 纬度 30.3 是哪儿」

### E. 智能体核心能力（`agent/core.ts`）—— 跨工具的"大脑"

| 能力 | 说明 |
|---|---|
| 多步推理（ReAct） | 复杂任务自主拆解，调用多个工具组合完成 |
| 工具编排 | 例：先搜 POI → 再算路线 → 再排序推荐 |
| 主动澄清 | 信息不足时反问（「您出发地是？预算大概多少？」） |
| 流式输出 | 思考过程、工具调用实时推送到聊天窗（SSE） |
| 错误自恢复 | 工具失败时换关键词/换工具重试 |

### F. 记忆系统（`memory/`）
- **短期记忆**：当前会话上下文连续——「刚才那个地方再往前走」能接上
- **长期记忆**（SQLite）：
  - 用户偏好画像（喜欢安静、预算档位、出行偏好）
  - 收藏的地点 / 保存的行程
  - 历史会话摘要
- **个性化**：推荐时优先调用长期记忆里的偏好

### G. 前端交互（Vue 3 `web/`）
- 双栏布局：左聊天 / 右地图，联动
- 实时渲染：标记、路线、热区随对话动态出现
- 工具过程可视化：「🔍 正在搜索 POI…」「🗺️ 规划路线中…」
- 点击联动：点地图标记 → 高亮对应对话消息；反之亦然
- 收藏操作：地图/对话里一键存入长期记忆

### H. 可观测 & 调试（学习项目加分项）
- Trace 面板：查看每次 agent 的 think→act→observe 全过程
- LLM 切换：一键切 DeepSeek / GLM，对比同一问题的表现
- 工具调用日志：每次工具的输入/输出可展开查看

---

## 5. Agent 核心循环（ReAct）

```
用户消息 + 短期记忆
      ↓
  ┌─ LLM 决策（function calling）──────────┐
  │  ① 给出最终回复 → 流式返回，结束        │
  │  ② 决定调用工具 → 执行工具 → 把结果     │
  │     作为 observation 喂回 → 回到 ①      │
  │  ③ 信息不足 → 反问用户                 │
  └──────────────────────────────────────────┘
```

每一步通过 SSE 推到前端，用户能"看见"智能体在思考、调工具。最大循环次数设上限，防止失控。

---

## 6. 记忆系统设计

- **短期记忆**：最近 N 轮对话 + 工具调用摘要，存内存/会话 store，按会话 ID 隔离
- **长期记忆**（SQLite 三张表）：
  - `preferences`：用户偏好画像（键值/JSON）
  - `saved_places`：收藏地点（POI id、名称、坐标、标签）
  - `session_summaries`：历史会话摘要
- agent 可通过记忆工具读写长期记忆；推荐工具读取偏好做个性化

---

## 7. 前端 UX 细节

**布局**（桌面优先，响应式）：
```
┌─────────────────────────────────────────────────┐
│  TopBar: [新对话] [会话切换]  LLM: DeepSeek▾      │
├──────────────────────┬──────────────────────────┤
│   ChatPanel          │   MapPanel (高德 JS SDK)  │
│   ├ 用户消息          │   ├ 标记 / 路线 / 热区    │
│   ├ 🔍搜索POI中…(卡片)│   ├ POI 列表 (侧边)       │
│   ├ 助手回复 (流式)    │   └ 点击↔对话联动        │
│   └ 输入框            │                          │
├──────────────────────┴──────────────────────────┤
│  TracePanel (可折叠): think→act→observe 步骤      │
└─────────────────────────────────────────────────┘
```

- **关键组件**：`ChatPanel` / `MessageList` / `ToolCallBubble`（工具调用卡片）/ `MapPanel` / `TracePanel`
- **Composables**：`useAgentStream`（SSE 流）/ `useMap`（封装高德 SDK，暴露 addMarkers/drawRoute/clear）
- **Pinia stores**：`chatStore`（消息）/ `mapStore`（地图数据：标记、路线）/ `settingsStore`（LLM 选择、偏好）

---

## 8. 数据流示例

场景：*「帮我规划上海两日游，预算 2000，喜欢人文景点」*

```
1. 用户输入 → POST /api/chat (SSE)
2. server 加载短期记忆 + 从 SQLite 取用户偏好
3. agent/core 调 LLM(DeepSeek, function calling)
4. LLM 多步决策：
   ① poi.search("上海 人文景点")      → POI 列表
   ② poi.search 补充/筛选             → 精选景点
   ③ routing(景点间路线)               → 距离/耗时
   ④ recommend(按 2 天 + 预算排序)     → 行程
5. 每步 SSE 推送 {type:"tool_call"/"observation"} → 聊天窗显示卡片
6. LLM 流式输出最终行程 + 结构化地图数据
   → 前端 mapStore 更新 → 地图按天渲染不同颜色路线
7. 行程存入长期记忆；用户偏好更新
```

**SSE 事件类型**：`token`（流式文本）/ `tool_call`（开始调工具）/ `observation`（工具结果）/ `map_update`（结构化地图数据：markers/routes）/ `done`（结束）/ `error`

---

## 9. 功能分期路线图

每期都能独立演示，适合学习项目增量推进。

| 阶段 | 目标 | 关键交付 |
|---|---|---|
| **P0 骨架打通** | 一句话端到端跑通 | Hono + `/api/chat` + LLM 抽象(先 DeepSeek) + 1 个工具 `poi.search` + Vue 双栏 + 高德打点 |
| **P1 Agent 核心** | 多步多工具 | 完整 ReAct 循环 + `routing`/`geocode`/`knowledge` + 短期记忆 + SSE 流式 |
| **P2 深度能力** | 推荐与个性化 | `recommend` + planner 拆解 + 长期记忆(SQLite) + 个性化推荐 |
| **P3 体验打磨** | 可观测+对比 | GLM 适配器 + LLM 切换对比 + Trace 面板 + 地图对话联动 + 收藏 + 错误自恢复/澄清 |

**P0 最小闭环**：用户输入「找三里屯的咖啡馆」→ agent 调 `poi.search` → 结果渲染为地图标记 + 聊天列表。先打通这一条链路，再横向加工具、纵向加深度。

---

## 10. 错误处理

- **LLM 调用失败**：重试 → 降级（切另一个 LLM）→ 友好提示
- **地图 API 失败**：限流/超时 → observation 带错误 → agent 换关键词或告知用户
- **SSE 断连**：前端自动重连
- **参数校验**：工具入参用 zod 做 schema 校验，校验失败直接回错误，不进 LLM
- **循环失控**：agent 最大迭代次数上限（如 10 步），超出则终止并提示

---

## 11. 测试

- **工具层**：单元测试，mock 高德 API（Vitest），每个工具独立测
- **maps 适配器**：mock HTTP，测响应解析逻辑
- **agent 循环**：mock LLM（固定返回"调某工具"）验证 think→act→observe 流转
- **端到端**：1–2 个关键场景（POI 搜索、行程规划）

---

## 12. 待定 / 后续决策

- LLM 之间的"按任务路由"或"A/B 对比"留到 P3 再定（当前仅配置切换）
- 地图服务商扩展（百度/Mapbox）：抽象层已就位，按需补适配器
- 是否引入向量检索做长期记忆语义召回：P2 评估，原型阶段先用结构化存储

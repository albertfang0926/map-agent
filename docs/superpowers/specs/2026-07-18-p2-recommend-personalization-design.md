# P2 推荐与个性化 — 设计文档

- **日期**：2026-07-18
- **项目**：f-agent —— 对话式地图智能体
- **阶段**：P2（推荐与个性化）
- **状态**：设计已确认，待拆实现计划
- **关联**：总设计 `2026-07-08-map-agent-design.md` §4.C / §6 / §9；P1 计划 `2026-07-11-p1-agent-core.md`
- **前置**：P0 + P1 已完成（40 后端单测全绿、ReAct 循环、4 工具、短期记忆、DeepSeek 流式 SSE）

---

## 1. 背景与范围

P2 在 P1 三层可插拔边界（LLM / MapProvider / Memory）之上补齐「推荐与个性化」能力。本 spec 覆盖完整 P2（设计文档 §9）：

1. **长期记忆（SQLite）**：`preferences` / `saved_places` / `session_summaries` 三表，持久化跨会话。
2. **`recommend` 工具 + `agent/planner.ts` 组装器**：把候选 POI 组装成按天分段、配好路线的行程。
3. **个性化推荐**：recommend 读取长期偏好影响排序。
4. **记忆读写闭环**：两个记忆工具（`save_place`、`remember_preference`）+ 会话摘要写/读闭环。
5. **最小前端联动**：行程按天可视化（复用 P1 多色折线）。

收藏按钮、偏好设置 UI、地图↔对话联动等明确归 P3（§9），不在本 spec。

---

## 2. 关键设计决策

1. **SQLite 用 `node:sqlite`（Node 24 内置）**，不用 better-sqlite3。已在本机 Node v24.17.0 验证：`import { DatabaseSync } from 'node:sqlite'` 直接可用，**无需 `--experimental-sqlite` flag、零依赖、零原生编译**，同步 API（`prepare/get/all/run`）与 better-sqlite3 一致。符合 P1「无新增依赖」哲学。代价：实验性 API（理论可能变）；`@types/node`（当前 ^22.20.0）可能需升到 v24 以获最佳类型。
2. **Memory 接口异步化**：`LongTermMemory` 方法全部返回 `Promise`，即使 node:sqlite 内部同步。吸取 P1 教训（短期记忆同步 `save` 未 `await` 会丢），先异步化，未来换 Redis/异步 DB 不破坏调用方；工具 `execute` 本身即 `async`。
3. **recommend 是 LLM 工具，planner 是纯算法组装器**：`tools/recommend.ts`（`createRecommendTool(map, memory)`）是 agent 可调工具；`agent/planner.ts`（`planItinerary`）是无 LLM、无 IO 的纯函数，做分组 + 排序。agent ReAct 循环不变，LLM 自己编排 `poi_search → recommend`（契合 §8 数据流）。
4. **planner 只做分组排序，recommend 配路线**：planner 零依赖、极易单测；配路线需 IO（`map.planRoute`），由 recommend 负责。
5. **精简记忆工具 + 自动读偏好**：给 agent 两个工具 `save_place`、`remember_preference`（LLM 显式调用，可观测）；recommend 内部自动读偏好做个性化（不暴露给 LLM）。不提供 get 工具（YAGNI）。
6. **session_summaries 写读闭环纳入 P2**：每轮后（user 轮数 ≥ 2）fire-and-forget 生成/更新摘要；新会话首轮注入最近 3 条摘要到 system 提示，使长期记忆真正影响 agent。
7. **预算约束 P2 仅占位**：`budget` 入参接受透传，但不做强约束——POI 无价格数据。真实预算约束需 POI 价格字段，留后续。

---

## 3. 架构与模块划分

延续三层可插拔边界。Memory 层补全为 `ShortTermMemory`（会话级，已有）+ `LongTermMemory`（持久化，新增）。

### 新增文件

| 文件 | 职责 |
|---|---|
| `server/src/memory/long_term.ts` | `LongTermMemory` 接口 + node:sqlite 实现（三表 CRUD） |
| `server/src/agent/planner.ts` | 纯算法行程组装器：候选 POI + 约束 → 按天分组 + 排序（无 LLM、无 IO） |
| `server/src/tools/recommend.ts` | `createRecommendTool(map, memory)`：工具入口，内部调 planner + 读偏好 + 配路线 |
| `server/src/tools/memory_tools.ts` | `createSavePlaceTool(memory)`、`createRememberPreferenceTool(memory)` |
| `server/src/agent/summary.ts` | `createSessionSummarizer(llm)`：会话消息 → 摘要 |
| 对应 `…/.test/*.test.ts` | 每个新业务文件配 `.test/` 单测（延续新约定） |

### 修改文件

| 文件 | 改动 |
|---|---|
| `server/src/types.ts` | 加 `Preference`/`SavedPlace`/`SessionSummary`/`Itinerary`/`ItineraryDay` 数据类型 |
| `server/src/agent/prompts.ts` | system 提示增补 recommend / save_place / remember_preference 用法 + 「用户历史」段（注入摘要） |
| `server/src/api/server.ts` | 装配 `LongTermMemory`（node:sqlite）+ 4 个新工具；首轮注入摘要；每轮后 fire-and-forget 摘要 |
| `server/src/config.ts` | 加 `sqlitePath`（默认 `./data/fagent.db`） |
| `web/src/stores/chat.ts` | observation 处理 `recommend` 返回的多 route → `setRoutes([...])` |

### 边界原则

`runAgent` 只依赖抽象接口，签名不变；`recommend` 依赖 `MapProvider` + `LongTermMemory` 抽象；planner 是无依赖纯函数。无新增 `AgentEvent`（recommend / 记忆工具复用 `tool_call`/`observation`）。现有 40 测试保持全绿。

---

## 4. 长期记忆子系统

### 4.1 接口（`memory/long_term.ts`，异步）

```ts
export interface LongTermMemory {
  // preferences：键值/JSON 偏好画像
  getPreference(key: string): Promise<string | undefined>;
  getAllPreferences(): Promise<Record<string, string>>;
  setPreference(key: string, value: string): Promise<void>;
  // saved_places：收藏地点
  savePlace(place: SavedPlace): Promise<void>;
  getPlaces(): Promise<SavedPlace[]>;
  // session_summaries：会话摘要
  saveSummary(sessionId: string, summary: string, messageCount: number): Promise<void>;
  getRecentSummaries(limit: number): Promise<SessionSummary[]>;
}
```

`Preference`/`SavedPlace`/`SessionSummary` 数据类型放 `types.ts`：

```ts
interface Preference { key: string; value: string; updatedAt: string; }
interface SavedPlace { id: string; name: string; location: LngLat; address?: string; tags?: string[]; savedAt: string; }
interface SessionSummary { sessionId: string; summary: string; messageCount: number; updatedAt: string; }
```

### 4.2 三表 schema（node:sqlite，首次打开 `CREATE TABLE IF NOT EXISTS` 迁移）

```sql
CREATE TABLE IF NOT EXISTS preferences (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS saved_places (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, lng REAL NOT NULL, lat REAL NOT NULL,
  address TEXT, tags TEXT, saved_at TEXT NOT NULL          -- tags 存 JSON 数组串
);
CREATE TABLE IF NOT EXISTS session_summaries (
  session_id TEXT PRIMARY KEY, summary TEXT NOT NULL,
  message_count INTEGER NOT NULL, updated_at TEXT NOT NULL
);
```

### 4.3 实现

`createLongTermMemory(opts: { dbPath: string })` → `new DatabaseSync(dbPath)`，`prepare().get/all/run` 同步调用后包 `Promise.resolve(...)`；`tags` 用 `JSON.stringify/parse`。生产路径取 `config.sqlitePath`（默认 `./data/fagent.db`，启动时确保 `data/` 目录存在）。

### 4.4 记忆工具（`tools/memory_tools.ts`）

- `save_place`：入参 `{ id, name, location:{lng,lat}, address?, tags? }` → `memory.savePlace` → `{ saved: id }`
- `remember_preference`：入参 `{ key, value }` → `memory.setPreference` → `{ remembered: key }`

### 4.5 session_summaries 闭环

- **写入**：每轮 `/api/chat` 处理完、短期记忆落库后，若该会话累计 user 轮数 ≥ 2，**fire-and-forget**（不 await、不阻塞 SSE）调 `summary.ts`（LLM）生成/更新该会话摘要存表。
- **读取/生效**：新会话首轮（该 sessionId 无短期记忆）时，取最近 3 条摘要拼进 system 提示的「用户历史」段。

### 4.6 会话摘要素材（`agent/summary.ts`）

`createSessionSummarizer(llm)`：接收该会话 messages，去掉 system 后压成一段中文摘要（≤ 100 字），调 LLM 一次（非流式 `chat`），返回摘要文本。供 server 写入 `session_summaries`。

---

## 5. recommend + planner + 个性化

### 5.1 planner（`agent/planner.ts`，纯函数）

```ts
planItinerary(pois: MapPOI[], opts: { days: number; preferences?: Record<string,string> }): ItineraryDayDraft[]
// ItineraryDayDraft = { day: number; places: MapPOI[] }  （已排序，无路线）
```

算法（原型级）：
1. **打分**：每个 POI 按 preferences 匹配度加分（偏好 value 命中 `name`/`typecode` → 加分）—— 个性化核心。
2. **分天**：按分数降序 round-robin 分入 day 1..days（高分优先、每天数量均衡）。
3. **天内排序**：贪心就近（从首个起每次选最近未排点），让同一天路线不绕。

### 5.2 recommend（`tools/recommend.ts`，`createRecommendTool(map, memory)`）

入参（zod）：`{ pois: MapPOI[], days: number, budget?: number }`（LLM 把 `poi_search` 候选传入，契合 §8 `poi.search → recommend`）。内部：

1. `memory.getAllPreferences()` 读偏好；
2. `planItinerary(pois, { days, preferences })` 分组排序；
3. 对每天 `places.length ≥ 2` 的，调 `map.planRoute`（driving，相邻 place 串成线）生成 `RouteResult`；
4. 返回 `{ itinerary: Itinerary; preferencesUsed: Record<string,string> }`。

行程数据结构（`types.ts`）：

```ts
interface ItineraryDay { day: number; places: MapPOI[]; route?: RouteResult; }
interface Itinerary { days: ItineraryDay[]; }
```

个性化注入：planner 用 preferences 打分；`preferencesUsed` 回传，可观测 agent 用了哪些偏好。

### 5.3 前端联动（`web/src/stores/chat.ts`，小改）

observation `tool === 'recommend'` 时，把 `itinerary.days[].route` 收集成 `RouteData[]` → `map.setRoutes([...])`。MapPanel 已支持 routes 数组 + `ROUTE_COLORS`，自动按天画不同色折线。

---

## 6. 数据流（端到端）

场景：「上海三日游，预算 2000，喜欢人文景点」

1. `POST /api/chat` → server 加载短期记忆；**首轮注入**：该 sessionId 无短期记忆时，取最近 3 条 `session_summaries` 拼进 system 提示「用户历史」段。
2. `runAgent`（ReAct 不变）多步决策：
   - ① `poi_search("上海 人文景点")` → 候选 POI（observation，地图打点）
   - ② `recommend({pois, days:3, budget:2000})` → 读偏好 + planner 分组排序 + 每天配路线 → `Itinerary`（observation）
   - ③（可选）`remember_preference({key:"travel_style", value:"人文"})`、`save_place({...})`
   - ④ LLM 流式输出行程总结 → `message`
3. `runAgent` 返回 messages → `memory.save(sessionId)`（短期，已有）。
4. **会话摘要**（该会话 user 轮数 ≥ 2）：fire-and-forget `summarizer`(LLM) → `long_term.saveSummary`。
5. 前端：recommend observation → `setRoutes(按天多色)`；poi observation → `setPois`。

---

## 7. 错误处理

- **SQLite 初始化失败**（路径不可写）→ server 启动即报错退出（原型，明确失败）。
- **工具内 memory/配路线异常** → `runAgent` 已有 `try/catch` 包 `tool.execute`，回 `{error}` observation。
- **某天 `planRoute` 抛错** → 该天 `route` 省略（places 仍在），不整体失败。
- **summarizer LLM 失败 / 首轮注入取摘要失败** → catch + 日志，**不阻塞主流程**（非关键路径）。
- **入参 zod 校验**（P1 风格），校验失败回错误，不进 LLM。

---

## 8. 测试策略

延续 P1，每个新业务文件配 `.test/` 单测，DI mock 不触网/不触盘：

- `planner`：纯函数，测分天均衡 / 偏好打分 / 天内就近。
- `long_term`：`:memory:` 库测三表 CRUD + 会话隔离。
- `recommend`：mock map + mock memory，测编排（调 planner + 配路线 + 读偏好 + 个性化排序）。
- `memory_tools`：mock memory，测 save_place / remember_preference。
- `summary`：mock LLM，测生成摘要并调 saveSummary。
- `api/server`：加测新工具装配 + 首轮摘要注入路径。
- **现有 40 测试保持全绿**；`runAgent` 签名不变；无新增 `AgentEvent`。
- 前端：`vue-tsc --noEmit` + 手动验证（无前端单测，同 P1）。
- 真实 key e2e：行程按天折线、收藏/记偏好、跨会话历史注入、短期记忆回归。

---

## 9. 完成标准（Definition of Done）

- 后端新增单测全绿 + **现有 40 测试保持全绿**。
- `cd server && npx tsc --noEmit` 通过；`cd web && npx vue-tsc --noEmit` 通过。
- `pnpm install` **不引入原生模块**（node:sqlite 内置，无 better-sqlite3）。
- 浏览器 e2e 跑通四类场景：多日行程按天多色折线、收藏/记偏好生效、跨会话历史摘要注入、短期记忆回归。
- 按 SDD 分 task、就地 `main`、每 task 一个 commit。

---

## 10. 待定 / 后续

- **预算约束**：POI 无价格数据，P2 仅占位；真实预算扣减需 POI 价格字段，留后续。
- **向量检索语义召回**：长期记忆先用结构化存储（本 spec）；语义召回（如「我之前想去的那种地方」）评估留 P3+（总设计 §12）。
- **session_summaries 注入策略**：P2 用「最近 3 条」启发式；更智能的相关性召回留后续。
- **planner 算法**：P2 用贪心（分天 + 就近）；更优的 TSP/聚类编排留后续。
- **`@types/node` 升级**：若 node:sqlite 类型不足，升到 v24（实现时确认）。

---

## 11. 自检（Self-Review）

- **Spec 覆盖**：设计 §9 P2 = recommend + planner + 长期记忆(SQLite) + 个性化。本 spec 全覆盖（§3 模块、§4 记忆、§5 recommend/planner、§6 数据流）。✓
- **占位符扫描**：无 TBD/TODO；预算约束、向量检索等明确归入 §10「待定/后续」而非悬空。✓
- **内部一致**：planner「纯函数只分组排序」与 recommend「配路线」职责切分在 §2.4、§5.1、§5.2 一致；`LongTermMemory` 异步在 §2.2、§4.1 一致；session_summaries 写读闭环在 §2.6、§4.5、§6 一致。✓
- **类型一致**：`ItineraryDay`/`Itinerary`/`SavedPlace`/`SessionSummary` 跨 §4/§5 签名一致；recommend 返回 `{itinerary, preferencesUsed}`，前端 chat.ts 据此取 `days[].route`。✓
- **向后兼容**：`runAgent` 签名不变、无新增 `AgentEvent`、新工具为新增、config 加字段；现有 40 测试保持绿。✓
- **YAGNI**：不暴露 get 记忆工具、预算不强约束、planner 用贪心、向量检索留后续——均克制。✓

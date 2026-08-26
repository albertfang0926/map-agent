# P2 推荐与个性化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 P1 之上补齐「推荐与个性化」——长期记忆（node:sqlite 三表）、`recommend` 工具 + `planner` 纯算法组装器、两个记忆工具、个性化推荐、会话摘要写读闭环、行程按天可视化。

**Architecture:** 延续三层可插拔边界。Memory 层补全为 `ShortTermMemory`（已有）+ `LongTermMemory`（新增，node:sqlite）。`recommend` 是 agent 可调工具（依赖 MapProvider + LongTermMemory），内部调 `agent/planner.ts` 纯函数（分组排序）并为每天配路线。`runAgent` 加**可选** `historySummaries` 参数（向后兼容，现有调用/测试不变）透传给 `buildSystemPrompt`，实现首轮历史注入。每轮后 fire-and-forget 生成会话摘要。

**Tech Stack:** TypeScript, Hono, zod, vitest, tsx, **node:sqlite（Node 24 内置，无新依赖）**；Vue 3 + Pinia（前端最小联动）。

## Global Constraints

- Node 24.17+，`node:sqlite` 内置已验证可直接 `import`（无需 `--experimental-sqlite`）。若 `tsc` 报 `node:sqlite` 类型缺失，升 `@types/node` 至 `^24`。
- 所有外部依赖（fetch、LLM、MapProvider、LongTermMemory）走依赖注入；单测不触网、不触盘（`LongTermMemory` 测试用 `:memory:`）。
- 后端每个业务文件配 `.test/` 子文件夹下的同名单测；TDD 先红后绿。
- **现有 40 个后端测试保持全绿**（向后兼容）；`runAgent` 仅加可选参数；无新增 `AgentEvent`。
- 包管理器 pnpm；就地 `main` 提交；每个 Task 一个 commit。
- `LngLat = { lng: number; lat: number }`；`MapPOI` 已含 `id/name/location/address?/typecode?`。
- 后端命令：单测 `cd server && pnpm exec vitest run <path>`；全量 `cd server && pnpm test`；类型 `cd server && pnpm exec tsc --noEmit`。前端类型 `cd web && pnpm exec vue-tsc --noEmit`。

---

## 设计决策（写在前面的关键取舍）

1. **node:sqlite 而非 better-sqlite3**：零依赖、零原生编译，已验证 Node 24.17 可直接用。
2. **LongTermMemory 接口异步**：方法返回 `Promise`（即使内部同步），面向未来 + 吸取 P1「同步 save 未 await 会丢」教训。
3. **planner 纯函数只做分组排序，recommend 配路线**：planner 零依赖极易测；路线需 IO 归 recommend。
4. **runAgent 加可选 `historySummaries`**：为首轮历史注入，向后兼容（spec §3「签名不变」解读为「不破坏现有调用」）。
5. **预算约束 P2 仅占位**：POI 无价格数据，不强约束（spec §10）。
6. **session_summaries 写读闭环**：每轮 user 轮数 ≥ 2 时 fire-and-forget 写摘要；首轮注入最近 3 条到 system。

---

## 文件结构

```
server/src/
├── types.ts                    # 修改：追加 Preference/SavedPlace/SessionSummary/Itinerary/ItineraryDay/ItineraryDayDraft
├── memory/long_term.ts         # 新增：LongTermMemory 接口 + node:sqlite 实现
├── memory/.test/long_term.test.ts  # 新增
├── tools/memory_tools.ts       # 新增：save_place / remember_preference 工具
├── tools/.test/memory_tools.test.ts # 新增
├── agent/planner.ts            # 新增：planItinerary 纯函数
├── agent/.test/planner.test.ts # 新增
├── tools/recommend.ts          # 新增：createRecommendTool(map, memory)
├── tools/.test/recommend.test.ts # 新增
├── agent/summary.ts            # 新增：createSessionSummarizer(llm)
├── agent/.test/summary.test.ts # 新增
├── agent/prompts.ts            # 修改：buildSystemPrompt 加 historySummaries + 新工具规则
├── agent/.test/prompts.test.ts # 新增
├── agent/core.ts               # 修改：runAgent 加可选 historySummaries 透传
├── config.ts                   # 修改：加 sqlitePath
├── api/server.ts               # 修改：装配长期记忆 + 5 工具 + 首轮注入 + fire-and-forget 摘要
└── api/.test/server.test.ts    # 修改：现有 createApp 注入 mockLTM + 加首轮注入测试

web/src/
└── stores/chat.ts              # 修改：observation 加 recommend 分支（多 route 按天）
```

---

## Task 1：扩展共享类型

**Files:**
- Modify: `server/src/types.ts`（末尾追加）

**Interfaces:**
- Produces: `Preference`/`SavedPlace`/`SessionSummary`/`ItineraryDay`/`Itinerary`/`ItineraryDayDraft`，后续所有任务依赖。

- [ ] **Step 1: 在 `server/src/types.ts` 末尾追加 P2 类型**

```ts
// ===== P2：长期记忆与行程 =====

// 用户偏好画像（键值/JSON）
export interface Preference {
  key: string;
  value: string;
  updatedAt: string;
}

// 收藏地点
export interface SavedPlace {
  id: string;
  name: string;
  location: LngLat;
  address?: string;
  tags?: string[];
  savedAt: string;
}

// 历史会话摘要
export interface SessionSummary {
  sessionId: string;
  summary: string;
  messageCount: number;
  updatedAt: string;
}

// 行程单天（含配好的路线）
export interface ItineraryDay {
  day: number;
  places: MapPOI[];
  route?: RouteResult;
}

// 行程
export interface Itinerary {
  days: ItineraryDay[];
}

// planner 内部草稿（已分组排序，无路线）
export interface ItineraryDayDraft {
  day: number;
  places: MapPOI[];
}
```

- [ ] **Step 2: 类型检查**

Run: `cd server && pnpm exec tsc --noEmit`
Expected: 无错误（纯类型追加，不影响现有代码）。

- [ ] **Step 3: 全量测试不回归**

Run: `cd server && pnpm test`
Expected: 40 passed。

- [ ] **Step 4: 提交**

```bash
git add server/src/types.ts
git commit -m "feat: add P2 long-term memory and itinerary types" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2：长期记忆（node:sqlite，TDD）

**Files:**
- Create: `server/src/memory/long_term.ts`
- Test: `server/src/memory/.test/long_term.test.ts`

**Interfaces:**
- Consumes: `Preference`/`SavedPlace`/`SessionSummary`（Task 1）。
- Produces: `LongTermMemory` 接口 + `createLongTermMemory({ dbPath })`。供 Task 3/5/8 使用。

- [ ] **Step 1: 写失败测试 `server/src/memory/.test/long_term.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createLongTermMemory } from '../long_term';
import type { SavedPlace } from '../../types';

function mem() {
  return createLongTermMemory({ dbPath: ':memory:' });
}

describe('LongTermMemory (node:sqlite)', () => {
  it('setPreference / getPreference', async () => {
    const m = mem();
    expect(await m.getPreference('x')).toBeUndefined();
    await m.setPreference('travel_style', '人文');
    expect(await m.getPreference('travel_style')).toBe('人文');
  });

  it('getAllPreferences 返回多条', async () => {
    const m = mem();
    await m.setPreference('a', '1');
    await m.setPreference('b', '2');
    expect(await m.getAllPreferences()).toEqual({ a: '1', b: '2' });
  });

  it('setPreference 覆盖同 key', async () => {
    const m = mem();
    await m.setPreference('k', 'old');
    await m.setPreference('k', 'new');
    expect(await m.getPreference('k')).toBe('new');
    expect(Object.keys(await m.getAllPreferences())).toHaveLength(1);
  });

  it('savePlace / getPlaces 字段映射 + tags JSON', async () => {
    const m = mem();
    const place: SavedPlace = {
      id: 'p1', name: '外滩', location: { lng: 121.49, lat: 31.24 },
      address: '上海', tags: ['景点', '人文'], savedAt: '2026-07-18T00:00:00.000Z',
    };
    await m.savePlace(place);
    expect(await m.getPlaces()).toEqual([place]);
  });

  it('savePlace 覆盖同 id', async () => {
    const m = mem();
    await m.savePlace({ id: 'p1', name: '旧', location: { lng: 1, lat: 2 }, savedAt: 't1' });
    await m.savePlace({ id: 'p1', name: '新', location: { lng: 1, lat: 2 }, savedAt: 't2' });
    const got = await m.getPlaces();
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe('新');
  });

  it('getRecentSummaries limit 截断', async () => {
    const m = mem();
    await m.saveSummary('s1', '一', 2);
    await m.saveSummary('s2', '二', 4);
    expect(await m.getRecentSummaries(1)).toHaveLength(1);
    expect(await m.getRecentSummaries(10)).toHaveLength(2);
  });

  it('saveSummary 覆盖同 sessionId', async () => {
    const m = mem();
    await m.saveSummary('s1', 'old', 2);
    await m.saveSummary('s1', 'new', 5);
    const got = await m.getRecentSummaries(10);
    expect(got).toHaveLength(1);
    expect(got[0].summary).toBe('new');
    expect(got[0].messageCount).toBe(5);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && pnpm exec vitest run src/memory/.test/long_term.test.ts`
Expected: FAIL，"Cannot find module '../long_term'"。

- [ ] **Step 3: 实现 `server/src/memory/long_term.ts`**

```ts
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { Preference, SavedPlace, SessionSummary } from '../types';

export interface LongTermMemory {
  getPreference(key: string): Promise<string | undefined>;
  getAllPreferences(): Promise<Record<string, string>>;
  setPreference(key: string, value: string): Promise<void>;
  savePlace(place: SavedPlace): Promise<void>;
  getPlaces(): Promise<SavedPlace[]>;
  saveSummary(sessionId: string, summary: string, messageCount: number): Promise<void>;
  getRecentSummaries(limit: number): Promise<SessionSummary[]>;
}

export function createLongTermMemory(opts: { dbPath: string }): LongTermMemory {
  // 文件型库：确保目录存在（:memory: 跳过）
  if (opts.dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });
  }
  const db = new DatabaseSync(opts.dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS saved_places (id TEXT PRIMARY KEY, name TEXT NOT NULL, lng REAL NOT NULL, lat REAL NOT NULL, address TEXT, tags TEXT, saved_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS session_summaries (session_id TEXT PRIMARY KEY, summary TEXT NOT NULL, message_count INTEGER NOT NULL, updated_at TEXT NOT NULL);
  `);

  const now = () => new Date().toISOString();

  const stmtGetPref = db.prepare('SELECT value FROM preferences WHERE key = ?');
  const stmtAllPref = db.prepare('SELECT key, value FROM preferences');
  const stmtSetPref = db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)');
  const stmtSavePlace = db.prepare('INSERT OR REPLACE INTO saved_places (id, name, lng, lat, address, tags, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const stmtGetPlaces = db.prepare('SELECT id, name, lng, lat, address, tags, saved_at FROM saved_places ORDER BY saved_at DESC');
  const stmtSaveSummary = db.prepare('INSERT OR REPLACE INTO session_summaries (session_id, summary, message_count, updated_at) VALUES (?, ?, ?, ?)');
  const stmtRecentSummaries = db.prepare('SELECT session_id, summary, message_count, updated_at FROM session_summaries ORDER BY updated_at DESC LIMIT ?');

  return {
    async getPreference(key) {
      const row = stmtGetPref.get(key) as { value: string } | undefined;
      return row?.value;
    },
    async getAllPreferences() {
      const rows = stmtAllPref.all() as Array<{ key: string; value: string }>;
      const out: Record<string, string> = {};
      for (const r of rows) out[r.key] = r.value;
      return out;
    },
    async setPreference(key, value) {
      stmtSetPref.run(key, value, now());
    },
    async savePlace(place) {
      stmtSavePlace.run(
        place.id, place.name, place.location.lng, place.location.lat,
        place.address ?? null, place.tags ? JSON.stringify(place.tags) : null, place.savedAt,
      );
    },
    async getPlaces() {
      const rows = stmtGetPlaces.all() as Array<{
        id: string; name: string; lng: number; lat: number;
        address: string | null; tags: string | null; saved_at: string;
      }>;
      return rows.map((r): SavedPlace => ({
        id: r.id, name: r.name, location: { lng: r.lng, lat: r.lat },
        address: r.address ?? undefined, tags: r.tags ? JSON.parse(r.tags) : undefined, savedAt: r.saved_at,
      }));
    },
    async saveSummary(sessionId, summary, messageCount) {
      stmtSaveSummary.run(sessionId, summary, messageCount, now());
    },
    async getRecentSummaries(limit) {
      const rows = stmtRecentSummaries.all(limit) as Array<{
        session_id: string; summary: string; message_count: number; updated_at: string;
      }>;
      return rows.map((r): SessionSummary => ({
        sessionId: r.session_id, summary: r.summary,
        messageCount: r.message_count, updatedAt: r.updated_at,
      }));
    },
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && pnpm exec vitest run src/memory/.test/long_term.test.ts`
Expected: PASS（7 passed）。

> 若 `tsc` 报 `node:sqlite` 无类型：`cd server && pnpm add -D @types/node@^24` 后重试。

- [ ] **Step 5: 类型检查**

Run: `cd server && pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add server/src/memory/long_term.ts server/src/memory/.test/long_term.test.ts
git commit -m "feat: add LongTermMemory with node:sqlite backend" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3：记忆工具 save_place / remember_preference（TDD）

**Files:**
- Create: `server/src/tools/memory_tools.ts`
- Test: `server/src/tools/.test/memory_tools.test.ts`

**Interfaces:**
- Consumes: `LongTermMemory`（Task 2）、`SavedPlace`/`Tool`（Task 1）。
- Produces: `createSavePlaceTool(memory): Tool`（name=`save_place`）、`createRememberPreferenceTool(memory): Tool`（name=`remember_preference`）。

- [ ] **Step 1: 写失败测试 `server/src/tools/.test/memory_tools.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createSavePlaceTool, createRememberPreferenceTool } from '../memory_tools';
import type { LongTermMemory } from '../../memory/long_term';

function mockMem() {
  return {
    savePlace: vi.fn().mockResolvedValue(undefined),
    setPreference: vi.fn().mockResolvedValue(undefined),
  } as unknown as LongTermMemory;
}

describe('save_place 工具', () => {
  it('写入 memory 并返回 saved（补 savedAt）', async () => {
    const mem = mockMem();
    const tool = createSavePlaceTool(mem);
    const result = await tool.execute({ id: 'p1', name: '外滩', location: { lng: 1, lat: 2 }, tags: ['人文'] });
    expect(mem.savePlace).toHaveBeenCalledOnce();
    expect(result).toEqual({ saved: 'p1' });
    const saved = (mem.savePlace as any).mock.calls[0][0];
    expect(saved.id).toBe('p1');
    expect(saved.savedAt).toEqual(expect.any(String));
  });

  it('工具定义名称为 save_place', () => {
    expect(createSavePlaceTool(mockMem()).name).toBe('save_place');
  });
});

describe('remember_preference 工具', () => {
  it('写入 memory 并返回 remembered', async () => {
    const mem = mockMem();
    const tool = createRememberPreferenceTool(mem);
    const result = await tool.execute({ key: 'travel_style', value: '人文' });
    expect(mem.setPreference).toHaveBeenCalledWith('travel_style', '人文');
    expect(result).toEqual({ remembered: 'travel_style' });
  });

  it('工具定义名称为 remember_preference', () => {
    expect(createRememberPreferenceTool(mockMem()).name).toBe('remember_preference');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && pnpm exec vitest run src/tools/.test/memory_tools.test.ts`
Expected: FAIL，"Cannot find module '../memory_tools'"。

- [ ] **Step 3: 实现 `server/src/tools/memory_tools.ts`**

```ts
import { z } from 'zod';
import type { SavedPlace, Tool } from '../types';
import type { LongTermMemory } from '../memory/long_term';

const placeSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: z.object({ lng: z.number(), lat: z.number() }),
  address: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const prefSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export function createSavePlaceTool(memory: LongTermMemory): Tool {
  return {
    name: 'save_place',
    definition: {
      type: 'function',
      function: {
        name: 'save_place',
        description: '收藏一个地点到长期记忆（用户收藏夹）。传入 poi_search 结果中的地点。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            location: {
              type: 'object',
              properties: { lng: { type: 'number' }, lat: { type: 'number' } },
              required: ['lng', 'lat'],
            },
            address: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'name', 'location'],
        },
      },
    },
    async execute(args) {
      const p = placeSchema.parse(args);
      const place: SavedPlace = { ...p, savedAt: new Date().toISOString() };
      await memory.savePlace(place);
      return { saved: p.id };
    },
  };
}

export function createRememberPreferenceTool(memory: LongTermMemory): Tool {
  return {
    name: 'remember_preference',
    definition: {
      type: 'function',
      function: {
        name: 'remember_preference',
        description: '记住用户的一条偏好到长期记忆（如出行风格、预算档位、喜欢的景点类型），用于后续个性化推荐。',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '偏好键，如 travel_style / budget / scene' },
            value: { type: 'string', description: '偏好值，如 人文 / 中 / 自然' },
          },
          required: ['key', 'value'],
        },
      },
    },
    async execute(args) {
      const p = prefSchema.parse(args);
      await memory.setPreference(p.key, p.value);
      return { remembered: p.key };
    },
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && pnpm exec vitest run src/tools/.test/memory_tools.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 5: 提交**

```bash
git add server/src/tools/memory_tools.ts server/src/tools/.test/memory_tools.test.ts
git commit -m "feat: add save_place and remember_preference memory tools" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4：planner 纯算法 planItinerary（TDD）

**Files:**
- Create: `server/src/agent/planner.ts`
- Test: `server/src/agent/.test/planner.test.ts`

**Interfaces:**
- Consumes: `MapPOI`/`ItineraryDayDraft`（Task 1）。
- Produces: `planItinerary(pois, { days, preferences }): ItineraryDayDraft[]`。供 Task 5 的 recommend 调用。

- [ ] **Step 1: 写失败测试 `server/src/agent/.test/planner.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { planItinerary } from '../planner';
import type { MapPOI } from '../../types';

function poi(id: string, name: string, lng: number, lat: number, typecode?: string): MapPOI {
  return { id, name, location: { lng, lat }, typecode };
}

describe('planItinerary', () => {
  const pois = [
    poi('a', '人文馆A', 116.40, 39.90, '110000'),
    poi('b', '自然公园B', 116.42, 39.92, '110101'),
    poi('c', '人文馆C', 116.41, 39.91, '110000'),
    poi('d', '商场D', 116.50, 39.95, '060100'),
  ];

  it('按天数均衡分配', () => {
    const days = planItinerary(pois, { days: 2 });
    expect(days).toHaveLength(2);
    expect(days.reduce((n, d) => n + d.places.length, 0)).toBe(4);
    expect(days[0].places).toHaveLength(2);
    expect(days[1].places).toHaveLength(2);
  });

  it('偏好打分：高分 POI 优先纳入（第一天含命中项）', () => {
    const days = planItinerary(pois, { days: 2, preferences: { scene: '人文' } });
    // 命中"人文"的 a、c 分数高，round-robin：a→day1, c→day2, b→day1, d→day2
    expect(days[0].places.map((p) => p.name)).toContain('人文馆A');
    expect(days[1].places.map((p) => p.name)).toContain('人文馆C');
  });

  it('天内贪心就近排序', () => {
    const three = [
      poi('a', 'A', 116.40, 39.90),
      poi('b', 'B', 116.41, 39.91), // 离 A 近
      poi('c', 'C', 116.80, 40.00), // 远
    ];
    const days = planItinerary(three, { days: 1 });
    expect(days[0].places.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('day 编号从 1 开始', () => {
    expect(planItinerary([poi('a', 'A', 1, 1)], { days: 1 })[0].day).toBe(1);
  });

  it('空 POI 列表返回空天', () => {
    const days = planItinerary([], { days: 2 });
    expect(days).toHaveLength(2);
    expect(days.every((d) => d.places.length === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && pnpm exec vitest run src/agent/.test/planner.test.ts`
Expected: FAIL，"Cannot find module '../planner'"。

- [ ] **Step 3: 实现 `server/src/agent/planner.ts`**

```ts
import type { ItineraryDayDraft, LngLat, MapPOI } from '../types';

function haversineKm(a: LngLat, b: LngLat): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function score(poi: MapPOI, preferences: Record<string, string>): number {
  let s = 0;
  const hay = `${poi.name} ${poi.typecode ?? ''}`.toLowerCase();
  for (const v of Object.values(preferences)) {
    if (v && hay.includes(String(v).toLowerCase())) s += 1;
  }
  return s;
}

export function planItinerary(
  pois: MapPOI[],
  opts: { days: number; preferences?: Record<string, string> },
): ItineraryDayDraft[] {
  const days = Math.max(1, opts.days);
  const prefs = opts.preferences ?? {};

  // 1. 打分后按分数降序（稳定：分数相同保持原顺序）
  const ordered = [...pois].sort((a, b) => score(b, prefs) - score(a, prefs));

  // 2. round-robin 分天
  const dayPlaces: MapPOI[][] = Array.from({ length: days }, () => []);
  ordered.forEach((p, i) => dayPlaces[i % days].push(p));

  // 3. 每天内贪心就近排序
  return dayPlaces.map((places, idx) => {
    const sorted: MapPOI[] = [];
    const remaining = [...places];
    while (remaining.length) {
      const last = sorted[sorted.length - 1];
      let pickIdx = 0;
      if (last) {
        let best = Infinity;
        for (let j = 0; j < remaining.length; j++) {
          const d = haversineKm(last.location, remaining[j].location);
          if (d < best) {
            best = d;
            pickIdx = j;
          }
        }
      }
      sorted.push(remaining.splice(pickIdx, 1)[0]);
    }
    return { day: idx + 1, places: sorted };
  });
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && pnpm exec vitest run src/agent/.test/planner.test.ts`
Expected: PASS（5 passed）。

- [ ] **Step 5: 提交**

```bash
git add server/src/agent/planner.ts server/src/agent/.test/planner.test.ts
git commit -m "feat: add planItinerary pure planner" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5：recommend 工具（TDD）

**Files:**
- Create: `server/src/tools/recommend.ts`
- Test: `server/src/tools/.test/recommend.test.ts`

**Interfaces:**
- Consumes: `MapProvider`（P1）、`LongTermMemory`（Task 2）、`planItinerary`（Task 4）、`MapPOI`/`Itinerary`/`ItineraryDay`（Task 1）。
- Produces: `createRecommendTool(map, memory): Tool`（name=`recommend`）。返回 `{ itinerary, preferencesUsed }`。

- [ ] **Step 1: 写失败测试 `server/src/tools/.test/recommend.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createRecommendTool } from '../recommend';
import type { MapProvider } from '../../types';
import type { LongTermMemory } from '../../memory/long_term';

function mockMap(): MapProvider {
  return {
    planRoute: vi.fn().mockImplementation(async (params: any) => ({
      mode: params.mode,
      origin: params.origin,
      destination: params.destination,
      distance: 1000,
      duration: 600,
      segments: [],
      polyline: [params.origin, ...(params.waypoints ?? []), params.destination],
    })),
  } as unknown as MapProvider;
}

function mockMem(prefs: Record<string, string> = {}) {
  return { getAllPreferences: vi.fn().mockResolvedValue(prefs) } as unknown as LongTermMemory;
}

describe('recommend 工具', () => {
  it('读取偏好 + 分天（每天单点则无 route）', async () => {
    const map = mockMap();
    const mem = mockMem({ scene: '人文' });
    const tool = createRecommendTool(map, mem);
    const result: any = await tool.execute({
      pois: [
        { id: 'a', name: '人文馆A', location: { lng: 116.40, lat: 39.90 } },
        { id: 'b', name: '公园B', location: { lng: 116.42, lat: 39.92 } },
      ],
      days: 2,
    });
    expect(mem.getAllPreferences).toHaveBeenCalledOnce();
    expect(result.preferencesUsed).toEqual({ scene: '人文' });
    expect(result.itinerary.days).toHaveLength(2);
    expect(result.itinerary.days.every((d: any) => d.route === undefined)).toBe(true);
  });

  it('每天 ≥2 个 place 时调 planRoute 配路线', async () => {
    const map = mockMap();
    const tool = createRecommendTool(map, mockMem());
    const result: any = await tool.execute({
      pois: [
        { id: 'a', name: 'A', location: { lng: 1, lat: 1 } },
        { id: 'b', name: 'B', location: { lng: 2, lat: 2 } },
        { id: 'c', name: 'C', location: { lng: 3, lat: 3 } },
      ],
      days: 1,
    });
    expect(map.planRoute).toHaveBeenCalledOnce();
    expect(result.itinerary.days[0].route).toBeDefined();
    expect(result.itinerary.days[0].route.distance).toBe(1000);
  });

  it('某天 planRoute 抛错 → 该天 route 省略，不整体失败', async () => {
    const map = { planRoute: vi.fn().mockRejectedValue(new Error('AMap error')) } as unknown as MapProvider;
    const tool = createRecommendTool(map, mockMem());
    const result: any = await tool.execute({
      pois: [
        { id: 'a', name: 'A', location: { lng: 1, lat: 1 } },
        { id: 'b', name: 'B', location: { lng: 2, lat: 2 } },
      ],
      days: 1,
    });
    expect(result.itinerary.days[0].route).toBeUndefined();
    expect(result.itinerary.days[0].places).toHaveLength(2);
  });

  it('工具定义名称为 recommend', () => {
    expect(createRecommendTool(mockMap(), mockMem()).name).toBe('recommend');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && pnpm exec vitest run src/tools/.test/recommend.test.ts`
Expected: FAIL，"Cannot find module '../recommend'"。

- [ ] **Step 3: 实现 `server/src/tools/recommend.ts`**

```ts
import { z } from 'zod';
import type { Itinerary, ItineraryDay, MapPOI, MapProvider, Tool } from '../types';
import type { LongTermMemory } from '../memory/long_term';
import { planItinerary } from '../agent/planner';

const schema = z.object({
  pois: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        location: z.object({ lng: z.number(), lat: z.number() }),
        address: z.string().optional(),
        typecode: z.string().optional(),
      }),
    )
    .min(1),
  days: z.number().int().min(1),
  budget: z.number().optional(),
});

export function createRecommendTool(map: MapProvider, memory: LongTermMemory): Tool {
  return {
    name: 'recommend',
    definition: {
      type: 'function',
      function: {
        name: 'recommend',
        description:
          '把候选 POI 组装成按天行程：读取用户偏好做个性化排序、按天分组、为每天规划路线。先用 poi_search 拿到候选 POI，再把它们传给本工具。',
        parameters: {
          type: 'object',
          properties: {
            pois: { type: 'array', description: '候选 POI 列表（来自 poi_search）', items: { type: 'object' } },
            days: { type: 'number', description: '行程天数' },
            budget: { type: 'number', description: '预算（占位，暂不强约束）' },
          },
          required: ['pois', 'days'],
        },
      },
    },
    async execute(args) {
      const parsed = schema.parse(args);
      const preferences = await memory.getAllPreferences();
      const drafts = planItinerary(parsed.pois as MapPOI[], { days: parsed.days, preferences });
      const days: ItineraryDay[] = [];
      for (const d of drafts) {
        let route;
        if (d.places.length >= 2) {
          try {
            const origin = d.places[0].location;
            const destination = d.places[d.places.length - 1].location;
            const waypoints = d.places.slice(1, -1).map((p) => p.location);
            route = await map.planRoute({
              mode: 'driving',
              origin,
              destination,
              waypoints: waypoints.length ? waypoints : undefined,
            });
          } catch {
            route = undefined; // 某天配路线失败，省略 route
          }
        }
        days.push({ day: d.day, places: d.places, route });
      }
      const itinerary: Itinerary = { days };
      return { itinerary, preferencesUsed: preferences };
    },
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && pnpm exec vitest run src/tools/.test/recommend.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 5: 提交**

```bash
git add server/src/tools/recommend.ts server/src/tools/.test/recommend.test.ts
git commit -m "feat: add recommend tool with personalized planning" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6：会话摘要 summarizer（TDD）

**Files:**
- Create: `server/src/agent/summary.ts`
- Test: `server/src/agent/.test/summary.test.ts`

**Interfaces:**
- Consumes: `LLM`/`LLMMessage`（P1）。
- Produces: `SessionSummarizer` 接口 + `createSessionSummarizer(llm)`，方法 `summarize(messages): Promise<string>`。供 Task 8 server 调用。

- [ ] **Step 1: 写失败测试 `server/src/agent/.test/summary.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createSessionSummarizer } from '../summary';
import type { LLM, LLMMessage } from '../../types';

describe('createSessionSummarizer', () => {
  it('过滤 system/tool，把对话压成摘要', async () => {
    const llm: LLM = {
      chat: vi.fn().mockResolvedValue({ content: '用户想去上海看人文景点。', toolCalls: [] }),
    };
    const sum = createSessionSummarizer(llm);
    const messages: LLMMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: '上海三日游' },
      { role: 'assistant', content: '好的，帮你规划' },
      { role: 'tool', tool_call_id: 'x', content: '{}' },
    ];
    const out = await sum.summarize(messages);
    expect(out).toBe('用户想去上海看人文景点。');
    const sent = (llm.chat as any).mock.calls[0][0].messages as LLMMessage[];
    expect(sent[0].role).toBe('system');
    expect(sent[1].content).toContain('上海三日游');
    expect(sent[1].content).toContain('好的，帮你规划');
  });

  it('LLM 返回空 content 时兜底', async () => {
    const llm: LLM = { chat: vi.fn().mockResolvedValue({ content: null, toolCalls: [] }) };
    const sum = createSessionSummarizer(llm);
    const out = await sum.summarize([{ role: 'user', content: 'hi' }]);
    expect(out).toBe('（无摘要）');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && pnpm exec vitest run src/agent/.test/summary.test.ts`
Expected: FAIL，"Cannot find module '../summary'"。

- [ ] **Step 3: 实现 `server/src/agent/summary.ts`**

```ts
import type { LLM, LLMMessage } from '../types';

export interface SessionSummarizer {
  summarize(messages: LLMMessage[]): Promise<string>;
}

export function createSessionSummarizer(llm: LLM): SessionSummarizer {
  return {
    async summarize(messages) {
      const convo = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content ?? ''}`)
        .join('\n');
      const req: LLMMessage[] = [
        { role: 'system', content: '把以下对话压成一段不超过 100 字的中文摘要，记录用户需求、涉及地点和结论。' },
        { role: 'user', content: convo || '（空对话）' },
      ];
      const res = await llm.chat({ messages: req, tools: [] });
      return (res.content ?? '').trim() || '（无摘要）';
    },
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && pnpm exec vitest run src/agent/.test/summary.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 5: 提交**

```bash
git add server/src/agent/summary.ts server/src/agent/.test/summary.test.ts
git commit -m "feat: add session summarizer" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7：系统提示词支持历史摘要 + runAgent 透传（TDD）

**Files:**
- Modify: `server/src/agent/prompts.ts`（全文替换）
- Modify: `server/src/agent/core.ts:4-11,19`（加可选参数 + 透传）
- Test: `server/src/agent/.test/prompts.test.ts`（新增）

**Interfaces:**
- Consumes: `Tool`（P1）。
- Produces: `buildSystemPrompt(tools, opts?: { historySummaries?: string[] })`；`RunAgentDeps.historySummaries?: string[]`。供 Task 8 注入历史。

- [ ] **Step 1: 写失败测试 `server/src/agent/.test/prompts.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../prompts';
import type { Tool } from '../../types';

const tool: Tool = {
  name: 'poi_search',
  definition: { type: 'function', function: { name: 'poi_search', description: '搜POI', parameters: {} } },
  execute: async () => ({}),
};

describe('buildSystemPrompt', () => {
  it('含工具列表', () => {
    expect(buildSystemPrompt([tool])).toContain('poi_search: 搜POI');
  });

  it('注入用户历史摘要段', () => {
    const p = buildSystemPrompt([tool], { historySummaries: ['用户曾去上海看人文'] });
    expect(p).toContain('用户历史会话摘要');
    expect(p).toContain('用户曾去上海看人文');
  });

  it('无历史时不出现历史段', () => {
    expect(buildSystemPrompt([tool])).not.toContain('用户历史会话摘要');
  });

  it('含新工具用法指引', () => {
    expect(buildSystemPrompt([tool])).toContain('recommend');
    expect(buildSystemPrompt([tool])).toContain('remember_preference');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && pnpm exec vitest run src/agent/.test/prompts.test.ts`
Expected: FAIL，"Cannot find module '../prompts'"（测试文件新；或注入/文案断言失败）。

- [ ] **Step 3: 替换 `server/src/agent/prompts.ts` 全文**

```ts
import type { Tool } from '../types';

export function buildSystemPrompt(tools: Tool[], opts?: { historySummaries?: string[] }): string {
  const toolList = tools.map((t) => `- ${t.name}: ${t.definition.function.description}`).join('\n');
  const history = opts?.historySummaries?.length
    ? `\n\n## 用户历史会话摘要（参考，以当前对话为准）\n${opts.historySummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    : '';
  return `你是一个地图智能体。用户用自然语言提问，你通过调用工具查找地点、规划路线、分析地理空间关系、推荐与编排行程。
可用工具：
${toolList}
${history}

规则：
- 查找地点/POI 用 poi_search；地址与坐标互转用 geocode；两地路线用 route_plan；方向/距离/就近关系用 spatial_query。
- 行程规划：先用 poi_search 搜候选 POI，再用 recommend 组装成按天行程（recommend 会读取用户偏好做个性化排序与配路线）。
- 记住用户偏好（出行风格/预算/景点类型）用 remember_preference；用户要收藏地点用 save_place。
- 工具结果会自动渲染到地图（POI 标记、路线折线），你只需用自然语言总结（名称、数量、耗时、方向），不必复述坐标或折线点。
- 复杂任务可分多步：先搜索/编码，再规划路线、分析关系或编排行程。
- 信息不足时直接反问用户（出发地、目的地、预算、时间、天数等）。
- 用简洁的中文回答。`;
}
```

- [ ] **Step 4: 修改 `server/src/agent/core.ts`（加可选 historySummaries 透传）**

把 `RunAgentDeps` 接口（第 4-11 行）改为：

```ts
export interface RunAgentDeps {
  llm: LLM;
  tools: Tool[];
  shortTermMemory?: LLMMessage[];
  historySummaries?: string[];
  maxIterations?: number;
  // 事件下沉可为异步（SSE 写入是 async）。必须 await，否则流关闭时尾部事件会丢失。
  onEvent: (event: AgentEvent) => void | Promise<void>;
}
```

把第 19 行：

```ts
    { role: 'system', content: buildSystemPrompt(tools) },
```

改为：

```ts
    { role: 'system', content: buildSystemPrompt(tools, { historySummaries: deps.historySummaries }) },
```

- [ ] **Step 5: 运行 prompts 测试，确认通过**

Run: `cd server && pnpm exec vitest run src/agent/.test/prompts.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 6: 运行 core 测试，确认无回归**

Run: `cd server && pnpm exec vitest run src/agent/.test/core.test.ts`
Expected: PASS（5 passed，historySummaries 可选，现有断言不受影响）。

- [ ] **Step 7: 全量测试 + 类型检查**

Run: `cd server && pnpm test`
Expected: 全部 PASS（40 + 新增 long_term 7 + memory_tools 4 + planner 5 + recommend 4 + summary 2 + prompts 4 = 66 passed）。

Run: `cd server && pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 8: 提交**

```bash
git add server/src/agent/prompts.ts server/src/agent/core.ts server/src/agent/.test/prompts.test.ts
git commit -m "feat: support history summaries in system prompt" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8：API 装配长期记忆 + 5 工具 + 首轮注入 + 摘要（TDD）

**Files:**
- Modify: `server/src/config.ts`（加 sqlitePath）
- Modify: `server/src/api/server.ts`（全文替换）
- Test: `server/src/api/.test/server.test.ts`（现有 createApp 注入 mockLTM + 加首轮注入测试）

**Interfaces:**
- Consumes: `LongTermMemory`（Task 2）、`recommend`/`save_place`/`remember_preference`（Task 3/5）、`SessionSummarizer`（Task 6）、`runAgent.historySummaries`（Task 7）。
- Produces: `createApp` 装配长期记忆与 5 个新工具；首轮注入历史摘要；每轮 fire-and-forget 摘要。

- [ ] **Step 1: 修改 `server/src/config.ts`，加 sqlitePath**

把：

```ts
export const config = {
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  amapApiKey: process.env.AMAP_API_KEY ?? "",
  port: Number(process.env.PORT ?? 3000),
};
```

改为：

```ts
export const config = {
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  amapApiKey: process.env.AMAP_API_KEY ?? "",
  port: Number(process.env.PORT ?? 3000),
  sqlitePath: process.env.SQLITE_PATH ?? "./data/fagent.db",
};
```

- [ ] **Step 2: 替换 `server/src/api/server.ts` 全文**

```ts
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { config } from '../config';
import { createAmapProvider } from '../maps/amap';
import { createPoiTool } from '../tools/poi';
import { createGeocodeTool } from '../tools/geocode';
import { createRouteTool } from '../tools/routing';
import { createSpatialTool } from '../tools/knowledge';
import { createRecommendTool } from '../tools/recommend';
import { createSavePlaceTool, createRememberPreferenceTool } from '../tools/memory_tools';
import { createDeepSeekLLM } from '../llm/deepseek';
import { runAgent } from '../agent/core';
import { createSessionSummarizer, type SessionSummarizer } from '../agent/summary';
import { createShortTermMemory, type ShortTermMemory } from '../memory/short_term';
import { createLongTermMemory, type LongTermMemory } from '../memory/long_term';
import type { AgentEvent, LLM, MapProvider, Tool } from '../types';

export interface AppDeps {
  llm?: LLM;
  map?: MapProvider;
  tools?: Tool[];
  memory?: ShortTermMemory;
  longTermMemory?: LongTermMemory;
  summarizer?: SessionSummarizer;
}

export function createApp(deps: AppDeps = {}) {
  const app = new Hono();
  const map = deps.map ?? createAmapProvider({ apiKey: config.amapApiKey });
  const llm = deps.llm ?? createDeepSeekLLM({ apiKey: config.deepseekApiKey });
  const memory = deps.memory ?? createShortTermMemory();
  const longTermMemory = deps.longTermMemory ?? createLongTermMemory({ dbPath: config.sqlitePath });
  const summarizer = deps.summarizer ?? createSessionSummarizer(llm);
  const tools = deps.tools ?? [
    createPoiTool(map),
    createGeocodeTool(map),
    createRouteTool(map),
    createSpatialTool(map),
    createRecommendTool(map, longTermMemory),
    createSavePlaceTool(longTermMemory),
    createRememberPreferenceTool(longTermMemory),
  ];

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/api/chat', async (c) => {
    const body = await c.req.json<{ message?: string; sessionId?: string }>().catch(() => null);
    if (!body?.message) return c.json({ error: 'message required' }, 400);
    const message = body.message;
    const sessionId = body.sessionId ?? crypto.randomUUID();

    return streamSSE(c, async (stream) => {
      const send = async (event: AgentEvent) => { await stream.writeSSE({ data: JSON.stringify(event) }); };
      try {
        const history = memory.get(sessionId);
        // 首轮注入：该会话无短期记忆时，取最近 3 条历史摘要拼进 system 提示
        let historySummaries: string[] | undefined;
        if (history.length === 0) {
          try {
            const recent = await longTermMemory.getRecentSummaries(3);
            if (recent.length) historySummaries = recent.map((s) => s.summary);
          } catch {
            /* 取摘要失败不阻塞主流程 */
          }
        }
        const messages = await runAgent(message, {
          llm, tools, shortTermMemory: history, historySummaries, onEvent: send,
        });
        memory.save(sessionId, messages);
        // 会话摘要（累计 user 轮数 ≥ 2）：fire-and-forget，不阻塞响应
        const userTurns = messages.filter((m) => m.role === 'user').length;
        if (userTurns >= 2) {
          summarizer
            .summarize(messages)
            .then((summary) => longTermMemory.saveSummary(sessionId, summary, userTurns))
            .catch(() => { /* 摘要失败不影响主流程 */ });
        }
      } catch (e) {
        await send({ type: 'error', message: (e as Error).message });
      }
    });
  });

  return app;
}
```

- [ ] **Step 3: 修改 `server/src/api/.test/server.test.ts`——给现有 createApp 注入 mockLTM**

在文件顶部 import 区，把：

```ts
import type { LLM, LLMResponse, Tool } from '../types';
```

改为：

```ts
import type { LLM, LLMResponse, Tool } from '../types';
import type { LongTermMemory } from '../../memory/long_term';

// 所有测试统一注入 mockLTM，避免默认 createLongTermMemory 触盘
const mockLTM = {
  getRecentSummaries: vi.fn().mockResolvedValue([]),
  saveSummary: vi.fn().mockResolvedValue(undefined),
  getAllPreferences: vi.fn().mockResolvedValue({}),
} as unknown as LongTermMemory;
```

然后把测试里**每一处** `createApp(` 调用补 `longTermMemory: mockLTM`：

- `createApp().request('/health'` → `createApp({ longTermMemory: mockLTM }).request('/health'`
- `createApp({ llm, tools: [tool] })` → `createApp({ llm, tools: [tool], longTermMemory: mockLTM })`
- `createApp({ llm })`（出现 3 处）→ `createApp({ llm, longTermMemory: mockLTM })`

- [ ] **Step 4: 追加首轮注入测试**

在现有 `describe('api', ...)` 块内追加：

```ts
  it('首轮（无短期记忆）注入历史摘要到 system', async () => {
    const longTermMemory = {
      getRecentSummaries: vi.fn().mockResolvedValue([
        { sessionId: 'old', summary: '用户曾去上海看人文', messageCount: 4, updatedAt: '2026-07-17T00:00:00.000Z' },
      ]),
      saveSummary: vi.fn().mockResolvedValue(undefined),
    } as unknown as LongTermMemory;
    let seenSystem = '';
    const llm: LLM = {
      chat: vi.fn().mockImplementation(async ({ messages }) => {
        const sys = messages.find((m: any) => m.role === 'system');
        seenSystem = sys?.content ?? '';
        return { content: 'ok', toolCalls: [] };
      }),
    };
    const app = createApp({ llm, longTermMemory });
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '你好', sessionId: 'fresh-session' }),
    });
    await res.text();
    expect(longTermMemory.getRecentSummaries).toHaveBeenCalledWith(3);
    expect(seenSystem).toContain('用户曾去上海看人文');
  });

  it('非首轮（有短期记忆）不注入历史摘要', async () => {
    const longTermMemory = {
      getRecentSummaries: vi.fn().mockResolvedValue([{ sessionId: 'old', summary: '历史X', messageCount: 2, updatedAt: 't' }]),
      saveSummary: vi.fn().mockResolvedValue(undefined),
    } as unknown as LongTermMemory;
    let seenSystem = '';
    const llm: LLM = {
      chat: vi.fn().mockImplementation(async ({ messages }) => {
        const sys = messages.find((m: any) => m.role === 'system');
        seenSystem = sys?.content ?? '';
        return { content: 'ok', toolCalls: [] };
      }),
    };
    const app = createApp({ llm, longTermMemory });
    // 第一轮（fresh）会注入；第二轮（同 sessionId 已有短期记忆）不应再注入
    const r1 = await app.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '第一轮', sessionId: 'sess-X' }) });
    await r1.text();
    (longTermMemory.getRecentSummaries as any).mockClear();
    const r2 = await app.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '第二轮', sessionId: 'sess-X' }) });
    await r2.text();
    expect(longTermMemory.getRecentSummaries).not.toHaveBeenCalled();
    expect(seenSystem).not.toContain('历史X');
  });
```

- [ ] **Step 5: 运行 server 测试，确认通过**

Run: `cd server && pnpm exec vitest run src/api/.test/server.test.ts`
Expected: PASS（原 5 + 新 2 = 7 passed）。

- [ ] **Step 6: 全量测试 + 类型检查**

Run: `cd server && pnpm test`
Expected: 全部 PASS（68 passed）。

Run: `cd server && pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 7: 提交**

```bash
git add server/src/config.ts server/src/api/server.ts server/src/api/.test/server.test.ts
git commit -m "feat: wire long-term memory, recommend, and summary into api" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9：前端——recommend observation 按天多 route

**Files:**
- Modify: `web/src/stores/chat.ts`（observation 分支加 recommend）

> 前端无自动化测试（与 P0/P1 一致）；以 `vue-tsc --noEmit` + Task 10 手动验证为保证。

**Interfaces:**
- Consumes: recommend 返回的 `{ itinerary: { days: [{ route? }] } }`（Task 5）。
- Produces: `recommend` observation → `map.setRoutes([...按天 route])`，MapPanel 已按 `ROUTE_COLORS` 多色渲染。

- [ ] **Step 1: 修改 `web/src/stores/chat.ts` 的 observation 分支**

把：

```ts
        if (event.tool === 'poi_search') {
          map.setPois(event.result?.pois ?? []);
        } else if (event.tool === 'route_plan') {
          const route = event.result?.route;
          map.setRoutes(route ? [route as RouteData] : []);
        }
```

改为：

```ts
        if (event.tool === 'poi_search') {
          map.setPois(event.result?.pois ?? []);
        } else if (event.tool === 'route_plan') {
          const route = event.result?.route;
          map.setRoutes(route ? [route as RouteData] : []);
        } else if (event.tool === 'recommend') {
          const days = event.result?.itinerary?.days ?? [];
          const routes = days.map((d: any) => d.route).filter(Boolean) as RouteData[];
          map.setRoutes(routes);
        }
```

- [ ] **Step 2: 前端类型检查**

Run: `cd web && pnpm exec vue-tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 3: 提交**

```bash
git add web/src/stores/chat.ts
git commit -m "feat: render recommend itinerary as per-day routes" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10：端到端手动验证

**Files:** 无（验证步骤）

- [x] **Step 1: 确认 Key 与 SQLite 路径**

- `server/.env.local`：`DEEPSEEK_API_KEY`、`AMAP_API_KEY`。
- `web/.env.local`：`VITE_AMAP_JS_KEY`、`VITE_AMAP_SECURITY`。
- SQLite 默认落在 `server/data/fagent.db`（首次运行自动创建目录与表）。

- [x] **Step 2: 启动后端**

Run: `cd server && pnpm run dev`
Expected: 控制台输出 `f-agent server on http://localhost:3000`，无报错；`server/data/fagent.db` 生成。

- [x] **Step 3: 启动前端**

Run（新终端）: `cd web && pnpm run dev`
Expected: Vite 输出本地地址。

- [x] **Step 4: 验证多日行程（recommend + 按天折线）**

输入「帮我规划上海三日游，喜欢人文景点」→ 助手应先 `poi_search` 再 `recommend`；地图出现**多条不同颜色折线**（按天），助手给出按天行程总结。若地图无多色折线：检查后端 `observation` 中 `recommend` 的 `itinerary.days[].route` 是否非空、前端 chat.ts recommend 分支是否生效。

- [x] **Step 5: 验证收藏与记偏好**

输入「把刚才那个景点收藏一下」→ 助手调用 `save_place`；输入「记住我喜欢自然风光」→ `remember_preference`。检查 `server/data/fagent.db` 的 `saved_places`/`preferences` 表有数据（可用 `sqlite3` 或 VSCode SQLite 插件查看）。

- [x] **Step 6: 验证跨会话历史注入**

开启**新对话**（前端「新对话」会换 sessionId），输入第一句话（如「你好，帮我推荐」）→ 后端首轮应取 `session_summaries` 注入 system；助手应体现对过往偏好的记忆（如优先推荐自然/人文类）。检查后端日志或摘要表已写入过往会话摘要。

- [x] **Step 7: 验证短期记忆回归**

同一会话内：第一轮「找三里屯的咖啡馆」，第二轮「刚才搜到的那家地址是什么」→ 助手能接上上文（P1 能力不回归）。

- [x] **Step 8: 提交 P2 完成标记**

```bash
git add -A
git commit -m "chore: p2 recommend & personalization end-to-end verified" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 完成标准（Definition of Done）

- 后端单测全绿：40（P1）+ long_term 7 + memory_tools 4 + planner 5 + recommend 4 + summary 2 + prompts 4 + server +2 = **68 passed**。
- `cd server && pnpm exec tsc --noEmit` 通过；`cd web && pnpm exec vue-tsc --noEmit` 通过。
- `pnpm install` **不引入原生模块**（node:sqlite 内置）。
- 浏览器 e2e 跑通四类场景：多日行程按天多色折线、收藏/记偏好、跨会话历史注入、短期记忆回归。
- 按 Task 顺序提交，每个 Task 一个 commit；就地 `main`。
- 现有 40 个 P0/P1 测试保持全绿（向后兼容）。

## P2 之外的延后项（不在本计划内）

- 真实预算约束（需 POI 价格数据）。
- 向量检索语义召回长期记忆（总设计 §12，P3+ 评估）。
- planner 更优编排（TSP/聚类）、session_summaries 相关性召回。
- GLM 适配器、LLM 切换对比、Trace 面板、地图↔对话联动、收藏 UI、偏好设置 UI（P3）。

## 自检（Self-Review）

- **Spec 覆盖**：spec §3 模块 → Task 1-9；§4 记忆 → Task 2/3/6/8；§5 recommend/planner → Task 4/5；§6 数据流 → Task 8 装配 + Task 10 e2e；§9 DoD → 完成标准。spec 每节均有对应 task。✓
- **占位符扫描**：无 TBD/TODO；预算约束在 Task 5 入参注释 + 延后项明确。每步含完整代码/命令。✓
- **类型一致**：`LongTermMemory` 方法签名跨 Task 2/3/5/8 一致；`planItinerary` 返回 `ItineraryDayDraft[]`、recommend 转 `ItineraryDay[]`；`buildSystemPrompt(tools, {historySummaries})` 在 Task 7 定义、Task 8 调用；`SavedPlace.savedAt` required（工具补 savedAt）。✓
- **向后兼容**：`runAgent` 仅加可选 `historySummaries`（core.test 5 个不受影响）；`buildSystemPrompt` 第二参可选；无新增 `AgentEvent`；现有 server.test 注入 mockLTM 不触盘。✓
- **YAGNI**：不暴露 get 记忆工具、预算不强约束、planner 贪心、向量检索留后。✓

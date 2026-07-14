# P1 Agent 核心 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 P0 骨架之上补齐 Agent 核心能力——新增 `geocode`/`route_plan`/`spatial_query` 三个工具、短期记忆（跨轮上下文）、DeepSeek token 级流式 SSE，使多步多工具编排可演示。

**Architecture:** 延续 P0 的三层可插拔边界。`MapProvider` 接口扩展出 `geocode`/`reverseGeocode`/`planRoute`（高德实现）。`LLM` 接口新增可选 `streamChat`（DeepSeek 实现，SSE chunk 解析）。`runAgent` 在流式可用时边收 token 边推 `token` 事件，并返回完整 `messages` 供 API 落短期记忆。短期记忆为进程内 `Map<sessionId, LLMMessage[]>`，由 `/api/chat` 按 sessionId 装载/保存。前端 `chatStore` 处理 `token` 流式增量与路线 observation，`MapPanel` 增画折线。

**Tech Stack:** TypeScript, Hono, zod, vitest, tsx（后端）；Vue 3, Vite, Pinia, 高德 JS SDK（前端）。无新增依赖。

## Global Constraints

- Node 18+（全局 `fetch`、`ReadableStream`、`crypto.randomUUID`）。
- 所有外部依赖（fetch、LLM、MapProvider）继续走依赖注入，单测不触网。
- 后端每个业务文件配同名 `.test.ts`（TDD，先红后绿）。
- 复用 P0 已有类型与文件，不重写已有逻辑；新增方法/事件向后兼容（现有 13 个测试须保持全绿）。
- 高德 REST 端点：地理编码 `/v3/geocode/geo`、逆地理 `/v3/geocode/regeo`、路径 `/v3/direction/{driving|walking|bicycling}`、公交 `/v3/direction/transit/integrated`。真实端点形态在 Task 11 端到端验证；单测用 mock 响应，不依赖真实形态。
- LngLat 统一为 `{ lng: number; lat: number }`（从 MapPOI.location 抽出命名类型）。

---

## 设计决策（写在前面的关键取舍）

1. **`knowledge` 工具聚焦空间推理**：设计文档 §4.D 把「百科属性」（面积/人口）和「空间关系」（方向/就近）都归到 knowledge。百科属性 LLM 自有参数化知识即可回答，无需工具；而方向/距离/就近是 LLM 不擅长的几何计算，需 geocode + 数学。故 P1 的 `knowledge` 工具实装为 `spatial_query`（计算方位角/距离/最近点），百科属性由 LLM 直接答。
2. **`route_plan` 接受地名而非坐标**：工具入参 `origin/destination/waypoints` 为地名串，内部先 `map.geocode` 再 `map.planRoute`。这样 LLM 无需在多步间传递坐标，且仍可演示 `poi_search → route_plan` 编排（用 POI 名作途经点）。
3. **流式 + message 共存**：流式路径先推若干 `token`，最后仍推一条完整 `message`（提交/兜底），再 `done`。非流式路径只推 `message`+`done`。前端 `token` 增量追加到「进行中」助手气泡，`message` 用完整文本提交该气泡。兼顾流式观感与健壮性。
4. **短期记忆全量存储**：`runAgent` 返回完整 `messages`（含 system + 历史 + 新轮），API 去掉 system 后按 sessionId 全量覆盖存储。学习项目会话短，暂不做截断（截断须成对保留 tool_call/tool，留 P2/P3）。

---

## 文件结构

```
server/src/
├── types.ts               # 修改：加 LngLat/GeocodeResult/RouteSegment/RouteResult；扩 MapProvider；加 token 事件、streamChat
├── maps/amap.ts           # 修改：加 geocode/reverseGeocode/planRoute + polyline 解析
├── maps/amap.test.ts      # 修改：加三个方法的解析测试
├── tools/poi.ts           # 不变（poi.test.ts 的 fake 改 cast 以适配新 MapProvider）
├── tools/poi.test.ts      # 修改：fake map 改 as unknown as MapProvider
├── tools/geocode.ts       # 新增：geocode 工具（正/逆）
├── tools/geocode.test.ts  # 新增
├── tools/routing.ts       # 新增：route_plan 工具（地名→geocode→planRoute）
├── tools/routing.test.ts  # 新增
├── tools/knowledge.ts     # 新增：spatial_query 工具（方位/距离/就近）
├── tools/knowledge.test.ts# 新增
├── llm/deepseek.ts        # 修改：加 streamChat（SSE chunk 解析）+ 共享请求构造
├── llm/deepseek.test.ts   # 修改：加流式 token 与 tool_call 装配测试
├── agent/prompts.ts       # 修改：通用化系统提示词（覆盖 4 工具）
├── agent/core.ts          # 修改：流式分支 + 返回 messages
├── agent/core.test.ts     # 修改：加流式测试；现有测试保持绿
├── memory/short_term.ts   # 新增：进程内会话记忆
├── memory/short_term.test.ts # 新增
├── api/server.ts          # 修改：sessionId + 短期记忆 + 装配 4 工具
└── api/server.test.ts     # 修改：加跨轮记忆测试

web/src/
├── stores/map.ts          # 修改：加 routes 状态 + RouteData
├── stores/chat.ts         # 修改：sessionId、token 流式、route observation
├── components/MapPanel.vue # 修改：画折线
└── components/ChatPanel.vue # 修改：流式气泡 + 自动滚动
```

---

## Task 1：扩展共享类型与 MapProvider 接口

**Files:**
- Modify: `server/src/types.ts`
- Modify: `server/src/tools/poi.test.ts`（fake map 适配新接口）

**Interfaces:**
- Produces: `LngLat`、`GeocodeResult`、`RouteSegment`、`RouteResult`；`MapProvider.geocode/reverseGeocode/planRoute`；`AgentEvent` 的 `token` 变体；`LLM.streamChat?`。后续所有任务依赖这些签名。

- [ ] **Step 1: 替换 `server/src/types.ts` 全文**

```ts
// 经纬度（地图服务、工具、前端共用）
export interface LngLat {
  lng: number;
  lat: number;
}

// 地图 POI（地图服务与工具、前端共用结构）
export interface MapPOI {
  id: string;
  name: string;
  location: LngLat;
  address?: string;
  typecode?: string;
}

// 地理编码结果（正/逆共用）
export interface GeocodeResult {
  location: LngLat;
  formattedAddress?: string;
  province?: string;
  city?: string;
  district?: string;
}

// 路线单段（一个 instruction + 一段折线）
export interface RouteSegment {
  instruction: string;
  distance: number; // 米
  duration: number; // 秒
  polyline: LngLat[];
}

// 路线规划结果
export interface RouteResult {
  mode: string;
  origin: LngLat;
  destination: LngLat;
  distance: number; // 米
  duration: number; // 秒
  segments: RouteSegment[];
  polyline: LngLat[]; // 全程折线（前端画线用）
}

// 地图服务适配器接口（高德/百度/Mapbox 各自实现）
export interface MapProvider {
  searchPoi(params: { keyword: string; city?: string }): Promise<MapPOI[]>;
  geocode(address: string): Promise<GeocodeResult[]>;
  reverseGeocode(location: LngLat): Promise<GeocodeResult>;
  planRoute(params: {
    mode: 'driving' | 'walking' | 'riding' | 'transit';
    origin: LngLat;
    destination: LngLat;
    waypoints?: LngLat[];
    city?: string;
  }): Promise<RouteResult>;
}

// 工具的 OpenAI 风格函数定义
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object; // JSON Schema
  };
}

// 工具接口
export interface Tool {
  name: string;
  definition: ToolDefinition;
  execute(args: unknown): Promise<unknown>;
}

// LLM 消息（含 tool_calls / tool 结果）
export interface LLMToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type LLMMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: LLMToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface LLMResponse {
  content: string | null;
  toolCalls: LLMToolCall[];
}

// LLM 适配器接口
export interface LLM {
  chat(params: { messages: LLMMessage[]; tools: ToolDefinition[] }): Promise<LLMResponse>;
  // 可选：流式输出。逐 token 回调 onToken，最终返回装配好的完整响应（含 tool_calls）。
  streamChat?(params: {
    messages: LLMMessage[];
    tools: ToolDefinition[];
    onToken: (token: string) => void | Promise<void>;
  }): Promise<LLMResponse>;
}

// agent 推送给前端的事件
export type AgentEvent =
  | { type: 'tool_call'; tool: string; args: unknown }
  | { type: 'observation'; tool: string; result: unknown }
  | { type: 'token'; content: string }
  | { type: 'message'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
```

- [ ] **Step 2: 修改 `server/src/tools/poi.test.ts` 中的 fake map**

把两个 fake map 改为 cast，避免必须实现新方法。将：

```ts
    const map: MapProvider = {
      searchPoi: vi
        .fn()
        .mockResolvedValue([
          { id: '1', name: 'A', location: { lng: 1, lat: 2 } },
        ]),
    };
```

改为：

```ts
    const map = {
      searchPoi: vi
        .fn()
        .mockResolvedValue([
          { id: '1', name: 'A', location: { lng: 1, lat: 2 } },
        ]),
    } as unknown as MapProvider;
```

（文件里 `createPoiTool({} as MapProvider)` 那行保持不变。）

- [ ] **Step 3: 运行全量后端测试，确认仍绿**

Run: `cd server && npx vitest run`
Expected: 13 passed（types 改动不应破坏行为；TS cast 绕过新方法）。

- [ ] **Step 4: 类型检查**

Run: `cd server && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add server/src/types.ts server/src/tools/poi.test.ts
git commit -m "feat: extend types with geocode/route/streaming"
```

---

## Task 2：高德 geocode / reverseGeocode / planRoute 适配（TDD）

**Files:**
- Modify: `server/src/maps/amap.ts`
- Test: `server/src/maps/amap.test.ts`

**Interfaces:**
- Consumes: `MapProvider`（Task 1）、`LngLat`/`GeocodeResult`/`RouteResult`/`RouteSegment`。
- Produces: `createAmapProvider` 返回的对象现在实现全部 4 个方法，供 Task 3/4/5 的工具与 Task 9 的 API 使用。

- [ ] **Step 1: 在 `server/src/maps/amap.test.ts` 追加三个失败的测试**

在现有 `describe` 块内追加：

```ts
  it('解析正地理编码响应', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => ({
        status: '1',
        geocodes: [
          { location: '116.48,39.99', formatted_address: '北京市朝阳区', province: '北京', city: [], district: '朝阳区' },
        ],
      }),
    }) as unknown as typeof fetch;
    const provider = createAmapProvider({ apiKey: 'k', fetch: fakeFetch });
    const res = await provider.geocode('三里屯');
    expect(res).toEqual([
      { location: { lng: 116.48, lat: 39.99 }, formattedAddress: '北京市朝阳区', province: '北京', city: undefined, district: '朝阳区' },
    ]);
  });

  it('解析逆地理编码响应', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => ({
        status: '1',
        regeocode: { formatted_address: '北京市朝阳区三里屯', addressComponent: { province: '北京', city: [], district: '朝阳区' } },
      }),
    }) as unknown as typeof fetch;
    const provider = createAmapProvider({ apiKey: 'k', fetch: fakeFetch });
    const res = await provider.reverseGeocode({ lng: 116.48, lat: 39.99 });
    expect(res.formattedAddress).toBe('北京市朝阳区三里屯');
    expect(res.location).toEqual({ lng: 116.48, lat: 39.99 });
    expect(res.province).toBe('北京');
  });

  it('解析驾车路线响应（distance/duration/polyline）', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => ({
        status: '1',
        route: {
          paths: [
            {
              distance: '5000',
              duration: '600',
              steps: [
                { instruction: '向东', distance: '2000', duration: '240', polyline: '116.48,39.99;116.49,39.99' },
                { instruction: '向北', distance: '3000', duration: '360', polyline: '116.49,39.99;116.49,40.00' },
              ],
            },
          ],
        },
      }),
    }) as unknown as typeof fetch;
    const provider = createAmapProvider({ apiKey: 'k', fetch: fakeFetch });
    const route = await provider.planRoute({
      mode: 'driving',
      origin: { lng: 116.48, lat: 39.99 },
      destination: { lng: 116.49, lat: 40.0 },
    });
    expect(route.distance).toBe(5000);
    expect(route.duration).toBe(600);
    expect(route.segments).toHaveLength(2);
    expect(route.polyline).toEqual([
      { lng: 116.48, lat: 39.99 },
      { lng: 116.49, lat: 39.99 },
      { lng: 116.49, lat: 40.0 },
    ]);
  });

  it('解析公交路线响应', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => ({
        status: '1',
        route: {
          transit: {
            transits: [
              {
                distance: '8000',
                duration: '1200',
                segments: [
                  { walking: { steps: [{ polyline: '116.48,39.99;116.48,40.00' }] }, bus: { buslines: [{ name: '1路', polyline: '116.48,40.00;116.49,40.00' }] } },
                ],
              },
            ],
          },
        },
      }),
    }) as unknown as typeof fetch;
    const provider = createAmapProvider({ apiKey: 'k', fetch: fakeFetch });
    const route = await provider.planRoute({
      mode: 'transit',
      origin: { lng: 116.48, lat: 39.99 },
      destination: { lng: 116.49, lat: 40.0 },
      city: '北京',
    });
    expect(route.distance).toBe(8000);
    expect(route.polyline).toEqual([
      { lng: 116.48, lat: 39.99 },
      { lng: 116.48, lat: 40.0 },
      { lng: 116.49, lat: 40.0 },
    ]);
  });

  it('路线错误状态时抛出', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => ({ status: '0', info: 'INVALID_USER_KEY' }),
    }) as unknown as typeof fetch;
    const provider = createAmapProvider({ apiKey: 'bad', fetch: fakeFetch });
    await expect(provider.planRoute({ mode: 'driving', origin: { lng: 1, lat: 2 }, destination: { lng: 3, lat: 4 } })).rejects.toThrow('AMap error');
  });
```

- [ ] **Step 2: 运行测试，确认新增失败**

Run: `cd server && npx vitest run src/maps/amap.test.ts`
Expected: FAIL（geocode/reverseGeocode/planRoute 不是函数）。

- [ ] **Step 3: 替换 `server/src/maps/amap.ts` 全文**

```ts
import type { GeocodeResult, LngLat, MapProvider, MapPOI, RouteResult, RouteSegment } from '../types';

function parsePolyline(s: string): LngLat[] {
  return (s ?? '')
    .split(';')
    .filter(Boolean)
    .map((pt) => {
      const [lng, lat] = pt.split(',').map(Number);
      return { lng, lat };
    });
}

function cityOrUndefined(city: string | [] | undefined): string | undefined {
  return typeof city === 'string' && city.length ? city : undefined;
}

export function createAmapProvider(opts: {
  apiKey: string;
  fetch?: typeof fetch;
}): MapProvider {
  const doFetch = opts.fetch ?? fetch;

  async function fetchJson(url: URL) {
    const res = await doFetch(url.toString());
    return (await res.json()) as { status: string; info?: string };
  }

  function ensureOk(json: { status: string; info?: string }) {
    if (json.status !== '1') throw new Error(`AMap error: ${json.info ?? 'unknown'}`);
  }

  return {
    async searchPoi({ keyword, city }) {
      const url = new URL('https://restapi.amap.com/v3/place/text');
      url.searchParams.set('key', opts.apiKey);
      url.searchParams.set('keywords', keyword);
      url.searchParams.set('offset', '10');
      if (city) url.searchParams.set('city', city);
      const json = await fetchJson(url) as Awaited<ReturnType<typeof fetchJson>> & {
        pois?: Array<{ id: string; name: string; location: string; address?: string; typecode?: string }>;
      };
      ensureOk(json);
      return (json.pois ?? []).map((p): MapPOI => {
        const [lng, lat] = (p.location ?? '0,0').split(',').map(Number);
        return { id: p.id, name: p.name, location: { lng, lat }, address: p.address, typecode: p.typecode };
      });
    },

    async geocode(address) {
      const url = new URL('https://restapi.amap.com/v3/geocode/geo');
      url.searchParams.set('key', opts.apiKey);
      url.searchParams.set('address', address);
      const json = await fetchJson(url) as Awaited<ReturnType<typeof fetchJson>> & {
        geocodes?: Array<{ location: string; formatted_address?: string; province?: string; city?: string | []; district?: string }>;
      };
      ensureOk(json);
      return (json.geocodes ?? []).map((g): GeocodeResult => {
        const [lng, lat] = (g.location ?? '0,0').split(',').map(Number);
        return { location: { lng, lat }, formattedAddress: g.formatted_address, province: g.province, city: cityOrUndefined(g.city), district: g.district };
      });
    },

    async reverseGeocode({ lng, lat }) {
      const url = new URL('https://restapi.amap.com/v3/geocode/regeo');
      url.searchParams.set('key', opts.apiKey);
      url.searchParams.set('location', `${lng},${lat}`);
      const json = await fetchJson(url) as Awaited<ReturnType<typeof fetchJson>> & {
        regeocode?: { formatted_address?: string; addressComponent?: { province?: string; city?: string | []; district?: string } };
      };
      ensureOk(json);
      const r = json.regeocode;
      const ac = r?.addressComponent ?? {};
      return {
        location: { lng, lat },
        formattedAddress: r?.formatted_address,
        province: ac.province,
        city: cityOrUndefined(ac.city),
        district: ac.district,
      };
    },

    async planRoute({ mode, origin, destination, waypoints, city }) {
      if (mode === 'transit') {
        const url = new URL('https://restapi.amap.com/v3/direction/transit/integrated');
        url.searchParams.set('key', opts.apiKey);
        url.searchParams.set('origin', `${origin.lng},${origin.lat}`);
        url.searchParams.set('destination', `${destination.lng},${destination.lat}`);
        url.searchParams.set('city', city ?? '北京');
        const json = await fetchJson(url) as Awaited<ReturnType<typeof fetchJson>> & {
          route?: { transit?: { transits?: Array<{ distance?: string; duration?: string; segments?: Array<{ walking?: { steps?: Array<{ polyline?: string }> }; bus?: { buslines?: Array<{ name?: string; polyline?: string }> } }> }> } };
        };
        ensureOk(json);
        const t = json.route?.transit?.transits?.[0];
        if (!t) throw new Error('AMap error: no transit');
        const polyline: LngLat[] = [];
        const segments: RouteSegment[] = [];
        for (const seg of t.segments ?? []) {
          const pts: LngLat[] = [];
          for (const step of seg.walking?.steps ?? []) pts.push(...parsePolyline(step.polyline ?? ''));
          for (const bus of seg.bus?.buslines ?? []) pts.push(...parsePolyline(bus.polyline ?? ''));
          polyline.push(...pts);
          segments.push({ instruction: seg.bus?.buslines?.[0]?.name ?? '步行', distance: 0, duration: 0, polyline: pts });
        }
        return { mode, origin, destination, distance: Number(t.distance ?? 0), duration: Number(t.duration ?? 0), segments, polyline };
      }

      const endpoint = mode === 'driving' ? 'driving' : mode === 'walking' ? 'walking' : 'bicycling';
      const url = new URL(`https://restapi.amap.com/v3/direction/${endpoint}`);
      url.searchParams.set('key', opts.apiKey);
      url.searchParams.set('origin', `${origin.lng},${origin.lat}`);
      url.searchParams.set('destination', `${destination.lng},${destination.lat}`);
      if (waypoints?.length && mode === 'driving') {
        url.searchParams.set('waypoints', waypoints.map((w) => `${w.lng},${w.lat}`).join(';'));
      }
      const json = await fetchJson(url) as Awaited<ReturnType<typeof fetchJson>> & {
        route?: { paths?: Array<{ distance?: string; duration?: string; steps?: Array<{ instruction?: string; distance?: string; duration?: string; polyline?: string }> }> };
      };
      ensureOk(json);
      const path = json.route?.paths?.[0];
      if (!path) throw new Error('AMap error: no route path');
      const segments: RouteSegment[] = (path.steps ?? []).map((s) => ({
        instruction: s.instruction ?? '',
        distance: Number(s.distance ?? 0),
        duration: Number(s.duration ?? 0),
        polyline: parsePolyline(s.polyline ?? ''),
      }));
      const polyline = segments.flatMap((s) => s.polyline);
      return {
        mode,
        origin,
        destination,
        distance: Number(path.distance ?? 0),
        duration: Number(path.duration ?? 0),
        segments,
        polyline,
      };
    },
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && npx vitest run src/maps/amap.test.ts`
Expected: PASS（原 2 + 新 5 = 7 passed）。

- [ ] **Step 5: 提交**

```bash
git add server/src/maps/amap.ts server/src/maps/amap.test.ts
git commit -m "feat: add geocode/reverseGeocode/planRoute to amap provider"
```

## Task 3：geocode 工具（TDD）

**Files:**
- Create: `server/src/tools/geocode.ts`
- Test: `server/src/tools/geocode.test.ts`

**Interfaces:**
- Consumes: `MapProvider.geocode` / `reverseGeocode`（Task 2）。
- Produces: `createGeocodeTool(map): Tool`，name = `geocode`。

- [ ] **Step 1: 写失败测试 `server/src/tools/geocode.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createGeocodeTool } from './geocode';
import type { MapProvider } from '../types';

describe('geocode 工具', () => {
  it('正地理编码：地址→坐标', async () => {
    const map = {
      geocode: vi.fn().mockResolvedValue([
        { location: { lng: 116.48, lat: 39.99 }, formattedAddress: '北京市朝阳区三里屯' },
      ]),
      reverseGeocode: vi.fn(),
    } as unknown as MapProvider;
    const tool = createGeocodeTool(map);
    const result = await tool.execute({ address: '三里屯' });
    expect(map.geocode).toHaveBeenCalledWith('三里屯');
    expect(result).toEqual({
      mode: 'forward',
      address: '三里屯',
      results: [{ location: { lng: 116.48, lat: 39.99 }, formattedAddress: '北京市朝阳区三里屯' }],
    });
  });

  it('逆地理编码：坐标→地址', async () => {
    const map = {
      geocode: vi.fn(),
      reverseGeocode: vi.fn().mockResolvedValue({ location: { lng: 116.48, lat: 39.99 }, formattedAddress: '北京市朝阳区' }),
    } as unknown as MapProvider;
    const tool = createGeocodeTool(map);
    const result = await tool.execute({ location: { lng: 116.48, lat: 39.99 } });
    expect(map.reverseGeocode).toHaveBeenCalledWith({ lng: 116.48, lat: 39.99 });
    expect(result).toEqual({
      mode: 'reverse',
      location: { lng: 116.48, lat: 39.99 },
      result: { location: { lng: 116.48, lat: 39.99 }, formattedAddress: '北京市朝阳区' },
    });
  });

  it('缺少 address 与 location 时返回错误', async () => {
    const map = {} as unknown as MapProvider;
    const tool = createGeocodeTool(map);
    const result = await tool.execute({});
    expect(result).toEqual({ error: '需要提供 address 或 location' });
  });

  it('工具定义名称为 geocode', () => {
    const tool = createGeocodeTool({} as unknown as MapProvider);
    expect(tool.name).toBe('geocode');
    expect(tool.definition.function.name).toBe('geocode');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && npx vitest run src/tools/geocode.test.ts`
Expected: FAIL，"Cannot find module './geocode'"。

- [ ] **Step 3: 实现 `server/src/tools/geocode.ts`**

```ts
import { z } from 'zod';
import type { MapProvider, Tool } from '../types';

const schema = z.object({
  address: z.string().optional(),
  location: z.object({ lng: z.number(), lat: z.number() }).optional(),
});

export function createGeocodeTool(map: MapProvider): Tool {
  return {
    name: 'geocode',
    definition: {
      type: 'function',
      function: {
        name: 'geocode',
        description: '地址与坐标互转。给 address 返回坐标（正地理编码）；给 location 返回地址（逆地理编码）。',
        parameters: {
          type: 'object',
          properties: {
            address: { type: 'string', description: '要解析为坐标的地名/地址，如"三里屯"' },
            location: {
              type: 'object',
              description: '要解析为地址的坐标',
              properties: { lng: { type: 'number' }, lat: { type: 'number' } },
              required: ['lng', 'lat'],
            },
          },
        },
      },
    },
    async execute(args) {
      const parsed = schema.parse(args);
      if (parsed.address) {
        const results = await map.geocode(parsed.address);
        return { mode: 'forward' as const, address: parsed.address, results };
      }
      if (parsed.location) {
        const result = await map.reverseGeocode(parsed.location);
        return { mode: 'reverse' as const, location: parsed.location, result };
      }
      return { error: '需要提供 address 或 location' };
    },
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && npx vitest run src/tools/geocode.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 5: 提交**

```bash
git add server/src/tools/geocode.ts server/src/tools/geocode.test.ts
git commit -m "feat: add geocode tool"
```

---

## Task 4：route_plan 工具（TDD）

**Files:**
- Create: `server/src/tools/routing.ts`
- Test: `server/src/tools/routing.test.ts`

**Interfaces:**
- Consumes: `MapProvider.geocode` + `MapProvider.planRoute`（Task 2）。
- Produces: `createRouteTool(map): Tool`，name = `route_plan`。返回 `{ route: RouteResult }`（含 `polyline` 供前端画线）。

- [ ] **Step 1: 写失败测试 `server/src/tools/routing.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createRouteTool } from './routing';
import type { MapProvider } from '../types';

function makeMap(): MapProvider {
  return {
    geocode: vi.fn().mockImplementation(async (address: string) => {
      if (address === '三里屯') return [{ location: { lng: 116.48, lat: 39.99 } }];
      if (address === '国贸') return [{ location: { lng: 116.46, lat: 39.91 } }];
      return [];
    }),
    reverseGeocode: vi.fn(),
    planRoute: vi.fn().mockResolvedValue({
      mode: 'driving',
      origin: { lng: 116.48, lat: 39.99 },
      destination: { lng: 116.46, lat: 39.91 },
      distance: 5000,
      duration: 600,
      segments: [],
      polyline: [{ lng: 116.48, lat: 39.99 }, { lng: 116.46, lat: 39.91 }],
    }),
  } as unknown as MapProvider;
}

describe('route_plan 工具', () => {
  it('地名→geocode→planRoute，返回 route', async () => {
    const map = makeMap();
    const tool = createRouteTool(map);
    const result = await tool.execute({ mode: 'driving', origin: '三里屯', destination: '国贸' });
    expect(map.geocode).toHaveBeenCalledWith('三里屯');
    expect(map.geocode).toHaveBeenCalledWith('国贸');
    expect(map.planRoute).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'driving',
      origin: { lng: 116.48, lat: 39.99 },
      destination: { lng: 116.46, lat: 39.91 },
    }));
    expect(result).toEqual({
      route: expect.objectContaining({ mode: 'driving', distance: 5000, duration: 600 }),
    });
  });

  it('无法定位地名时返回错误', async () => {
    const map = makeMap();
    const tool = createRouteTool(map);
    const result = await tool.execute({ mode: 'driving', origin: '不存在的地方', destination: '国贸' });
    expect(result).toEqual({ error: '无法定位：不存在的地方' });
  });

  it('途经点也被 geocode', async () => {
    const map = makeMap();
    const tool = createRouteTool(map);
    await tool.execute({ mode: 'driving', origin: '三里屯', destination: '国贸', waypoints: ['三里屯'] });
    expect(map.planRoute).toHaveBeenCalledWith(expect.objectContaining({
      waypoints: [{ lng: 116.48, lat: 39.99 }],
    }));
  });

  it('工具定义名称为 route_plan', () => {
    const tool = createRouteTool({} as unknown as MapProvider);
    expect(tool.name).toBe('route_plan');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && npx vitest run src/tools/routing.test.ts`
Expected: FAIL，"Cannot find module './routing'"。

- [ ] **Step 3: 实现 `server/src/tools/routing.ts`**

```ts
import { z } from 'zod';
import type { LngLat, MapProvider, Tool } from '../types';

const schema = z.object({
  mode: z.enum(['driving', 'walking', 'riding', 'transit']),
  origin: z.string(),
  destination: z.string(),
  waypoints: z.array(z.string()).optional(),
  city: z.string().optional(),
});

async function resolve(map: MapProvider, name: string): Promise<LngLat | null> {
  const results = await map.geocode(name);
  return results[0]?.location ?? null;
}

export function createRouteTool(map: MapProvider): Tool {
  return {
    name: 'route_plan',
    definition: {
      type: 'function',
      function: {
        name: 'route_plan',
        description: '规划两地路线（驾车/步行/骑行/公交）。origin/destination/waypoints 传地名，内部自动解析坐标。返回距离、耗时与路线折线（自动渲染到地图）。',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['driving', 'walking', 'riding', 'transit'], description: '交通方式' },
            origin: { type: 'string', description: '出发地地名，如"三里屯"' },
            destination: { type: 'string', description: '目的地地名，如"国贸"' },
            waypoints: { type: 'array', items: { type: 'string' }, description: '途经点地名列表（仅驾车）' },
            city: { type: 'string', description: '公交模式所需的城市，如"北京"' },
          },
          required: ['mode', 'origin', 'destination'],
        },
      },
    },
    async execute(args) {
      const parsed = schema.parse(args);
      const origin = await resolve(map, parsed.origin);
      if (!origin) return { error: `无法定位：${parsed.origin}` };
      const destination = await resolve(map, parsed.destination);
      if (!destination) return { error: `无法定位：${parsed.destination}` };
      const waypoints: LngLat[] = [];
      for (const w of parsed.waypoints ?? []) {
        const loc = await resolve(map, w);
        if (!loc) return { error: `无法定位：${w}` };
        waypoints.push(loc);
      }
      const route = await map.planRoute({
        mode: parsed.mode,
        origin,
        destination,
        waypoints: waypoints.length ? waypoints : undefined,
        city: parsed.city,
      });
      return { route };
    },
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && npx vitest run src/tools/routing.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 5: 提交**

```bash
git add server/src/tools/routing.ts server/src/tools/routing.test.ts
git commit -m "feat: add route_plan tool"
```

---

## Task 5：spatial_query 工具（TDD）

**Files:**
- Create: `server/src/tools/knowledge.ts`
- Test: `server/src/tools/knowledge.test.ts`

**Interfaces:**
- Consumes: `MapProvider.geocode`（Task 2）。
- Produces: `createSpatialTool(map): Tool`，name = `spatial_query`。返回每个 place 相对 reference 的 `distanceKm`、`direction`（8 点方位）与 `nearest`。

- [ ] **Step 1: 写失败测试 `server/src/tools/knowledge.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createSpatialTool } from './knowledge';
import type { MapProvider } from '../types';

// 北京 [116.40, 39.90] → 上海 [121.47, 31.23]：约 1067km，方位≈153°→东南
function makeMap(): MapProvider {
  return {
    geocode: vi.fn().mockImplementation(async (address: string) => {
      if (address === '北京') return [{ location: { lng: 116.4, lat: 39.9 } }];
      if (address === '上海') return [{ location: { lng: 121.47, lat: 31.23 } }];
      if (address === '南京') return [{ location: { lng: 118.8, lat: 32.06 } }];
      return [];
    }),
    reverseGeocode: vi.fn(),
    planRoute: vi.fn(),
  } as unknown as MapProvider;
}

describe('spatial_query 工具', () => {
  it('计算方向、距离与最近点', async () => {
    const map = makeMap();
    const tool = createSpatialTool(map);
    const result = await tool.execute({ reference: '北京', places: ['上海', '南京'] });
    expect(result).toEqual({
      reference: '北京',
      referenceLocation: { lng: 116.4, lat: 39.9 },
      results: [
        expect.objectContaining({ place: '上海', direction: '东南', distanceKm: expect.any(Number) }),
        expect.objectContaining({ place: '南京', direction: '东南', distanceKm: expect.any(Number) }),
      ],
      nearest: '南京',
    });
    const res = result as any;
    expect(res.results[0].distanceKm).toBeGreaterThan(1000);
    expect(res.results[0].distanceKm).toBeLessThan(1100);
    expect(res.results[1].distanceKm).toBeLessThan(res.results[0].distanceKm);
  });

  it('省略 reference 时以第一个 place 为参考', async () => {
    const map = makeMap();
    const tool = createSpatialTool(map);
    const result = (await tool.execute({ places: ['北京', '上海'] })) as any;
    expect(result.reference).toBe('北京');
  });

  it('地名无法定位时返回错误', async () => {
    const map = makeMap();
    const tool = createSpatialTool(map);
    const result = await tool.execute({ reference: '火星', places: ['上海'] });
    expect(result).toEqual({ error: '无法定位：火星' });
  });

  it('工具定义名称为 spatial_query', () => {
    const tool = createSpatialTool({} as unknown as MapProvider);
    expect(tool.name).toBe('spatial_query');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && npx vitest run src/tools/knowledge.test.ts`
Expected: FAIL，"Cannot find module './knowledge'"。

- [ ] **Step 3: 实现 `server/src/tools/knowledge.ts`**

```ts
import { z } from 'zod';
import type { LngLat, MapProvider, Tool } from '../types';

const schema = z.object({
  reference: z.string().optional(),
  places: z.array(z.string()).min(1),
});

const TO_RAD = (d: number) => (d * Math.PI) / 180;
const TO_DEG = (r: number) => (r * 180) / Math.PI;

function haversineKm(a: LngLat, b: LngLat): number {
  const R = 6371;
  const dLat = TO_RAD(b.lat - a.lat);
  const dLng = TO_RAD(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(TO_RAD(a.lat)) * Math.cos(TO_RAD(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function bearing(a: LngLat, b: LngLat): number {
  const dLng = TO_RAD(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(TO_RAD(b.lat));
  const x = Math.cos(TO_RAD(a.lat)) * Math.sin(TO_RAD(b.lat)) - Math.sin(TO_RAD(a.lat)) * Math.cos(TO_RAD(b.lat)) * Math.cos(dLng);
  return (TO_DEG(Math.atan2(y, x)) + 360) % 360;
}

const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
function compass(b: number): string {
  return DIRS[Math.round(b / 45) % 8];
}

export function createSpatialTool(map: MapProvider): Tool {
  return {
    name: 'spatial_query',
    definition: {
      type: 'function',
      function: {
        name: 'spatial_query',
        description: '分析地理空间关系：给定参考地与若干地点，计算每个地点相对参考地的直线距离（公里）与方位（8 点罗盘），并指出最近的一个。用于回答「X 在 Y 的什么方向」「哪个最近」。',
        parameters: {
          type: 'object',
          properties: {
            reference: { type: 'string', description: '参考地名；省略时以 places[0] 为参考' },
            places: { type: 'array', items: { type: 'string' }, description: '待分析的地点名列表' },
          },
          required: ['places'],
        },
      },
    },
    async execute(args) {
      const parsed = schema.parse(args);
      const refName = parsed.reference ?? parsed.places[0];
      const refResults = await map.geocode(refName);
      const refLoc = refResults[0]?.location;
      if (!refLoc) return { error: `无法定位：${refName}` };

      const results: Array<{ place: string; location: LngLat; distanceKm: number; direction: string }> = [];
      let nearest: { place: string; distanceKm: number } | null = null;
      for (const place of parsed.places.filter((p) => p !== refName)) {
        const loc = (await map.geocode(place))[0]?.location;
        if (!loc) return { error: `无法定位：${place}` };
        const distanceKm = Math.round(haversineKm(refLoc, loc));
        const direction = compass(bearing(refLoc, loc));
        results.push({ place, location: loc, distanceKm, direction });
        if (!nearest || distanceKm < nearest.distanceKm) nearest = { place, distanceKm };
      }
      return {
        reference: refName,
        referenceLocation: refLoc,
        results,
        nearest: nearest?.place ?? refName,
      };
    },
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && npx vitest run src/tools/knowledge.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 5: 运行全部后端测试，确认工具层全绿**

Run: `cd server && npm test`
Expected: 全部 PASS（amap 7 + poi 2 + geocode 4 + routing 4 + knowledge 4 + deepseek 3 + core 3 + api 3 = 30 passed）。

- [ ] **Step 6: 提交**

```bash
git add server/src/tools/knowledge.ts server/src/tools/knowledge.test.ts
git commit -m "feat: add spatial_query tool"
```

## Task 6：DeepSeek 流式 streamChat（TDD）

**Files:**
- Modify: `server/src/llm/deepseek.ts`
- Test: `server/src/llm/deepseek.test.ts`

**Interfaces:**
- Consumes: `LLM.streamChat`（Task 1）。
- Produces: `createDeepSeekLLM(...)` 返回对象实现 `streamChat`：逐 token 回调 `onToken`，最终返回装配好的 `LLMResponse`（content 拼接、tool_calls delta 合并）。供 Task 7 的 `runAgent` 使用。

- [ ] **Step 1: 在 `server/src/llm/deepseek.test.ts` 追加流式测试**

在现有 `describe` 块内追加：

```ts
  // 构造一个 SSE 响应体（Node 18 全局 ReadableStream / TextEncoder）
  function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c + '\n\n'));
        controller.close();
      },
    });
  }

  it('流式输出 token 并拼接最终 content', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: sseBody([
        'data: {"choices":[{"delta":{"content":"你"}}]}',
        'data: {"choices":[{"delta":{"content":"好"}}]}',
        'data: [DONE]',
      ]),
    }) as unknown as typeof fetch;
    const llm = createDeepSeekLLM({ apiKey: 'k', fetch: fakeFetch });
    const tokens: string[] = [];
    const res = await llm.streamChat!({ messages: [], tools: [], onToken: (t) => tokens.push(t) });
    expect(tokens).toEqual(['你', '好']);
    expect(res.content).toBe('你好');
    expect(res.toolCalls).toEqual([]);
  });

  it('流式装配 tool_calls delta', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: sseBody([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"poi_search","arguments":""}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"keyword\\""}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"咖啡\\"}"}}]}}]}',
        'data: [DONE]',
      ]),
    }) as unknown as typeof fetch;
    const llm = createDeepSeekLLM({ apiKey: 'k', fetch: fakeFetch });
    const res = await llm.streamChat!({ messages: [], tools: [], onToken: () => {} });
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].id).toBe('c1');
    expect(res.toolCalls[0].function.name).toBe('poi_search');
    expect(res.toolCalls[0].function.arguments).toBe('{"keyword":"咖啡"}');
  });
```

- [ ] **Step 2: 运行测试，确认新增失败**

Run: `cd server && npx vitest run src/llm/deepseek.test.ts`
Expected: FAIL（`llm.streamChat` 不是函数）。

- [ ] **Step 3: 替换 `server/src/llm/deepseek.ts` 全文**

```ts
import type { LLM, LLMResponse, ToolDefinition } from '../types';

interface DeltaToolCall {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

export function createDeepSeekLLM(opts: {
  apiKey: string;
  model?: string;
  url?: string;
  fetch?: typeof fetch;
}): LLM {
  const doFetch = opts.fetch ?? fetch;
  const model = opts.model ?? 'deepseek-chat';
  const url = opts.url ?? 'https://api.deepseek.com/chat/completions';

  function buildBody(messages: unknown, tools: ToolDefinition[], stream: boolean) {
    const body: Record<string, unknown> = { model, messages, stream };
    if (tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    return body;
  }

  function headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    };
  }

  async function chat({ messages, tools }): Promise<LLMResponse> {
    const res = await doFetch(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(buildBody(messages, tools, false)),
    });
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> } }>;
    };
    const msg = json.choices[0].message;
    const toolCalls = (msg.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));
    return { content: msg.content, toolCalls };
  }

  async function streamChat({ messages, tools, onToken }): Promise<LLMResponse> {
    const res = await doFetch(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(buildBody(messages, tools, true)),
    });
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${await res.text()}`);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const byIndex = new Map<number, DeltaToolCall>();
    const order: number[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string | null; tool_calls?: DeltaToolCall[] } }> };
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          await onToken(delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
          if (!byIndex.has(tc.index)) {
            byIndex.set(tc.index, { index: tc.index });
            order.push(tc.index);
          }
          const acc = byIndex.get(tc.index)!;
          if (tc.id) acc.id = tc.id;
          if (tc.type) acc.type = tc.type;
          if (tc.function?.name) acc.function = { ...(acc.function ?? {}), name: tc.function.name };
          if (tc.function?.arguments) acc.function = { ...(acc.function ?? {}), arguments: (acc.function?.arguments ?? '') + tc.function.arguments };
        }
      }
    }

    const toolCalls = order.map((idx) => {
      const acc = byIndex.get(idx)!;
      return {
        id: acc.id ?? '',
        type: 'function' as const,
        function: { name: acc.function?.name ?? '', arguments: acc.function?.arguments ?? '' },
      };
    });
    return { content: content || null, toolCalls };
  }

  return { chat, streamChat };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && npx vitest run src/llm/deepseek.test.ts`
Expected: PASS（原 3 + 新 2 = 5 passed）。

- [ ] **Step 5: 提交**

```bash
git add server/src/llm/deepseek.ts server/src/llm/deepseek.test.ts
git commit -m "feat: add deepseek streaming streamChat"
```

---

## Task 7：runAgent 流式 + 返回 messages + 通用提示词（TDD）

**Files:**
- Modify: `server/src/agent/core.ts`, `server/src/agent/prompts.ts`
- Test: `server/src/agent/core.test.ts`

**Interfaces:**
- Consumes: `LLM.streamChat`（Task 6）。
- Produces: `runAgent` 返回 `Promise<LLMMessage[]>`（完整消息数组，供 Task 9 落记忆）；流式可用时边收 token 边推 `token` 事件，最终仍推 `message`+`done`。

- [ ] **Step 1: 替换 `server/src/agent/prompts.ts` 全文（通用化）**

```ts
import type { Tool } from '../types';

export function buildSystemPrompt(tools: Tool[]): string {
  const toolList = tools.map((t) => `- ${t.name}: ${t.definition.function.description}`).join('\n');
  return `你是一个地图智能体。用户用自然语言提问，你通过调用工具查找地点、规划路线、分析地理空间关系。
可用工具：
${toolList}

规则：
- 查找地点/POI 用 poi_search；地址与坐标互转用 geocode；两地路线用 route_plan；方向/距离/就近关系用 spatial_query。
- 工具结果会自动渲染到地图（POI 标记、路线折线），你只需用自然语言总结（名称、数量、耗时、方向），不必复述坐标或折线点。
- 复杂任务可分多步：先搜索/编码，再规划路线或分析关系。
- 信息不足时直接反问用户（出发地、目的地、预算、时间等）。
- 用简洁的中文回答。`;
}
```

- [ ] **Step 2: 在 `server/src/agent/core.test.ts` 追加流式测试**

在现有 `describe` 块内追加：

```ts
  it('流式 LLM 逐 token 推送，最后推 message + done', async () => {
    const events: AgentEvent[] = [];
    const llm: LLM = {
      chat: async () => ({ content: '找到2家咖啡馆', toolCalls: [] }),
      streamChat: async ({ onToken }) => {
        for (const t of ['找到', '2家', '咖啡馆']) await onToken(t);
        return { content: '找到2家咖啡馆', toolCalls: [] };
      },
    };
    const messages = await runAgent('找咖啡', { llm, tools: [], onEvent: (e) => { events.push(e); } });
    expect(events.map((e) => e.type)).toEqual(['token', 'token', 'token', 'message', 'done']);
    expect(events[3]).toMatchObject({ content: '找到2家咖啡馆' });
    expect(messages.some((m) => m.role === 'user' && m.content === '找咖啡')).toBe(true);
  });

  it('runAgent 返回完整 messages 数组（含 system/user）', async () => {
    const llm = makeScriptedLLM([{ content: '你好', toolCalls: [] }]);
    const messages = await runAgent('hi', { llm, tools: [], onEvent: () => {} });
    expect(messages[0].role).toBe('system');
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', content: '你好' });
  });
```

- [ ] **Step 3: 运行测试，确认新增失败**

Run: `cd server && npx vitest run src/agent/core.test.ts`
Expected: FAIL（流式测试：`runAgent` 未用 streamChat；返回值非 messages）。

- [ ] **Step 4: 替换 `server/src/agent/core.ts` 全文**

```ts
import type { AgentEvent, LLM, LLMMessage, Tool } from '../types';
import { buildSystemPrompt } from './prompts';

export interface RunAgentDeps {
  llm: LLM;
  tools: Tool[];
  shortTermMemory?: LLMMessage[];
  maxIterations?: number;
  // 事件下沉可为异步（SSE 写入是 async）。必须 await，否则流关闭时尾部事件会丢失。
  onEvent: (event: AgentEvent) => void | Promise<void>;
}

export async function runAgent(userInput: string, deps: RunAgentDeps): Promise<LLMMessage[]> {
  const { llm, tools, onEvent } = deps;
  const maxIterations = deps.maxIterations ?? 8;
  const toolDefs = tools.map((t) => t.definition);
  const useStream = !!llm.streamChat;
  const messages: LLMMessage[] = [
    { role: 'system', content: buildSystemPrompt(tools) },
    ...(deps.shortTermMemory ?? []),
    { role: 'user', content: userInput },
  ];

  for (let i = 0; i < maxIterations; i++) {
    const response = useStream
      ? await llm.streamChat!({
          messages,
          tools: toolDefs,
          onToken: async (t) => { await onEvent({ type: 'token', content: t }); },
        })
      : await llm.chat({ messages, tools: toolDefs });

    if (response.toolCalls.length > 0) {
      messages.push({ role: 'assistant', content: response.content, tool_calls: response.toolCalls });
      for (const call of response.toolCalls) {
        await onEvent({ type: 'tool_call', tool: call.function.name, args: call.function.arguments });
        const tool = tools.find((t) => t.name === call.function.name);
        let result: unknown;
        if (!tool) {
          result = { error: `unknown tool: ${call.function.name}` };
        } else {
          try {
            result = await tool.execute(JSON.parse(call.function.arguments));
          } catch (e) {
            result = { error: (e as Error).message };
          }
        }
        await onEvent({ type: 'observation', tool: call.function.name, result });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
      continue;
    }

    await onEvent({ type: 'message', content: response.content ?? '' });
    await onEvent({ type: 'done' });
    messages.push({ role: 'assistant', content: response.content ?? '' });
    return messages;
  }

  await onEvent({ type: 'error', message: `达到最大迭代次数 ${maxIterations}` });
  return messages;
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd server && npx vitest run src/agent/core.test.ts`
Expected: PASS（原 3 + 新 2 = 5 passed）。

- [ ] **Step 6: 运行全部后端测试，确认无回归**

Run: `cd server && npm test`
Expected: 全部 PASS（35 passed）。

- [ ] **Step 7: 提交**

```bash
git add server/src/agent/core.ts server/src/agent/core.test.ts server/src/agent/prompts.ts
git commit -m "feat: stream tokens in runAgent and return messages"
```

---

## Task 8：短期记忆（TDD）

**Files:**
- Create: `server/src/memory/short_term.ts`
- Test: `server/src/memory/short_term.test.ts`

**Interfaces:**
- Consumes: `LLMMessage`（Task 1）。
- Produces: `createShortTermMemory(): ShortTermMemory`，方法 `get(sessionId)` / `save(sessionId, messages)` / `clear(sessionId)`。供 Task 9 的 API 使用。

- [ ] **Step 1: 写失败测试 `server/src/memory/short_term.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createShortTermMemory } from './short_term';
import type { LLMMessage } from '../types';

describe('short_term memory', () => {
  it('save 后 get 返回相同消息', () => {
    const mem = createShortTermMemory();
    const msgs: LLMMessage[] = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好啊' },
    ];
    mem.save('s1', msgs);
    expect(mem.get('s1')).toEqual(msgs);
  });

  it('不同 sessionId 互相隔离', () => {
    const mem = createShortTermMemory();
    mem.save('s1', [{ role: 'user', content: 'a' }]);
    mem.save('s2', [{ role: 'user', content: 'b' }]);
    expect(mem.get('s1')).toHaveLength(1);
    expect((mem.get('s1')[0] as any).content).toBe('a');
    expect((mem.get('s2')[0] as any).content).toBe('b');
  });

  it('未知 sessionId 返回空数组', () => {
    const mem = createShortTermMemory();
    expect(mem.get('unknown')).toEqual([]);
  });

  it('clear 清空指定会话', () => {
    const mem = createShortTermMemory();
    mem.save('s1', [{ role: 'user', content: 'a' }]);
    mem.clear('s1');
    expect(mem.get('s1')).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && npx vitest run src/memory/short_term.test.ts`
Expected: FAIL，"Cannot find module './short_term'"。

- [ ] **Step 3: 实现 `server/src/memory/short_term.ts`**

```ts
import type { LLMMessage } from '../types';

export interface ShortTermMemory {
  get(sessionId: string): LLMMessage[];
  save(sessionId: string, messages: LLMMessage[]): void;
  clear(sessionId: string): void;
}

export function createShortTermMemory(): ShortTermMemory {
  const store = new Map<string, LLMMessage[]>();
  return {
    get(sessionId) {
      return store.get(sessionId) ?? [];
    },
    save(sessionId, messages) {
      // 落库时去掉 system 提示词（每次 runAgent 会重新前置）
      store.set(sessionId, messages.filter((m) => m.role !== 'system'));
    },
    clear(sessionId) {
      store.delete(sessionId);
    },
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && npx vitest run src/memory/short_term.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 5: 提交**

```bash
git add server/src/memory/short_term.ts server/src/memory/short_term.test.ts
git commit -m "feat: add in-memory short-term session memory"
```

## Task 9：API 接入 sessionId + 短期记忆 + 4 工具装配（TDD）

**Files:**
- Modify: `server/src/api/server.ts`
- Test: `server/src/api/server.test.ts`

**Interfaces:**
- Consumes: `runAgent` 返回 messages（Task 7）、`createShortTermMemory`（Task 8）、4 个工具（Task 2/3/4/5）。
- Produces: `createApp(deps)` 的 `/api/chat` 接受 `{ message, sessionId? }`，按 sessionId 装载/保存记忆，默认装配 4 工具。

- [ ] **Step 1: 在 `server/src/api/server.test.ts` 追加跨轮记忆测试**

在现有 `describe` 块内追加：

```ts
  it('同一 sessionId 第二轮能看到第一轮的对话历史', async () => {
    const seen: any[] = [];
    let n = 0;
    const responses: LLMResponse[] = [
      { content: '好的', toolCalls: [] },
      { content: '继续', toolCalls: [] },
    ];
    const llm: LLM = {
      chat: async ({ messages }) => {
        seen.push(messages.map((m) => ({ role: m.role, content: (m as any).content })));
        return responses[n++];
      },
    };
    const app = createApp({ llm });

    await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '第一轮', sessionId: 'sess-A' }),
    });
    await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '第二轮', sessionId: 'sess-A' }),
    });

    // 第二次调用时 messages 应包含第一轮的 user + assistant
    expect(seen[1].some((m: any) => m.role === 'user' && m.content === '第一轮')).toBe(true);
    expect(seen[1].some((m: any) => m.role === 'assistant' && m.content === '好的')).toBe(true);
  });

  it('不同 sessionId 历史互不影响', async () => {
    const seen: any[] = [];
    let n = 0;
    const responses: LLMResponse[] = [{ content: 'A', toolCalls: [] }, { content: 'B', toolCalls: [] }];
    const llm: LLM = { chat: async ({ messages }) => { seen.push(messages); return responses[n++]; } };
    const app = createApp({ llm });

    await app.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '只对sess1说', sessionId: 's1' }) });
    await app.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi', sessionId: 's2' }) });

    expect(seen[1].some((m: any) => m.role === 'user' && m.content === '只对sess1说')).toBe(false);
  });
```

（文件顶部已有的 `import type { LLM, LLMResponse, Tool }` 复用；若 `LLMResponse` 未导入则补上。）

- [ ] **Step 2: 运行测试，确认新增失败**

Run: `cd server && npx vitest run src/api/server.test.ts`
Expected: FAIL（第二次调用看不到第一轮历史——当前 API 无记忆）。

- [ ] **Step 3: 替换 `server/src/api/server.ts` 全文**

```ts
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { config } from '../config';
import { createAmapProvider } from '../maps/amap';
import { createPoiTool } from '../tools/poi';
import { createGeocodeTool } from '../tools/geocode';
import { createRouteTool } from '../tools/routing';
import { createSpatialTool } from '../tools/knowledge';
import { createDeepSeekLLM } from '../llm/deepseek';
import { runAgent } from '../agent/core';
import { createShortTermMemory, type ShortTermMemory } from '../memory/short_term';
import type { AgentEvent, LLM, MapProvider, Tool } from '../types';

export interface AppDeps {
  llm?: LLM;
  map?: MapProvider;
  tools?: Tool[];
  memory?: ShortTermMemory;
}

export function createApp(deps: AppDeps = {}) {
  const app = new Hono();
  const map = deps.map ?? createAmapProvider({ apiKey: config.amapApiKey });
  const tools = deps.tools ?? [
    createPoiTool(map),
    createGeocodeTool(map),
    createRouteTool(map),
    createSpatialTool(map),
  ];
  const llm = deps.llm ?? createDeepSeekLLM({ apiKey: config.deepseekApiKey });
  const memory = deps.memory ?? createShortTermMemory();

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
        const messages = await runAgent(message, { llm, tools, shortTermMemory: history, onEvent: send });
        memory.save(sessionId, messages);
        await send({ type: 'done' });
      } catch (e) {
        await send({ type: 'error', message: (e as Error).message });
      }
    });
  });

  return app;
}
```

> 注意：`runAgent` 在正常结束时已自行推 `done`；上面 catch 之外再补一个 `done` 是为了兜底（即便 agent 内部已推也无害——前端对多个 done 幂等）。若你希望严格只推一次，可改为不补，但当前测试不依赖 done 次数。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && npx vitest run src/api/server.test.ts`
Expected: PASS（原 3 + 新 2 = 5 passed）。

- [ ] **Step 5: 运行全部后端测试**

Run: `cd server && npm test`
Expected: 全部 PASS（amap 7 + poi 2 + geocode 4 + routing 4 + knowledge 4 + deepseek 5 + core 5 + short_term 4 + api 5 = 40 passed）。

- [ ] **Step 6: 类型检查**

Run: `cd server && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 7: 提交**

```bash
git add server/src/api/server.ts server/src/api/server.test.ts
git commit -m "feat: wire sessionId, short-term memory, and 4 tools into api"
```

---

## Task 10：前端 — 路线渲染 + token 流式 + sessionId

**Files:**
- Modify: `web/src/stores/map.ts`, `web/src/stores/chat.ts`
- Modify: `web/src/components/MapPanel.vue`, `web/src/components/ChatPanel.vue`

> 前端无自动化测试（与 P0 一致）；以 `vue-tsc --noEmit` + Task 11 手动验证为保证。

- [ ] **Step 1: 替换 `web/src/stores/map.ts` 全文**

```ts
import { defineStore } from 'pinia';

export interface MapPOI {
  id: string;
  name: string;
  location: { lng: number; lat: number };
  address?: string;
}

export interface RouteData {
  mode: string;
  origin: { lng: number; lat: number };
  destination: { lng: number; lat: number };
  polyline: { lng: number; lat: number }[];
  distance: number; // 米
  duration: number; // 秒
}

export const useMapStore = defineStore('map', {
  state: () => ({
    pois: [] as MapPOI[],
    routes: [] as RouteData[],
    mapInstance: null as any,
  }),
  actions: {
    setPois(pois: MapPOI[]) {
      this.pois = pois;
    },
    setRoutes(routes: RouteData[]) {
      this.routes = routes;
    },
    setMap(m: any) {
      this.mapInstance = m;
    },
  },
});
```

- [ ] **Step 2: 替换 `web/src/stores/chat.ts` 全文**

```ts
import { defineStore } from 'pinia';
import { useMapStore, type RouteData } from './map';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  streaming?: boolean;
}

export const useChatStore = defineStore('chat', {
  state: () => ({
    messages: [] as ChatMessage[],
    loading: false,
    sessionId: crypto.randomUUID(),
  }),
  actions: {
    push(msg: ChatMessage) {
      this.messages.push(msg);
    },
    handleEvent(event: any) {
      const map = useMapStore();
      if (event.type === 'token') {
        const last = this.messages[this.messages.length - 1];
        if (last && last.role === 'assistant' && last.streaming) {
          last.content += event.content;
        } else {
          this.push({ id: crypto.randomUUID(), role: 'assistant', content: event.content, streaming: true });
        }
      } else if (event.type === 'message') {
        const last = this.messages[this.messages.length - 1];
        if (last && last.role === 'assistant' && last.streaming) {
          last.content = event.content;
          last.streaming = false;
        } else {
          this.push({ id: crypto.randomUUID(), role: 'assistant', content: event.content });
        }
      } else if (event.type === 'tool_call') {
        this.push({ id: crypto.randomUUID(), role: 'tool', content: `调用 ${event.tool}…`, toolName: event.tool });
      } else if (event.type === 'observation') {
        if (event.result?.error) {
          this.push({ id: crypto.randomUUID(), role: 'assistant', content: `⚠️ ${event.tool} 调用失败：${event.result.error}` });
        }
        if (event.tool === 'poi_search') {
          map.setPois(event.result?.pois ?? []);
        } else if (event.tool === 'route_plan') {
          const route = event.result?.route;
          map.setRoutes(route ? [route as RouteData] : []);
        }
      } else if (event.type === 'error') {
        this.push({ id: crypto.randomUUID(), role: 'assistant', content: `⚠️ 出错了：${event.message ?? '未知错误'}` });
      }
    },
    async send(text: string) {
      this.push({ id: crypto.randomUUID(), role: 'user', content: text });
      this.loading = true;
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, sessionId: this.sessionId }),
        });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop()!;
          for (const line of lines) {
            if (line.startsWith('data:')) {
              this.handleEvent(JSON.parse(line.slice(5).trim()));
            }
          }
        }
      } finally {
        this.loading = false;
      }
    },
  },
});
```

- [ ] **Step 3: 替换 `web/src/components/MapPanel.vue` 全文（增画折线）**

```vue
<template>
  <div class="map-panel"><div ref="el" class="map"></div></div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { loadAmap } from '../composables/useAmap';
import { useMapStore } from '../stores/map';

const key = import.meta.env.VITE_AMAP_JS_KEY as string;
const security = import.meta.env.VITE_AMAP_SECURITY as string | undefined;
const el = ref<HTMLDivElement>();
const store = useMapStore();
let AMap: any, map: any;
let markers: any[] = [];
let polylines: any[] = [];
const ROUTE_COLORS = ['#1677ff', '#52c41a', '#fa8c16', '#722ed1'];

onMounted(async () => {
  AMap = await loadAmap(key, security);
  map = new AMap.Map(el.value, { zoom: 11, center: [116.397, 39.9] });
  store.setMap(map);
});

watch(
  () => store.pois,
  (pois) => {
    markers.forEach((m) => m.setMap(null));
    markers = pois.map((p) => {
      const m = new AMap.Marker({ position: [p.location.lng, p.location.lat], title: p.name });
      m.setMap(map);
      return m;
    });
    if (pois.length && map) map.setFitView();
  },
  { deep: true },
);

watch(
  () => store.routes,
  (routes) => {
    polylines.forEach((p) => p.setMap(null));
    polylines = routes.map((r, i) => {
      const pl = new AMap.Polyline({
        path: r.polyline.map((pt) => [pt.lng, pt.lat]),
        strokeColor: ROUTE_COLORS[i % ROUTE_COLORS.length],
        strokeWeight: 5,
        strokeOpacity: 0.9,
      });
      pl.setMap(map);
      return pl;
    });
    if (routes.length && map) map.setFitView();
  },
  { deep: true },
);
</script>

<style scoped>
.map-panel { height: 100%; }
.map { width: 100%; height: 100%; }
</style>
```

- [ ] **Step 4: 替换 `web/src/components/ChatPanel.vue` 全文（流式气泡 + 自动滚动）**

```vue
<template>
  <div class="chat-panel">
    <div ref="messagesEl" class="messages">
      <div v-for="m in chat.messages" :key="m.id" :class="['msg', m.role]">
        <strong v-if="m.role === 'user'">你</strong>
        <strong v-else-if="m.role === 'assistant'">助手</strong>
        <strong v-else>🔧 {{ m.toolName }}</strong>
        <p>{{ m.content }}<span v-if="m.streaming" class="cursor">▋</span></p>
      </div>
    </div>
    <form class="input" @submit.prevent="onSend">
      <input v-model="text" placeholder="例如：找三里屯的咖啡馆 / 从三里屯到国贸怎么走 / 杭州在南京的什么方向" />
      <button :disabled="chat.loading || !text.trim()">发送</button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { useChatStore } from '../stores/chat';

const chat = useChatStore();
const text = ref('');
const messagesEl = ref<HTMLDivElement>();

async function scrollToBottom() {
  await nextTick();
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
}

watch(() => chat.messages.length, scrollToBottom);
// 流式时内容增长也跟随滚动
watch(
  () => chat.messages.map((m) => m.content).join(''),
  scrollToBottom,
);

async function onSend() {
  const t = text.value.trim();
  if (!t) return;
  text.value = '';
  await chat.send(t);
}
</script>

<style scoped>
.chat-panel { display: flex; flex-direction: column; height: 100%; }
.messages { flex: 1; overflow-y: auto; padding: 12px; }
.msg { margin-bottom: 10px; }
.msg.tool { color: #888; font-size: 0.9em; }
.input { display: flex; padding: 8px; border-top: 1px solid #ddd; gap: 8px; }
.input input { flex: 1; }
.cursor { animation: blink 1s step-start infinite; color: #1677ff; }
@keyframes blink { 50% { opacity: 0; } }
</style>
```

- [ ] **Step 5: 类型检查**

Run: `cd web && npx vue-tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 6: 提交**

```bash
git add web/src
git commit -m "feat: render routes, stream tokens, and carry sessionId in web"
```

---

## Task 11：端到端手动验证

**Files:** 无（验证步骤）

- [ ] **Step 1: 确认 Key 已填**

- `server/.env`（或 `.env.local`）：`DEEPSEEK_API_KEY`、`AMAP_API_KEY`（Web服务 Key）。
- `web/.env`：`VITE_AMAP_JS_KEY`、`VITE_AMAP_SECURITY`。

- [ ] **Step 2: 启动后端**

Run: `cd server && npm run dev`
Expected: 控制台输出 `f-agent server on http://localhost:3000`，无报错。

- [ ] **Step 3: 启动前端**

Run（新终端）: `cd web && npm run dev`
Expected: Vite 输出本地地址（如 `http://localhost:5173`）。

- [ ] **Step 4: 验证 POI 搜索（回归 P0）**

输入「找三里屯的咖啡馆」→ 地图出现标记 + 助手摘要。

- [ ] **Step 5: 验证路线规划**

输入「从三里屯到国贸怎么走」→ 聊天出现 `🔧 route_plan` 卡片 + 助手给出耗时/距离摘要 + 地图出现彩色折线并自适应视野。
若地图无折线：检查后端日志 `observation` 是否含 `route.polyline`；若高德返回错误（如 bicycling/transit 端点 404 或 INF），记录并在 `maps/amap.ts` 调整端点/参数后重试。

- [ ] **Step 6: 验证空间分析**

输入「杭州在南京的什么方向」→ 助手调用 `spatial_query` 并回答方向（应为「东南」）与直线距离。

- [ ] **Step 7: 验证短期记忆（跨轮）**

紧接上一轮输入「那它到上海呢」或「刚才那个城市再往前走」→ 助手能接上上文（说明 sessionId + 短期记忆生效）。若答非所问，检查 `/api/chat` 是否带了 `sessionId`（前端 chatStore）与 `memory.save` 是否在 runAgent 后执行。

- [ ] **Step 8: 验证流式**

观察助手回复是否逐字出现（token 事件）而非一次性出现。

- [ ] **Step 9: 提交 P1 完成标记**

```bash
git add -A
git commit -m "chore: p1 agent-core end-to-end verified"
```

---

## 完成标准（Definition of Done）

- 后端 40 个单测全绿（`cd server && npm test`）。
- `cd server && npx tsc --noEmit` 通过；`cd web && npx vue-tsc --noEmit` 通过。
- 浏览器中端到端跑通：POI 打点（回归）、路线折线、空间方向、跨轮记忆、token 流式。
- 代码按 Task 顺序提交，每个 Task 一个 commit。
- 现有 13 个 P0 测试保持全绿（向后兼容）。

## P1 之外的延后项（不在本计划内）

- Token 截断式短期记忆（成对保留 tool_call/tool）→ P2/P3
- `recommend` + planner 任务拆解 + 长期记忆 SQLite + 个性化 → P2
- GLM 适配器、LLM 切换对比、Trace 面板、地图↔对话联动、收藏、错误自恢复/主动澄清打磨 → P3

## 自检（Self-Review）

- **Spec 覆盖**：设计 §9 P1 = 完整 ReAct 循环（Task 7 流式+返回 messages 复用既有循环）+ routing/geocode/knowledge（Task 3/4/5）+ 短期记忆（Task 8/9）+ SSE 流式（Task 6/7/10）。✓ 全覆盖。
- **占位符扫描**：无 TBD/TODO；每步含完整代码与命令。✓
- **类型一致**：`LngLat`/`GeocodeResult`/`RouteResult` 跨任务签名一致；`route_plan` 返回 `{ route }`，前端 chatStore 与 mapStore RouteData 结构兼容；`spatial_query` 返回 `nearest`/`results[].direction/distanceKm`。✓
- **向后兼容**：`streamChat?` 可选、`token` 事件为新增变体、`runAgent` 返回值新增不影响现有断言；poi.test.ts fake 改 cast 适配扩展后的 MapProvider。✓


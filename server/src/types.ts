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

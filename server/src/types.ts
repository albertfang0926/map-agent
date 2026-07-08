// 地图 POI（地图服务与工具、前端共用结构）
export interface MapPOI {
  id: string;
  name: string;
  location: { lng: number; lat: number };
  address?: string;
  typecode?: string;
}

// 地图服务适配器接口（高德/百度/Mapbox 各自实现）
export interface MapProvider {
  searchPoi(params: { keyword: string; city?: string }): Promise<MapPOI[]>;
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
}

// agent 推送给前端的事件
export type AgentEvent =
  | { type: 'tool_call'; tool: string; args: unknown }
  | { type: 'observation'; tool: string; result: unknown }
  | { type: 'message'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

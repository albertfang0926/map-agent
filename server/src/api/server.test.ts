import { describe, it, expect } from 'vitest';
import { createApp } from './server';
import type { LLM, LLMResponse, Tool } from '../types';

// 复用：一个先返回 tool_call、再返回最终文本的假 LLM + 假工具（不触网）
function makeFakeLlmAndTool() {
  let n = 0;
  const responses: LLMResponse[] = [
    {
      content: null,
      toolCalls: [{ id: 'c1', type: 'function', function: { name: 'poi_search', arguments: '{"keyword":"咖啡"}' } }],
    },
    { content: '找到了1家咖啡馆', toolCalls: [] },
  ];
  const llm: LLM = { chat: async () => responses[n++] };
  const tool: Tool = {
    name: 'poi_search',
    definition: { type: 'function', function: { name: 'poi_search', description: 'd', parameters: {} } },
    execute: async () => ({ count: 1, pois: [{ id: '1', name: 'A', location: { lng: 1, lat: 2 } }] }),
  };
  return { llm, tool };
}

describe('api', () => {
  it('/health 返回 ok', async () => {
    const res = await createApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('/api/chat 缺少 message 返回 400', async () => {
    const res = await createApp().request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
  });

  it('/api/chat 流式输出 tool_call / observation / 最终 message 全部事件', async () => {
    const { llm, tool } = makeFakeLlmAndTool();
    const res = await createApp({ llm, tools: [tool] }).request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '找咖啡' }),
    });
    const body = await res.text();
    expect(body).toContain('"type":"tool_call"');
    expect(body).toContain('"type":"observation"');
    // 回归 bug：writeSSE 未被 await 时，流关闭前最后的 message 事件会丢失
    expect(body).toContain('"type":"message"');
    expect(body).toContain('找到了1家咖啡馆');
  });
});

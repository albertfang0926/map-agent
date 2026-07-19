import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../server';
import type { LLM, LLMResponse, Tool } from '../../types';
import type { LongTermMemory } from '../../memory/long_term';

// 所有测试统一注入 mockLTM，避免默认 createLongTermMemory 触盘
const mockLTM = {
  getRecentSummaries: vi.fn().mockResolvedValue([]),
  saveSummary: vi.fn().mockResolvedValue(undefined),
  getAllPreferences: vi.fn().mockResolvedValue({}),
} as unknown as LongTermMemory;

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
    const res = await createApp({ longTermMemory: mockLTM }).request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('/api/chat 缺少 message 返回 400', async () => {
    const res = await createApp({ longTermMemory: mockLTM }).request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
  });

  it('/api/chat 流式输出 tool_call / observation / 最终 message 全部事件', async () => {
    const { llm, tool } = makeFakeLlmAndTool();
    const res = await createApp({ llm, tools: [tool], longTermMemory: mockLTM }).request('/api/chat', {
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
    const app = createApp({ llm, longTermMemory: mockLTM });

    // 消费响应体：streamSSE 的回调（含 memory.save）需流被排空才会完整执行
    const r1 = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '第一轮', sessionId: 'sess-A' }),
    });
    await r1.text();
    const r2 = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '第二轮', sessionId: 'sess-A' }),
    });
    await r2.text();

    // 第二次调用时 messages 应包含第一轮的 user + assistant
    expect(seen[1].some((m: any) => m.role === 'user' && m.content === '第一轮')).toBe(true);
    expect(seen[1].some((m: any) => m.role === 'assistant' && m.content === '好的')).toBe(true);
  });

  it('不同 sessionId 历史互不影响', async () => {
    const seen: any[] = [];
    let n = 0;
    const responses: LLMResponse[] = [{ content: 'A', toolCalls: [] }, { content: 'B', toolCalls: [] }];
    const llm: LLM = { chat: async ({ messages }) => { seen.push(messages); return responses[n++]; } };
    const app = createApp({ llm, longTermMemory: mockLTM });

    const s1r = await app.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '只对sess1说', sessionId: 's1' }) });
    await s1r.text();
    const s2r = await app.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi', sessionId: 's2' }) });
    await s2r.text();

    expect(seen[1].some((m: any) => m.role === 'user' && m.content === '只对sess1说')).toBe(false);
  });

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
});

import { describe, it, expect, vi } from 'vitest';
import { createDeepSeekLLM } from './deepseek';

describe('deepseek LLM', () => {
  it('解析 tool_calls 响应', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
      json: async () => ({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'c1', type: 'function',
              function: { name: 'poi_search', arguments: '{"keyword":"咖啡"}' },
            }],
          },
        }],
      }),
    }) as unknown as typeof fetch;
    const llm = createDeepSeekLLM({ apiKey: 'k', fetch: fakeFetch });
    const res = await llm.chat({ messages: [{ role: 'user', content: '找咖啡' }], tools: [] });
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].function.name).toBe('poi_search');
  });

  it('解析纯文本响应', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true, text: async () => '',
      json: async () => ({ choices: [{ message: { content: '你好' } }] }),
    }) as unknown as typeof fetch;
    const llm = createDeepSeekLLM({ apiKey: 'k', fetch: fakeFetch });
    const res = await llm.chat({ messages: [], tools: [] });
    expect(res.content).toBe('你好');
    expect(res.toolCalls).toEqual([]);
  });

  it('HTTP 错误时抛出', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => 'unauthorized',
    }) as unknown as typeof fetch;
    const llm = createDeepSeekLLM({ apiKey: 'bad', fetch: fakeFetch });
    await expect(llm.chat({ messages: [], tools: [] })).rejects.toThrow('DeepSeek HTTP 401');
  });
});

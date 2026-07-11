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
    const res = await llm.streamChat!({ messages: [], tools: [], onToken: (t) => { tokens.push(t); } });
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
});

import { describe, it, expect } from 'vitest';
import { runAgent } from './core';
import type { LLM, LLMResponse, Tool, AgentEvent } from '../types';

function makeScriptedLLM(responses: LLMResponse[]): LLM {
  let i = 0;
  return { chat: async () => responses[i++] };
}

const fakeTool: Tool = {
  name: 'poi_search',
  definition: { type: 'function', function: { name: 'poi_search', description: 'd', parameters: {} } },
  execute: async () => ({ count: 2, pois: [] }),
};

describe('runAgent', () => {
  it('先调工具再回答，按序触发事件', async () => {
    const events: AgentEvent[] = [];
    const llm = makeScriptedLLM([
      { content: null, toolCalls: [{ id: 'c1', type: 'function', function: { name: 'poi_search', arguments: '{"keyword":"咖啡"}' } }] },
      { content: '找到2家咖啡馆', toolCalls: [] },
    ]);
    await runAgent('找咖啡', { llm, tools: [fakeTool], onEvent: (e) => { events.push(e); } });
    expect(events.map((e) => e.type)).toEqual(['tool_call', 'observation', 'message', 'done']);
    expect(events[0]).toMatchObject({ tool: 'poi_search', args: '{"keyword":"咖啡"}' });
    expect(events[2]).toMatchObject({ content: '找到2家咖啡馆' });
  });

  it('无需工具直接回答', async () => {
    const events: AgentEvent[] = [];
    const llm = makeScriptedLLM([{ content: '你好', toolCalls: [] }]);
    await runAgent('hi', { llm, tools: [], onEvent: (e) => { events.push(e); } });
    expect(events.map((e) => e.type)).toEqual(['message', 'done']);
  });

  it('达到最大迭代次数时触发 error', async () => {
    const events: AgentEvent[] = [];
    const llm: LLM = {
      chat: async () => ({ content: null, toolCalls: [{ id: 'c', type: 'function', function: { name: 'poi_search', arguments: '{}' } }] }),
    };
    await runAgent('x', { llm, tools: [fakeTool], onEvent: (e) => { events.push(e); }, maxIterations: 2 });
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

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
});

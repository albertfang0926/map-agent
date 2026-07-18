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

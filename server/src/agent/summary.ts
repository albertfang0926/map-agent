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

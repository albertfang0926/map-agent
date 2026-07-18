import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../prompts';
import type { Tool } from '../../types';

const tool: Tool = {
  name: 'poi_search',
  definition: { type: 'function', function: { name: 'poi_search', description: '搜POI', parameters: {} } },
  execute: async () => ({}),
};

describe('buildSystemPrompt', () => {
  it('含工具列表', () => {
    expect(buildSystemPrompt([tool])).toContain('poi_search: 搜POI');
  });

  it('注入用户历史摘要段', () => {
    const p = buildSystemPrompt([tool], { historySummaries: ['用户曾去上海看人文'] });
    expect(p).toContain('用户历史会话摘要');
    expect(p).toContain('用户曾去上海看人文');
  });

  it('无历史时不出现历史段', () => {
    expect(buildSystemPrompt([tool])).not.toContain('用户历史会话摘要');
  });

  it('含新工具用法指引', () => {
    expect(buildSystemPrompt([tool])).toContain('recommend');
    expect(buildSystemPrompt([tool])).toContain('remember_preference');
  });
});

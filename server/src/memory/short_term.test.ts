import { describe, it, expect } from 'vitest';
import { createShortTermMemory } from './short_term';
import type { LLMMessage } from '../types';

describe('short_term memory', () => {
  it('save 后 get 返回相同消息', () => {
    const mem = createShortTermMemory();
    const msgs: LLMMessage[] = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好啊' },
    ];
    mem.save('s1', msgs);
    expect(mem.get('s1')).toEqual(msgs);
  });

  it('不同 sessionId 互相隔离', () => {
    const mem = createShortTermMemory();
    mem.save('s1', [{ role: 'user', content: 'a' }]);
    mem.save('s2', [{ role: 'user', content: 'b' }]);
    expect(mem.get('s1')).toHaveLength(1);
    expect((mem.get('s1')[0] as any).content).toBe('a');
    expect((mem.get('s2')[0] as any).content).toBe('b');
  });

  it('未知 sessionId 返回空数组', () => {
    const mem = createShortTermMemory();
    expect(mem.get('unknown')).toEqual([]);
  });

  it('clear 清空指定会话', () => {
    const mem = createShortTermMemory();
    mem.save('s1', [{ role: 'user', content: 'a' }]);
    mem.clear('s1');
    expect(mem.get('s1')).toEqual([]);
  });
});

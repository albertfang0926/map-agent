import type { LLMMessage } from '../types';

export interface ShortTermMemory {
  get(sessionId: string): LLMMessage[];
  save(sessionId: string, messages: LLMMessage[]): void;
  clear(sessionId: string): void;
}

export function createShortTermMemory(): ShortTermMemory {
  const store = new Map<string, LLMMessage[]>();
  return {
    get(sessionId) {
      return store.get(sessionId) ?? [];
    },
    save(sessionId, messages) {
      // 落库时去掉 system 提示词（每次 runAgent 会重新前置）
      store.set(sessionId, messages.filter((m) => m.role !== 'system'));
    },
    clear(sessionId) {
      store.delete(sessionId);
    },
  };
}

import { defineStore } from 'pinia';
import { useMapStore } from './map';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
}

export const useChatStore = defineStore('chat', {
  state: () => ({
    messages: [] as ChatMessage[],
    loading: false,
  }),
  actions: {
    push(msg: ChatMessage) {
      this.messages.push(msg);
    },
    handleEvent(event: any) {
      const map = useMapStore();
      if (event.type === 'tool_call') {
        this.push({ id: crypto.randomUUID(), role: 'tool', content: `调用 ${event.tool}…`, toolName: event.tool });
      } else if (event.type === 'observation' && event.tool === 'poi_search') {
        map.setPois(event.result?.pois ?? []);
      } else if (event.type === 'message') {
        this.push({ id: crypto.randomUUID(), role: 'assistant', content: event.content });
      }
    },
    async send(text: string) {
      this.push({ id: crypto.randomUUID(), role: 'user', content: text });
      this.loading = true;
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop()!;
          for (const line of lines) {
            if (line.startsWith('data:')) {
              this.handleEvent(JSON.parse(line.slice(5).trim()));
            }
          }
        }
      } finally {
        this.loading = false;
      }
    },
  },
});

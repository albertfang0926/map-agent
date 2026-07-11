import { defineStore } from 'pinia';
import { useMapStore, type RouteData } from './map';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  streaming?: boolean;
}

export const useChatStore = defineStore('chat', {
  state: () => ({
    messages: [] as ChatMessage[],
    loading: false,
    sessionId: crypto.randomUUID(),
  }),
  actions: {
    push(msg: ChatMessage) {
      this.messages.push(msg);
    },
    handleEvent(event: any) {
      const map = useMapStore();
      if (event.type === 'token') {
        const last = this.messages[this.messages.length - 1];
        if (last && last.role === 'assistant' && last.streaming) {
          last.content += event.content;
        } else {
          this.push({ id: crypto.randomUUID(), role: 'assistant', content: event.content, streaming: true });
        }
      } else if (event.type === 'message') {
        const last = this.messages[this.messages.length - 1];
        if (last && last.role === 'assistant' && last.streaming) {
          last.content = event.content;
          last.streaming = false;
        } else {
          this.push({ id: crypto.randomUUID(), role: 'assistant', content: event.content });
        }
      } else if (event.type === 'tool_call') {
        this.push({ id: crypto.randomUUID(), role: 'tool', content: `调用 ${event.tool}…`, toolName: event.tool });
      } else if (event.type === 'observation') {
        if (event.result?.error) {
          this.push({ id: crypto.randomUUID(), role: 'assistant', content: `⚠️ ${event.tool} 调用失败：${event.result.error}` });
        }
        if (event.tool === 'poi_search') {
          map.setPois(event.result?.pois ?? []);
        } else if (event.tool === 'route_plan') {
          const route = event.result?.route;
          map.setRoutes(route ? [route as RouteData] : []);
        }
      } else if (event.type === 'error') {
        this.push({ id: crypto.randomUUID(), role: 'assistant', content: `⚠️ 出错了：${event.message ?? '未知错误'}` });
      }
    },
    async send(text: string) {
      this.push({ id: crypto.randomUUID(), role: 'user', content: text });
      this.loading = true;
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, sessionId: this.sessionId }),
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

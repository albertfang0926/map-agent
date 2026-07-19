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
    // 把「正在流式输出」的助手气泡定格：保留已收到的 token 文本，只清掉闪烁光标。
    // 在 tool_call / error / 网络中断打断流式时调用，避免遗留永久闪烁的半句气泡。
    commitStreaming() {
      const last = this.messages[this.messages.length - 1];
      if (last && last.role === 'assistant' && last.streaming) last.streaming = false;
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
        // 模型常在决定调工具前先输出一段引子文本（token），需把那段气泡定格，否则光标会一直闪。
        this.commitStreaming();
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
        } else if (event.tool === 'recommend') {
          const days = event.result?.itinerary?.days ?? [];
          const routes = days.map((d: any) => d.route).filter(Boolean) as RouteData[];
          map.setRoutes(routes);
        }
      } else if (event.type === 'error') {
        this.commitStreaming();
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
      } catch (e) {
        this.commitStreaming();
        this.push({ id: crypto.randomUUID(), role: 'assistant', content: `⚠️ 连接出错：${(e as Error).message ?? '未知错误'}` });
      } finally {
        this.loading = false;
      }
    },
  },
});

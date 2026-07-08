import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { config } from '../config';
import { createAmapProvider } from '../maps/amap';
import { createPoiTool } from '../tools/poi';
import { createDeepSeekLLM } from '../llm/deepseek';
import { runAgent } from '../agent/core';
import type { AgentEvent, LLM, MapProvider, Tool } from '../types';

export interface AppDeps {
  llm?: LLM;
  map?: MapProvider;
  tools?: Tool[];
}

export function createApp(deps: AppDeps = {}) {
  const app = new Hono();
  const map = deps.map ?? createAmapProvider({ apiKey: config.amapApiKey });
  const tools = deps.tools ?? [createPoiTool(map)];
  const llm = deps.llm ?? createDeepSeekLLM({ apiKey: config.deepseekApiKey });

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/api/chat', async (c) => {
    const body = await c.req.json<{ message?: string }>().catch(() => null);
    if (!body?.message) return c.json({ error: 'message required' }, 400);
    const message = body.message;

    return streamSSE(c, async (stream) => {
      const send = (event: AgentEvent) => stream.writeSSE({ data: JSON.stringify(event) });
      try {
        await runAgent(message, { llm, tools, onEvent: send });
      } catch (e) {
        await send({ type: 'error', message: (e as Error).message });
      }
    });
  });

  return app;
}

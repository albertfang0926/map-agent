import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { config } from '../config';
import { createAmapProvider } from '../maps/amap';
import { createPoiTool } from '../tools/poi';
import { createGeocodeTool } from '../tools/geocode';
import { createRouteTool } from '../tools/routing';
import { createSpatialTool } from '../tools/knowledge';
import { createDeepSeekLLM } from '../llm/deepseek';
import { runAgent } from '../agent/core';
import { createShortTermMemory, type ShortTermMemory } from '../memory/short_term';
import type { AgentEvent, LLM, MapProvider, Tool } from '../types';

export interface AppDeps {
  llm?: LLM;
  map?: MapProvider;
  tools?: Tool[];
  memory?: ShortTermMemory;
}

export function createApp(deps: AppDeps = {}) {
  const app = new Hono();
  const map = deps.map ?? createAmapProvider({ apiKey: config.amapApiKey });
  const tools = deps.tools ?? [
    createPoiTool(map),
    createGeocodeTool(map),
    createRouteTool(map),
    createSpatialTool(map),
  ];
  const llm = deps.llm ?? createDeepSeekLLM({ apiKey: config.deepseekApiKey });
  const memory = deps.memory ?? createShortTermMemory();

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/api/chat', async (c) => {
    const body = await c.req.json<{ message?: string; sessionId?: string }>().catch(() => null);
    if (!body?.message) return c.json({ error: 'message required' }, 400);
    const message = body.message;
    const sessionId = body.sessionId ?? crypto.randomUUID();

    return streamSSE(c, async (stream) => {
      const send = async (event: AgentEvent) => { await stream.writeSSE({ data: JSON.stringify(event) }); };
      try {
        const history = memory.get(sessionId);
        const messages = await runAgent(message, { llm, tools, shortTermMemory: history, onEvent: send });
        memory.save(sessionId, messages);
      } catch (e) {
        await send({ type: 'error', message: (e as Error).message });
      }
    });
  });

  return app;
}

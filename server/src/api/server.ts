import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { config } from '../config';
import { createAmapProvider } from '../maps/amap';
import { createPoiTool } from '../tools/poi';
import { createGeocodeTool } from '../tools/geocode';
import { createRouteTool } from '../tools/routing';
import { createSpatialTool } from '../tools/knowledge';
import { createRecommendTool } from '../tools/recommend';
import { createSavePlaceTool, createRememberPreferenceTool } from '../tools/memory_tools';
import { createDeepSeekLLM } from '../llm/deepseek';
import { runAgent } from '../agent/core';
import { createSessionSummarizer, type SessionSummarizer } from '../agent/summary';
import { createShortTermMemory, type ShortTermMemory } from '../memory/short_term';
import { createLongTermMemory, type LongTermMemory } from '../memory/long_term';
import type { AgentEvent, LLM, MapProvider, Tool } from '../types';

export interface AppDeps {
  llm?: LLM;
  map?: MapProvider;
  tools?: Tool[];
  memory?: ShortTermMemory;
  longTermMemory?: LongTermMemory;
  summarizer?: SessionSummarizer;
}

export function createApp(deps: AppDeps = {}) {
  const app = new Hono();
  const map = deps.map ?? createAmapProvider({ apiKey: config.amapApiKey });
  const llm = deps.llm ?? createDeepSeekLLM({ apiKey: config.deepseekApiKey });
  const memory = deps.memory ?? createShortTermMemory();
  const longTermMemory = deps.longTermMemory ?? createLongTermMemory({ dbPath: config.sqlitePath });
  const summarizer = deps.summarizer ?? createSessionSummarizer(llm);
  const tools = deps.tools ?? [
    createPoiTool(map),
    createGeocodeTool(map),
    createRouteTool(map),
    createSpatialTool(map),
    createRecommendTool(map, longTermMemory),
    createSavePlaceTool(longTermMemory),
    createRememberPreferenceTool(longTermMemory),
  ];

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
        // 首轮注入：该会话无短期记忆时，取最近 3 条历史摘要拼进 system 提示
        let historySummaries: string[] | undefined;
        if (history.length === 0) {
          try {
            const recent = await longTermMemory.getRecentSummaries(3);
            if (recent.length) historySummaries = recent.map((s) => s.summary);
          } catch {
            /* 取摘要失败不阻塞主流程 */
          }
        }
        const messages = await runAgent(message, {
          llm, tools, shortTermMemory: history, historySummaries, onEvent: send,
        });
        memory.save(sessionId, messages);
        // 会话摘要（累计 user 轮数 ≥ 2）：fire-and-forget，不阻塞响应
        const userTurns = messages.filter((m) => m.role === 'user').length;
        if (userTurns >= 2) {
          summarizer
            .summarize(messages)
            .then((summary) => longTermMemory.saveSummary(sessionId, summary, userTurns))
            .catch(() => { /* 摘要失败不影响主流程 */ });
        }
      } catch (e) {
        await send({ type: 'error', message: (e as Error).message });
      }
    });
  });

  return app;
}

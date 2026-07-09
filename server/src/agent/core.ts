import type { AgentEvent, LLM, LLMMessage, Tool } from '../types';
import { buildSystemPrompt } from './prompts';

export interface RunAgentDeps {
  llm: LLM;
  tools: Tool[];
  shortTermMemory?: LLMMessage[];
  maxIterations?: number;
  // 事件下沉可为异步（SSE 写入是 async）。必须 await，否则流关闭时尾部事件会丢失。
  onEvent: (event: AgentEvent) => void | Promise<void>;
}

export async function runAgent(userInput: string, deps: RunAgentDeps): Promise<void> {
  const { llm, tools, onEvent } = deps;
  const maxIterations = deps.maxIterations ?? 8;
  const toolDefs = tools.map((t) => t.definition);
  const messages: LLMMessage[] = [
    { role: 'system', content: buildSystemPrompt(tools) },
    ...(deps.shortTermMemory ?? []),
    { role: 'user', content: userInput },
  ];

  for (let i = 0; i < maxIterations; i++) {
    const response = await llm.chat({ messages, tools: toolDefs });

    if (response.toolCalls.length > 0) {
      messages.push({ role: 'assistant', content: response.content, tool_calls: response.toolCalls });
      for (const call of response.toolCalls) {
        await onEvent({ type: 'tool_call', tool: call.function.name, args: call.function.arguments });
        const tool = tools.find((t) => t.name === call.function.name);
        let result: unknown;
        if (!tool) {
          result = { error: `unknown tool: ${call.function.name}` };
        } else {
          try {
            result = await tool.execute(JSON.parse(call.function.arguments));
          } catch (e) {
            result = { error: (e as Error).message };
          }
        }
        await onEvent({ type: 'observation', tool: call.function.name, result });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
      continue;
    }

    await onEvent({ type: 'message', content: response.content ?? '' });
    await onEvent({ type: 'done' });
    return;
  }

  await onEvent({ type: 'error', message: `达到最大迭代次数 ${maxIterations}` });
}

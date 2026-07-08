import type { LLM, LLMResponse, ToolDefinition } from '../types';

export function createDeepSeekLLM(opts: {
  apiKey: string;
  model?: string;
  url?: string;
  fetch?: typeof fetch;
}): LLM {
  const doFetch = opts.fetch ?? fetch;
  const model = opts.model ?? 'deepseek-chat';
  const url = opts.url ?? 'https://api.deepseek.com/chat/completions';
  return {
    async chat({ messages, tools }) {
      const body: Record<string, unknown> = { model, messages, stream: false };
      if (tools.length) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }
      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as {
        choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> } }>;
      };
      const msg = json.choices[0].message;
      const toolCalls = (msg.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));
      return { content: msg.content, toolCalls } satisfies LLMResponse;
    },
  };
}

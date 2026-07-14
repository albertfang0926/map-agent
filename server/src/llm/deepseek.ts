import type { LLM, LLMMessage, LLMResponse, ToolDefinition } from '../types';

interface DeltaToolCall {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

export function createDeepSeekLLM(opts: {
  apiKey: string;
  model?: string;
  url?: string;
  fetch?: typeof fetch;
}): LLM {
  const doFetch = opts.fetch ?? fetch;
  const model = opts.model ?? 'deepseek-chat';
  const url = opts.url ?? 'https://api.deepseek.com/chat/completions';

  function buildBody(messages: unknown, tools: ToolDefinition[], stream: boolean) {
    const body: Record<string, unknown> = { model, messages, stream };
    if (tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    return body;
  }

  function headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    };
  }

  async function chat({ messages, tools }: { messages: LLMMessage[]; tools: ToolDefinition[] }): Promise<LLMResponse> {
    const res = await doFetch(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(buildBody(messages, tools, false)),
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
    return { content: msg.content, toolCalls };
  }

  async function streamChat({ messages, tools, onToken }: { messages: LLMMessage[]; tools: ToolDefinition[]; onToken: (token: string) => void | Promise<void> }): Promise<LLMResponse> {
    const res = await doFetch(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(buildBody(messages, tools, true)),
    });
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${await res.text()}`);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const byIndex = new Map<number, DeltaToolCall>();
    const order: number[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string | null; tool_calls?: DeltaToolCall[] } }> };
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          await onToken(delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
          if (!byIndex.has(tc.index)) {
            byIndex.set(tc.index, { index: tc.index });
            order.push(tc.index);
          }
          const acc = byIndex.get(tc.index)!;
          if (tc.id) acc.id = tc.id;
          if (tc.type) acc.type = tc.type;
          if (tc.function?.name) acc.function = { ...(acc.function ?? {}), name: tc.function.name };
          if (tc.function?.arguments) acc.function = { ...(acc.function ?? {}), arguments: (acc.function?.arguments ?? '') + tc.function.arguments };
        }
      }
    }

    const toolCalls = order.map((idx) => {
      const acc = byIndex.get(idx)!;
      return {
        id: acc.id ?? '',
        type: 'function' as const,
        function: { name: acc.function?.name ?? '', arguments: acc.function?.arguments ?? '' },
      };
    });
    return { content: content || null, toolCalls };
  }

  return { chat, streamChat };
}

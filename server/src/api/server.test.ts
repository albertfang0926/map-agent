import { describe, it, expect } from 'vitest';
import { createApp } from './server';

describe('api', () => {
  it('/health 返回 ok', async () => {
    const res = await createApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('/api/chat 缺少 message 返回 400', async () => {
    const res = await createApp().request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
  });
});

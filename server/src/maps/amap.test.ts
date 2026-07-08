import { describe, it, expect, vi } from 'vitest';
import { createAmapProvider } from './amap';

describe('createAmapProvider', () => {
  it('解析高德 POI 响应', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => ({
        status: '1',
        pois: [
          { id: '1', name: '咖啡馆A', location: '116.48,39.99', address: '路1号', typecode: '050500' },
        ],
      }),
    }) as unknown as typeof fetch;
    const provider = createAmapProvider({ apiKey: 'k', fetch: fakeFetch });
    const pois = await provider.searchPoi({ keyword: '咖啡馆' });
    expect(pois).toEqual([
      { id: '1', name: '咖啡馆A', location: { lng: 116.48, lat: 39.99 }, address: '路1号', typecode: '050500' },
    ]);
    expect(fakeFetch).toHaveBeenCalledOnce();
  });

  it('高德返回错误状态时抛出', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => ({ status: '0', info: 'INVALID_USER_KEY' }),
    }) as unknown as typeof fetch;
    const provider = createAmapProvider({ apiKey: 'bad', fetch: fakeFetch });
    await expect(provider.searchPoi({ keyword: 'x' })).rejects.toThrow('AMap error');
  });
});

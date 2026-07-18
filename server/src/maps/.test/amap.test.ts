import { describe, it, expect, vi } from 'vitest';
import { createAmapProvider } from '../amap';

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

  it('解析正地理编码响应', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => ({
        status: '1',
        geocodes: [
          { location: '116.48,39.99', formatted_address: '北京市朝阳区', province: '北京', city: [], district: '朝阳区' },
        ],
      }),
    }) as unknown as typeof fetch;
    const provider = createAmapProvider({ apiKey: 'k', fetch: fakeFetch });
    const res = await provider.geocode('三里屯');
    expect(res).toEqual([
      { location: { lng: 116.48, lat: 39.99 }, formattedAddress: '北京市朝阳区', province: '北京', city: undefined, district: '朝阳区' },
    ]);
  });

  it('解析逆地理编码响应', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => ({
        status: '1',
        regeocode: { formatted_address: '北京市朝阳区三里屯', addressComponent: { province: '北京', city: [], district: '朝阳区' } },
      }),
    }) as unknown as typeof fetch;
    const provider = createAmapProvider({ apiKey: 'k', fetch: fakeFetch });
    const res = await provider.reverseGeocode({ lng: 116.48, lat: 39.99 });
    expect(res.formattedAddress).toBe('北京市朝阳区三里屯');
    expect(res.location).toEqual({ lng: 116.48, lat: 39.99 });
    expect(res.province).toBe('北京');
  });

  it('解析驾车路线响应（distance/duration/polyline）', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => ({
        status: '1',
        route: {
          paths: [
            {
              distance: '5000',
              duration: '600',
              steps: [
                { instruction: '向东', distance: '2000', duration: '240', polyline: '116.48,39.99;116.49,39.99' },
                { instruction: '向北', distance: '3000', duration: '360', polyline: '116.49,39.99;116.49,40.00' },
              ],
            },
          ],
        },
      }),
    }) as unknown as typeof fetch;
    const provider = createAmapProvider({ apiKey: 'k', fetch: fakeFetch });
    const route = await provider.planRoute({
      mode: 'driving',
      origin: { lng: 116.48, lat: 39.99 },
      destination: { lng: 116.49, lat: 40.0 },
    });
    expect(route.distance).toBe(5000);
    expect(route.duration).toBe(600);
    expect(route.segments).toHaveLength(2);
    expect(route.polyline).toEqual([
      { lng: 116.48, lat: 39.99 },
      { lng: 116.49, lat: 39.99 },
      { lng: 116.49, lat: 40.0 },
    ]);
  });

  it('解析公交路线响应', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => ({
        status: '1',
        route: {
          transit: {
            transits: [
              {
                distance: '8000',
                duration: '1200',
                segments: [
                  { walking: { steps: [{ polyline: '116.48,39.99;116.48,40.00' }] }, bus: { buslines: [{ name: '1路', polyline: '116.48,40.00;116.49,40.00' }] } },
                ],
              },
            ],
          },
        },
      }),
    }) as unknown as typeof fetch;
    const provider = createAmapProvider({ apiKey: 'k', fetch: fakeFetch });
    const route = await provider.planRoute({
      mode: 'transit',
      origin: { lng: 116.48, lat: 39.99 },
      destination: { lng: 116.49, lat: 40.0 },
      city: '北京',
    });
    expect(route.distance).toBe(8000);
    expect(route.polyline).toEqual([
      { lng: 116.48, lat: 39.99 },
      { lng: 116.48, lat: 40.0 },
      { lng: 116.49, lat: 40.0 },
    ]);
  });

  it('路线错误状态时抛出', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => ({ status: '0', info: 'INVALID_USER_KEY' }),
    }) as unknown as typeof fetch;
    const provider = createAmapProvider({ apiKey: 'bad', fetch: fakeFetch });
    await expect(provider.planRoute({ mode: 'driving', origin: { lng: 1, lat: 2 }, destination: { lng: 3, lat: 4 } })).rejects.toThrow('AMap error');
  });
});

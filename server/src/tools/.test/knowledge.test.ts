import { describe, it, expect, vi } from 'vitest';
import { createSpatialTool } from '../knowledge';
import type { MapProvider } from '../../types';

// 北京 [116.40, 39.90] → 上海 [121.47, 31.23]：约 1067km，方位≈153°→东南
function makeMap(): MapProvider {
  return {
    geocode: vi.fn().mockImplementation(async (address: string) => {
      if (address === '北京') return [{ location: { lng: 116.4, lat: 39.9 } }];
      if (address === '上海') return [{ location: { lng: 121.47, lat: 31.23 } }];
      if (address === '南京') return [{ location: { lng: 118.8, lat: 32.06 } }];
      return [];
    }),
    reverseGeocode: vi.fn(),
    planRoute: vi.fn(),
  } as unknown as MapProvider;
}

describe('spatial_query 工具', () => {
  it('计算方向、距离与最近点', async () => {
    const map = makeMap();
    const tool = createSpatialTool(map);
    const result = await tool.execute({ reference: '北京', places: ['上海', '南京'] });
    expect(result).toEqual({
      reference: '北京',
      referenceLocation: { lng: 116.4, lat: 39.9 },
      results: [
        expect.objectContaining({ place: '上海', direction: '东南', distanceKm: expect.any(Number) }),
        expect.objectContaining({ place: '南京', direction: '南', distanceKm: expect.any(Number) }),
      ],
      nearest: '南京',
    });
    const res = result as any;
    expect(res.results[0].distanceKm).toBeGreaterThan(1000);
    expect(res.results[0].distanceKm).toBeLessThan(1100);
    expect(res.results[1].distanceKm).toBeLessThan(res.results[0].distanceKm);
  });

  it('省略 reference 时以第一个 place 为参考', async () => {
    const map = makeMap();
    const tool = createSpatialTool(map);
    const result = (await tool.execute({ places: ['北京', '上海'] })) as any;
    expect(result.reference).toBe('北京');
  });

  it('地名无法定位时返回错误', async () => {
    const map = makeMap();
    const tool = createSpatialTool(map);
    const result = await tool.execute({ reference: '火星', places: ['上海'] });
    expect(result).toEqual({ error: '无法定位：火星' });
  });

  it('工具定义名称为 spatial_query', () => {
    const tool = createSpatialTool({} as unknown as MapProvider);
    expect(tool.name).toBe('spatial_query');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { createRouteTool } from './routing';
import type { MapProvider } from '../types';

function makeMap(): MapProvider {
  return {
    geocode: vi.fn().mockImplementation(async (address: string) => {
      if (address === '三里屯') return [{ location: { lng: 116.48, lat: 39.99 } }];
      if (address === '国贸') return [{ location: { lng: 116.46, lat: 39.91 } }];
      return [];
    }),
    reverseGeocode: vi.fn(),
    planRoute: vi.fn().mockResolvedValue({
      mode: 'driving',
      origin: { lng: 116.48, lat: 39.99 },
      destination: { lng: 116.46, lat: 39.91 },
      distance: 5000,
      duration: 600,
      segments: [],
      polyline: [{ lng: 116.48, lat: 39.99 }, { lng: 116.46, lat: 39.91 }],
    }),
  } as unknown as MapProvider;
}

describe('route_plan 工具', () => {
  it('地名→geocode→planRoute，返回 route', async () => {
    const map = makeMap();
    const tool = createRouteTool(map);
    const result = await tool.execute({ mode: 'driving', origin: '三里屯', destination: '国贸' });
    expect(map.geocode).toHaveBeenCalledWith('三里屯');
    expect(map.geocode).toHaveBeenCalledWith('国贸');
    expect(map.planRoute).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'driving',
      origin: { lng: 116.48, lat: 39.99 },
      destination: { lng: 116.46, lat: 39.91 },
    }));
    expect(result).toEqual({
      route: expect.objectContaining({ mode: 'driving', distance: 5000, duration: 600 }),
    });
  });

  it('无法定位地名时返回错误', async () => {
    const map = makeMap();
    const tool = createRouteTool(map);
    const result = await tool.execute({ mode: 'driving', origin: '不存在的地方', destination: '国贸' });
    expect(result).toEqual({ error: '无法定位：不存在的地方' });
  });

  it('途经点也被 geocode', async () => {
    const map = makeMap();
    const tool = createRouteTool(map);
    await tool.execute({ mode: 'driving', origin: '三里屯', destination: '国贸', waypoints: ['三里屯'] });
    expect(map.planRoute).toHaveBeenCalledWith(expect.objectContaining({
      waypoints: [{ lng: 116.48, lat: 39.99 }],
    }));
  });

  it('工具定义名称为 route_plan', () => {
    const tool = createRouteTool({} as unknown as MapProvider);
    expect(tool.name).toBe('route_plan');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { createRecommendTool } from '../recommend';
import type { MapProvider } from '../../types';
import type { LongTermMemory } from '../../memory/long_term';

function mockMap(): MapProvider {
  return {
    planRoute: vi.fn().mockImplementation(async (params: any) => ({
      mode: params.mode,
      origin: params.origin,
      destination: params.destination,
      distance: 1000,
      duration: 600,
      segments: [],
      polyline: [params.origin, ...(params.waypoints ?? []), params.destination],
    })),
  } as unknown as MapProvider;
}

function mockMem(prefs: Record<string, string> = {}) {
  return { getAllPreferences: vi.fn().mockResolvedValue(prefs) } as unknown as LongTermMemory;
}

describe('recommend 工具', () => {
  it('读取偏好 + 分天（每天单点则无 route）', async () => {
    const map = mockMap();
    const mem = mockMem({ scene: '人文' });
    const tool = createRecommendTool(map, mem);
    const result: any = await tool.execute({
      pois: [
        { id: 'a', name: '人文馆A', location: { lng: 116.40, lat: 39.90 } },
        { id: 'b', name: '公园B', location: { lng: 116.42, lat: 39.92 } },
      ],
      days: 2,
    });
    expect(mem.getAllPreferences).toHaveBeenCalledOnce();
    expect(result.preferencesUsed).toEqual({ scene: '人文' });
    expect(result.itinerary.days).toHaveLength(2);
    expect(result.itinerary.days.every((d: any) => d.route === undefined)).toBe(true);
  });

  it('每天 ≥2 个 place 时调 planRoute 配路线', async () => {
    const map = mockMap();
    const tool = createRecommendTool(map, mockMem());
    const result: any = await tool.execute({
      pois: [
        { id: 'a', name: 'A', location: { lng: 1, lat: 1 } },
        { id: 'b', name: 'B', location: { lng: 2, lat: 2 } },
        { id: 'c', name: 'C', location: { lng: 3, lat: 3 } },
      ],
      days: 1,
    });
    expect(map.planRoute).toHaveBeenCalledOnce();
    expect(result.itinerary.days[0].route).toBeDefined();
    expect(result.itinerary.days[0].route.distance).toBe(1000);
  });

  it('某天 planRoute 抛错 → 该天 route 省略，不整体失败', async () => {
    const map = { planRoute: vi.fn().mockRejectedValue(new Error('AMap error')) } as unknown as MapProvider;
    const tool = createRecommendTool(map, mockMem());
    const result: any = await tool.execute({
      pois: [
        { id: 'a', name: 'A', location: { lng: 1, lat: 1 } },
        { id: 'b', name: 'B', location: { lng: 2, lat: 2 } },
      ],
      days: 1,
    });
    expect(result.itinerary.days[0].route).toBeUndefined();
    expect(result.itinerary.days[0].places).toHaveLength(2);
  });

  it('工具定义名称为 recommend', () => {
    expect(createRecommendTool(mockMap(), mockMem()).name).toBe('recommend');
  });
});

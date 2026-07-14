import { describe, it, expect, vi } from 'vitest';
import { createPoiTool } from './poi';
import type { MapProvider } from '../types';

describe('poi_search 工具', () => {
  it('执行搜索并包装结果', async () => {
    const map = {
      searchPoi: vi.fn().mockResolvedValue([
        { id: '1', name: 'A', location: { lng: 1, lat: 2 } },
      ]),
    } as unknown as MapProvider;
    const tool = createPoiTool(map);
    const result = await tool.execute({ keyword: '咖啡馆', city: '北京' });
    expect(map.searchPoi).toHaveBeenCalledWith({ keyword: '咖啡馆', city: '北京' });
    expect(result).toEqual({
      count: 1,
      pois: [{ id: '1', name: 'A', location: { lng: 1, lat: 2 } }],
    });
  });

  it('工具定义名称为 poi_search', () => {
    const tool = createPoiTool({} as MapProvider);
    expect(tool.name).toBe('poi_search');
    expect(tool.definition.function.name).toBe('poi_search');
  });
});

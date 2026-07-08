import { z } from 'zod';
import type { MapProvider, Tool } from '../types';

const schema = z.object({
  keyword: z.string(),
  city: z.string().optional(),
});

export function createPoiTool(map: MapProvider): Tool {
  return {
    name: 'poi_search',
    definition: {
      type: 'function',
      function: {
        name: 'poi_search',
        description: '按关键词搜索地点/POI，返回名称、坐标、地址。结果会自动渲染到地图。',
        parameters: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: '搜索关键词，如"咖啡馆"' },
            city: { type: 'string', description: '限定城市，如"北京"' },
          },
          required: ['keyword'],
        },
      },
    },
    async execute(args) {
      const parsed = schema.parse(args);
      const pois = await map.searchPoi(parsed);
      return { count: pois.length, pois };
    },
  };
}

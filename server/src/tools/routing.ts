import { z } from 'zod';
import type { LngLat, MapProvider, Tool } from '../types';

const schema = z.object({
  mode: z.enum(['driving', 'walking', 'riding', 'transit']),
  origin: z.string(),
  destination: z.string(),
  waypoints: z.array(z.string()).optional(),
  city: z.string().optional(),
});

async function resolve(map: MapProvider, name: string): Promise<LngLat | null> {
  const results = await map.geocode(name);
  return results[0]?.location ?? null;
}

export function createRouteTool(map: MapProvider): Tool {
  return {
    name: 'route_plan',
    definition: {
      type: 'function',
      function: {
        name: 'route_plan',
        description: '规划两地路线（驾车/步行/骑行/公交）。origin/destination/waypoints 传地名，内部自动解析坐标。返回距离、耗时与路线折线（自动渲染到地图）。',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['driving', 'walking', 'riding', 'transit'], description: '交通方式' },
            origin: { type: 'string', description: '出发地地名，如"三里屯"' },
            destination: { type: 'string', description: '目的地地名，如"国贸"' },
            waypoints: { type: 'array', items: { type: 'string' }, description: '途经点地名列表（仅驾车）' },
            city: { type: 'string', description: '公交模式所需的城市，如"北京"' },
          },
          required: ['mode', 'origin', 'destination'],
        },
      },
    },
    async execute(args) {
      const parsed = schema.parse(args);
      const origin = await resolve(map, parsed.origin);
      if (!origin) return { error: `无法定位：${parsed.origin}` };
      const destination = await resolve(map, parsed.destination);
      if (!destination) return { error: `无法定位：${parsed.destination}` };
      const waypoints: LngLat[] = [];
      for (const w of parsed.waypoints ?? []) {
        const loc = await resolve(map, w);
        if (!loc) return { error: `无法定位：${w}` };
        waypoints.push(loc);
      }
      const route = await map.planRoute({
        mode: parsed.mode,
        origin,
        destination,
        waypoints: waypoints.length ? waypoints : undefined,
        city: parsed.city,
      });
      return { route };
    },
  };
}

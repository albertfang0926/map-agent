import { z } from 'zod';
import type { Itinerary, ItineraryDay, MapPOI, MapProvider, Tool } from '../types';
import type { LongTermMemory } from '../memory/long_term';
import { planItinerary } from '../agent/planner';

const schema = z.object({
  pois: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        location: z.object({ lng: z.number(), lat: z.number() }),
        address: z.string().optional(),
        typecode: z.string().optional(),
      }),
    )
    .min(1),
  days: z.number().int().min(1),
  budget: z.number().optional(),
});

export function createRecommendTool(map: MapProvider, memory: LongTermMemory): Tool {
  return {
    name: 'recommend',
    definition: {
      type: 'function',
      function: {
        name: 'recommend',
        description:
          '把候选 POI 组装成按天行程：读取用户偏好做个性化排序、按天分组、为每天规划路线。先用 poi_search 拿到候选 POI，再把它们传给本工具。',
        parameters: {
          type: 'object',
          properties: {
            pois: { type: 'array', description: '候选 POI 列表（来自 poi_search）', items: { type: 'object' } },
            days: { type: 'number', description: '行程天数' },
            budget: { type: 'number', description: '预算（占位，暂不强约束）' },
          },
          required: ['pois', 'days'],
        },
      },
    },
    async execute(args) {
      const parsed = schema.parse(args);
      const preferences = await memory.getAllPreferences();
      const drafts = planItinerary(parsed.pois as MapPOI[], { days: parsed.days, preferences });
      const days: ItineraryDay[] = [];
      for (const d of drafts) {
        let route;
        if (d.places.length >= 2) {
          try {
            const origin = d.places[0].location;
            const destination = d.places[d.places.length - 1].location;
            const waypoints = d.places.slice(1, -1).map((p) => p.location);
            route = await map.planRoute({
              mode: 'driving',
              origin,
              destination,
              waypoints: waypoints.length ? waypoints : undefined,
            });
          } catch {
            route = undefined; // 某天配路线失败，省略 route
          }
        }
        days.push({ day: d.day, places: d.places, route });
      }
      const itinerary: Itinerary = { days };
      return { itinerary, preferencesUsed: preferences };
    },
  };
}

import { z } from 'zod';
import type { SavedPlace, Tool } from '../types';
import type { LongTermMemory } from '../memory/long_term';

const placeSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: z.object({ lng: z.number(), lat: z.number() }),
  address: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const prefSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export function createSavePlaceTool(memory: LongTermMemory): Tool {
  return {
    name: 'save_place',
    definition: {
      type: 'function',
      function: {
        name: 'save_place',
        description: '收藏一个地点到长期记忆（用户收藏夹）。传入 poi_search 结果中的地点。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            location: {
              type: 'object',
              properties: { lng: { type: 'number' }, lat: { type: 'number' } },
              required: ['lng', 'lat'],
            },
            address: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'name', 'location'],
        },
      },
    },
    async execute(args) {
      const p = placeSchema.parse(args);
      const place: SavedPlace = { ...p, savedAt: new Date().toISOString() };
      await memory.savePlace(place);
      return { saved: p.id };
    },
  };
}

export function createRememberPreferenceTool(memory: LongTermMemory): Tool {
  return {
    name: 'remember_preference',
    definition: {
      type: 'function',
      function: {
        name: 'remember_preference',
        description: '记住用户的一条偏好到长期记忆（如出行风格、预算档位、喜欢的景点类型），用于后续个性化推荐。',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '偏好键，如 travel_style / budget / scene' },
            value: { type: 'string', description: '偏好值，如 人文 / 中 / 自然' },
          },
          required: ['key', 'value'],
        },
      },
    },
    async execute(args) {
      const p = prefSchema.parse(args);
      await memory.setPreference(p.key, p.value);
      return { remembered: p.key };
    },
  };
}

import { describe, it, expect } from 'vitest';
import { planItinerary } from '../planner';
import type { MapPOI } from '../../types';

function poi(id: string, name: string, lng: number, lat: number, typecode?: string): MapPOI {
  return { id, name, location: { lng, lat }, typecode };
}

describe('planItinerary', () => {
  const pois = [
    poi('a', '人文馆A', 116.40, 39.90, '110000'),
    poi('b', '自然公园B', 116.42, 39.92, '110101'),
    poi('c', '人文馆C', 116.41, 39.91, '110000'),
    poi('d', '商场D', 116.50, 39.95, '060100'),
  ];

  it('按天数均衡分配', () => {
    const days = planItinerary(pois, { days: 2 });
    expect(days).toHaveLength(2);
    expect(days.reduce((n, d) => n + d.places.length, 0)).toBe(4);
    expect(days[0].places).toHaveLength(2);
    expect(days[1].places).toHaveLength(2);
  });

  it('偏好打分：高分 POI 优先纳入（第一天含命中项）', () => {
    const days = planItinerary(pois, { days: 2, preferences: { scene: '人文' } });
    // 命中"人文"的 a、c 分数高，round-robin：a→day1, c→day2, b→day1, d→day2
    expect(days[0].places.map((p) => p.name)).toContain('人文馆A');
    expect(days[1].places.map((p) => p.name)).toContain('人文馆C');
  });

  it('天内贪心就近排序', () => {
    const three = [
      poi('a', 'A', 116.40, 39.90),
      poi('b', 'B', 116.41, 39.91), // 离 A 近
      poi('c', 'C', 116.80, 40.00), // 远
    ];
    const days = planItinerary(three, { days: 1 });
    expect(days[0].places.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('day 编号从 1 开始', () => {
    expect(planItinerary([poi('a', 'A', 1, 1)], { days: 1 })[0].day).toBe(1);
  });

  it('空 POI 列表返回空天', () => {
    const days = planItinerary([], { days: 2 });
    expect(days).toHaveLength(2);
    expect(days.every((d) => d.places.length === 0)).toBe(true);
  });
});

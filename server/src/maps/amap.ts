import type { MapProvider, MapPOI, LngLat, GeocodeResult, RouteResult } from '../types';

export function createAmapProvider(opts: {
  apiKey: string;
  fetch?: typeof fetch;
}): MapProvider {
  const doFetch = opts.fetch ?? fetch;
  return {
    async searchPoi({ keyword, city }) {
      const url = new URL('https://restapi.amap.com/v3/place/text');
      url.searchParams.set('key', opts.apiKey);
      url.searchParams.set('keywords', keyword);
      url.searchParams.set('offset', '10');
      if (city) url.searchParams.set('city', city);
      const res = await doFetch(url.toString());
      const json = (await res.json()) as {
        status: string;
        info?: string;
        pois?: Array<{ id: string; name: string; location: string; address?: string; typecode?: string }>;
      };
      if (json.status !== '1') throw new Error(`AMap error: ${json.info ?? 'unknown'}`);
      return (json.pois ?? []).map((p): MapPOI => {
        const [lng, lat] = (p.location ?? '0,0').split(',').map(Number);
        return { id: p.id, name: p.name, location: { lng, lat }, address: p.address, typecode: p.typecode };
      });
    },
    // Task 2 将实现以下三个方法
    async geocode(_address: string): Promise<GeocodeResult[]> {
      throw new Error('geocode not implemented');
    },
    async reverseGeocode(_location: LngLat): Promise<GeocodeResult> {
      throw new Error('reverseGeocode not implemented');
    },
    async planRoute(_params: {
      mode: 'driving' | 'walking' | 'riding' | 'transit';
      origin: LngLat;
      destination: LngLat;
      waypoints?: LngLat[];
      city?: string;
    }): Promise<RouteResult> {
      throw new Error('planRoute not implemented');
    },
  };
}

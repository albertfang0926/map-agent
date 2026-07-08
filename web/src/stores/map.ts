import { defineStore } from 'pinia';

export interface MapPOI {
  id: string;
  name: string;
  location: { lng: number; lat: number };
  address?: string;
}

export const useMapStore = defineStore('map', {
  state: () => ({
    pois: [] as MapPOI[],
    mapInstance: null as any,
  }),
  actions: {
    setPois(pois: MapPOI[]) {
      this.pois = pois;
    },
    setMap(m: any) {
      this.mapInstance = m;
    },
  },
});

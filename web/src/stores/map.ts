import { defineStore } from 'pinia';

export interface MapPOI {
  id: string;
  name: string;
  location: { lng: number; lat: number };
  address?: string;
}

export interface RouteData {
  mode: string;
  origin: { lng: number; lat: number };
  destination: { lng: number; lat: number };
  polyline: { lng: number; lat: number }[];
  distance: number; // 米
  duration: number; // 秒
}

export const useMapStore = defineStore('map', {
  state: () => ({
    pois: [] as MapPOI[],
    routes: [] as RouteData[],
    mapInstance: null as any,
  }),
  actions: {
    setPois(pois: MapPOI[]) {
      this.pois = pois;
    },
    setRoutes(routes: RouteData[]) {
      this.routes = routes;
    },
    setMap(m: any) {
      this.mapInstance = m;
    },
  },
});

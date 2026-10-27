// Types for the part of d3-geo@3.1.1 the tactical map uses. The package ships no types, and @types/d3-geo would be
// a further dependency; extend this only with what the map actually calls.
declare module "d3-geo" {
  export interface GeoGeometryObject {
    type: string;
  }

  export interface GeoProjection {
    /** Projected [x, y], or null when the point cannot be projected. */
    (point: [number, number]): [number, number] | null;
    fitExtent(extent: [[number, number], [number, number]], object: GeoGeometryObject): this;
  }

  export interface GeoPath {
    (object: GeoGeometryObject): string | null;
  }

  export function geoNaturalEarth1(): GeoProjection;
  export function geoPath(projection?: GeoProjection | null): GeoPath;
  export function geoGraticule10(): GeoGeometryObject;
}

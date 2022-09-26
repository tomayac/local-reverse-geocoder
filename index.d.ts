/**
 * @fileoverview Local reverse geocoder based on GeoNames data.
 * @author Thomas Steiner (tomac@google.com)
 * @license Apache 2.0
 *
 * @param {(PointsEntry|PointsEntry[])} points One single or an array of
 *                                   latitude/longitude pairs
 * @param {integer} maxResults The maximum number of results to return
 * @callback callback The callback function with the results
 *
 * @returns {AddressObject[]} An array of GeoNames-based geocode results
 *
 * @example
 * // With just one point
 * const point = { latitude: 42.083333, longitude: 3.1 };
 * geocoder.lookUp(point, 1, function(err, res) {
 *   console.log(JSON.stringify(res, null, 2));
 * });
 *
 * // In batch mode with many points
 * const points = [
 *   { latitude: 42.083333, longitude: 3.1 },
 *   { latitude: 48.466667, longitude: 9.133333 }
 * ];
 * geocoder.lookUp(points, 1, function(err, res) {
 *   console.log(JSON.stringify(res, null, 2));
 * });
 */

/**
 * The callback function with the results
 */
export type callback = () => AddressObject[];

export interface InitLoadOptions {
  admin1?: boolean;
  admin2?: boolean;
  admin3And4?: boolean;
  alternateNames?: boolean;
}

export interface InitOptions {
  dumpDirectory?: string;
  load?: InitLoadOptions;
  citiesFileOverride?: string;
  countries?: string[];
}

export interface PointsEntry {
  latitude: number | string;
  longitude: number | string;
}

export interface AddressObject {
  geoNameId: string;
  name: string;
  asciiName: string;
  alternateNames?: string;
  latitude: string;
  longitude: string;
  featureClass: string;
  featureCode: string;
  countryCode: string;
  cc2?: string;
  admin1Code: string;
  admin2Code?: string;
  admin3Code?: string;
  admin4Code?: string;
  population: string;
  elevation?: string;
  dem: string;
  timezone: string;
  modificationDate?: string;
  distance: number;
}

export type lookUpCallback =
  | ((error: Error) => void)
  | ((error: null, addresses: Array<Array<AddressObject>>) => void);

declare const _default: {
  init: (options?: InitOptions, callback?: () => void) => void;
  lookUp(points: PointsEntry | PointsEntry[], callback: lookUpCallback): void;
  lookUp(
    points: PointsEntry | PointsEntry[],
    maxResults: number,
    callback: lookUpCallback
  ): void;
};

export default _default;

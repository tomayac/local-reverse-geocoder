/**
 * @fileoverview Local reverse geocoder based on GeoNames data.
 * @author Thomas Steiner (tomac@google.com)
 * @license Apache 2.0
 *
 * @param {(object|object[])} points One single or an array of
 *                                   latitude/longitude pairs
 * @param {integer} maxResults The maximum number of results to return
 * @callback callback The callback function with the results
 *
 * @returns {object[]} An array of GeoNames-based geocode results
 *
 * @example
 * // With just one point
 * var point = {latitude: 42.083333, longitude: 3.1};
 * geocoder.lookUp(point, 1, function(err, res) {
 *   console.log(JSON.stringify(res, null, 2));
 * });
 *
 * // In batch mode with many points
 * var points = [
 *   {latitude: 42.083333, longitude: 3.1},
 *   {latitude: 48.466667, longitude: 9.133333}
 * ];
 * geocoder.lookUp(points, 1, function(err, res) {
 *   console.log(JSON.stringify(res, null, 2));
 * });
 */

/**
 * The callback function with the results
 */
export type callback = () => object[];

export interface InitLoadOptions {
  admin1?: boolean;
  admin2?: boolean;
  admin3And4?: boolean;
  alternateNames?: boolean;
}

export interface InitOptions {
  dumpDirectory?: string;
  load?: InitLoadOptions;
}

declare const _default: {
  init: (options?: InitOptions, callback?: () => void) => void;
  // TODO: this is a very complex type signature
  lookUp: any;
};

export default _default;

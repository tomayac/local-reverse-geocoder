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

'use strict';

var fs = require('fs');
var kdTree = require('kdt');
var request = require('request');
var zip = require('adm-zip');
var lazy = require('lazy.js');
var async = require('async');

// All data from http://download.geonames.org/export/dump/
var GEONAMES_URL = 'http://download.geonames.org/export/dump/';
var GEONAMES_FILE = 'cities1000';
var GEONAMES_DUMP = './geonames_dump';
/* jshint maxlen: false */
var GEONAMES_COLUMNS = [
  'geoNameId', // integer id of record in geonames database
  'name', // name of geographical point (utf8) varchar(200)
  'asciiName', // name of geographical point in plain ascii characters, varchar(200)
  'alternateNames', // alternatenames, comma separated, ascii names automatically transliterated, convenience attribute from alternatename table, varchar(10000)
  'latitude', // latitude in decimal degrees (wgs84)
  'longitude', // longitude in decimal degrees (wgs84)
  'featureClass', // see http://www.geonames.org/export/codes.html, char(1)
  'featureCode', // see http://www.geonames.org/export/codes.html, varchar(10)
  'countryCode', // ISO-3166 2-letter country code, 2 characters
  'cc2', // alternate country codes, comma separated, ISO-3166 2-letter country code, 60 characters
  'admin1Code', // fipscode (subject to change to iso code), see exceptions below, see file admin1Codes.txt for display names of this code; varchar(20)
  'admin2Code', // code for the second administrative division, a county in the US, see file admin2Codes.txt; varchar(80)
  'admin3Code', // code for third level administrative division, varchar(20)
  'admin4Code', // code for fourth level administrative division, varchar(20)
  'population', // bigint (8 byte int)
  'elevation', // in meters, integer
  'dem', // digital elevation model, srtm3 or gtopo30, average elevation of 3''x3'' (ca 90mx90m) or 30''x30'' (ca 900mx900m) area in meters, integer. srtm processed by cgiar/ciat.
  'timezone', // the timezone id (see file timeZone.txt) varchar(40)
  'modificationDate', // date of last modification in yyyy-MM-dd format
];
/* jshint maxlen: 80 */

var DEBUG = false;

var geocoder = {
  _kdTree: null,

  _getGeoNamesData: function(callback) {
    var now = (new Date()).toISOString().substr(0, 10);
    if (fs.existsSync(GEONAMES_DUMP + '/' + now + '.csv')) {
      DEBUG && console.log('Using cached GeoNames data from ' + GEONAMES_URL +
          GEONAMES_FILE + '.zip');
      return callback(null, GEONAMES_DUMP + '/' + now + '.csv');
    }
    DEBUG && console.log('Getting GeoNames data from ' + GEONAMES_URL +
        GEONAMES_FILE + '.zip (this may take a while)');
    var options = {
      url: GEONAMES_URL + GEONAMES_FILE + '.zip',
      encoding: null
    };
    request.get(options, function(err, response, body) {
      if (err || response.statusCode !== 200) {
        return callback('Error downloading GeoNames data' +
            (err ? ': ' + err : ''));
      }
      DEBUG && console.log('Received zipped GeoNames data');
      // Store a dump locally
      if (!fs.existsSync(GEONAMES_DUMP)) {
        fs.mkdirSync(GEONAMES_DUMP);
      }
      var oldName = GEONAMES_DUMP + '/' + GEONAMES_FILE + '.txt';
      // Name files like a timestamp so we can easily remove old files
      var newName = GEONAMES_DUMP + '/' + now + '.csv';
      var fileName = GEONAMES_DUMP + '/' + now + '.zip';
      try {
        fs.writeFileSync(fileName, body);
        var zipped = new zip(fileName);
        zipped.extractEntryTo(GEONAMES_FILE + '.txt', GEONAMES_DUMP, false,
            true);
        fs.renameSync(oldName, newName);
        fs.unlink(GEONAMES_DUMP + '/' + now + '.zip');
        DEBUG && console.log('Unzipped GeoNames data');
        // Housekeeping, remove old files
        var currentFileName = now + '.csv';
        fs.readdirSync(GEONAMES_DUMP).forEach(function(file) {
          if (file !== currentFileName) {
            fs.unlink(GEONAMES_DUMP + '/' + file);
          }
        });
      } catch(e) {
        throw(e);
      }
      return callback(null, newName);
    });
  },

  _parseGeoNamesCsv: function(pathToCsv, callback) {
    var data = [];
    var lenI = GEONAMES_COLUMNS.length;
    var that = this;
    lazy.readFile(pathToCsv).lines().each(function(line) {
      var lineObj = {};
      line = line.split('\t');
      for (var i = 0; i < lenI; i++) {
        var column = line[i] || null;
        lineObj[GEONAMES_COLUMNS[i]] = column;
      }
      data.push(lineObj);
    }).onComplete(function() {
      // Distance function
      var distanceFunc = function(a, b) {
        return Math.pow(a.latitude - b.latitude, 2) +
            Math.pow(a.longitude - b.longitude, 2);
      };
      DEBUG && console.log('Started building k-d tree (this may take a while)');
      var dimensions = [
        'latitude',
        'longitude'
      ];
      that._kdTree = kdTree.createKdTree(data, distanceFunc, dimensions);
      DEBUG && console.log('Finished building k-d tree');
      return callback(null);
    });
  },

  _init: function(callback) {
    DEBUG && console.log('Initializing local reverse geocoder');
    async.waterfall([
      this._getGeoNamesData.bind(this),
      this._parseGeoNamesCsv.bind(this)
    ], function() {
      return callback();
    });
  },

  lookUp: function(points, maxResults, callback) {
    var that = this;
    // If not yet initialied, then initialize
    if (!this._kdTree) {
      return this._init(function() {
        return that.lookUp(points, maxResults, callback);
      });
    }
    // Make sure we have an array of points
    if (!Array.isArray(points)) {
      points = [points];
    }
    var functions = [];
    points.forEach(function(point, i) {
      functions[i] = function(innerCallback) {
        return innerCallback(null, that._kdTree.nearest(point, maxResults));
      };
    });
    async.series(
      functions,
    function(err, results) {
      return callback(null, results);
    });
  }
};

module.exports = geocoder;
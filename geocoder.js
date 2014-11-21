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

var DEBUG = true;

var fs = require('fs');
var kdTree = require('kdt');
var request = require('request');
var unzip = require('unzip');
var lazy = require('lazy.js');
var async = require('async');

// All data from http://download.geonames.org/export/dump/
var GEONAMES_URL = 'http://download.geonames.org/export/dump/';

var CITIES_FILE = 'cities1000';
var ADMIN_1_CODES_FILE = 'admin1CodesASCII';
var ADMIN_2_CODES_FILE = 'admin2Codes';
var ALL_COUNTRIES_FILE = 'allCountries';

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

var GEONAMES_ADMIN_CODES_COLUMNS = [
  'concatenatedCodes',
  'name',
  'asciiName',
  'geoNameId'
];

var GEONAMES_DUMP = __dirname + '/geonames_dump';

var geocoder = {
  _kdTree: null,
  _admin1Codes: {},
  _admin2Codes: {},
  _admin3Codes: {},
  _admin4Codes: {},

  // Distance function taken from
  // http://www.movable-type.co.uk/scripts/latlong.html
  _distanceFunc: function distance(x, y) {
    var toRadians = function(num) {
      return num * Math.PI / 180;
    };
    var lat1 = x.latitude;
    var lon1 = x.longitude;
    var lat2 = y.latitude;
    var lon2 = y.longitude;

    var R = 6371; // km
    var φ1 = toRadians(lat1);
    var φ2 = toRadians(lat2);
    var Δφ = toRadians(lat2 - lat1);
    var Δλ = toRadians(lon2 - lon1);
    var a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  _getGeoNamesAdmin1CodesData: function(callback) {
    var now = (new Date()).toISOString().substr(0, 10);
    if (fs.existsSync(GEONAMES_DUMP + '/admin1_codes/' + ADMIN_1_CODES_FILE +
        '_' + now + '.csv')) {
      DEBUG && console.log('Using cached GeoNames admin 1 codes data from ' +
          GEONAMES_URL + ADMIN_1_CODES_FILE + '.txt');
      return callback(null, GEONAMES_DUMP + '/admin1_codes/' +
          ADMIN_1_CODES_FILE + '_' + now + '.csv');
    }
    DEBUG && console.log('Getting GeoNames admin 1 codes data from ' +
        GEONAMES_URL + ADMIN_1_CODES_FILE + '.txt (this may take a while)');
    var url = GEONAMES_URL + ADMIN_1_CODES_FILE + '.txt';
    request.get(url, function(err, response, body) {
      if (err || response.statusCode !== 200) {
        return callback('Error downloading GeoNames admin 1 codes data' +
            (err ? ': ' + err : ''));
      }
      // Store a dump locally
      if (!fs.existsSync(GEONAMES_DUMP + '/admin1_codes')) {
        fs.mkdirSync(GEONAMES_DUMP + '/admin1_codes');
      }
      var fileName = GEONAMES_DUMP + '/admin1_codes/' + ADMIN_1_CODES_FILE +
          '_' + now + '.csv';
      try {
        fs.writeFileSync(fileName, body);
        // Housekeeping, remove old files
        var currentFileName = ADMIN_1_CODES_FILE + '_' + now + '.csv';
        fs.readdirSync(GEONAMES_DUMP + '/admin1_codes').forEach(function(file) {
          if (file !== currentFileName) {
            fs.unlinkSync(GEONAMES_DUMP + '/admin1_codes/' + file);
          }
        });
      } catch(e) {
        throw(e);
      }
      return callback(null, fileName);
    });
  },

  _parseGeoNamesAdmin1CodesCsv: function(pathToCsv, callback) {
    var that = this;
    var lenI = GEONAMES_ADMIN_CODES_COLUMNS.length;
    lazy.readFile(pathToCsv).lines().each(function(line) {
      line = line.split('\t');
      for (var i = 0; i < lenI; i++) {
        var value = line[i] || null;
        if (i === 0) {
          that._admin1Codes[value] = {};
        } else {
          that._admin1Codes[line[0]][GEONAMES_ADMIN_CODES_COLUMNS[i]] = value;
        }
      }
    }).onComplete(function() {
      return callback();
    });
  },

  _getGeoNamesAdmin2CodesData: function(callback) {
    var now = (new Date()).toISOString().substr(0, 10);
    if (fs.existsSync(GEONAMES_DUMP + '/admin2_codes/' + ADMIN_2_CODES_FILE +
        '_' + now + '.csv')) {
      DEBUG && console.log('Using cached GeoNames admin 2 codes data from ' +
          GEONAMES_URL + ADMIN_2_CODES_FILE + '.txt');
      return callback(null, GEONAMES_DUMP + '/admin2_codes/' +
          ADMIN_2_CODES_FILE + '_' + now + '.csv');
    }
    DEBUG && console.log('Getting GeoNames admin 2 codes data from ' +
        GEONAMES_URL + ADMIN_2_CODES_FILE + '.txt (this may take a while)');
    var url = GEONAMES_URL + ADMIN_2_CODES_FILE + '.txt';
    request.get(url, function(err, response, body) {
      if (err || response.statusCode !== 200) {
        return callback('Error downloading GeoNames admin 2 codes data' +
            (err ? ': ' + err : ''));
      }
      // Store a dump locally
      if (!fs.existsSync(GEONAMES_DUMP + '/admin2_codes')) {
        fs.mkdirSync(GEONAMES_DUMP + '/admin2_codes');
      }
      var fileName = GEONAMES_DUMP + '/admin2_codes/' + ADMIN_2_CODES_FILE +
          '_' + now + '.csv';
      try {
        fs.writeFileSync(fileName, body);
        // Housekeeping, remove old files
        var currentFileName = ADMIN_2_CODES_FILE + '_' + now + '.csv';
        fs.readdirSync(GEONAMES_DUMP + '/admin2_codes').forEach(function(file) {
          if (file !== currentFileName) {
            fs.unlinkSync(GEONAMES_DUMP + '/admin2_codes/' + file);
          }
        });
      } catch(e) {
        throw(e);
      }
      return callback(null, fileName);
    });
  },

  _parseGeoNamesAdmin2CodesCsv: function(pathToCsv, callback) {
    var that = this;
    var lenI = GEONAMES_ADMIN_CODES_COLUMNS.length;
    lazy.readFile(pathToCsv).lines().each(function(line) {
      line = line.split('\t');
      for (var i = 0; i < lenI; i++) {
        var value = line[i] || null;
        if (i === 0) {
          that._admin2Codes[value] = {};
        } else {
          that._admin2Codes[line[0]][GEONAMES_ADMIN_CODES_COLUMNS[i]] = value;
        }
      }
    }).onComplete(function() {
      return callback();
    });
  },

  _getGeoNamesCititesData: function(callback) {
    var now = (new Date()).toISOString().substr(0, 10);
    if (fs.existsSync(GEONAMES_DUMP + '/cities/' + CITIES_FILE + '_' + now +
        '.csv')) {
      DEBUG && console.log('Using cached GeoNames cities data from ' +
          GEONAMES_URL + CITIES_FILE + '.zip');
      return callback(null, GEONAMES_DUMP + '/cities/' + CITIES_FILE + '_' +
          now + '.csv');
    }
    DEBUG && console.log('Getting GeoNames cities data from ' + GEONAMES_URL +
        CITIES_FILE + '.zip (this may take a while)');
    var options = {
      url: GEONAMES_URL + CITIES_FILE + '.zip',
      encoding: null
    };
    request.get(options, function(err, response, body) {
      if (err || response.statusCode !== 200) {
        return callback('Error downloading GeoNames cities data' +
            (err ? ': ' + err : ''));
      }
      DEBUG && console.log('Received zipped GeoNames cities data');
      // Store a dump locally
      if (!fs.existsSync(GEONAMES_DUMP + '/cities')) {
        fs.mkdirSync(GEONAMES_DUMP + '/cities');
      }
      var oldName = GEONAMES_DUMP + '/cities/' + CITIES_FILE + '.txt';
      // Name files like a timestamp so we can easily remove old files
      var newName = GEONAMES_DUMP + '/cities/' + CITIES_FILE + '_' + now +
          '.csv';
      var fileName = GEONAMES_DUMP + '/cities/' + CITIES_FILE + '_' + now +
          '.zip';
      try {
        fs.writeFileSync(fileName, body);
        fs.createReadStream(fileName)
          .pipe(unzip.Extract({ path: GEONAMES_DUMP + '/cities' }))
          .on('close', function() {
            fs.renameSync(oldName, newName);
            fs.unlinkSync(GEONAMES_DUMP + '/cities/' + CITIES_FILE + '_' + now +
                '.zip');
            DEBUG && console.log('Unzipped GeoNames cities data');
            // Housekeeping, remove old files
            var currentFileName = CITIES_FILE + '_' + now + '.csv';
            fs.readdirSync(GEONAMES_DUMP + '/cities').forEach(function(file) {
              if (file !== currentFileName) {
                fs.unlinkSync(GEONAMES_DUMP + '/cities/' + file);
              }
            });
            return callback(null, newName);
          });
      } catch(e) {
        DEBUG && console.log('Warning: ' + e);
        return callback(null, newName);
      }
    });
  },

  _parseGeoNamesCitiesCsv: function(pathToCsv, callback) {
    DEBUG && console.log('Started parsing cities .csv (this  may take a ' +
        'while)');
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
      DEBUG && console.log('Finished parsing cities .csv');
      DEBUG && console.log('Started building cities k-d tree (this may take ' +
          'a while)');
      var dimensions = [
        'latitude',
        'longitude'
      ];
      that._kdTree = kdTree.createKdTree(data, that._distanceFunc, dimensions);
      DEBUG && console.log('Finished building cities k-d tree');
      return callback();
    });
  },

  _getGeoNamesAllCountriesData: function(callback) {
    var now = (new Date()).toISOString().substr(0, 10);
    if (fs.existsSync(GEONAMES_DUMP + '/all_countries/' + ALL_COUNTRIES_FILE +
        '_' + now + '.csv')) {
      DEBUG && console.log('Using cached GeoNames all countries data from ' +
          GEONAMES_URL + ALL_COUNTRIES_FILE + '.zip');
      return callback(null, GEONAMES_DUMP + '/all_countries/' +
          ALL_COUNTRIES_FILE + '_' + now + '.csv');
    }
    DEBUG && console.log('Getting GeoNames all countries data from ' +
        GEONAMES_URL + ALL_COUNTRIES_FILE + '.zip (this may take a while)');
    var options = {
      url: GEONAMES_URL + ALL_COUNTRIES_FILE + '.zip',
      encoding: null
    };
    request.get(options, function(err, response, body) {
      if (err || response.statusCode !== 200) {
        return callback('Error downloading GeoNames all countries data' +
            (err ? ': ' + err : ''));
      }
      DEBUG && console.log('Received zipped GeoNames all countries data');
      // Store a dump locally
      if (!fs.existsSync(GEONAMES_DUMP + '/all_countries')) {
        fs.mkdirSync(GEONAMES_DUMP + '/all_countries');
      }
      var oldName = GEONAMES_DUMP + '/all_countries/' + ALL_COUNTRIES_FILE +
          '.txt';
      // Name files like a timestamp so we can easily remove old files
      var newName = GEONAMES_DUMP + '/all_countries/' + ALL_COUNTRIES_FILE +
          '_' + now + '.csv';
      var fileName = GEONAMES_DUMP + '/all_countries/' + ALL_COUNTRIES_FILE +
          '_' + now + '.zip';
      try {
        fs.writeFileSync(fileName, body);
        fs.createReadStream(fileName)
          .pipe(unzip.Extract({ path: GEONAMES_DUMP + '/all_countries' }))
          .on('close', function() {
            fs.renameSync(oldName, newName);
            fs.unlinkSync(GEONAMES_DUMP + '/all_countries/' +
                ALL_COUNTRIES_FILE + '_' + now + '.zip');
            DEBUG && console.log('Unzipped GeoNames all countries data');
            // Housekeeping, remove old files
            var currentFileName = ALL_COUNTRIES_FILE + '_' + now + '.csv';
            var directory = GEONAMES_DUMP + '/all_countries';
            fs.readdirSync(directory).forEach(function(file) {
              if (file !== currentFileName) {
                fs.unlinkSync(GEONAMES_DUMP + '/all_countries/' + file);
              }
            });
            return callback(null, newName);
          });
      } catch(e) {
        DEBUG && console.log('Warning: ' + e);
        return callback(null, newName);
      }
    });
  },

  _parseGeoNamesAllCountriesCsv: function(pathToCsv, callback) {
    DEBUG && console.log('Started parsing all countries .csv (this  may take ' +
        'a while)');
    var lenI = GEONAMES_COLUMNS.length;
    var that = this;
    // Indexes
    var featureCodeIndex = GEONAMES_COLUMNS.indexOf('featureCode');
    var countryCodeIndex = GEONAMES_COLUMNS.indexOf('countryCode');
    var admin1CodeIndex = GEONAMES_COLUMNS.indexOf('admin1Code');
    var admin2CodeIndex = GEONAMES_COLUMNS.indexOf('admin2Code');
    var admin3CodeIndex = GEONAMES_COLUMNS.indexOf('admin3Code');
    var admin4CodeIndex = GEONAMES_COLUMNS.indexOf('admin4Code');
    var nameIndex = GEONAMES_COLUMNS.indexOf('name');
    var asciiNameIndex = GEONAMES_COLUMNS.indexOf('asciiName');
    var geoNameIdIndex = GEONAMES_COLUMNS.indexOf('geoNameId');

    var counter = 0;
    lazy.readFile(pathToCsv).lines().each(function(line) {
      line = line.split('\t');
      var featureCode = line[featureCodeIndex];
      if ((featureCode === 'ADM3') || (featureCode === 'ADM4')) {
        var lineObj = {
          name: line[nameIndex],
          asciiName: line[asciiNameIndex],
          geoNameId: line[geoNameIdIndex]
        };
        var key = line[countryCodeIndex] + '.' + line[admin1CodeIndex] + '.' +
            line[admin2CodeIndex] + '.' + line[admin3CodeIndex];
        if (featureCode === 'ADM3') {
          that._admin3Codes[key] = lineObj;
        } else if (featureCode === 'ADM4') {
          that._admin4Codes[key + '.' + line[admin4CodeIndex]] = lineObj;
        }
      }
      if (counter % 100000 === 0) {
        DEBUG && console.log('Parsing progress all countries ' + counter);
      }
      counter++;
    }).onComplete(function() {
      DEBUG && console.log('Finished parsing all countries .csv');
      return callback();
    });
  },

  _init: function(callback) {
    DEBUG && console.log('Initializing local reverse geocoder');
    // Create local cache folder
    if (!fs.existsSync(GEONAMES_DUMP)) {
      fs.mkdirSync(GEONAMES_DUMP);
    }
    var that = this;
    async.parallel([
      // Get GeoNames cities
      function(waterfallCallback) {
        async.waterfall([
          that._getGeoNamesCititesData.bind(that),
          that._parseGeoNamesCitiesCsv.bind(that)
        ], function() {
          return waterfallCallback();
        });
      },
      // Get GeoNames admin 1 codes
      function(waterfallCallback) {
        async.waterfall([
          that._getGeoNamesAdmin1CodesData.bind(that),
          that._parseGeoNamesAdmin1CodesCsv.bind(that)
        ], function() {
          return waterfallCallback();
        });
      },
      // Get GeoNames admin 2 codes
      function(waterfallCallback) {
        async.waterfall([
          that._getGeoNamesAdmin2CodesData.bind(that),
          that._parseGeoNamesAdmin2CodesCsv.bind(that)
        ], function() {
          return waterfallCallback();
        });
      },
      // Get GeoNames all countries
      function(waterfallCallback) {
        async.waterfall([
          that._getGeoNamesAllCountriesData.bind(that),
          that._parseGeoNamesAllCountriesCsv.bind(that)
        ], function() {
          return waterfallCallback();
        });
      }
    ],
    // Main callback
    function(err) {
      if (err) {
        throw(err);
      }
      return callback();
    });
  },

  lookUp: function(points, arg2, arg3) {
    var callback;
    var maxResults;
    if (arguments.length === 2) {
      maxResults = 1;
      callback = arg2;
    } else {
      maxResults = arg2;
      callback = arg3;
    }
    this._lookUp(points, maxResults, function(err, results) {
      return callback(null, results);
    });
  },

  _lookUp: function(points, maxResults, callback) {
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
        var result = that._kdTree.nearest(point, maxResults);
        if (result && result[0] && result[0][0]) {
          // Look-up of admin 1 code
          var countryCode = result[0][0].countryCode || '';
          var admin1Code = result[0][0].admin1Code || '';
          var admin1CodeKey = countryCode + '.' + admin1Code;
          result[0][0].admin1Code = that._admin1Codes[admin1CodeKey] ||
              result[0][0].admin1Code;
          // Look-up of admin 2 code
          var geoNameId = result[0][0].geoNameId || '';
          var admin2Code = result[0][0].admin2Code || '';
          var admin2CodeKey = countryCode + '.' + admin1Code + '.' + admin2Code;
          result[0][0].admin2Code = that._admin2Codes[admin2CodeKey] ||
              result[0][0].admin2Code;
          // Look-up of admin 3 code
          var admin3Code = result[0][0].admin3Code || '';
          var admin3CodeKey = countryCode + '.' + admin1Code + '.' +
              admin2Code + '.' + admin3Code;
          result[0][0].admin3Code = that._admin3Codes[admin3CodeKey] ||
              result[0][0].admin3Code;
          // Look-up of admin 4 code
          var admin4Code = result[0][0].admin4Code || '';
          var admin4CodeKey = countryCode + '.' + admin1Code + '.' +
              admin2Code + '.' + admin3Code + '.' + admin4Code;
          result[0][0].admin4Code = that._admin4Codes[admin4CodeKey] ||
              result[0][0].admin4Code;
        }
        return innerCallback(null, result);
      };
    });
    async.series(
      functions,
    function(err, results) {
      DEBUG && console.log('Delivering results');
      return callback(null, results);
    });
  }
};

module.exports = geocoder;
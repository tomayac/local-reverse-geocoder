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

var debug = require('debug')('local-reverse-geocoder');
var fs = require('fs');
var path = require('path');
var parser = require('csv-parse');
var parse = parser.parse;
var kdTree = require('kdt');
var request = require('request');
var unzip = require('unzip-stream');
var async = require('async');
var readline = require('readline');
const { basename } = require('path');

// All data from http://download.geonames.org/export/dump/
var GEONAMES_URL = 'https://download.geonames.org/export/dump/';

var CITIES_FILE = 'cities1000';
var ADMIN_1_CODES_FILE = 'admin1CodesASCII';
var ADMIN_2_CODES_FILE = 'admin2Codes';
var ALL_COUNTRIES_FILE = 'allCountries';
var ALTERNATE_NAMES_FILE = 'alternateNames';
var COUNTRY_CODE = '';

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
  'dem', // digital elevation model, srtm3 or gtopo30, average elevation 3''x3'' (ca 90mx90m) or 30''x30'' (ca 900mx900m) area in meters, integer. srtm processed by cgiar/ciat.
  'timezone', // the timezone id (see file timeZone.txt) varchar(40)
  'modificationDate', // date of last modification in yyyy-MM-dd format
];
/* jshint maxlen: 80 */

var GEONAMES_ADMIN_CODES_COLUMNS = [
  'concatenatedCodes',
  'name',
  'asciiName',
  'geoNameId',
];

/* jshint maxlen: false */
var GEONAMES_ALTERNATE_NAMES_COLUMNS = [
  'alternateNameId', // the id of this alternate name, int
  'geoNameId', // geonameId referring to id in table 'geoname', int
  'isoLanguage', // iso 639 language code 2- or 3-characters; 4-characters 'post' for postal codes and 'iata','icao' and faac for airport codes, fr_1793 for French Revolution name
  'alternateNames', // alternate name or name variant, varchar(200)
  'isPreferrredName', // '1', if this alternate name is an official/preferred name
  'isShortName', // '1', if this is a short name like 'California' for 'State of California'
  'isColloquial', // '1', if this alternate name is a colloquial or slang term
  'isHistoric', // '1', if this alternate name is historic and was used in the past
];
/* jshint maxlen: 80 */

var GEONAMES_DUMP = __dirname + '/geonames_dump';

var geocoder = {
  _kdTree: null,

  _admin1Codes: null,
  _admin2Codes: null,
  _admin3Codes: null,
  _admin4Codes: null,
  _alternateNames: null,

  // Distance function taken from
  // http://www.movable-type.co.uk/scripts/latlong.html
  _distanceFunc: function distance(x, y) {
    var toRadians = function (num) {
      return (num * Math.PI) / 180;
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
    var a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  _getData: function (
    dataName,
    baseName,
    geonamesZipFilename,
    fileNameInsideZip,
    outputFileFolderWithoutSlash,
    downloadMethodBoundToThis,
    callback
  ) {
    const now = new Date().toISOString().substr(0, 10);

    // Use timestamped file OR bare file
    const timestampedBasename = `${baseName}_${now}.txt`;
    const timestampedFilename = `${outputFileFolderWithoutSlash}/${timestampedBasename}`;
    if (fs.existsSync(timestampedFilename)) {
      debug(
        `Using cached GeoNames ${dataName} data from ${timestampedFilename}`
      );
      return callback(null, timestampedFilename);
    }

    const filename = `${outputFileFolderWithoutSlash}/${baseName}.txt`;
    if (fs.existsSync(filename)) {
      debug(`Using cached GeoNames ${dataName} data from ${filename}`);
      return callback(null, filename);
    }

    if (!fs.existsSync(outputFileFolderWithoutSlash)) {
      fs.mkdirSync(outputFileFolderWithoutSlash, { recursive: true });
    }

    const outputFileName = timestampedBasename;

    downloadMethodBoundToThis(
      dataName,
      geonamesZipFilename,
      fileNameInsideZip,
      outputFileFolderWithoutSlash,
      outputFileName,
      callback
    );
  },

  _downloadFile: function (
    dataName,
    geonamesZipFilename,
    fileNameInsideZip,
    outputFileFolderWithoutSlash,
    outputFileName,
    callback
  ) {
    const geonamesUrl = `${GEONAMES_URL}${geonamesZipFilename}`;
    const outputFilePath = `${outputFileFolderWithoutSlash}/${outputFileName}`;

    debug(
      `Getting GeoNames ${dataName} data from ${geonamesUrl} (this may take a while)`
    );

    request({
      url: geonamesUrl,
      encoding: null,
    })
      .on('error', (err) => {
        callback(
          `Error downloading GeoNames ${dataName} data` +
            (err ? ': ' + err : '')
        );
      })
      .on('response', (response) => {
        if (response.statusCode !== 200) {
          callback(
            `Error downloading GeoNames ${dataName} data (response ${response.statusCode} for url ${geonamesUrl})`
          );
        }
      })
      .pipe(fs.createWriteStream(outputFilePath))
      .on('finish', () => {
        debug(`Downloaded GeoNames ${dataName} data`);
        this._housekeepingSync(outputFileFolderWithoutSlash, outputFileName);
        return callback(null, outputFilePath);
      });
  },

  _downloadAndExtractFileFromZip: function (
    dataName,
    geonamesZipFilename,
    fileNameInsideZip,
    outputFileFolderWithoutSlash,
    outputFileName,
    callback
  ) {
    const geonamesUrl = `${GEONAMES_URL}${geonamesZipFilename}`;
    const outputFilePath = `${outputFileFolderWithoutSlash}/${outputFileName}`;

    debug(
      `Getting GeoNames ${dataName} data from ${geonamesUrl} (this may take a while)`
    );

    let foundFiles = 0;
    request({
      url: geonamesUrl,
      encoding: null,
    })
      .on('error', (err) => {
        callback(
          `Error downloading GeoNames ${dataName} data` +
            (err ? ': ' + err : '')
        );
      })
      .on('response', (response) => {
        if (response.statusCode !== 200) {
          callback('Error downloading GeoNames ${dataName} data');
        }
      })
      .pipe(unzip.Parse())
      .on('entry', (entry) => {
        var entryPath = entry.path;
        var entryType = entry.type; // 'Directory' or 'File'
        var entrySize = entry.size; // might be undefined in some archives
        if (entryType === 'File' && entryPath === fileNameInsideZip) {
          debug(
            `Unzipping GeoNames ${dataName} data - found ${entryType} ${entryPath}` +
              (typeof entrySize === 'number' ? ` (${entrySize} B)` : '')
          );
          foundFiles++;
          entry.pipe(fs.createWriteStream(outputFilePath)).on('finish', () => {
            debug(`- unzipped GeoNames ${dataName} data - ${entryPath}`);
            this._housekeepingSync(
              outputFileFolderWithoutSlash,
              outputFileName
            );
            // file is now written, call callback
            return callback(null, outputFilePath);
          });
        } else {
          debug(
            `Unzipping GeoNames ${dataName} data - ignoring ${entryType} ${entryPath}`
          );
          entry.autodrain();
        }
      })
      .on('finish', () => {
        // beware - this event is a finish of unzip, finish event of writeStream may and will happen later ...
        if (foundFiles === 1) {
          // ... so if we found one file, we call callback in it's finish event above
          debug(`Unzipped GeoNames ${dataName} data.`);
          // return callback(null, outputFilePath);
        } else {
          // .. while if there is something unexpected, we fire callback here
          debug(
            `Error unzipping ${geonamesZipFilename}: Was expecting ${outputFileName}, found ${foundFiles} file(s).`
          );
          return callback(
            `Was expecting ${outputFileName}, found ${foundFiles} file(s).`
          );
        }
      });
  },

  _housekeepingSync: function (outputFileFolderWithoutSlash, outputFileName) {
    fs.readdirSync(outputFileFolderWithoutSlash).forEach((foundFile) => {
      if (foundFile !== outputFileName) {
        fs.unlinkSync(`${outputFileFolderWithoutSlash}/${foundFile}`);
      }
    });
  },

  _getGeoNamesAlternateNamesData: function (callback) {
    this._getData(
      // dataName
      'alternate names',
      // baseName
      ALTERNATE_NAMES_FILE,
      // geonamesZipFilename
      `${ALTERNATE_NAMES_FILE}.zip`,
      // fileNameInsideZip
      `${ALTERNATE_NAMES_FILE}.txt`,
      // outputFileFolderWithoutSlash
      GEONAMES_DUMP + '/alternate_names',
      // downloadMethodBoundToThis
      this._downloadAndExtractFileFromZip.bind(this),
      // callback
      callback
    );
  },

  _parseGeoNamesAlternateNamesCsv: function (pathToCsv, callback) {
    var that = this;
    that._alternateNames = {};
    var lineReader = readline.createInterface({
      input: fs.createReadStream(pathToCsv),
    });
    lineReader.on('line', function (line) {
      line = line.split('\t');

      const [
        _,
        geoNameId,
        isoLanguage,
        altName,
        isPreferredName,
        isShortName,
        isColloquial,
        isHistoric,
      ] = line;

      if (isoLanguage === '') {
        // consider data without country code as invalid
        return;
      }

      if (!that._alternateNames[geoNameId]) {
        that._alternateNames[geoNameId] = {};
      }

      that._alternateNames[geoNameId][isoLanguage] = {
        altName,
        isPreferredName: Boolean(isPreferredName),
        isShortName: Boolean(isShortName),
        isColloquial: Boolean(isColloquial),
        isHistoric: Boolean(isHistoric),
      };
    });
    lineReader.on('close', function () {
      return callback();
    });
  },

  _getGeoNamesAdmin1CodesData: function (callback) {
    this._getData(
      // dataName
      'admin 1 codes',
      // baseName
      ADMIN_1_CODES_FILE,
      // geonamesZipFilename
      `${ADMIN_1_CODES_FILE}.txt`,
      // fileNameInsideZip
      null,
      // outputFileFolderWithoutSlash
      GEONAMES_DUMP + '/admin1_codes',
      // downloadMethodBoundToThis
      this._downloadFile.bind(this),
      // callback
      callback
    );
  },

  _parseGeoNamesAdmin1CodesCsv: function (pathToCsv, callback) {
    var that = this;
    var lenI = GEONAMES_ADMIN_CODES_COLUMNS.length;
    that._admin1Codes = {};
    var lineReader = readline.createInterface({
      input: fs.createReadStream(pathToCsv),
    });
    lineReader.on('line', function (line) {
      line = line.split('\t');
      for (var i = 0; i < lenI; i++) {
        var value = line[i] || null;
        if (i === 0) {
          that._admin1Codes[value] = {};
        } else {
          that._admin1Codes[line[0]][GEONAMES_ADMIN_CODES_COLUMNS[i]] = value;
        }
      }
    });
    lineReader.on('close', function () {
      return callback();
    });
  },

  _getGeoNamesAdmin2CodesData: function (callback) {
    this._getData(
      // dataName
      'admin 2 codes',
      // baseName
      ADMIN_2_CODES_FILE,
      // geonamesZipFilename
      `${ADMIN_2_CODES_FILE}.txt`,
      // fileNameInsideZip
      null,
      // outputFileFolderWithoutSlash
      GEONAMES_DUMP + '/admin2_codes',
      // downloadMethodBoundToThis
      this._downloadFile.bind(this),
      // callback
      callback
    );
  },

  _parseGeoNamesAdmin2CodesCsv: function (pathToCsv, callback) {
    var that = this;
    var lenI = GEONAMES_ADMIN_CODES_COLUMNS.length;
    that._admin2Codes = {};
    var lineReader = readline.createInterface({
      input: fs.createReadStream(pathToCsv),
    });
    lineReader.on('line', function (line) {
      line = line.split('\t');
      for (var i = 0; i < lenI; i++) {
        var value = line[i] || null;
        if (i === 0) {
          that._admin2Codes[value] = {};
        } else {
          that._admin2Codes[line[0]][GEONAMES_ADMIN_CODES_COLUMNS[i]] = value;
        }
      }
    });
    lineReader.on('close', function () {
      return callback();
    });
  },

  _getGeoNamesCitiesData: function (callback) {
    this._getData(
      // dataName
      'cities',
      // baseName
      CITIES_FILE,
      // geonamesZipFilename
      `${CITIES_FILE}.zip`,
      // fileNameInsideZip
      `${CITIES_FILE}.txt`,
      // outputFileFolderWithoutSlash
      GEONAMES_DUMP + '/cities',
      // downloadMethodBoundToThis
      this._downloadAndExtractFileFromZip.bind(this),
      // callback
      callback
    );
  },

  _parseGeoNamesCitiesCsv: function (pathToCsv, callback) {
    debug('Started parsing cities.txt (this  may take a while)');
    var data = [];
    var lenI = GEONAMES_COLUMNS.length;
    var that = this;
    var content = fs.readFileSync(pathToCsv);
    parse(content, { delimiter: '\t', quote: '' }, function (err, lines) {
      if (err) {
        return callback(err);
      }
      lines.forEach(function (line) {
        var lineObj = {};
        for (var i = 0; i < lenI; i++) {
          var column = line[i] || null;
          lineObj[GEONAMES_COLUMNS[i]] = column;
        }
        data.push(lineObj);
      });

      debug('Finished parsing cities.txt');
      debug('Started building cities k-d tree (this may take a while)');
      var dimensions = ['latitude', 'longitude'];
      that._kdTree = kdTree.createKdTree(data, that._distanceFunc, dimensions);
      debug('Finished building cities k-d tree');
      return callback();
    });
  },

  _getGeoNamesAllCountriesData: function (callback) {
    this._getData(
      // dataName
      'all countries',
      // baseName
      ALL_COUNTRIES_FILE,
      // geonamesZipFilename
      `${ALL_COUNTRIES_FILE}.zip`,
      // fileNameInsideZip
      `${ALL_COUNTRIES_FILE}.txt`,
      // outputFileFolderWithoutSlash
      GEONAMES_DUMP + '/all_countries',
      // downloadMethodBoundToThis
      this._downloadAndExtractFileFromZip.bind(this),
      // callback
      callback
    );
  },

  _parseGeoNamesCountryCsv: function (pathToCsv, callback) {
    debug('Started parsing cities.txt (this  may take a while)');
    var data = [];
    var lenI = GEONAMES_COLUMNS.length;
    var that = this;
    var content = fs.readFileSync(pathToCsv);
    parse(content, { delimiter: '\t', quote: '' }, function (err, lines) {
      if (err) {
        return callback(err);
      }
      lines.forEach(function (line) {
        var lineObj = {};
        for (var i = 0; i < lenI; i++) {
          var column = line[i] || null;
          lineObj[GEONAMES_COLUMNS[i]] = column;
        }
        data.push(lineObj);
      });

      debug('Finished parsing cities.txt');
      debug('Started building cities k-d tree (this may take a while)');
      var dimensions = ['latitude', 'longitude'];
      that._kdTree = kdTree.createKdTree(data, that._distanceFunc, dimensions);
      debug('Finished building cities k-d tree');
      return callback();
    });
  },

  _getGeoNamesCountriesData: function (callback) {
    this._getData(
      // dataName
      COUNTRY_CODE,
      // baseName
      COUNTRY_CODE,
      // geonamesZipFilename
      `${COUNTRY_CODE.toUpperCase()}.zip`,
      // fileNameInsideZip
      `${COUNTRY_CODE.toUpperCase()}.txt`,
      // outputFileFolderWithoutSlash
      GEONAMES_DUMP + `/${COUNTRY_CODE.toUpperCase()}`,
      // downloadMethodBoundToThis
      this._downloadAndExtractFileFromZip.bind(this),
      // callback
      callback
    );
  },

  _parseGeoNamesAllCountriesCsv: function (pathToCsv, callback) {
    debug('Started parsing all countries.txt (this  may take a while)');
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
    that._admin3Codes = {};
    that._admin4Codes = {};
    var lineReader = readline.createInterface({
      input: fs.createReadStream(pathToCsv),
    });
    lineReader.on('line', function (line) {
      line = line.split('\t');
      var featureCode = line[featureCodeIndex];
      if (featureCode === 'ADM3' || featureCode === 'ADM4') {
        var lineObj = {
          name: line[nameIndex],
          asciiName: line[asciiNameIndex],
          geoNameId: line[geoNameIdIndex],
        };
        var key =
          line[countryCodeIndex] +
          '.' +
          line[admin1CodeIndex] +
          '.' +
          line[admin2CodeIndex] +
          '.' +
          line[admin3CodeIndex];
        if (featureCode === 'ADM3') {
          that._admin3Codes[key] = lineObj;
        } else if (featureCode === 'ADM4') {
          that._admin4Codes[key + '.' + line[admin4CodeIndex]] = lineObj;
        }
      }
      if (counter % 100000 === 0) {
        debug('Parsing progress all countries ' + counter);
      }
      counter++;
    });
    lineReader.on('close', function () {
      debug('Finished parsing all countries.txt');
      return callback();
    });
  },

  init: function (options, callback) {
    options = options || {};

    if (options.dumpDirectory) {
      GEONAMES_DUMP = options.dumpDirectory;
    }

    options.load = options.load || {};

    if (options.load.admin1 === undefined) {
      options.load.admin1 = true;
    }

    if (options.load.admin2 === undefined) {
      options.load.admin2 = true;
    }

    if (options.load.admin3And4 === undefined) {
      options.load.admin3And4 = true;
    }

    if (options.load.alternateNames === undefined) {
      options.load.alternateNames = true;
    }

    debug(
      'Initializing local reverse geocoder using dump ' +
        'directory: ' +
        GEONAMES_DUMP
    );
    // Create local cache folder
    if (!fs.existsSync(GEONAMES_DUMP)) {
      fs.mkdirSync(GEONAMES_DUMP);
    }
    var that = this;

    if (options.countries.length === 0) {
      async.parallel(
        [
          // Get GeoNames cities
          function (waterfallCallback) {
            async.waterfall(
              [
                that._getGeoNamesCitiesData.bind(that),
                that._parseGeoNamesCitiesCsv.bind(that),
              ],
              function () {
                return waterfallCallback();
              }
            );
          },
          // Get GeoNames admin 1 codes
          function (waterfallCallback) {
            if (options.load.admin1) {
              async.waterfall(
                [
                  that._getGeoNamesAdmin1CodesData.bind(that),
                  that._parseGeoNamesAdmin1CodesCsv.bind(that),
                ],
                function () {
                  return waterfallCallback();
                }
              );
            } else {
              return setImmediate(waterfallCallback);
            }
          },
          // Get GeoNames admin 2 codes
          function (waterfallCallback) {
            if (options.load.admin2) {
              async.waterfall(
                [
                  that._getGeoNamesAdmin2CodesData.bind(that),
                  that._parseGeoNamesAdmin2CodesCsv.bind(that),
                ],
                function () {
                  return waterfallCallback();
                }
              );
            } else {
              return setImmediate(waterfallCallback);
            }
          },
          // Get GeoNames all countries
          function (waterfallCallback) {
            if (options.load.admin3And4) {
              async.waterfall(
                [
                  that._getGeoNamesAllCountriesData.bind(that),
                  that._parseGeoNamesAllCountriesCsv.bind(that),
                ],
                function () {
                  return waterfallCallback();
                }
              );
            } else {
              return setImmediate(waterfallCallback);
            }
          },
          // Get GeoNames alternate names
          function (waterfallCallback) {
            if (options.load.alternateNames) {
              async.waterfall(
                [
                  that._getGeoNamesAlternateNamesData.bind(that),
                  that._parseGeoNamesAlternateNamesCsv.bind(that),
                ],
                function () {
                  return waterfallCallback();
                }
              );
            } else {
              return setImmediate(waterfallCallback);
            }
          },
        ],
        // Main callback
        function (err) {
          if (err) {
            throw err;
          }
          if (callback) {
            return callback();
          }
        }
      );
    } else {
      async.parallel(
        [
          // Get GeoNames of specific countries
          function (waterfallCallback) {
            if (options.countries.length > 0) {
              options.countries.map((country, index) => {
                COUNTRY_CODE = country;
                async.waterfall(
                  [
                    that._getGeoNamesCountriesData.bind(that),
                    that._parseGeoNamesCountryCsv.bind(that),
                  ],

                  options.countries.length - 1 === index &&
                    function () {
                      return waterfallCallback();
                    }
                );
              });
            } else {
              return setImmediate(waterfallCallback);
            }
          },
        ],
        // Main callback
        function (err) {
          if (err) {
            throw err;
          }
          if (callback) {
            return callback();
          }
        }
      );
    }
  },

  lookUp: function (points, arg2, arg3) {
    var callback;
    var maxResults;
    if (arguments.length === 2) {
      maxResults = 1;
      callback = arg2;
    } else {
      maxResults = arg2;
      callback = arg3;
    }
    this._lookUp(points, maxResults, function (err, results) {
      return callback(null, results);
    });
  },

  _lookUp: function (points, maxResults, callback) {
    var that = this;
    // If not yet initialied, then initialize
    if (!this._kdTree) {
      return this.init({}, function () {
        return that.lookUp(points, maxResults, callback);
      });
    }
    // Make sure we have an array of points
    if (!Array.isArray(points)) {
      points = [points];
    }
    var functions = [];
    points.forEach(function (point, i) {
      point = {
        latitude: parseFloat(point.latitude),
        longitude: parseFloat(point.longitude),
      };
      debug('Look-up request for point ' + JSON.stringify(point));
      functions[i] = function (innerCallback) {
        var result = that._kdTree.nearest(point, maxResults);
        result.reverse();
        for (var j = 0, lenJ = result.length; j < lenJ; j++) {
          if (result && result[j] && result[j][0]) {
            var countryCode = result[j][0].countryCode || '';
            var geoNameId = result[j][0].geoNameId || '';
            var admin1Code;
            var admin2Code;
            var admin3Code;
            var admin4Code;
            // Look-up of admin 1 code
            if (that._admin1Codes) {
              admin1Code = result[j][0].admin1Code || '';
              var admin1CodeKey = countryCode + '.' + admin1Code;
              result[j][0].admin1Code =
                that._admin1Codes[admin1CodeKey] || result[j][0].admin1Code;
            }
            // Look-up of admin 2 code
            if (that._admin2Codes) {
              admin2Code = result[j][0].admin2Code || '';
              var admin2CodeKey =
                countryCode + '.' + admin1Code + '.' + admin2Code;
              result[j][0].admin2Code =
                that._admin2Codes[admin2CodeKey] || result[j][0].admin2Code;
            }
            // Look-up of admin 3 code
            if (that._admin3Codes) {
              admin3Code = result[j][0].admin3Code || '';
              var admin3CodeKey =
                countryCode +
                '.' +
                admin1Code +
                '.' +
                admin2Code +
                '.' +
                admin3Code;
              result[j][0].admin3Code =
                that._admin3Codes[admin3CodeKey] || result[j][0].admin3Code;
            }
            // Look-up of admin 4 code
            if (that._admin4Codes) {
              admin4Code = result[j][0].admin4Code || '';
              var admin4CodeKey =
                countryCode +
                '.' +
                admin1Code +
                '.' +
                admin2Code +
                '.' +
                admin3Code +
                '.' +
                admin4Code;
              result[j][0].admin4Code =
                that._admin4Codes[admin4CodeKey] || result[j][0].admin4Code;
            }
            // Look-up of alternate name
            if (that._alternateNames) {
              result[j][0].alternateName =
                that._alternateNames[geoNameId] || result[j][0].alternateName;
            }
            // Pull in the k-d tree distance in the main object
            result[j][0].distance = result[j][1];
            // Simplify the output by not returning an array
            result[j] = result[j][0];
          }
        }
        debug(
          'Found result(s) for point ' +
            JSON.stringify(point) +
            result.map(function (subResult, i) {
              return (
                '\n  (' +
                ++i + // jshint ignore:line
                ') {"geoNameId":"' +
                subResult.geoNameId +
                '",' +
                '"name":"' +
                subResult.name +
                '"}'
              );
            })
        );
        return innerCallback(null, result);
      };
    });
    async.series(functions, function (err, results) {
      debug('Delivering joint results');
      return callback(null, results);
    });
  },
};

module.exports = geocoder;

# Local Reverse Geocoder

This library provides a local reverse geocoder for Node.js that is based on
[GeoNames](http://download.geonames.org/export/dump/) data. It is *local*
in the sense that there are no calls to a remote service like the
[Google Maps API](https://developers.google.com/maps/documentation/javascript/geocoding#ReverseGeocoding),
and in consequence the gecoder is suitable for batch reverse geocoding.
It is *reverse* in the sense that you give it a (list of) point(s), *i.e.*,
a latitude/longitude pair, and it returns the closest city to that point.

# Installation
```bash
$ npm install local-reverse-geocoder
```

# Usage in Node.js

## Look Up

```javascript
var geocoder = require('local-reverse-geocoder');

// With just one point
var point = {latitude: 42.083333, longitude: 3.1};
geocoder.lookUp(point, function(err, res) {
  console.log(JSON.stringify(res, null, 2));
});

// In batch mode with many points
var points = [
  {latitude: 42.083333, longitude: 3.1},
  {latitude: 48.466667, longitude: 9.133333}
];
geocoder.lookUp(points, function(err, res) {
  console.log(JSON.stringify(res, null, 2));
});


// How many results to display at max
var maxResults = 5;

// With just one point
var point = {latitude: 42.083333, longitude: 3.1};
geocoder.lookUp(point, maxResults, function(err, res) {
  console.log(JSON.stringify(res, null, 2));
});

// In batch mode with many points
var points = [
  {latitude: 42.083333, longitude: 3.1},
  {latitude: 48.466667, longitude: 9.133333}
];
geocoder.lookUp(points, maxResults, function(err, res) {
  console.log(JSON.stringify(res, null, 2));
});
```

## Init

You can optionally initialize the geocoder prior to the first call to lookUp.  This ensures
that all files are loaded into the cache prior to making the first call.

```javascript
var geocoder = require('local-reverse-geocoder');

geocoder.init({}, function() {
  // geocoder is loaded and ready to run
});
```

Optionally ```init``` also allows you to specify which files to load data from.  This reduces
initialization time and the runtime memory footprint of the nodejs process.  By default
all files are loaded.

```javascript
var geocoder = require('local-reverse-geocoder');

geocoder.init({load:{admin1: true, admin2: false, admin3And4: false, alternateNames: false}}, function() {
  // Ready to call lookUp
});

```

Optionally ```init``` allows you to specify the directory that geonames files are downloaded and cached in.

```javascript
var geocoder = require('local-reverse-geocoder');

geocoder.init({dumpDirectory: '/tmp/geonames'}, function() {
  // Ready to call lookUp and all files will be downloaded to /tmp/geonames
});

```

# Usage of the Web Service

You can use the built-in Web service by running `node app.js` as follows.

```bash
$ curl "http://localhost:3000/geocode?latitude=48.466667&longitude=9.133333&latitude=42.083333&longitude=3.1&maxResults=2"
```

# Result Format

An output array that maps each point in the input array (or input object converted to a single-element array) to the `maxResults` closest addresses.

The measurement units are used [as defined by GenoNames](http://www.geonames.org/export/web-services.html), for example, ```elevation``` is measured in meters. The ```distance``` value is dynamically calculated based on the [haversine distance](http://www.movable-type.co.uk/scripts/latlong.html) for the input point(s) to each of the particular results points and is measured in kilometers.

```javascript
[
  [{
    "geoNameId": "2919146",
    "name": "Gomaringen",
    "asciiName": "Gomaringen",
    "alternateNames": null,
    "latitude": "48.45349",
    "longitude": "9.09582",
    "featureClass": "P",
    "featureCode": "PPLA4",
    "countryCode": "DE",
    "cc2": null,
    "admin1Code": {
      "name": "Baden-Württemberg",
      "asciiName": "Baden-Wuerttemberg",
      "geoNameId": "2953481"
    },
    "admin2Code": {
      "name": "Tübingen Region",
      "asciiName": "Tuebingen Region",
      "geoNameId": "3214106"
    },
    "admin3Code": {
      "name": "Landkreis Tübingen",
      "asciiName": "Landkreis Tubingen",
      "geoNameId": "2820859"
    },
    "admin4Code": {
      "name": "Gomaringen",
      "asciiName": "Gomaringen",
      "geoNameId": "6555939"
    },
    "population": "8400",
    "elevation": null,
    "dem": "430",
    "timezone": "Europe/Berlin",
    "modificationDate": "2011-04-25",
    "distance": 3.1302317076079285
  }, {
    "geoNameId": "2814195",
    "name": "Wannweil",
    "asciiName": "Wannweil",
    "alternateNames": null,
    "latitude": "48.51667",
    "longitude": "9.15",
    "featureClass": "P",
    "featureCode": "PPLA4",
    "countryCode": "DE",
    "cc2": null,
    "admin1Code": {
      "name": "Baden-Württemberg",
      "asciiName": "Baden-Wuerttemberg",
      "geoNameId": "2953481"
    },
    "admin2Code": {
      "name": "Tübingen Region",
      "asciiName": "Tuebingen Region",
      "geoNameId": "3214106"
    },
    "admin3Code": {
      "name": "Landkreis Reutlingen",
      "asciiName": "Landkreis Reutlingen",
      "geoNameId": "3220792"
    },
    "admin4Code": {
      "name": "Wannweil",
      "asciiName": "Wannweil",
      "geoNameId": "6555933"
    },
    "population": "5092",
    "elevation": null,
    "dem": "320",
    "timezone": "Europe/Berlin",
    "modificationDate": "2011-04-25",
    "distance": 5.694122211376861
  }],
  [{
    "geoNameId": "3130634",
    "name": "Albons",
    "asciiName": "Albons",
    "alternateNames": null,
    "latitude": "42.10389",
    "longitude": "3.08433",
    "featureClass": "P",
    "featureCode": "PPLA3",
    "countryCode": "ES",
    "cc2": null,
    "admin1Code": {
      "name": "Catalonia",
      "asciiName": "Catalonia",
      "geoNameId": "3336901"
    },
    "admin2Code": {
      "name": "Província de Girona",
      "asciiName": "Provincia de Girona",
      "geoNameId": "6355230"
    },
    "admin3Code": {
      "name": "Albons",
      "asciiName": "Albons",
      "geoNameId": "6534005"
    },
    "admin4Code": null,
    "population": "558",
    "elevation": "13",
    "dem": "18",
    "timezone": "Europe/Madrid",
    "modificationDate": "2012-03-04",
    "distance": 2.626176210836868
  }, {
    "geoNameId": "3118799",
    "name": "la Tallada d'Empordà",
    "asciiName": "la Tallada d'Emporda",
    "alternateNames": "La Tallada,la Tallada,la Tallada d'Emporda,la Tallada d'Empordà",
    "latitude": "42.0802",
    "longitude": "3.05583",
    "featureClass": "P",
    "featureCode": "PPLA3",
    "countryCode": "ES",
    "cc2": null,
    "admin1Code": {
      "name": "Catalonia",
      "asciiName": "Catalonia",
      "geoNameId": "3336901"
    },
    "admin2Code": {
      "name": "Província de Girona",
      "asciiName": "Provincia de Girona",
      "geoNameId": "6355230"
    },
    "admin3Code": {
      "name": "la Tallada d'Empordà",
      "asciiName": "la Tallada d'Emporda",
      "geoNameId": "6534150"
    },
    "admin4Code": null,
    "population": "0",
    "elevation": null,
    "dem": "16",
    "timezone": "Europe/Madrid",
    "modificationDate": "2012-03-04",
    "distance": 3.6618561653699846
  }]
]
```

# A Word on Accuracy

By design, *i.e.*, due to the granularity of the available
[GeoNames data](http://download.geonames.org/export/dump/cities1000.zip),
this reverse geocoder is limited to city-level, so no streets or house numbers.
In many cases this is already sufficient, but obviously your actual mileage may
vary. If you need street-level granularity, you are better off with a service
like Google's
[reverse geocoding API](https://developers.google.com/maps/documentation/javascript/geocoding#ReverseGeocoding).
(Full disclosure: the author is currently employed by Google.)

# A Word on Speed

The initial lookup takes quite a while, as the geocoder has to download roughly
300MB of data that it then caches locally (unzipped, this occupies about 1.3GB
of disk space). All follow-up requests are lightning fast.
By default, the local [GeoNames dump](http://download.geonames.org/export/dump/) data gets refreshed each day.
You can override this behavior by removing the timestamp from the files in the `./geonames_dump` download folder.
If you don't need admin1, admin2, admin3, admin4 or alternate names you can turn them
off in a manual init call and decrease load time.

# License
Copyright 2017 Thomas Steiner (tomac@google.com)

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

[http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0)

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

# Acknowledgements

This project was inspired by Richard Penman's Python
[reverse geocoder](https://bitbucket.org/richardpenman/reverse_geocode/).
It uses Ubilabs' [k-d-tree implementation](https://github.com/ubilabs/kd-tree-javascript)
that was ported to Node.js by [Luke Arduini](https://github.com/luk-/node-kdt).

# Contributors
- [Chris Kinsman](https://github.com/chriskinsman)
- [@bloodfire91](https://github.com/bloodfire91)

[![NPM](https://nodei.co/npm/local-reverse-geocoder.png?downloads=true)](https://nodei.co/npm/local-reverse-geocoder/)

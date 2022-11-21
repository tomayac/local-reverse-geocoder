'use strict';

var express = require('express');
var app = express();
var geocoder = require('./geocoder.js');
var isGeocodeInitialized = false;

app.get("/healthcheck", function(req, res) {
  return res.status(200).send("OK");
});

app.get("/deep-healthcheck", function(req, res) {
  if (isGeocodeInitialized) {
    return res.status(200).send("OK");
  } else {
    return res.status(503).send("Not ready yet.");
  }
});

app.get(/geocode/, function(req, res) {
  if (!isGeocodeInitialized) {
    return res.status(503).send("Not ready yet.");
  }

  var lat = req.query.latitude || false;
  var lon = req.query.longitude || false;
  var maxResults = req.query.maxResults || 1;
  if (!lat || !lon) {
    return res.status(400).send('Bad Request');
  }
  var points = [];
  if (Array.isArray(lat) && Array.isArray(lon)) {
    if (lat.length !== lon.length) {
      return res.status(400).send('Bad Request');
    }
    for (var i = 0, lenI = lat.length; i < lenI; i++) {
      points[i] = {latitude: lat[i], longitude: lon[i]};
    }
  } else {
    points[0] =  {latitude: lat, longitude: lon};
  }
  geocoder.lookUp(points, maxResults, function(err, addresses) {
    if (err) {
      return res.status(500).send(err);
    }
    return res.send(addresses);
  });
});



var port = Number(process.env.PORT || 3000);
app.listen(port, function() {
  console.log('Local reverse geocoder listening on port ' + port);
  console.log('Initializing Geocoder...');
  geocoder.init({ load: { admin1: true, admin2: false, admin3And4: false } }, function() {
    console.log("Geocoder initialized and ready.")
    isGeocodeInitialized = true;
  });
});

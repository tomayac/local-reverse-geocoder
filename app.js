'use strict';

var express = require('express');
var app = express();
var geocoder = require('./geocoder.js');

app.get(/geocode/, function(req, res) {
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

geocoder.init({}, function() {
  var port = Number(process.env.PORT || 3000);
  app.listen(port, function() {
    console.log('Local reverse geocoder listening on port ' + port);
  });
});

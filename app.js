'use strict';

var express = require('express');
var app = express();
var geocoder = require('./geocoder.js');

app.get(/geocode/, function(req, res) {
  var lat = req.query.latitude || false;
  var lon = req.query.longitude || false;
  if (!lat || !lon) {
    return res.send(400, 'Bad Request');
  }
  geocoder.lookUp({latitude: lat, longitude: lon}, 1, function(err, addresses) {
    if (err) {
      return res.send(500, err);
    }
    return res.send(addresses);
  });
});

var port = Number(process.env.PORT || 3000);
app.listen(port, function() {
  console.log('Local reverse geocoder listening on port ' + port);
});

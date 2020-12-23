#!/bin/bash

docker build . -t "064061306967.dkr.ecr.us-west-2.amazonaws.com/acceptto/local-reverse-geocoder:1.0.0"
docker push 064061306967.dkr.ecr.us-west-2.amazonaws.com/acceptto/local-reverse-geocoder:1.0.0

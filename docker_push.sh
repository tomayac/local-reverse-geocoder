#!/bin/bash

VERSION=1.2.2

docker buildx build --platform linux/amd64,linux/arm64/v8 --push -t 064061306967.dkr.ecr.us-west-2.amazonaws.com/acceptto/local-reverse-geocoder:$VERSION .

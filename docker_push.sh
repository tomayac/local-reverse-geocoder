#!/bin/bash

VERSION="1.2.5"

docker buildx build --sbom=false --provenance=false --platform linux/amd64,linux/arm64/v8 --push -t 064061306967.dkr.ecr.us-west-2.amazonaws.com/acceptto/local-reverse-geocoder:$VERSION .

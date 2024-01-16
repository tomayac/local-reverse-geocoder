#!/bin/bash

set -e

VERSION="$(git describe --tags --match 'v*')"  # Get version tag from git
VERSION=${VERSION#v}                           # Remove leading 'v'

read -p "This action will build and publish docker image version $VERSION (this will automatically proceed in 15 seconds)" -t 15

docker buildx build --sbom=false --provenance=false --platform linux/amd64,linux/arm64/v8 --push -t 064061306967.dkr.ecr.us-west-2.amazonaws.com/acceptto/local-reverse-geocoder:$VERSION .

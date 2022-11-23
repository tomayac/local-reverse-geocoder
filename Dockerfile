FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache curl && \
  addgroup --gid 2000 arculix && \
  adduser --uid 2000 -G arculix -D arculix && \
  mkdir -p \
  /app/geonames_dump/admin1_codes \
  /app/geonames_dump/admin2_codes \
  /app/geonames_dump/all_countries \
  /app/geonames_dump/alternate_names \
  /app/geonames_dump/cities && \
  cd /app/geonames_dump && \
  curl -L -o admin1_codes/admin1CodesASCII.txt http://download.geonames.org/export/dump/admin1CodesASCII.txt && \
  curl -L -o admin2_codes/admin2Codes.txt http://download.geonames.org/export/dump/admin2Codes.txt && \
  curl -L -o all_countries/allCountries.zip http://download.geonames.org/export/dump/allCountries.zip && \
  curl -L -o alternate_names/alternateNames.zip http://download.geonames.org/export/dump/alternateNames.zip && \
  curl -L -o cities/cities1000.zip http://download.geonames.org/export/dump/cities1000.zip && \
  cd all_countries && unzip allCountries.zip && rm allCountries.zip && cd .. && \
  cd cities && unzip cities1000.zip && rm cities1000.zip && cd .. && \
  cd alternate_names && unzip alternateNames.zip && rm alternateNames.zip


COPY package*.json ./
RUN npm ci --only=production
ADD app.js geocoder.js /app/
RUN chown -R arculix:arculix /app

USER arculix

EXPOSE 3000
CMD [ "npm", "start"]

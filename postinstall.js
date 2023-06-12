const {
  GEOCODER_POSTINSTALL_DUMP_DIRECTORY,
  GEOCODER_POSTINSTALL_CITIES_FILE_OVERRIDE,
  GEOCODER_POSTINSTALL_ADMIN1,
  GEOCODER_POSTINSTALL_ADMIN2,
  GEOCODER_POSTINSTALL_ADMIN3_AND_4,
  GEOCODER_POSTINSTALL_ALTERNATE_NAMES,
  GEOCODER_POSTINSTALL_COUNTRIES,
  GEOCODER_POSTINSTALL_FAIL_SILENTLY,
} = process.env;

const values = [
  GEOCODER_POSTINSTALL_DUMP_DIRECTORY,
  GEOCODER_POSTINSTALL_CITIES_FILE_OVERRIDE,
  GEOCODER_POSTINSTALL_ADMIN1,
  GEOCODER_POSTINSTALL_ADMIN2,
  GEOCODER_POSTINSTALL_ADMIN3_AND_4,
  GEOCODER_POSTINSTALL_ALTERNATE_NAMES,
  GEOCODER_POSTINSTALL_COUNTRIES,
];

if (values.every((val) => typeof val === 'undefined')) {
  console.info(
    '[local-reverse-geocoder] post-install: No env variables detected. Doing nothing.'
  );
  process.exit(0);
}

const geocoder = require('./index');

try {
  console.info('[local-reverse-geocoder] post-install: Starting.');
  geocoder.init(
    {
      dumpDirectory: GEOCODER_POSTINSTALL_DUMP_DIRECTORY,
      citiesFileOverride: GEOCODER_POSTINSTALL_CITIES_FILE_OVERRIDE,
      load: {
        admin1: GEOCODER_POSTINSTALL_ADMIN1?.toLowerCase() === 'true',
        admin2: GEOCODER_POSTINSTALL_ADMIN2?.toLowerCase() === 'true',
        admin3And4: GEOCODER_POSTINSTALL_ADMIN3_AND_4?.toLowerCase() === 'true',
        alternateNames:
          GEOCODER_POSTINSTALL_ALTERNATE_NAMES?.toLowerCase() === 'true',
      },
      countries: GEOCODER_POSTINSTALL_COUNTRIES?.split(',') || [],
    },
    function () {
      console.info('[local-reverse-geocoder] post-install: Finished.');
      process.exit(0);
    }
  );
} catch (error) {
  if (GEOCODER_POSTINSTALL_FAIL_SILENTLY?.toLowerCase() === 'true') {
    console.warn(
      '[local-reverse-geocoder] post-install: An error occurred. Detected fail-silently flag.',
      error
    );
    process.exit(0);
  } else {
    console.error(
      '[local-reverse-geocoder] post-install: An error occurred.',
      error
    );
    process.exit(1);
  }
}

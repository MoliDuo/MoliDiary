#!/bin/sh
set -e

# A command given to `docker run` or `compose run` replaces the server. The
# deploy script runs the migration this way (migrate.cmd).
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

# For running the image on its own; the deploy script migrates beforehand.
if [ "${RUN_MIGRATIONS:-}" = "true" ]; then
  node tools/migrate.mjs
fi

exec node server.js

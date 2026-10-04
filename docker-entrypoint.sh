#!/bin/sh
set -e

# Apply pending migrations before serving; a failure stops the container
# rather than starting an app against a schema it does not match.
node tools/migrate.mjs

exec node server.js

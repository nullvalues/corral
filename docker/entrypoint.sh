#!/bin/sh
set -e

case "$1" in
  migrate)
    exec node api/dist/scripts/migrate.js
    ;;
  serve)
    exec node api/dist/index.js
    ;;
  seed)
    exec node api/dist/scripts/seed.prod.js
    ;;
  admin:promote)
    shift
    exec node api/dist/scripts/adminPromote.js "$@"
    ;;
  *)
    echo "Unknown command: $1" >&2
    echo "Usage: $0 {migrate|serve|seed|admin:promote}" >&2
    exit 1
    ;;
esac

#!/bin/sh
set -e
echo "Applying database migrations..."
npx prisma migrate deploy
exec node dist/src/index.js

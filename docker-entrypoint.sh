#!/bin/sh
set -e

echo "Waiting for PostgreSQL at localhost:5432..."
i=0
until node -e "const n=require('net');const s=n.connect(5432,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "PostgreSQL did not become ready in time"
    exit 1
  fi
  echo "PostgreSQL not ready yet (attempt $i/60)..."
  sleep 2
done
echo "PostgreSQL is accepting connections."

echo "Applying database migrations..."
npx prisma migrate deploy

exec node dist/src/index.js

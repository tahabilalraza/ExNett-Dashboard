#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo 'Docker is required for this local MongoDB helper. Alternatively configure MONGODB_URI for an existing replica set.' >&2; exit 1; }
if docker container inspect exnett-mongo >/dev/null 2>&1; then
  docker start exnett-mongo >/dev/null
else
  docker run -d --name exnett-mongo --restart unless-stopped -p 127.0.0.1:27017:27017 -v exnett-mongo-data:/data/db mongo:8.0.32 --replSet rs0 --bind_ip_all >/dev/null
fi
ready=0
for attempt in {1..30}; do
  if docker exec exnett-mongo mongosh --quiet --eval 'db.adminCommand({ping:1})' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'MongoDB did not become available.' >&2; exit 1; }
docker exec exnett-mongo mongosh --quiet --eval 'try { rs.status() } catch(e) { if(e.codeName === "NotYetInitialized") { rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]}) } else { throw e } }' >/dev/null
ready=0
for attempt in {1..30}; do
  if docker exec exnett-mongo mongosh --quiet --eval 'if (!db.hello().isWritablePrimary) { quit(1) }' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'MongoDB did not elect a primary.' >&2; exit 1; }
echo 'Local MongoDB replica set ready on port 27017. Data remains in exnett-mongo-data.'

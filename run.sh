#!/bin/bash
# (re)start the server in background. Usage: ./run.sh
cd "$(dirname "$0")"; pkill -f "node server.js" 2>/dev/null; sleep 0.5
nohup node server.js >> data/server.log 2>&1 &
echo "started pid $!"

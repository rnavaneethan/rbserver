forever -wfa --watchDirectory . -p ./logs/ -l ./forever.log -o ./logs/server.out.log -e ./logs/server.err.log --minUptime 1000 --spinSleepTime 10000 start ./server.js

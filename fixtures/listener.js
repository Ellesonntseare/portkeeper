// Manual integration fixture: node test-listener.js 34567
const server = require('node:http').createServer((_request, response) => response.end('ok'));
server.listen(Number(process.argv[2] || 34567), '127.0.0.1', () => console.log(`Test listener PID ${process.pid}`));

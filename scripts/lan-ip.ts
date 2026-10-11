import os from 'node:os';

const ifaces = os.networkInterfaces();
console.log('LAN IPv4 addresses:');
for (const [name, list] of Object.entries(ifaces)) {
  if (!list) continue;
  for (const net of list) {
    if (net.family === 'IPv4' && !net.internal) {
      console.log(`  ${name}: ${net.address}`);
    }
  }
}

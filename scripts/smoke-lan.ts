import os from 'node:os';

const port = Number(process.env.PORT ?? 3000);
const ifaces = os.networkInterfaces();
const ips: string[] = ['127.0.0.1'];
for (const list of Object.values(ifaces)) {
  if (!list) continue;
  for (const net of list) {
    if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
  }
}

let failed = 0;
for (const ip of ips) {
  const url = `http://${ip}:${port}/api/health`;
  try {
    const res = await fetch(url);
    const body = await res.json();
    console.log(`${res.ok ? 'OK' : 'FAIL'} ${url} -> ${JSON.stringify(body)}`);
    if (!res.ok) failed++;
  } catch (err) {
    console.log(`FAIL ${url} -> ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}
process.exit(failed ? 1 : 0);

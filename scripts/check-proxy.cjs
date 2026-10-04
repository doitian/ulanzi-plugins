// Live check: fetch a real https endpoint through the shared proxy logic.
// Usage: node scripts/check-proxy.cjs [proxyUrl]   (default http://127.0.0.1:7890)
const { createProxyFetch } = require('../me.iany.js.ulanziPlugin/bridge/proxy-fetch.cjs');

async function main() {
    const proxy = process.argv[2] || 'http://127.0.0.1:7890';
    const proxyFetch = createProxyFetch({ optionsStore: { read: () => ({ proxy }) } });
    console.log('proxy:', proxy);
    try {
        // No token: a 401 proves the tunnel, TLS and HTTP round-trip all worked.
        const response = await proxyFetch('https://api.anthropic.com/api/oauth/usage');
        console.log('status:', response.status);
        console.log('body:', (await response.text()).slice(0, 200));
    } catch (error) {
        console.log('request failed:', error.message);
        process.exitCode = 1;
    }
}
main();

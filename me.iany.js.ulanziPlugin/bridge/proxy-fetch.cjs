// Shared AI usage proxy: when set, provider traffic only ever leaves through
// this HTTP proxy as a CONNECT tunnel. A dead proxy fails the request; there
// is no direct fallback. Built on node core so any bundled Node 18+ works.
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

// Not Readable.toWeb: on Node 20.12 (bundled with Ulanzi Studio) cancelling its
// stream between the response's 'end' and 'close' events, as callers do with
// small non-OK bodies, throws an uncaught ERR_INVALID_STATE that kills the plugin.
function responseBody(response) {
    const chunks = response[Symbol.asyncIterator]();
    return new ReadableStream({
        async pull(controller) {
            const { value, done } = await chunks.next();
            if (done) controller.close();
            else controller.enqueue(new Uint8Array(value));
        },
        cancel() { response.destroy(); }
    });
}

function normalizeProxy(value) {
    const proxy = (typeof value === 'string' ? value : '').trim();
    if (!proxy) return '';
    let parsed;
    try { parsed = new URL(proxy); }
    catch (_) { throw new Error('invalid_proxy'); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('invalid_proxy');
    return parsed;
}

function connectThroughProxy(proxy, target) {
    return new Promise((resolve, reject) => {
        const authority = target.hostname + ':' + (target.port || (target.protocol === 'https:' ? 443 : 80));
        const headers = { Host: authority };
        if (proxy.username || proxy.password) {
            const credentials = decodeURIComponent(proxy.username) + ':' + decodeURIComponent(proxy.password);
            headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(credentials).toString('base64');
        }
        const request = (proxy.protocol === 'https:' ? https : http).request({
            host: proxy.hostname,
            port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
            method: 'CONNECT', path: authority, headers, timeout: 20000
        });
        request.on('connect', (response, socket) => {
            if (response.statusCode !== 200) {
                socket.destroy();
                reject(new Error('proxy_connect_failed'));
                return;
            }
            resolve(socket);
        });
        request.on('timeout', () => request.destroy(new Error('proxy_connect_failed')));
        request.on('error', reject);
        request.end();
    });
}

function requestOverSocket(socket, target, options) {
    return new Promise((resolve, reject) => {
        const agent = new https.Agent();
        agent.createConnection = (unused, callback) => callback(null, socket);
        const request = https.request(target, {
            agent, method: options.method || 'GET', headers: options.headers || {}, signal: options.signal
        });
        request.on('response', response => {
            const headers = new Headers();
            for (let i = 0; i < response.rawHeaders.length; i += 2) headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
            resolve(new Response(NULL_BODY_STATUS.has(response.statusCode) ? null : responseBody(response), {
                status: response.statusCode, statusText: response.statusMessage, headers
            }));
        });
        request.on('error', reject);
        if (options.body) request.write(options.body);
        request.end();
    });
}

async function proxiedFetch(url, options, proxy, tlsConnect) {
    const target = new URL(url);
    // Fail closed: every provider endpoint is https, and plain-http requests
    // must never bypass the tunnel.
    if (target.protocol !== 'https:') throw new Error('invalid_request');
    const tunnel = await connectThroughProxy(proxy, target);
    const secure = tlsConnect({ socket: tunnel, servername: target.hostname });
    await new Promise((resolve, reject) => {
        secure.once('secureConnect', resolve);
        secure.once('error', reject);
    });
    return requestOverSocket(secure, target, options);
}

function createProxyFetch({ optionsStore, fetchImpl = fetch, tlsConnect = tls.connect } = {}) {
    return async function proxyFetch(url, options = {}) {
        const proxy = normalizeProxy(optionsStore.read().proxy);
        if (!proxy) return fetchImpl(url, options);
        return proxiedFetch(url, options, proxy, tlsConnect);
    };
}

module.exports = { createProxyFetch, normalizeProxy };

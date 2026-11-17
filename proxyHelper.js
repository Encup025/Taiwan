const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const KODE_BLOKIR = new Set([403, 407, 429, 503]);
const keyHabisUntil = new Map();

let daftarProxyPublik = [];
let waktuAmbilProxyPublik = 0;

function diblokCloudflare(data) {
    if (typeof data !== 'string') return true;
    const lower = data.toLowerCase();
    return (
        lower.includes('just a moment...') ||
        lower.includes('attention required') ||
        lower.includes('cf-chl-') ||
        lower.includes('cloudflare ray id')
    );
}

function isErrorBlokir(err) {
    const status = err?.response?.status;
    if (status && KODE_BLOKIR.has(status)) return true;

    const msg = String(err?.message || '').toLowerCase();
    return (
        msg.includes('cloudflare') ||
        msg.includes('ditolak') ||
        msg.includes('403') ||
        msg.includes('429') ||
        msg.includes('503')
    );
}

function ambilKeysAktif(envName) {
    const raw = process.env[envName] || '';
    const now = Date.now();
    return raw
        .split(',')
        .map(k => k.trim())
        .filter(k => k && (keyHabisUntil.get(k) || 0) <= now);
}

function tandaiKeyHabis(key) {
    // Nonaktifkan key sementara selama 1 jam jika terkena limit/429/401
    keyHabisUntil.set(key, Date.now() + 60 * 60 * 1000);
}

// --- LAPIS 2A: CLOUDFLARE WORKER RELAY (TANPA API KEY) ---
async function cobaCloudflareWorker(targetUrl, headers, signal) {
    const workerUrl = (process.env.CF_WORKER_URL || '').trim();
    if (!workerUrl) throw new Error('CF_WORKER_URL belum diatur');

    const relayUrl = `${workerUrl.replace(/\/$/, '')}/?url=${encodeURIComponent(targetUrl)}`;
    const res = await axios.get(relayUrl, {
        headers: {
            ...headers,
            'x-relay-secret': process.env.CF_WORKER_SECRET || 'rahasia123'
        },
        timeout: 9000,
        responseType: 'text',
        signal,
        validateStatus: s => s >= 200 && s < 300
    });

    if (typeof res.data !== 'string' || res.data.length < 50 || diblokCloudflare(res.data)) {
        throw new Error('CF Worker terblokir atau respons kosong');
    }
    return res.data;
}

// --- LAPIS 2B: PROXYSCRAPE PUBLIK IP:PORT (TANPA API KEY) ---
async function ambilDaftarProxyScrape() {
    if (daftarProxyPublik.length > 0 && Date.now() - waktuAmbilProxyPublik < 10 * 60 * 1000) {
        return daftarProxyPublik;
    }

    const apiPublik = 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=4000&country=all&ssl=all&anonymity=all';
    const res = await axios.get(apiPublik, { timeout: 5000, responseType: 'text' });
    const list = String(res.data || '')
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(x => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(x));

    if (list.length > 0) {
        daftarProxyPublik = list;
        waktuAmbilProxyPublik = Date.now();
    }
    return daftarProxyPublik;
}

async function cobaProxyPublik(targetUrl, headers, signal) {
    if (process.env.ENABLE_PUBLIC_PROXY === '0') {
        throw new Error('Proxy publik dinonaktifkan');
    }

    const list = await ambilDaftarProxyScrape();
    if (!list.length) throw new Error('Daftar proxy publik kosong');

    // Balapkan 3 proxy publik secara paralel dengan timeout ketat 4.5 detik
    const kandidat = [...list].sort(() => Math.random() - 0.5).slice(0, 3);

    return await Promise.any(
        kandidat.map(async ipPort => {
            const agent = new HttpsProxyAgent(`http://${ipPort}`);
            const res = await axios.get(targetUrl, {
                headers,
                httpsAgent: agent,
                httpAgent: agent,
                proxy: false,
                timeout: 4500,
                responseType: 'text',
                signal,
                validateStatus: s => s >= 200 && s < 300
            });

            if (typeof res.data !== 'string' || res.data.length < 50 || diblokCloudflare(res.data)) {
                throw new Error('Proxy publik gagal/diblokir');
            }
            return res.data;
        })
    );
}

// --- LAPIS 3A: ROTASI 10 IP WEBSHARE ---
async function cobaWebshare(targetUrl, headers, signal) {
    const rawList = (process.env.WEBSHARE_PROXY_URL || '')
        .split(',')
        .map(u => u.trim())
        .filter(Boolean);

    if (!rawList.length) throw new Error('WEBSHARE_PROXY_URL belum diatur');

    // Acak urutan dan coba maksimal 2 IP Webshare berbeda
    const kandidat = [...rawList].sort(() => Math.random() - 0.5).slice(0, 2);
    let lastErr = null;

    for (const proxyUrl of kandidat) {
        if (signal?.aborted) break;
        try {
            const agent = new HttpsProxyAgent(proxyUrl);
            const res = await axios.get(targetUrl, {
                headers,
                httpsAgent: agent,
                httpAgent: agent,
                proxy: false,
                timeout: 9000,
                responseType: 'text',
                signal,
                validateStatus: s => s >= 200 && s < 300
            });

            if (typeof res.data === 'string' && res.data.length >= 50 && !diblokCloudflare(res.data)) {
                return res.data;
            }
            throw new Error('Webshare terkena challenge Cloudflare');
        } catch (err) {
            lastErr = err;
        }
    }

    throw lastErr || new Error('Semua kandidat Webshare gagal');
}

// --- LAPIS 3B: ROTASI WEB UNBLOCKER API (SCRAPINGANT -> SCRAPERAPI -> ZENROWS) ---
async function cobaWebUnblockerApi(targetUrl, signal) {
    // 1. ScrapingAnt (Kuota besar 10.000/bulan)
    for (const key of ambilKeysAktif('SCRAPINGANT_KEYS')) {
        if (signal?.aborted) break;
        try {
            const u = `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${encodeURIComponent(key)}&browser=false`;
            const res = await axios.get(u, { timeout: 15000, responseType: 'text', signal });
            if (typeof res.data === 'string' && res.data.length >= 50 && !diblokCloudflare(res.data)) {
                return res.data;
            }
        } catch (err) {
            if ([401, 403, 429].includes(err?.response?.status)) tandaiKeyHabis(key);
        }
    }

    // 2. ScraperAPI (Mode standar, lalu aktifkan render=true jika terkena JS Challenge)
    for (const key of ambilKeysAktif('SCRAPERAPI_KEYS')) {
        if (signal?.aborted) break;
        try {
            const u = `https://api.scraperapi.com/?api_key=${encodeURIComponent(key)}&url=${encodeURIComponent(targetUrl)}`;
            let res = await axios.get(u, { timeout: 20000, responseType: 'text', signal });

            if (typeof res.data === 'string' && diblokCloudflare(res.data)) {
                res = await axios.get(`${u}&render=true`, { timeout: 30000, responseType: 'text', signal });
            }

            if (typeof res.data === 'string' && res.data.length >= 50 && !diblokCloudflare(res.data)) {
                return res.data;
            }
        } catch (err) {
            if ([401, 403, 429].includes(err?.response?.status)) tandaiKeyHabis(key);
        }
    }

    // 3. ZenRows (Cadangan terakhir)
    for (const key of ambilKeysAktif('ZENROWS_KEYS')) {
        if (signal?.aborted) break;
        try {
            const u = `https://api.zenrows.com/v1/?apikey=${encodeURIComponent(key)}&url=${encodeURIComponent(targetUrl)}`;
            const res = await axios.get(u, { timeout: 20000, responseType: 'text', signal });
            if (typeof res.data === 'string' && res.data.length >= 50 && !diblokCloudflare(res.data)) {
                return res.data;
            }
        } catch (err) {
            if ([401, 403, 429].includes(err?.response?.status)) tandaiKeyHabis(key);
        }
    }

    throw new Error('Semua Web Unblocker API gagal atau kuota habis.');
}

// --- ORKESTRATOR UTAMA 4 LAPIS ---
async function fetchDenganFallback(targetUrl, options = {}) {
    const {
        headers = {},
        httpsAgent,
        signal,
        isJson = false,
        izinkanApiKey = true
    } = options;

    let lastErr = null;

    // LAPIS 1: Direct Request (Axios -> Native Fetch)
    try {
        try {
            const res = await axios.get(targetUrl, {
                headers,
                httpsAgent,
                timeout: 9000,
                responseType: 'text',
                signal,
                validateStatus: s => s >= 200 && s < 300
            });
            if (!isJson && diblokCloudflare(res.data)) throw new Error('diblokir Cloudflare');
            if (typeof res.data === 'string' && res.data.length >= 2) return res.data;
        } catch (axiosErr) {
            if (isErrorBlokir(axiosErr) && typeof fetch === 'function') {
                const fetchRes = await fetch(targetUrl, {
                    headers: { ...headers, 'Referer': 'https://www.google.com/' },
                    signal
                });
                if (!fetchRes.ok) {
                    const e = new Error(`HTTP ${fetchRes.status}`);
                    e.response = { status: fetchRes.status };
                    throw e;
                }
                const txt = await fetchRes.text();
                if (!isJson && diblokCloudflare(txt)) throw new Error('diblokir Cloudflare');
                return txt;
            }
            throw axiosErr;
        }
    } catch (err) {
        lastErr = err;
        if (!isErrorBlokir(err) || signal?.aborted) throw err;
    }

    // LAPIS 2: Proxy Gratis Tanpa API Key (CF Worker -> ProxyScrape)
    if (process.env.CF_WORKER_URL && !signal?.aborted) {
        try {
            return await cobaCloudflareWorker(targetUrl, headers, signal);
        } catch (e) {
            lastErr = e;
        }
    }

    if (!signal?.aborted) {
        try {
            return await cobaProxyPublik(targetUrl, headers, signal);
        } catch (e) {
            lastErr = e;
        }
    }

    // LAPIS 3: Proxy Gratis Dengan API Key (Webshare -> Web Unblocker)
    if (izinkanApiKey && !signal?.aborted) {
        if (process.env.WEBSHARE_PROXY_URL) {
            try {
                return await cobaWebshare(targetUrl, headers, signal);
            } catch (e) {
                lastErr = e;
            }
        }

        try {
            return await cobaWebUnblockerApi(targetUrl, signal);
        } catch (e) {
            lastErr = e;
        }
    }

    throw lastErr || new Error('Gagal mengambil data dari semua jalur.');
}

module.exports = { fetchDenganFallback, isErrorBlokir };

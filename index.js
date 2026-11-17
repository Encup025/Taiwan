const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const https = require('https');
const { randomUUID } = require('crypto');
const { fetchDenganFallback } = require('./proxyHelper');
const app = express();
app.use(cors());

const FETCH_TIMEOUT_MS = 5000;

function gabungSignal(signal, ms = FETCH_TIMEOUT_MS) {
    const tSignal = AbortSignal.timeout(ms);
    if (!signal) return tSignal;
    if (typeof AbortSignal.any === 'function') {
        return AbortSignal.any([signal, tSignal]);
    }
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal.aborted || tSignal.aborted) {
        ctrl.abort();
        return ctrl.signal;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    tSignal.addEventListener('abort', onAbort, { once: true });
    return ctrl.signal;
}

const httpsAgentAman = new https.Agent({
    keepAlive: true,
    minVersion: 'TLSv1.2'
});

const httpsAgentKhususIP = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
    minVersion: 'TLSv1.2',
    ciphers: [
        'TLS_AES_128_GCM_SHA256',
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'ECDHE-ECDSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-ECDSA-CHACHA20-POLY1305',
        'ECDHE-RSA-CHACHA20-POLY1305',
        'ECDHE-RSA-AES128-SHA',
        'ECDHE-RSA-AES256-SHA',
        'AES128-GCM-SHA256',
        'AES256-GCM-SHA384',
        'AES128-SHA',
        'AES256-SHA'
    ].join(':')
});

function getHttpsAgentUntukUrl(targetUrl) {
    try {
        const hostname = new URL(targetUrl).hostname;
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
            return httpsAgentKhususIP;
        }
    } catch {}
    return httpsAgentAman;
}

// ================= ZONA WAKTU =================
const STATE_TZ = {
    'texas': 'America/Chicago',
    'missouri': 'America/Chicago',
    'iowa': 'America/Chicago',
    'california': 'America/Los_Angeles',
    'oregon': 'America/Los_Angeles',
    'arizona': 'America/Phoenix',
    'indiana': 'America/Indiana/Indianapolis',
    'kentucky': 'America/New_York',
    'florida': 'America/New_York',
    'new-york': 'America/New_York',
    'washington-dc': 'America/New_York',
    'north-carolina': 'America/New_York',
    'virginia': 'America/New_York',
    'georgia': 'America/New_York',
    'new-jersey': 'America/New_York'
};

const STATE_SLUG = {
    'washington-dc': 'district-of-columbia'
};

const GAME_ALIAS = {
    'texas/morning-daily-4': 'morning-pick-4',
    'texas/day-daily-4': 'midday-4',
    'texas/evening-daily-4': 'evening-pick-4',
    'texas/night-daily-4': 'daily-4',

    'oregon/1-pm-pick-4': 'pick-4-1pm',
    'oregon/4-pm-pick-4': 'pick-4-4pm',
    'oregon/7-pm-pick-4': 'pick-4-7pm',
    'oregon/10-pm-pick-4': 'pick-4-10pm',

    'florida/pick-4-midday': 'midday-pick-4',
    'florida/pick-4-evening': 'pick-4',

    'kentucky/pick-4-evening': 'pick-4'
};

const MONTHS = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
];

// ================= HELPER TANGGAL =================

function partsInTZ(date, tz) {
    const f = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const p = Object.fromEntries(
        f.formatToParts(date).map(x => [x.type, x.value])
    );

    return {
        y: Number(p.year),
        m: Number(p.month),
        d: Number(p.day)
    };
}

const iso = ({ y, m, d }) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function getWIBDateString() {
    const { y, m, d } = partsInTZ(new Date(), 'Asia/Jakarta');
    return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tanggalValid(value) {
    if (!value) return false;

    const match = String(value).match(
        /^(\d{4})-(\d{2})-(\d{2})$/
    );

    if (!match) return false;

    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);

    const date = new Date(Date.UTC(y, m - 1, d));

    return (
        date.getUTCFullYear() === y &&
        date.getUTCMonth() === m - 1 &&
        date.getUTCDate() === d
    );
}

function tzOffsetMs(date, tz) {
    const f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const p = Object.fromEntries(
        f.formatToParts(date).map(x => [x.type, x.value])
    );

    const asUTC = Date.UTC(
        Number(p.year),
        Number(p.month) - 1,
        Number(p.day),
        Number(p.hour),
        Number(p.minute),
        Number(p.second)
    );

    return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

function localToDate(y, m, d, hh, mm, tz) {
    const guess = Date.UTC(y, m - 1, d, hh, mm);

    let t = guess - tzOffsetMs(new Date(guess), tz);
    t = guess - tzOffsetMs(new Date(t), tz);

    return new Date(t);
}

function jamWIB(date) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).format(date) + ' WIB';
}

function dapatkanWaktuWIB() {
    return new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }) + ' WIB';
}

function getTanggalWIB(waktu = new Date()) {
    const hari = [
        'Minggu', 'Senin', 'Selasa', 'Rabu',
        'Kamis', 'Jumat', 'Sabtu'
    ];

    const bulan = [
        'Januari', 'Februari', 'Maret', 'April',
        'Mei', 'Juni', 'Juli', 'Agustus',
        'September', 'Oktober', 'November', 'Desember'
    ];

    const { y, m, d } = partsInTZ(waktu, 'Asia/Jakarta');
    const hr = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    return `${hari[hr]}, ${d} ${bulan[m - 1]} ${y}`;
}

function parseTanggal(str, tzNow) {
    if (!str) return null;

    str = String(str).toLowerCase().trim();

    let match = str.match(/(\d{4})-(\d{2})-(\d{2})/);

    if (match) {
        const hasil = {
            y: Number(match[1]),
            m: Number(match[2]),
            d: Number(match[3])
        };

        return tanggalValid(iso(hasil)) ? hasil : null;
    }

    match = str.match(
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?!\d)(?:,?\s*(\d{4}))?/
    );

    if (match) {
        const bulan = MONTHS.indexOf(match[1]) + 1;
        let tahun = match[3] ? Number(match[3]) : tzNow.y;

        if (!match[3] && bulan > tzNow.m + 1) {
            tahun -= 1;
        } else if (!match[3] && tzNow.m === 1 && bulan === 12) {
            tahun -= 1;
        }

        const hasil = {
            y: tahun,
            m: bulan,
            d: Number(match[2])
        };

        return tanggalValid(iso(hasil)) ? hasil : null;
    }

    return null;
}

// ================= VALIDASI TANGGAL & SLOT DARI SCRAPER.JS =================

const MONTHS_ID_LOWER = [
    'januari', 'februari', 'maret', 'april', 'mei', 'juni',
    'juli', 'agustus', 'september', 'oktober', 'november', 'desember'
];

const MONTHS_EN_LOWER = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
];

const MONTHS_SHORT_MAP = {
    jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5,
    jun: 6, jul: 7, agu: 8, aug: 8, sep: 9, okt: 10,
    oct: 10, nov: 11, des: 12, dec: 12
};

function getMonthNumber(name) {
    const value = String(name || '')
        .toLowerCase()
        .replace(/\./g, '')
        .trim();

    const idIndex = MONTHS_ID_LOWER.indexOf(value);
    if (idIndex !== -1) return idIndex + 1;

    const enIndex = MONTHS_EN_LOWER.indexOf(value);
    if (enIndex !== -1) return enIndex + 1;

    return MONTHS_SHORT_MAP[value] || 0;
}

function hasExactWIBDate(text) {
    const value = String(text || '');
    if (!value.trim()) return false;

    const { y: year, m: month, d: day } = partsInTZ(new Date(), 'Asia/Jakarta');

    const monthNames = [
        ...MONTHS_ID_LOWER,
        ...MONTHS_EN_LOWER,
        ...Object.keys(MONTHS_SHORT_MAP)
    ]
        .sort((a, b) => b.length - a.length)
        .map(escapeRegex)
        .join('|');

    const namedDateRegex = new RegExp(
        `(?:^|[^\\d])(\\d{1,2})\\s+(${monthNames})\\.?[,]?\\s+(\\d{4})(?!\\d)`,
        'gi'
    );

    let match;
    while ((match = namedDateRegex.exec(value)) !== null) {
        const foundDay = Number(match[1]);
        const foundMonth = getMonthNumber(match[2]);
        const foundYear = Number(match[3]);

        if (foundDay === day && foundMonth === month && foundYear === year) {
            return true;
        }
    }

    const sep = '[\\s./-]+';
    const dd = String(day).padStart(2, '0');
    const mm = String(month).padStart(2, '0');
    const yyyy = String(year);

    const numericPatterns = [
        new RegExp(`(?:^|\\D)${dd}${sep}${mm}${sep}${yyyy}(?!\\d)`),
        new RegExp(`(?:^|\\D)${day}${sep}${month}${sep}${yyyy}(?!\\d)`),
        new RegExp(`(?:^|\\D)${mm}${sep}${dd}${sep}${yyyy}(?!\\d)`),
        new RegExp(`(?:^|\\D)${yyyy}${sep}${mm}${sep}${dd}(?!\\d)`),
        new RegExp(`(?:^|\\D)${yyyy}${mm}${dd}(?!\\d)`),
        new RegExp(`(?:^|\\D)${dd}${mm}${yyyy}(?!\\d)`)
    ];

    return numericPatterns.some(pattern => pattern.test(value));
}

function isDateValid(htmlContent) {
    const { y: year, m: month, d: day } = partsInTZ(new Date(), 'Asia/Jakarta');

    const dayNoZero = String(day);
    const dayTwo = String(day).padStart(2, '0');
    const monthNoZero = String(month);
    const monthTwo = String(month).padStart(2, '0');
    const shortYear = String(year).slice(-2);

    const monthNamesId = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const monthNamesEn = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const id = monthNamesId[month - 1];
    const en = monthNamesEn[month - 1];
    const idShort = id.slice(0, 3);
    const enShort = en.slice(0, 3);

    const sep = '[-/.,\\s]+';
    const boundary = '(?<!\\d)';
    const endBoundary = '(?!\\d)';

    const patterns = [
        `${boundary}0?${dayNoZero}${sep}0?${monthNoZero}${sep}${year}${endBoundary}`,
        `${boundary}${year}${sep}0?${monthNoZero}${sep}0?${dayNoZero}${endBoundary}`,
        `${boundary}0?${monthNoZero}${sep}0?${dayNoZero}${sep}${year}${endBoundary}`,
        `${boundary}0?${dayNoZero}${sep}0?${monthNoZero}${sep}${shortYear}${endBoundary}`,
        `${boundary}0?${monthNoZero}${sep}0?${dayNoZero}${sep}${shortYear}${endBoundary}`,
        `${boundary}${shortYear}${sep}0?${monthNoZero}${sep}0?${dayNoZero}${endBoundary}`,
        `${boundary}0?${dayNoZero}${sep}${escapeRegex(id)}${sep}${year}${endBoundary}`,
        `${boundary}0?${dayNoZero}${sep}${escapeRegex(idShort)}${sep}${year}${endBoundary}`,
        `${boundary}${escapeRegex(id)}${sep}0?${dayNoZero}${sep}${year}${endBoundary}`,
        `${boundary}${escapeRegex(idShort)}${sep}0?${dayNoZero}${sep}${year}${endBoundary}`,
        `${boundary}0?${dayNoZero}${sep}${escapeRegex(en)}${sep}${year}${endBoundary}`,
        `${boundary}0?${dayNoZero}${sep}${escapeRegex(enShort)}${sep}${year}${endBoundary}`,
        `${boundary}${escapeRegex(en)}${sep}0?${dayNoZero}${sep}${year}${endBoundary}`,
        `${boundary}${escapeRegex(enShort)}${sep}0?${dayNoZero}${sep}${year}${endBoundary}`,
        `${boundary}${dayTwo}${monthTwo}${year}${endBoundary}`,
        `${boundary}${year}${monthTwo}${dayTwo}${endBoundary}`,
        `${boundary}${dayTwo}${escapeRegex(enShort)}${year}${endBoundary}`,
        `${boundary}${dayTwo}${escapeRegex(idShort)}${year}${endBoundary}`,
        `${boundary}0?${dayNoZero}${sep}${escapeRegex(id)}${endBoundary}`,
        `${boundary}0?${dayNoZero}${sep}${escapeRegex(idShort)}${endBoundary}`,
        `${boundary}0?${dayNoZero}${sep}${escapeRegex(en)}${endBoundary}`,
        `${boundary}0?${dayNoZero}${sep}${escapeRegex(enShort)}${endBoundary}`,
        `${boundary}${escapeRegex(en)}${sep}0?${dayNoZero}${endBoundary}`,
        `${boundary}${escapeRegex(enShort)}${sep}0?${dayNoZero}${endBoundary}`
    ];

    const str = String(htmlContent || '');
    return patterns.some(pattern => new RegExp(pattern, 'i').test(str));
}

function getMacauSlotValue(pageText, jam) {
    const re = /JAM\s+(\d{2}[:.]\d{2})(?!\s*WIB)/gi;
    const jams = [];
    let last = 0;
    let m;

    while ((m = re.exec(pageText))) {
        jams.push(m[1].replace('.', ':'));
        last = re.lastIndex;
    }

    if (jams.length === 0) return null;

    const nums = (pageText.slice(last).match(/\b\d{4}\b/g) || []).slice(0, jams.length);
    const target = String(jam).replace('.', ':');
    let i = jams.indexOf(target);

    if (i < 0 && target === '00:00') {
        i = jams.indexOf('00:01');
    }

    return i >= 0 ? nums[i] || null : null;
}

// ================= JADWAL UNDIAN US =================
const JADWAL = {
    'texas/morning-daily-4': '10:00',
    'texas/day-daily-4': '12:27',
    'texas/evening-daily-4': '18:00',
    'texas/night-daily-4': '22:12',

    'oregon/1-pm-pick-4': '13:00',
    'oregon/4-pm-pick-4': '16:00',
    'oregon/7-pm-pick-4': '19:00',
    'oregon/10-pm-pick-4': '22:00',

    'kentucky/midday-pick-4': '13:25',
    'kentucky/pick-4': '23:00',

    'florida/pick-4-midday': '13:30',
    'florida/pick-4-evening': '21:45',

    'new-york/midday-win-4': '14:30',
    'new-york/win-4': '22:30',

    'washington-dc/dc-4-midday': '13:50',
    'washington-dc/dc-4': '19:50',

    'north-carolina/midday-pick-4': '15:00',
    'north-carolina/pick-4': '23:22',

    'virginia/midday-4': '13:59',
    'virginia/pick-4': '23:00',

    'georgia/midday-4': '12:29',
    'georgia/cash-4-evening': '18:59',

    'missouri/midday-pick-4': '12:45',
    'missouri/pick-4': '21:00',

    'indiana/midday-4': '12:59',
    'indiana/daily-4': '22:59',

    'new-jersey/midday-pick-4': '12:59',
    'new-jersey/pick-4': '22:57',

    'california/daily-4': '18:30',

    'arizona/pick-4-midday': '12:05',
    'arizona/pick-4': '19:00',

    'iowa/midday-4': '12:20',
    'iowa/pick-4': '22:00'
};

const JAM_DEFAULT = '13:00';

const SLOT_WIB = {
    'kentucky/midday-pick-4': '00:11',
    'florida/pick-4-midday': '00:21',
    'texas/day-daily-4': '00:30',
    'washington-dc/dc-4-midday': '00:55',
    'virginia/midday-4': '01:00',
    'new-jersey/midday-pick-4': '01:00',
    'new-york/midday-win-4': '01:15',
    'iowa/midday-4': '01:30',
    'north-carolina/midday-pick-4': '01:51',
    'oregon/1-pm-pick-4': '02:51',
    'arizona/pick-4-midday': '03:00',
    'oregon/4-pm-pick-4': '05:51',
    'texas/evening-daily-4': '06:00',
    'washington-dc/dc-4': '07:00',
    'florida/pick-4-evening': '08:35',
    'oregon/7-pm-pick-4': '08:51',
    'arizona/pick-4': '09:00',
    'new-york/win-4': '09:25',
    'kentucky/pick-4': '09:51',
    'virginia/pick-4': '10:00',
    'iowa/pick-4': '10:00',
    'north-carolina/pick-4': '10:12',
    'california/daily-4': '10:13',
    'texas/night-daily-4': '10:15',
    'oregon/10-pm-pick-4': '11:51',
    'texas/morning-daily-4': '22:00'
};

// Seluruh sumber tercepat US langsung dari config.js kamu
const US_SUMBER_TERCEPAT = {
    'kentucky/midday-pick-4': {
        url: 'https://togel-online.cc/livedraw/kentucky%20mid',
        selector: 'p.text-gold'
    },
    'florida/pick-4-midday': {
        url: 'https://togel-online.cc/livedraw/florida%20mid',
        selector: 'p.text-gold'
    },
    'washington-dc/dc-4-midday': {
        url: 'https://dclottery.com/games/dc-4',
        selector: '.views-field-data .field-content .ball',
        gabung: true
    },
    'new-york/midday-win-4': {
        url: 'https://togel-online.cc/livedraw/newyork%20mid',
        selector: 'p.text-gold'
    },
    'north-carolina/midday-pick-4': {
        url: 'https://togel-online.cc/livedraw/carolina%20day',
        selector: 'p.text-gold'
    },
    'oregon/1-pm-pick-4': {
        url: 'https://togel-online.cc/livedraw/oregon03',
        selector: 'p.text-gold'
    },
    'oregon/4-pm-pick-4': {
        url: 'https://togel-online.cc/livedraw/oregon06',
        selector: 'p.text-gold'
    },
    'washington-dc/dc-4': {
        url: 'https://dclottery.com/games/dc-4',
        selector: '.views-field-data .field-content .ball',
        gabung: true
    },
    'florida/pick-4-evening': {
        url: 'https://togel-online.cc/livedraw/florida%20eve',
        selector: 'p.text-gold'
    },
    'oregon/7-pm-pick-4': {
        url: 'https://togel-online.cc/livedraw/oregon09',
        selector: 'p.text-gold'
    },
    'new-york/win-4': {
        url: 'https://togel-online.cc/livedraw/newyork%20eve',
        selector: 'p.text-gold'
    },
    'kentucky/pick-4': {
        url: 'https://togel-online.cc/livedraw/kentucky%20eve',
        selector: 'p.text-gold'
    },
    'california/daily-4': {
        url: 'https://togel-online.cc/livedraw/california',
        selector: 'p.text-gold'
    },
    'north-carolina/pick-4': {
        url: 'https://togel-online.cc/livedraw/carolina%20eve',
        selector: 'p.text-gold'
    },
    'oregon/10-pm-pick-4': {
        url: 'https://togel-online.cc/livedraw/oregon12',
        selector: 'p.text-gold'
    }
};

function slotWIB(tglUS, tz, slot) {
    const [hh, mm] = slot.split(':').map(Number);

    const mulai = localToDate(
        tglUS.y, tglUS.m, tglUS.d, 0, 0, tz
    );

    const tanggalBerikutnya = new Date(
        Date.UTC(tglUS.y, tglUS.m - 1, tglUS.d + 1)
    );

    const selesai = localToDate(
        tanggalBerikutnya.getUTCFullYear(),
        tanggalBerikutnya.getUTCMonth() + 1,
        tanggalBerikutnya.getUTCDate(),
        0, 0, tz
    );

    const w = partsInTZ(mulai, 'Asia/Jakarta');

    for (let add = 0; add <= 1; add++) {
        const candidate = localToDate(
            w.y, w.m, w.d + add, hh, mm, 'Asia/Jakarta'
        );

        if (candidate >= mulai && candidate < selesai) {
            return candidate;
        }
    }

    return null;
}

// ================= FETCH =================

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
];

function getRandomHeaders() {
    return {
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
    };
}

const diblokCF = data => {
    if (typeof data !== 'string') return true;

    const lower = data.toLowerCase();

    return (
        lower.includes('just a moment...') ||
        lower.includes('attention required') ||
        lower.includes('cf-chl-') ||
        lower.includes('cloudflare ray id')
    );
};

async function ambil(url, options = {}) {
    const headers = options.headers || getRandomHeaders();
    const signal = gabungSignal(options.signal, options.timeoutMs || FETCH_TIMEOUT_MS);

    const data = await fetchDenganFallback(url, {
        headers,
        httpsAgent: getHttpsAgentUntukUrl(url),
        signal,
        isJson: Boolean(options.isJson),
        izinkanApiKey: options.izinkanApiKey !== undefined ? options.izinkanApiKey : true
    });

    if (!options.isJson && diblokCF(data)) {
        throw new Error('Halaman ditolak atau menampilkan challenge Cloudflare.');
    }

    if (typeof data !== 'string' || data.length < (options.isJson ? 2 : 100)) {
        throw new Error('Respons HTML kosong atau terlalu pendek.');
    }

    return data;
}

const inFlightFetch = new Map();

async function fetchWithAntiBlock(targetUrl, options = {}) {
    if (options.signal) {
        return await ambil(targetUrl, options);
    }

    const existing = inFlightFetch.get(targetUrl);

    if (existing) {
        return existing;
    }

    const request = (async () => {
        return await ambil(targetUrl, options);
    })();

    inFlightFetch.set(targetUrl, request);

    try {
        return await request;
    } finally {
        if (inFlightFetch.get(targetUrl) === request) {
            inFlightFetch.delete(targetUrl);
        }
    }
}

// ================= PARSER UNIVERSAL DARI SCRAPER.JS =================

function parseSG4DHistory(jsonData, requestedDate) {
    const drawList = jsonData?.result?.draw4d;
    if (!Array.isArray(drawList) || drawList.length === 0) {
        throw new Error('SG4D History: data draw4d kosong.');
    }

    const draw = drawList.find(item => String(item?.date || '') === String(requestedDate));
    if (!draw) {
        const latestDate = drawList[0]?.date || 'unknown';
        throw new Error(`SG4D Result belum update (Diminta: ${requestedDate}, API: ${latestDate})`);
    }

    const prizeRows = Array.isArray(draw.n) ? draw.n : [];
    if (prizeRows.length === 0) {
        throw new Error('SG4D History: array n kosong.');
    }

    const findPrize = position => {
        const item = prizeRows.find(row => String(row?.p || '').toUpperCase() === position);
        return item?.i != null ? String(item.i) : null;
    };

    const p1 = findPrize('T1');
    const p2 = findPrize('T2');
    const p3 = findPrize('T3');

    if (!p1 || !p2 || !p3) {
        throw new Error('SG4D History: Prize T1/T2/T3 belum lengkap.');
    }

    return { p1, p2, p3, drawDate: draw.date };
}

function ekstrakGambarBola($, selector) {
    let numStr = '';
    $(selector)
        .first()
        .find('img')
        .each((_, el) => {
            const src = $(el).attr('src');
            if (src) {
                const match = src.match(/_(\d)\.jpg/i);
                if (match) numStr += match[1];
            }
        });
    return numStr;
}

function ekstrakSelectorHtml($, selector, src) {
    const isImageBallWeb =
        Boolean(src.gambar) ||
        (src.url && (src.url.includes('magnumcambodia.com') || src.url.includes('sydneypoolstoday.com')));

    if (isImageBallWeb) {
        return ekstrakGambarBola($, selector);
    }

    if (src.gabung) {
        return $(selector)
            .map((_, el) => $(el).text().trim())
            .get()
            .join('');
    }

    return $(selector).first().text().trim();
}

async function ambilDanParseSumber(src, opsi = {}) {
    const {
        signal = null,
        izinkanApiKey = true,
        isMacau = false,
        jamMacau = null,
        digits = 4,
        position = 'LAST'
    } = opsi;

    const signalTerbatas = gabungSignal(signal, FETCH_TIMEOUT_MS);

    let requestBaseUrl = src.url;
    if (src.sourceType === 'sg4d-history') {
        const sep = requestBaseUrl.includes('?') ? '&' : '?';
        requestBaseUrl = `${requestBaseUrl}${sep}d=${getWIBDateString()}`;
    }

    const url =
        requestBaseUrl +
        (requestBaseUrl.includes('?') ? '&' : '?') +
        '_=' +
        Date.now();

    const isHijau = Boolean(src.hijau) || src.url.includes('livedrawhijau.org');

    const headers = {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': src.url,
        'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/json',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        ...(isHijau
            ? {
                'X-Requested-With': 'XMLHttpRequest',
                'Referer':
                    'https://livedrawhijau.org/' +
                    new URL(src.url).pathname.split('/')[1] +
                    '/'
            }
            : {})
    };

    const data = await fetchDenganFallback(url, {
        headers,
        httpsAgent: getHttpsAgentUntukUrl(url),
        signal: signalTerbatas,
        isJson: isHijau || Boolean(src.isJson),
        izinkanApiKey
    });

    if (!data || typeof data !== 'string') {
        throw new Error('Response kosong.');
    }

    let jsonData = null;
    let textData = data.trim();

    if (textData.startsWith('<')) {
        if (diblokCF(textData)) {
            throw new Error('diblokir Cloudflare');
        }
        const $pre = cheerio.load(textData);
        const inner = $pre('pre').text().trim() || $pre('body').text().trim();
        if (inner.startsWith('{') || inner.startsWith('[')) {
            try {
                jsonData = JSON.parse(inner);
            } catch {}
        }
    } else if (textData.startsWith('{') || textData.startsWith('[')) {
        try {
            jsonData = JSON.parse(textData);
        } catch {}
    }

    const rawDataString = jsonData ? JSON.stringify(jsonData) : data;

    let raw = null;
    let p1_raw = null;
    let p2_raw = null;
    let p3_raw = null;
    let drawDate = null;

    if (jsonData) {
        if (src.sourceType === 'sg4d-history') {
            const parsed = parseSG4DHistory(jsonData, getWIBDateString());
            p1_raw = parsed.p1;
            p2_raw = parsed.p2;
            p3_raw = parsed.p3;
            raw = p1_raw;
            drawDate = parsed.drawDate;
        } else if (
            jsonData.Special_Prize ||
            (jsonData.Grand_Prize && Array.isArray(jsonData.Grand_Prize))
        ) {
            const mainPrize = jsonData.Special_Prize || jsonData.Grand_Prize;
            p1_raw = Array.isArray(mainPrize) ? mainPrize.join('') : String(mainPrize);
            raw = p1_raw;

            if (jsonData.Grand_Prize && jsonData.Special_Prize) {
                p2_raw = Array.isArray(jsonData.Grand_Prize)
                    ? jsonData.Grand_Prize.join('')
                    : String(jsonData.Grand_Prize);
            } else if (jsonData.Second_Prize) {
                p2_raw = Array.isArray(jsonData.Second_Prize)
                    ? jsonData.Second_Prize.join('')
                    : String(jsonData.Second_Prize);
            }

            if (jsonData.Third_Prize) {
                p3_raw = Array.isArray(jsonData.Third_Prize)
                    ? jsonData.Third_Prize.join('')
                    : String(jsonData.Third_Prize);
            }

            drawDate = jsonData.draw_date || jsonData.date || jsonData.tanggal || null;
        } else if (jsonData.p1) {
            p1_raw = String(jsonData.p1);
            raw = p1_raw;
            if (jsonData.p2) p2_raw = String(jsonData.p2);
            if (jsonData.p3) p3_raw = String(jsonData.p3);
            drawDate = jsonData.date || jsonData.tanggal || null;
        } else if (jsonData.result) {
            p1_raw = String(jsonData.result);
            raw = p1_raw;
            drawDate = jsonData.date || jsonData.tanggal || null;
        } else if (jsonData.data && jsonData.data.first_place) {
            p1_raw = String(jsonData.data.first_place).replace(/,/g, '');
            raw = p1_raw;
            if (jsonData.data.second_place) {
                p2_raw = String(jsonData.data.second_place).replace(/,/g, '');
            }
            if (jsonData.data.third_place) {
                p3_raw = String(jsonData.data.third_place).replace(/,/g, '');
            }
            if (jsonData.date) drawDate = jsonData.date;
        } else if (jsonData.hk_1st) {
            p1_raw = String(jsonData.hk_1st);
            raw = p1_raw;
            if (jsonData.hk_2nd) p2_raw = String(jsonData.hk_2nd);
            if (jsonData.hk_3rd) p3_raw = String(jsonData.hk_3rd);
            if (jsonData.hk_date) drawDate = jsonData.hk_date;
        } else if (
            jsonData.success === true &&
            Array.isArray(jsonData.data) &&
            jsonData.data.length > 0 &&
            jsonData.data[0].today_results &&
            jsonData.data[0].today_results.results
        ) {
            const resultsObj = jsonData.data[0].today_results.results;
            const resultKeys = Object.keys(resultsObj);
            if (resultKeys.length > 0) {
                p1_raw = String(resultsObj[resultKeys[0]]);
                raw = p1_raw;
            }
            if (jsonData.data[0].today_results.date) {
                drawDate = jsonData.data[0].today_results.date;
            }
        } else if (jsonData.status === 'sukses' && jsonData.angka_keluar) {
            p1_raw = String(jsonData.angka_keluar);
            raw = p1_raw;
            if (jsonData.tanggal_wib) drawDate = jsonData.tanggal_wib;
        } else if (Array.isArray(jsonData) && jsonData[0]?.prize1) {
            const d = jsonData[0];
            p1_raw = String(d.prize1).replace(/\D/g, '');
            raw = p1_raw;
            if (d.prize2) p2_raw = String(d.prize2).replace(/\D/g, '');
            if (d.prize3) p3_raw = String(d.prize3).replace(/\D/g, '');
            if (d.tanggal) drawDate = d.tanggal;
        } else if (jsonData.status === 'belum_update') {
            throw new Error(jsonData.pesan || 'Belum update.');
        } else {
            throw new Error('Format JSON tidak memiliki key prize yang dikenali.');
        }
    } else {
        if (data.length < 100) {
            throw new Error('respons kosong');
        }
        if (diblokCF(data)) {
            throw new Error('diblokir Cloudflare');
        }

        const $ = cheerio.load(data);

        if (src.prizeSelectors) {
            if (src.prizeSelectors.p1) {
                p1_raw = ekstrakSelectorHtml($, src.prizeSelectors.p1, src);
            }
            if (src.prizeSelectors.p2) {
                p2_raw = ekstrakSelectorHtml($, src.prizeSelectors.p2, src);
            }
            if (src.prizeSelectors.p3) {
                p3_raw = ekstrakSelectorHtml($, src.prizeSelectors.p3, src);
            }
            raw = p1_raw;

            if (src.prizeSelectors.p1 && !String(p1_raw || '').replace(/\D/g, '')) {
                throw new Error('Prize 1 kosong atau selector tidak menemukan data.');
            }
            if (src.prizeSelectors.p2 && !String(p2_raw || '').replace(/\D/g, '')) {
                throw new Error('Prize 2 kosong atau selector tidak menemukan data.');
            }
            if (src.prizeSelectors.p3 && !String(p3_raw || '').replace(/\D/g, '')) {
                throw new Error('Prize 3 kosong atau selector tidak menemukan data.');
            }
        } else {
            if (src.selector) {
                raw = ekstrakSelectorHtml($, src.selector, src);
            }
            if (!raw) {
                raw =
                    $('.resultTable2').text().trim() ||
                    $('.outerbox').text().trim();
            }
            p1_raw = raw;
        }
    }

    if (!raw) {
        throw new Error('Result kosong.');
    }

    // ================= VALIDASI TANGGAL & JAM (SAMA PERSIS SCRAPER.JS) =================
    if (isMacau) {
        let dateVerified = false;

        if (jsonData && jsonData.tanggal_wib) {
            drawDate = String(jsonData.tanggal_wib);
            dateVerified = hasExactWIBDate(drawDate);
        } else {
            const dateMatch = String(rawDataString).match(
                /(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu),?\s+\d{1,2}\s+\w+\.?,?\s+\d{4}/i
            );
            if (dateMatch) {
                drawDate = dateMatch[0];
                dateVerified = hasExactWIBDate(drawDate);
            } else {
                dateVerified = hasExactWIBDate(rawDataString);
            }
        }

        if (!dateVerified) {
            throw new Error(
                `Tanggal Macau tidak cocok untuk WIB hari ini (${drawDate || 'tidak ditemukan'})`
            );
        }

        if (jamMacau && !jsonData && !src.url.includes('livedrawterkini')) {
            const pageText = cheerio
                .load(String(rawDataString))
                .text()
                .replace(/\s+/g, ' ');

            const slot = getMacauSlotValue(pageText, jamMacau);
            const rawLast4 = String(raw).replace(/\D/g, '').slice(-4);

            if (slot && rawLast4 && slot !== rawLast4) {
                throw new Error(`Nomor tidak cocok dengan kolom jadwal ${jamMacau}.`);
            }
        }
    } else if (src.sourceType === 'sg4d-history') {
        if (!drawDate) {
            throw new Error('SG4D History: tanggal draw kosong.');
        }
    } else {
        const cekTeksTanggal = drawDate ? `${drawDate} ${rawDataString}` : rawDataString;
        if (!isDateValid(cekTeksTanggal)) {
            throw new Error('Tanggal belum update.');
        }
    }

    // ================= FORMATTING DIGIT (LAST / FIRST) =================
    const formatDigits = val => {
        if (!val) return null;
        const clean = String(val).replace(/\D/g, '');
        if (!clean) return null;
        return position === 'LAST' ? clean.slice(-digits) : clean.slice(0, digits);
    };

    const result = formatDigits(raw);
    if (!result || result.length !== digits) {
        throw new Error(`Digit tidak sesuai (Dapat: ${result || 'kosong'})`);
    }

    const cp1 = formatDigits(p1_raw) || result;
    const cp2 = formatDigits(p2_raw);
    const cp3 = formatDigits(p3_raw);

    if (src.prizeSelectors?.p1 && (!cp1 || cp1.length !== digits)) {
        throw new Error(`Prize 1 tidak valid (Dapat: ${cp1 || 'kosong'})`);
    }
    if (src.prizeSelectors?.p2 && (!cp2 || cp2.length !== digits)) {
        throw new Error(`Prize 2 tidak valid (Dapat: ${cp2 || 'kosong'})`);
    }
    if (src.prizeSelectors?.p3 && (!cp3 || cp3.length !== digits)) {
        throw new Error(`Prize 3 tidak valid (Dapat: ${cp3 || 'kosong'})`);
    }

    return {
        p1: cp1,
        p2: cp2,
        p3: cp3,
        drawDate,
        sumber: hostDari(src.url)
    };
}

// ================= SUMBER RESMI FLORIDA =================
const FL_API = 'https://apim-website-prod-eastus.azure-api.net/drawgamesapp/getLatestDrawGames';

const FL_TIPE = {
    'florida/pick-4-midday': 'MIDDAY',
    'florida/pick-4-evening': 'EVENING'
};

async function ambilFloridaResmi(kunci) {
    const respons = await axios.get(FL_API, {
        headers: {
            ...getRandomHeaders(),
            'Accept': 'application/json',
            'x-partner': 'web',
            'Origin': 'https://floridalottery.com',
            'Referer': 'https://floridalottery.com/'
        },
        httpsAgent: httpsAgentAman,
        timeout: FETCH_TIMEOUT_MS
    });

    const list = Array.isArray(respons.data)
        ? respons.data
        : JSON.parse(respons.data);

    const hasil = list
        .filter(x => x.Id === 108 && x.DrawType === FL_TIPE[kunci])
        .map(x => {
            const m = String(x.DrawDate).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);

            if (!m) return null;

            const angka = ['wn1', 'wn2', 'wn3', 'wn4'].map(k =>
                (x.DrawNumbers.find(n => n.NumberType === k) || {}).NumberPick
            );

            return {
                tgl: { y: Number(m[3]), m: Number(m[1]), d: Number(m[2]) },
                angka
            };
        })
        .filter(x => x && x.angka.every(Number.isInteger))
        .sort((a, b) => iso(b.tgl).localeCompare(iso(a.tgl)));

    return hasil[0] || null;
}

// ================= SUMBER RESMI NEW YORK =================
const NY_INTERNAL_API = 'https://nylottery.ny.gov/nyl-api/games/all/draws';

const NY_TIPE_INTERNAL = {
    'new-york/midday-win-4': 1,
    'new-york/win-4': 2
};

async function ambilNewYorkResmi(kunci) {
    const periodTarget = NY_TIPE_INTERNAL[kunci];
    if (!periodTarget) return null;

    const respons = await axios.get(NY_INTERNAL_API, {
        headers: getRandomHeaders(),
        httpsAgent: httpsAgentAman,
        timeout: FETCH_TIMEOUT_MS
    });

    const dataRoot = respons.data.data ? respons.data.data : respons.data;

    if (!dataRoot || !dataRoot.win4 || !Array.isArray(dataRoot.win4.draws)) {
        return null;
    }

    const hasil = dataRoot.win4.draws
        .filter(x => x.drawPeriod === periodTarget && x.results && x.results.length > 0)
        .map(x => {
            const tglObj = new Date(x.resultDate);
            const { y, m, d } = partsInTZ(tglObj, 'America/New_York');
            const angkaArray = x.results[0].primary;

            return {
                tgl: { y, m, d },
                angka: angkaArray
            };
        })
        .filter(x => x && x.angka.length === 4)
        .sort((a, b) => iso(b.tgl).localeCompare(iso(a.tgl)));

    return hasil[0] || null;
}

// ================= CACHE HASIL VALID & CACHE SINGKAT BELUM UPDATE =================

const okCache = new Map();
const OK_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

const belumUpdateCache = new Map();
const BELUM_UPDATE_TTL_MS = 2500;

function getCache(key) {
    const item = okCache.get(key);

    if (!item) return null;

    if (Date.now() - item.t >= OK_TTL_MS) {
        okCache.delete(key);
        return null;
    }

    return item.v;
}

function setCache(key, value) {
    belumUpdateCache.delete(key);

    for (const [cacheKey, item] of okCache.entries()) {
        if (Date.now() - item.t >= OK_TTL_MS) {
            okCache.delete(cacheKey);
        }
    }

    while (
        !okCache.has(key) &&
        okCache.size >= CACHE_MAX_ENTRIES
    ) {
        const oldestKey = okCache.keys().next().value;

        if (oldestKey === undefined) break;

        okCache.delete(oldestKey);
    }

    okCache.delete(key);

    okCache.set(key, {
        t: Date.now(),
        v: value
    });
}

function getBelumUpdateCache(key) {
    const item = belumUpdateCache.get(key);
    if (!item) return null;
    if (Date.now() - item.t >= BELUM_UPDATE_TTL_MS) {
        belumUpdateCache.delete(key);
        return null;
    }
    return item.v;
}

function setBelumUpdateCache(key, value) {
    belumUpdateCache.set(key, {
        t: Date.now(),
        v: value
    });
}

function bentukRespons(full, debug) {
    if (debug) return full;

    const {
        status,
        pasaran,
        tanggal_wib,
        angka_keluar,
        p1,
        p2,
        p3
    } = full;

    if (p1 !== undefined) {
        return { status, pasaran, tanggal_wib, p1, p2, p3 };
    }

    return { status, pasaran, tanggal_wib, angka_keluar };
}

// ================= HELPER PARSER LOTTERYUSA =================
function isFireball($, element) {
    const cls = ($(element).attr('class') || '').toLowerCase();

    return (
        cls.includes('fire') ||
        $(element).closest('[class*="fire"]').length > 0
    );
}

function ambilAngka($, wadah) {
    const angka = [];

    wadah.find('[class*="ball"]').each((i, element) => {
        if (isFireball($, element)) return;

        const teks = $(element).text().trim();

        if (/^\d$/.test(teks)) {
            angka.push(teks);
        }
    });

    return angka;
}

function cariWadahAngka($, bolaPertama) {
    let wadah = bolaPertama.parent();

    for (let i = 0; i < 8 && wadah.length; i++) {
        const angka = ambilAngka($, wadah);

        if (angka.length >= 4) {
            return wadah;
        }

        wadah = wadah.parent();
    }

    return bolaPertama.parent();
}

function cariTanggalRaw($, mulai) {
    let wadah = mulai;

    for (let i = 0; i < 8 && wadah.length; i++) {
        const elemenTanggal = wadah.find(
            'time, [class*="date"]'
        ).first();

        if (elemenTanggal.length) {
            const datetime = (
                elemenTanggal.attr('datetime') || ''
            ).trim();

            const teks = elemenTanggal.text().trim();
            const raw = datetime || teks;

            if (raw) return raw;
        }

        wadah = wadah.parent();
    }

    return '';
}

// ================= HELPER HK POOLS =================
const HKPOOLS_URL = 'https://hkpools1.com/';

const HKPOOLS_LABEL = {
    day: 'HONGKONG DAY',
    night: 'HONGKONG NIGHT'
};

const BULAN_INGGRIS = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];

function formatTanggalHkPools(tanggal) {
    if (!tanggal) return null;

    const match = String(tanggal).match(
        /^(\d{1,2})-(\d{1,2})-(\d{4})$/
    );

    if (!match) return null;

    const hari = Number(match[1]);
    const bulan = Number(match[2]);
    const tahun = Number(match[3]);

    const date = new Date(Date.UTC(tahun, bulan - 1, hari));

    if (
        date.getUTCFullYear() !== tahun ||
        date.getUTCMonth() !== bulan - 1 ||
        date.getUTCDate() !== hari
    ) {
        return null;
    }

    return `${String(hari).padStart(2, '0')} ${BULAN_INGGRIS[bulan - 1]} ${tahun}`;
}

function cariBagianHkPools($, market) {
    const namaTarget = market === 'day'
        ? 'HKPOOLS DAY'
        : 'HKPOOLS NIGHT';

    const kolom = $('.col-md-6').filter(function () {
        const teks = $(this)
            .text()
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();

        return (
            teks.includes(namaTarget) &&
            /DRAW\s*DATE/i.test(teks) &&
            /1ST\s*PRIZE/i.test(teks) &&
            /2ND\s*PRIZE/i.test(teks) &&
            /3RD\s*PRIZE/i.test(teks)
        );
    }).first();

    if (kolom.length) return kolom;

    let judul = null;

    $('b').each((_, el) => {
        const teks = $(el)
            .text()
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();

        if (teks === namaTarget) {
            judul = $(el);
            return false;
        }
    });

    if (!judul || !judul.length) return null;

    let parent = judul.parent();

    for (let i = 0; i < 10 && parent.length; i++) {
        const teks = parent.text().replace(/\s+/g, ' ');

        if (
            /DRAW\s*DATE/i.test(teks) &&
            /1ST\s*PRIZE/i.test(teks) &&
            /2ND\s*PRIZE/i.test(teks) &&
            /3RD\s*PRIZE/i.test(teks)
        ) {
            return parent;
        }

        parent = parent.parent();
    }

    return null;
}

function ambilTanggalHkPools($, bagian) {
    const teks = bagian.text().replace(/\s+/g, ' ').trim();

    const match = teks.match(
        /DRAW\s*DATE\s*:?\s*(\d{1,2}-\d{1,2}-\d{4})/i
    );

    return match ? match[1] : null;
}

function ambilNomorEnamDigitHkPools($, row) {
    const bola = row.find(
        'span.ball-1, span.ball-2, span.ball-3'
    );

    if (bola.length === 6) {
        let nomor = '';
        let valid = true;

        bola.each((_, el) => {
            const digit = $(el).text().trim();

            if (!/^\d$/.test(digit)) {
                valid = false;
                return false;
            }

            nomor += digit;
        });

        if (valid && /^\d{6}$/.test(nomor)) {
            return nomor;
        }

        return null;
    }

    const teks = row.find('td').last().text().replace(/\s+/g, ' ').trim();
    const digit = teks.replace(/\D/g, '');

    return /^\d{6}$/.test(digit) ? digit : null;
}

function ambilHadiahHkPools($, bagian, label) {
    let hasil = null;

    bagian.find('tr').each((_, el) => {
        if (hasil !== null) return false;

        const row = $(el);

        const labelTeks = row.find('td').first()
            .text()
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();

        if (labelTeks !== label.toUpperCase()) return;

        const nomor = ambilNomorEnamDigitHkPools($, row);

        if (nomor && /^\d{6}$/.test(nomor)) {
            hasil = nomor.slice(-4);
            return false;
        }
    });

    return hasil;
}

function parseHkPools(html, market) {
    const $ = cheerio.load(html);

    const bagian = cariBagianHkPools($, market);

    if (!bagian || !bagian.length) {
        throw new Error(
            `Bagian ${HKPOOLS_LABEL[market]} tidak ditemukan pada HTML sumber.`
        );
    }

    const tanggalRaw = ambilTanggalHkPools($, bagian);
    const tanggalWib = formatTanggalHkPools(tanggalRaw);

    const p1 = ambilHadiahHkPools($, bagian, '1ST PRIZE');
    const p2 = ambilHadiahHkPools($, bagian, '2ND PRIZE');
    const p3 = ambilHadiahHkPools($, bagian, '3RD PRIZE');

    return {
        status: 'sukses',
        pasaran: HKPOOLS_LABEL[market],
        tanggal_wib: tanggalWib,
        p1,
        p2,
        p3
    };
}

// ================= NEW ZEALAND BULLSEYE (BALAPAN TERCEPAT: TOGEL-ONLINE.CC + MYLOTTO.CO.NZ) =================

const BULLSEYE_API =
    'https://pathway.mylotto.co.nz/api/results/v1/results/bullseye';

const BULLSEYE_TZ = 'Pacific/Auckland';

function getBullseyeHeaders() {
    return {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': USER_AGENTS[
            Math.floor(Math.random() * USER_AGENTS.length)
        ],
        'Origin': 'https://mylotto.co.nz',
        'Referer': 'https://mylotto.co.nz/',
        'LNZ-CHANNEL': 'web',
        'LNZ-APPLICATION-VERSION': '39.0.0',
        'LNZ-REQUEST-ID': randomUUID()
    };
}

function validasiBullseye(drawDate, drawTime, waktuUndian) {
    if (!tanggalValid(drawDate)) {
        throw new Error('Tanggal undian Bullseye tidak valid.');
    }

    if (!(waktuUndian instanceof Date) || isNaN(waktuUndian.getTime())) {
        throw new Error('Waktu undian Bullseye tidak valid.');
    }

    const match = /^(\d{1,2}):(\d{2})$/.exec(drawTime);

    if (!match) {
        throw new Error('Format waktu undian Bullseye tidak dikenali.');
    }

    const jam = Number(match[1]);
    const menit = Number(match[2]);
    const totalMenit = jam * 60 + menit;

    if (jam > 23 || menit > 59) {
        throw new Error('Jam undian Bullseye tidak valid.');
    }

    if (
        totalMenit < 17 * 60 + 55 ||
        totalMenit > 18 * 60 + 15
    ) {
        throw new Error(
            'Waktu undian tidak sesuai jadwal Bullseye.'
        );
    }

    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: BULLSEYE_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    });

    const parts = Object.fromEntries(
        formatter.formatToParts(new Date()).map(p => [
            p.type,
            p.value
        ])
    );

    const sekarangMenit =
        Number(parts.hour) * 60 + Number(parts.minute);

    const tanggalSekarang =
        `${parts.year}-${parts.month}-${parts.day}`;

    const hariIni = new Date(Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day)
    ));

    const kemarin = new Date(hariIni);
    kemarin.setUTCDate(kemarin.getUTCDate() - 1);

    const tanggalKemarin = [
        kemarin.getUTCFullYear(),
        String(kemarin.getUTCMonth() + 1).padStart(2, '0'),
        String(kemarin.getUTCDate()).padStart(2, '0')
    ].join('-');

    if (sekarangMenit < 18 * 60) {
        if (drawDate !== tanggalKemarin) {
            throw new Error(
                'Tanggal hasil Bullseye tidak sesuai jadwal.'
            );
        }
    } else if (sekarangMenit > 18 * 60 + 15) {
        if (drawDate !== tanggalSekarang) {
            throw new Error(
                'Hasil Bullseye masih menggunakan tanggal lama.'
            );
        }
    } else {
        if (
            drawDate !== tanggalSekarang &&
            drawDate !== tanggalKemarin
        ) {
            throw new Error(
                'Tanggal hasil Bullseye tidak valid.'
            );
        }
    }

    if (waktuUndian.getTime() > Date.now() + 5 * 60 * 1000) {
        throw new Error(
            'Waktu undian Bullseye berada di masa depan.'
        );
    }

    return true;
}

async function ambilBullseyeResmi(signal) {
    const response = await axios.get(BULLSEYE_API, {
        headers: getBullseyeHeaders(),
        httpsAgent: httpsAgentAman,
        timeout: FETCH_TIMEOUT_MS,
        signal,
        params: {
            _: Date.now()
        }
    });

    const raw = response.data;

    if (!raw || typeof raw !== 'object') {
        throw new Error('Respons Bullseye bukan JSON yang valid.');
    }

    const angkaEnamDigit = String(
        raw.bullseyeWinningNumbers?.numbers ?? ''
    );

    if (!/^\d{6}$/.test(angkaEnamDigit)) {
        throw new Error('Angka Bullseye tidak ditemukan atau bukan enam digit.');
    }

    const drawDate = String(raw.drawDate || '');
    const drawTime = String(raw.drawTime || '');

    const tanggalMatch = drawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const waktuMatch = drawTime.match(/^(\d{1,2}):(\d{2})$/);

    if (!tanggalMatch || !waktuMatch) {
        throw new Error('Format tanggal atau waktu undian Bullseye tidak dikenali.');
    }

    const tahun = Number(tanggalMatch[1]);
    const bulan = Number(tanggalMatch[2]);
    const hari = Number(tanggalMatch[3]);
    const jam = Number(waktuMatch[1]);
    const menit = Number(waktuMatch[2]);

    const tanggalISO =
        `${tahun}-${String(bulan).padStart(2, '0')}-${String(hari).padStart(2, '0')}`;

    if (!tanggalValid(tanggalISO)) {
        throw new Error('Tanggal kalender Bullseye tidak valid.');
    }

    if (jam > 23 || menit > 59) {
        throw new Error('Jam undian Bullseye tidak valid.');
    }

    const waktuUndian = localToDate(
        tahun,
        bulan,
        hari,
        jam,
        menit,
        BULLSEYE_TZ
    );

    validasiBullseye(tanggalISO, drawTime, waktuUndian);

    return {
        status: 'sukses',
        pasaran: 'NEW ZEALAND BULLSEYE',
        tanggal_wib: getTanggalWIB(waktuUndian),
        waktu_undian_wib: jamWIB(waktuUndian),
        tanggal_undian_nz: tanggalISO,
        zona_undian: BULLSEYE_TZ,
        draw_number: raw.drawNumber ?? null,
        sumber: 'mylotto.co.nz',
        angka_keluar: angkaEnamDigit.slice(-4)
    };
}

async function ambilBullseye() {
    const isoWib = iso(partsInTZ(new Date(), 'Asia/Jakarta'));
    const cacheKey = `bullseye_${isoWib}`;

    const hit = getCache(cacheKey);
    if (hit) return hit;

    const hitBelum = getBelumUpdateCache(cacheKey);
    if (hitBelum) {
        throw new Error(hitBelum.pesan);
    }

    const ctrl = new AbortController();

    try {
        const menang = await Promise.any([
            // Jalur 1: Sumber tercepat di config.js kamu
            ambilDanParseSumber(
                { url: 'https://togel-online.cc/livedraw/bullseye', selector: 'p.text-gold' },
                { signal: ctrl.signal, izinkanApiKey: true }
            ).then(res => ({
                status: 'sukses',
                pasaran: 'NEW ZEALAND BULLSEYE',
                tanggal_wib: getTanggalWIB(),
                waktu_undian_wib: '13:05 WIB',
                sumber: res.sumber,
                angka_keluar: res.p1
            })),
            // Jalur 2: API resmi mylotto.co.nz
            ambilBullseyeResmi(ctrl.signal)
        ]);

        ctrl.abort();
        setCache(cacheKey, menang);
        return menang;
    } catch (aggErr) {
        ctrl.abort();
        const pesan = aggErr?.errors?.map(e => e.message).join(' | ') || 'Belum update.';
        setBelumUpdateCache(cacheKey, { pesan });
        throw new Error(pesan);
    }
}

// ================= DASHBOARD =================
app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

    const waktuWIB = dapatkanWaktuWIB();

    const html = `
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard API Live Draw USA & Macau</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #121212; color: #ffffff; margin: 0; padding: 20px; }
            .container { max-width: 1000px; margin: 0 auto; }
            h1 { color: #00e676; text-align: center; margin-bottom: 5px; }
            .waktu { text-align: center; color: #aaaaaa; margin-bottom: 30px; font-size: 1.1em; background: #1e1e1e; padding: 10px; border-radius: 8px; border: 1px solid #333;}
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; }
            .market-card { background: #1e1e1e; padding: 15px; border-radius: 8px; border-left: 5px solid #03a9f4; }
            .market-card h2 { margin-top: 0; color: #03a9f4; font-size: 1.2em; border-bottom: 1px solid #333; padding-bottom: 10px; }
            a { display: block; color: #ff9800; text-decoration: none; font-weight: bold; background: #2c2c2c; padding: 12px; margin-bottom: 10px; border-radius: 5px; text-align: center; transition: 0.3s;}
            a:hover { background: #ff9800; color: #121212; }
            .btn-utama { background: #d32f2f; border-left: 5px solid #d32f2f; }
            .btn-utama a { color: white; background: #b71c1c; }
            .btn-utama a:hover { background: #ff5252; }
            .macau-card { border-left-color: #e91e63; }
            .macau-card h2 { color: #e91e63; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Server API Live Draw USA & Macau</h1>
            <div class="waktu">Waktu Server: <strong>${waktuWIB}</strong></div>
            <div class="market-card btn-utama" style="margin-bottom: 20px;">
                <h2 style="color:white;">🌐 Pasaran Nasional</h2>
                <a href="/api/markets" target="_blank">Lihat Semua Pasaran Utama (Powerball, dll)</a>
            </div>
            <div class="grid">
                <div class="market-card macau-card">
                    <h2>🇲🇴 Toto Macau (4D)</h2>
                    <a href="/api/result/macau/1300" target="_blank">Putaran 13:00</a>
                    <a href="/api/result/macau/1600" target="_blank">Putaran 16:00</a>
                    <a href="/api/result/macau/1900" target="_blank">Putaran 19:00</a>
                    <a href="/api/result/macau/2200" target="_blank">Putaran 22:00</a>
                    <a href="/api/result/macau/2300" target="_blank">Putaran 23:00</a>
                    <a href="/api/result/macau/0000" target="_blank">Putaran 00:00</a>
                </div>

                <div class="market-card macau-card">
                    <h2>🇭🇰 HK Pools</h2>
                    <a href="/api/result/hk-pools/day" target="_blank">Hongkong Day</a>
                    <a href="/api/result/hk-pools/night" target="_blank">Hongkong Night</a>
                </div>
                <div class="market-card">
                    <h2>🇳🇿 Bullseye</h2>
                    <a href="/api/result/bullseye" target="_blank">Bullseye</a>
                </div>
                <div class="market-card">
                    <h2>🇹🇼 Taiwan</h2>
                    <a href="/api/result/taiwan" target="_blank">Taiwan</a>
                </div>
                <div class="market-card">
                    <h2>⭐ Texas</h2>
                    <a href="/api/result/texas/morning-daily-4" target="_blank">Morning Daily 4</a>
                    <a href="/api/result/texas/day-daily-4" target="_blank">Day Daily 4</a>
                    <a href="/api/result/texas/evening-daily-4" target="_blank">Evening Daily 4</a>
                    <a href="/api/result/texas/night-daily-4" target="_blank">Night Daily 4</a>
                </div>
                <div class="market-card">
                    <h2>🌲 Oregon</h2>
                    <a href="/api/result/oregon/1-pm-pick-4" target="_blank">Oregon 3 (1 PM)</a>
                    <a href="/api/result/oregon/4-pm-pick-4" target="_blank">Oregon 6 (4 PM)</a>
                    <a href="/api/result/oregon/7-pm-pick-4" target="_blank">Oregon 9 (7 PM)</a>
                    <a href="/api/result/oregon/10-pm-pick-4" target="_blank">Oregon 12 (10 PM)</a>
                </div>
                <div class="market-card">
                    <h2>🍗 Kentucky</h2>
                    <a href="/api/result/kentucky/midday-pick-4" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/kentucky/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🍊 Florida</h2>
                    <a href="/api/result/florida/pick-4-midday" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/florida/pick-4-evening" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🗽 New York</h2>
                    <a href="/api/result/new-york/midday-win-4" target="_blank">Midday Win 4</a>
                    <a href="/api/result/new-york/win-4" target="_blank">Win 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🏛️ Washington DC</h2>
                    <a href="/api/result/washington-dc/dc-4-midday" target="_blank">DC-4 Midday</a>
                    <a href="/api/result/washington-dc/dc-4" target="_blank">DC-4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🌲 North Carolina</h2>
                    <a href="/api/result/north-carolina/midday-pick-4" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/north-carolina/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🦅 Virginia</h2>
                    <a href="/api/result/virginia/midday-4" target="_blank">Midday 4</a>
                    <a href="/api/result/virginia/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🍑 Georgia</h2>
                    <a href="/api/result/georgia/midday-4" target="_blank">Midday 4</a>
                    <a href="/api/result/georgia/cash-4-evening" target="_blank">Cash 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🐻 Missouri</h2>
                    <a href="/api/result/missouri/midday-pick-4" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/missouri/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🏎️ Indiana & NJ</h2>
                    <a href="/api/result/indiana/midday-4" target="_blank">IN Midday 4</a>
                    <a href="/api/result/indiana/daily-4" target="_blank">IN Daily 4</a>
                    <a href="/api/result/new-jersey/midday-pick-4" target="_blank">NJ Midday Pick 4</a>
                    <a href="/api/result/new-jersey/pick-4" target="_blank">NJ Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🏖️ California</h2>
                    <a href="/api/result/california/daily-4" target="_blank">Daily 4</a>
                </div>
                <div class="market-card">
                    <h2>🌵 Arizona</h2>
                    <a href="/api/result/arizona/pick-4-midday" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/arizona/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🌽 Iowa</h2>
                    <a href="/api/result/iowa/midday-4" target="_blank">Midday 4</a>
                    <a href="/api/result/iowa/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🌏 Pasaran Tambahan</h2>
                    <a href="/api/result/hk" target="_blank">Hongkong</a>
                    <a href="/api/result/hk-lotto" target="_blank">Hongkong Lotto</a>
                    <a href="/api/result/sgp4d" target="_blank">Singapore 4D</a>
                    <a href="/api/result/sgp-toto" target="_blank">Singapore Toto</a>
                    <a href="/api/result/sydney" target="_blank">Sydney Pools</a>
                    <a href="/api/result/sydney-lotto" target="_blank">Sydney Lotto</a>
                    <a href="/api/result/china" target="_blank">Cina</a>
                    <a href="/api/result/japan" target="_blank">Japan</a>
                    <a href="/api/result/cambodia" target="_blank">Cambodia</a>
                    <a href="/api/result/magnum4d" target="_blank">Magnum 4D</a>
                    <a href="/api/result/pcso" target="_blank">PCSO</a>
                    <a href="/api/result/taipei" target="_blank">Taipei</a>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;

    res.send(html);
});

// ================= TOTO MACAU (HANYA SUMBER TERCEPAT DI LOG) =================
const MACAU_SUMBER_TERCEPAT = {
    '00:00': [
        { url: 'https://livedrawmacau.sbs/ldmacau.php', selector: 'table.satu tr:nth-child(3) td.warnaisi' },
        { url: 'https://68.183.227.182/live-draw-togel/totomacau-live.php', selector: 'table:nth-of-type(2) tbody tr:nth-child(3) td:nth-child(1)' }
    ],
    '13:00': [
        { url: 'https://livedrawmacau.sbs/ldmacau.php', selector: 'table.satu tr:nth-child(4) td.warnaisi' },
        { url: 'https://68.183.227.182/live-draw-togel/totomacau-live.php', selector: 'table:nth-of-type(2) tbody tr:nth-child(3) td:nth-child(2)' }
    ],
    '16:00': [
        { url: 'https://livedrawmacau.sbs/ldmacau.php', selector: 'table.satu tr:nth-child(5) td.warnaisi' },
        { url: 'https://68.183.227.182/live-draw-togel/totomacau-live.php', selector: 'table:nth-of-type(2) tbody tr:nth-child(3) td:nth-child(3)' }
    ],
    '19:00': [
        { url: 'https://livedrawmacau.sbs/ldmacau.php', selector: 'table.satu tr:nth-child(6) td.warnaisi' },
        { url: 'https://68.183.227.182/live-draw-togel/totomacau-live.php', selector: 'table:nth-of-type(2) tbody tr:nth-child(3) td:nth-child(4)' }
    ],
    '22:00': [
        { url: 'https://livedrawmacau.sbs/ldmacau.php', selector: 'table.satu tr:nth-child(7) td.warnaisi' },
        { url: 'https://68.183.227.182/live-draw-togel/totomacau-live.php', selector: 'table:nth-of-type(2) tbody tr:nth-child(3) td:nth-child(5)' }
    ],
    '23:00': [
        { url: 'https://livedrawmacau.sbs/ldmacau.php', selector: 'table.satu tr:nth-child(8) td.warnaisi' },
        { url: 'https://68.183.227.182/live-draw-togel/totomacau-live.php', selector: 'table:nth-of-type(2) tbody tr:nth-child(3) td:nth-child(6)' }
    ]
};

function formatTanggalWibLengkap() {
    const { y, m, d } = partsInTZ(new Date(), 'Asia/Jakarta');
    return `${d} ${BULAN_INGGRIS[m - 1]} ${y}`;
}

async function prosesMacau(targetJam) {
    const wibHariIni = partsInTZ(new Date(), 'Asia/Jakarta');
    const isoWib = iso(wibHariIni);
    const cacheKey = `macau_${targetJam}_${isoWib}`;

    const hit = getCache(cacheKey);
    if (hit) return { dariCache: true, data: hit };

    const hitBelum = getBelumUpdateCache(cacheKey);
    if (hitBelum) return { dariCache: true, data: hitBelum };

    const sumberList = MACAU_SUMBER_TERCEPAT[targetJam] || [];
    const ctrl = new AbortController();
    const galat = [];

    const jalankanBalapan = async (izinkanApiKey) => {
        const tugas = sumberList.map(src =>
            ambilDanParseSumber(src, {
                signal: ctrl.signal,
                izinkanApiKey,
                isMacau: true,
                jamMacau: targetJam
            })
                .then(res => ({
                    status: 'sukses',
                    pasaran: `TOTO MACAU ${targetJam} WIB`,
                    tanggal_wib: res.drawDate || formatTanggalWibLengkap(),
                    waktu_undian_wib: `${targetJam} WIB`,
                    angka_keluar: res.p1,
                    sumber: res.sumber
                }))
                .catch(err => {
                    galat.push(`${hostDari(src.url)}: ${err.message}`);
                    throw err;
                })
        );

        return await Promise.any(tugas);
    };

    try {
        let menang;
        try {
            menang = await jalankanBalapan(false);
            ctrl.abort();
        } catch (firstErr) {
            ctrl.abort();
            const adaBlokir = galat.some(g => /403|407|429|503|cloudflare|ditolak/i.test(g));
            if (!adaBlokir) throw firstErr;

            const ctrl2 = new AbortController();
            try {
                menang = await Promise.any(
                    sumberList.map(src =>
                        ambilDanParseSumber(src, {
                            signal: ctrl2.signal,
                            izinkanApiKey: true,
                            isMacau: true,
                            jamMacau: targetJam
                        }).then(res => ({
                            status: 'sukses',
                            pasaran: `TOTO MACAU ${targetJam} WIB`,
                            tanggal_wib: res.drawDate || formatTanggalWibLengkap(),
                            waktu_undian_wib: `${targetJam} WIB`,
                            angka_keluar: res.p1,
                            sumber: res.sumber
                        }))
                    )
                );
            } finally {
                ctrl2.abort();
            }
        }

        setCache(cacheKey, menang);
        return { dariCache: false, data: menang };
    } catch (err) {
        const belumPayload = {
            status: 'belum_update',
            pasaran: `TOTO MACAU ${targetJam} WIB`,
            pesan: `Belum update: Data putaran ${targetJam} untuk tanggal ${isoWib} belum tersedia. (${[...new Set(galat)].join(' | ').slice(0, 220)})`,
            detail_galat: galat
        };
        setBelumUpdateCache(cacheKey, belumPayload);
        return { dariCache: false, data: belumPayload };
    }
}

app.get('/api/result/macau/:sesi', async (req, res) => {
    const { sesi } = req.params;
    const debug = req.query.debug === '1';

    let targetJam = '';

    if (/^\d{4}$/.test(sesi)) {
        targetJam = `${sesi.slice(0, 2)}:${sesi.slice(2, 4)}`;
    } else if (/^\d{2}:\d{2}$/.test(sesi)) {
        targetJam = sesi;
    } else {
        return res.status(404).json({
            status: 'error',
            pesan: 'Format sesi salah. Gunakan format: 1300, 1600, 1900, 2200, 2300, atau 0000.'
        });
    }

    const [jamAngka, menitAngka] = targetJam.split(':').map(Number);

    if (jamAngka > 23 || menitAngka > 59) {
        return res.status(404).json({
            status: 'error',
            pesan: 'Jam sesi tidak valid.'
        });
    }

    const hasil = await prosesMacau(targetJam);
    const payload = hasil.data;

    if (payload.status === 'sukses') {
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        if (!debug) {
            const { sumber, detail_galat, ...bersih } = payload;
            return res.json(bersih);
        }
        return res.json(payload);
    }

    const { detail_galat, ...bersihBelum } = payload;
    return res.json(debug ? { ...bersihBelum, detail: detail_galat } : bersihBelum);
});

// ================= ENDPOINT HK POOLS DAY & NIGHT =================
async function prosesHkPools(market) {
    const namaPasaran = HKPOOLS_LABEL[market];
    const cacheKey = `hk-pools-${market}`;

    const hit = getCache(cacheKey);
    if (hit) return { ok: true, data: hit };

    const hitBelum = getBelumUpdateCache(cacheKey);
    if (hitBelum) return { ok: false, data: hitBelum };

    const html = await fetchWithAntiBlock(HKPOOLS_URL, { timeoutMs: FETCH_TIMEOUT_MS });
    const payload = parseHkPools(html, market);

    const hasilLengkap = Boolean(
        payload.tanggal_wib &&
        /^\d{4}$/.test(payload.p1 || '') &&
        /^\d{4}$/.test(payload.p2 || '') &&
        /^\d{4}$/.test(payload.p3 || '')
    );

    if (!hasilLengkap) {
        const belum = {
            status: 'belum_update',
            pasaran: namaPasaran,
            tanggal_wib: payload.tanggal_wib,
            p1: payload.p1,
            p2: payload.p2,
            p3: payload.p3,
            pesan: 'Hasil belum lengkap atau situs masih menampilkan placeholder.'
        };
        setBelumUpdateCache(cacheKey, belum);
        return { ok: false, data: belum, html };
    }

    setCache(cacheKey, payload);
    return { ok: true, data: payload };
}

app.get('/api/result/hk-pools/:market', async (req, res) => {
    const market = String(req.params.market || '').toLowerCase();
    const debug = req.query.debug === '1';

    if (!['day', 'night'].includes(market)) {
        return res.status(404).json({
            status: 'error',
            pesan: 'Market HK Pools tidak dikenal. Gunakan day atau night.'
        });
    }

    const namaPasaran = HKPOOLS_LABEL[market];

    try {
        const hasil = await prosesHkPools(market);

        if (!hasil.ok) {
            return res.status(503).json({
                ...hasil.data,
                ...(debug && hasil.html ? {
                    url: HKPOOLS_URL,
                    market,
                    judul: cheerio.load(hasil.html)('title').text().trim(),
                    panjang_html: hasil.html.length
                } : {})
            });
        }

        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        return res.json(bentukRespons(hasil.data, debug));
    } catch (error) {
        console.error(`[HK POOLS ${market.toUpperCase()}]`, error.message);

        return res.status(502).json({
            status: 'error',
            pasaran: namaPasaran,
            pesan: 'Gagal mengambil atau membaca hasil HK Pools.',
            ...(debug ? {
                detail: error.message,
                url: HKPOOLS_URL,
                waktu: dapatkanWaktuWIB()
            } : {})
        });
    }
});

// ================= HELPER & ENDPOINT HASIL (US) =================
async function prosesUSMarket(state, game) {
    const tz = STATE_TZ[state];
    const targetGame = GAME_ALIAS[`${state}/${game}`] || game;
    const targetState = STATE_SLUG[state] || state;
    const targetUrl = `https://www.lotteryusa.com/${targetState}/${targetGame}/`;
    const wibHariIniStr = iso(partsInTZ(new Date(), 'Asia/Jakarta'));
    const cacheKey = `${state}/${game}/${wibHariIniStr}`;

    const hit = getCache(cacheKey);
    if (hit) return { code: 200, data: hit, targetUrl };

    const hitBelum = getBelumUpdateCache(cacheKey);
    if (hitBelum) return { code: hitBelum.httpCode || 200, data: hitBelum.body, targetUrl };

    const kunciLotre = `${state}/${game}`;
    const slot = SLOT_WIB[kunciLotre];
    const jam = JADWAL[kunciLotre];
    const cepatBot = US_SUMBER_TERCEPAT[kunciLotre];

    // 1. New York: Balapan API resmi nylottery.ny.gov vs togel-online.cc
    if (NY_TIPE_INTERNAL[kunciLotre]) {
        const tugasNY = [
            ambilNewYorkResmi(kunciLotre).then(hasilNY => {
                if (!hasilNY) throw new Error('NY resmi kosong');
                let waktuNY = slot ? slotWIB(hasilNY.tgl, tz, slot) : null;
                if (!waktuNY) {
                    const [hhNY, mmNY] = (jam || JAM_DEFAULT).split(':').map(Number);
                    waktuNY = localToDate(hasilNY.tgl.y, hasilNY.tgl.m, hasilNY.tgl.d, hhNY, mmNY, tz);
                }
                if (iso(partsInTZ(waktuNY, 'Asia/Jakarta')) !== wibHariIniStr) {
                    throw new Error('NY resmi belum update hari ini');
                }
                return {
                    status: 'sukses',
                    pasaran: game === 'midday-win-4' ? 'MIDDAY WIN 4' : 'WIN 4',
                    tanggal_wib: getTanggalWIB(waktuNY),
                    waktu_undian_wib: jamWIB(waktuNY),
                    tanggal_undian_us: iso(hasilNY.tgl),
                    zona_undian: tz,
                    sumber: 'nylottery.ny.gov (API)',
                    angka_keluar: hasilNY.angka.join('')
                };
            })
        ];

        if (cepatBot) {
            tugasNY.push(
                ambilDanParseSumber(cepatBot, { izinkanApiKey: true }).then(resBot => {
                    const nowWib = new Date();
                    return {
                        status: 'sukses',
                        pasaran: game === 'midday-win-4' ? 'MIDDAY WIN 4' : 'WIN 4',
                        tanggal_wib: getTanggalWIB(nowWib),
                        waktu_undian_wib: slot ? `${slot} WIB` : null,
                        tanggal_undian_us: iso(partsInTZ(nowWib, tz)),
                        zona_undian: tz,
                        sumber: resBot.sumber,
                        angka_keluar: resBot.p1
                    };
                })
            );
        }

        try {
            const payloadNY = await Promise.any(tugasNY);
            setCache(cacheKey, payloadNY);
            return { code: 200, data: payloadNY, targetUrl };
        } catch {
            const bodyNY = { status: 'belum_update', pesan: 'Hasil New York belum update hari ini.' };
            setBelumUpdateCache(cacheKey, { httpCode: 200, body: bodyNY });
            return { code: 200, data: bodyNY, targetUrl: NY_INTERNAL_API };
        }
    }

    // 2. Florida: Balapan API resmi floridalottery.com vs togel-online.cc
    if (FL_TIPE[kunciLotre]) {
        const tugasFL = [
            ambilFloridaResmi(kunciLotre).then(hasilFl => {
                if (!hasilFl) throw new Error('FL resmi kosong');
                let waktuFl = slot ? slotWIB(hasilFl.tgl, tz, slot) : null;
                if (!waktuFl) {
                    const [hhFl, mmFl] = (jam || JAM_DEFAULT).split(':').map(Number);
                    waktuFl = localToDate(hasilFl.tgl.y, hasilFl.tgl.m, hasilFl.tgl.d, hhFl, mmFl, tz);
                }
                if (iso(partsInTZ(waktuFl, 'Asia/Jakarta')) !== wibHariIniStr) {
                    throw new Error('FL resmi belum update hari ini');
                }
                return {
                    status: 'sukses',
                    pasaran: game === 'pick-4-midday' ? 'MIDDAY PICK 4' : 'PICK 4',
                    tanggal_wib: getTanggalWIB(waktuFl),
                    waktu_undian_wib: jamWIB(waktuFl),
                    tanggal_undian_us: iso(hasilFl.tgl),
                    zona_undian: tz,
                    sumber: 'floridalottery.com',
                    angka_keluar: hasilFl.angka.join('')
                };
            })
        ];

        if (cepatBot) {
            tugasFL.push(
                ambilDanParseSumber(cepatBot, { izinkanApiKey: true }).then(resBot => {
                    const nowWib = new Date();
                    return {
                        status: 'sukses',
                        pasaran: game === 'pick-4-midday' ? 'MIDDAY PICK 4' : 'PICK 4',
                        tanggal_wib: getTanggalWIB(nowWib),
                        waktu_undian_wib: slot ? `${slot} WIB` : null,
                        tanggal_undian_us: iso(partsInTZ(nowWib, tz)),
                        zona_undian: tz,
                        sumber: resBot.sumber,
                        angka_keluar: resBot.p1
                    };
                })
            );
        }

        try {
            const payloadFl = await Promise.any(tugasFL);
            setCache(cacheKey, payloadFl);
            return { code: 200, data: payloadFl, targetUrl };
        } catch {
            const bodyFl = { status: 'belum_update', pesan: 'Hasil Florida belum update hari ini.' };
            setBelumUpdateCache(cacheKey, { httpCode: 200, body: bodyFl });
            return { code: 200, data: bodyFl, targetUrl: FL_API };
        }
    }

    // 3. Sumber Tercepat dari Config Bot (togel-online.cc / dclottery.com)
    if (cepatBot) {
        try {
            const resBot = await ambilDanParseSumber(cepatBot, { izinkanApiKey: true });
            const nowWib = new Date();
            const payloadBot = {
                status: 'sukses',
                pasaran: `${state} ${game}`.toUpperCase(),
                tanggal_wib: getTanggalWIB(nowWib),
                waktu_undian_wib: slot ? `${slot} WIB` : null,
                tanggal_undian_us: iso(partsInTZ(nowWib, tz)),
                zona_undian: tz,
                sumber: resBot.sumber,
                angka_keluar: resBot.p1
            };
            setCache(cacheKey, payloadBot);
            return { code: 200, data: payloadBot, targetUrl: cepatBot.url };
        } catch (errBot) {
            const bodyBot = { status: 'belum_update', pesan: `Belum update (${errBot.message})` };
            setBelumUpdateCache(cacheKey, { httpCode: 200, body: bodyBot });
            return { code: 200, data: bodyBot, targetUrl: cepatBot.url };
        }
    }

    // 4. LotteryUSA (hanya untuk pasaran yang tidak punya sumber cepat lain: TX, VA, NJ, AZ, IA, GA, MO, IN)
    const html = await fetchWithAntiBlock(targetUrl, { timeoutMs: FETCH_TIMEOUT_MS });
    const $ = cheerio.load(html);

    let namaPasaran = $('h1').first().text()
        .replace(/winning numbers/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase() || `${state} ${game}`.toUpperCase();

    const blok = $('.c-game-components').first().length
        ? $('.c-game-components').first()
        : $('main').first();

    const tzNow = partsInTZ(new Date(), tz);
    const bolaPertama = blok
        .find('[class*="ball"]')
        .filter((i, el) => !isFireball($, el))
        .filter((i, el) => /^\d$/.test($(el).text().trim()))
        .first();

    if (!bolaPertama.length) {
        const body = {
            status: 'belum_update',
            pesan: 'Angka hasil tidak ditemukan pada HTML.',
            debugExtra: { url: targetUrl, judul: $('title').text().trim(), selector: '.c-game-components [class*="ball"]' }
        };
        setBelumUpdateCache(cacheKey, { httpCode: 422, body });
        return { code: 422, data: body, targetUrl };
    }

    const wadahAngka = cariWadahAngka($, bolaPertama);
    let tglRaw = cariTanggalRaw($, wadahAngka) || cariTanggalRaw($, bolaPertama.parent());
    const tglUndian = parseTanggal(tglRaw, tzNow);

    if (!tglUndian) {
        const body = {
            status: 'error',
            pesan: 'Tanggal undian tidak ditemukan atau formatnya tidak dikenali.',
            debugExtra: { detail: (tglRaw || '').slice(0, 200), url: targetUrl, judul: $('title').text().trim() }
        };
        setBelumUpdateCache(cacheKey, { httpCode: 422, body });
        return { code: 422, data: body, targetUrl };
    }

    if (iso(tglUndian) > iso(tzNow)) {
        const body = {
            status: 'belum_update',
            pesan: `Tanggal hasil web ${iso(tglUndian)} lebih baru daripada tanggal lokal ${iso(tzNow)} di ${tz}.`,
            debugExtra: { url: targetUrl, tanggal_web: iso(tglUndian), tanggal_lokal: iso(tzNow) }
        };
        setBelumUpdateCache(cacheKey, { httpCode: 200, body });
        return { code: 200, data: body, targetUrl };
    }

    let waktuUndian = slot ? slotWIB(tglUndian, tz, slot) : null;
    if (!waktuUndian) {
        const [hh, mm] = (jam || JAM_DEFAULT).split(':').map(Number);
        waktuUndian = localToDate(tglUndian.y, tglUndian.m, tglUndian.d, hh, mm, tz);
    }

    const wibUndian = iso(partsInTZ(waktuUndian, 'Asia/Jakarta'));
    if (wibUndian !== wibHariIniStr) {
        const body = {
            status: 'belum_update',
            pesan: `Tanggal hasil WIB (${wibUndian}) berbeda dari tanggal WIB hari ini (${wibHariIniStr}).`,
            debugExtra: {
                url: targetUrl,
                tanggal_undian_us: iso(tglUndian),
                tanggal_undian_wib: wibUndian,
                tanggal_hari_ini_wib: wibHariIniStr,
                slot_wib: slot || null,
                jadwal_lokal: jam || JAM_DEFAULT
            }
        };
        setBelumUpdateCache(cacheKey, { httpCode: 200, body });
        return { code: 200, data: body, targetUrl };
    }

    let angka = ambilAngka($, wadahAngka);
    if (angka.length !== 4) {
        let wadah = wadahAngka.parent();
        for (let i = 0; i < 5 && wadah.length; i++) {
            const kandidat = ambilAngka($, wadah);
            if (kandidat.length >= 4) {
                angka = kandidat.slice(0, 4);
                break;
            }
            wadah = wadah.parent();
        }
    }
    angka = angka.slice(0, 4);

    if (angka.length !== 4) {
        const body = {
            status: 'belum_update',
            pesan: `Angka belum lengkap (${angka.length}/4).`,
            debugExtra: { url: targetUrl, tanggal_dibaca: tglRaw, angka_ditemukan: angka }
        };
        setBelumUpdateCache(cacheKey, { httpCode: 422, body });
        return { code: 422, data: body, targetUrl };
    }

    const payload = {
        status: 'sukses',
        pasaran: namaPasaran,
        tanggal_wib: getTanggalWIB(waktuUndian),
        waktu_undian_wib: (slot || jam) ? jamWIB(waktuUndian) : null,
        tanggal_undian_us: iso(tglUndian),
        zona_undian: tz,
        angka_keluar: angka.join('')
    };

    setCache(cacheKey, payload);
    return { code: 200, data: payload, targetUrl };
}

app.get('/api/result/:state/:game', async (req, res) => {
    const { state, game } = req.params;
    const debug = req.query.debug === '1';

    const tz = STATE_TZ[state];

    if (!tz || !/^[a-z0-9-]+$/.test(game)) {
        return res.status(404).json({
            status: 'error',
            pesan: 'State atau game tidak dikenal.'
        });
    }

    try {
        const hasil = await prosesUSMarket(state, game);
        if (hasil.data.status === 'sukses') {
            res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
            return res.json(bentukRespons(hasil.data, debug));
        }

        const { debugExtra, ...bersih } = hasil.data;
        return res.status(hasil.code).json(debug ? { ...bersih, ...(debugExtra || {}) } : bersih);
    } catch (error) {
        const targetGame = GAME_ALIAS[`${state}/${game}`] || game;
        const targetState = STATE_SLUG[state] || state;
        const targetUrl = `https://www.lotteryusa.com/${targetState}/${targetGame}/`;
        return res.status(502).json({
            status: 'error',
            pesan: 'Gagal mengambil data dari target.',
            detail: error.message,
            ...(debug ? {
                url: targetUrl,
                waktu: dapatkanWaktuWIB()
            } : {})
        });
    }
});

// ================= ENDPOINT NEW ZEALAND BULLSEYE =================

app.get('/api/result/bullseye', async (req, res) => {
    const debug = req.query.debug === '1';

    try {
        const payload = await ambilBullseye();

        res.setHeader(
            'Cache-Control',
            's-maxage=60, stale-while-revalidate'
        );

        return res.json(
            debug
                ? payload
                : {
                    status: payload.status,
                    pasaran: payload.pasaran,
                    tanggal_wib: payload.tanggal_wib,
                    angka_keluar: payload.angka_keluar
                }
        );
    } catch (error) {
        return res.status(502).json({
            status: 'error',
            pasaran: 'NEW ZEALAND BULLSEYE',
            pesan: 'Gagal mengambil hasil New Zealand Bullseye.',
            ...(debug ? {
                detail: error.message,
                waktu: dapatkanWaktuWIB()
            } : {})
        });
    }
});

// ================= TAIWAN (HANYA SUMBER TERCEPAT DI LOG) =================
const TAIWAN_SUMBER_TERCEPAT = [
    { url: 'https://www.pewaristotoprediksi.com/api/market-latest?market=taiwan', isJson: true },
    { url: 'https://159.89.203.33/live-draw/taiwan/proxy_taiwan.php', isJson: true }
];

async function prosesTaiwan() {
    const isoHariIni = iso(partsInTZ(new Date(), 'Asia/Jakarta'));
    const cacheKey = `taiwan_prize1_${isoHariIni}`;

    const hit = getCache(cacheKey);
    if (hit) return hit;

    const hitBelum = getBelumUpdateCache(cacheKey);
    if (hitBelum) return hitBelum;

    const sekarangWIB = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date());

    const menitWIB =
        Number(sekarangWIB.find(p => p.type === 'hour').value) * 60 +
        Number(sekarangWIB.find(p => p.type === 'minute').value);

    if (menitWIB < 20 * 60 + 30) {
        const belum = {
            status: 'belum_update',
            pesan: 'Undian Taiwan belum dimulai (sekitar 20:35 WIB).'
        };
        setBelumUpdateCache(cacheKey, belum);
        return belum;
    }

    const ctrl = new AbortController();
    const tugas = TAIWAN_SUMBER_TERCEPAT.map(src =>
        ambilDanParseSumber(src, { signal: ctrl.signal, izinkanApiKey: true }).then(res => ({
            status: 'sukses',
            pasaran: 'TAIWAN',
            tanggal_wib: getTanggalWIB(),
            angka_keluar: res.p1,
            sumber: res.sumber
        }))
    );

    try {
        const menang = await Promise.any(tugas);
        ctrl.abort();
        setCache(cacheKey, menang);
        return menang;
    } catch (aggErr) {
        ctrl.abort();
        const pesanPertama = aggErr?.errors?.[0]?.message || 'Belum update.';
        const belum = {
            status: 'belum_update',
            pesan: pesanPertama
        };
        setBelumUpdateCache(cacheKey, belum);
        return belum;
    }
}

app.get('/api/result/taiwan', async (req, res) => {
    const debug = req.query.debug === '1';

    try {
        const payload = await prosesTaiwan();

        if (payload.status === 'sukses') {
            res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
            if (!debug) {
                const { sumber, ...bersih } = payload;
                return res.json(bersih);
            }
            return res.json(payload);
        }

        return res.json(payload);
    } catch (error) {
        return res.status(502).json({
            status: 'error',
            pasaran: 'TAIWAN',
            pesan: 'Gagal mengambil hasil Taiwan.',
            ...(debug ? {
                detail: error.message,
                waktu: dapatkanWaktuWIB()
            } : {})
        });
    }
});

// ================= PASARAN UTAMA =================
app.get('/api/markets', async (req, res) => {
    const cacheKey = 'usa_markets';

    const hit = getCache(cacheKey);

    if (hit) {
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        return res.json(hit);
    }

    try {
        const html = await fetchWithAntiBlock('https://www.lotteryusa.com/', { timeoutMs: FETCH_TIMEOUT_MS });
        const $ = cheerio.load(html);
        const markets = [];

        const bukanLotre = [
            'PLAY',
            'Play online',
            'Daily game stats',
            'On this day'
        ];

        $('h3').each((i, element) => {
            const nama = $(element).text().trim();

            if (
                !nama ||
                bukanLotre.includes(nama) ||
                nama.includes('?') ||
                nama.length > 25
            ) {
                return;
            }

            let parent = $(element).parent();
            let angka = [];
            let tanggal = 'Belum diundi';
            let jackpot = 'N/A';

            for (let level = 0; level < 5; level++) {
                parent.find('[class*="ball"]').each((j, b) => {
                    if (isFireball($, b)) return;

                    const t = $(b).text().trim();

                    if (t && t.length <= 3) {
                        angka.push(t);
                    }
                });

                if (angka.length > 0) {
                    const elemenTanggal = parent
                        .find('time, [class*="date"]')
                        .first();

                    tanggal =
                        elemenTanggal.attr('datetime') ||
                        elemenTanggal.text().trim() ||
                        tanggal;

                    parent.find(
                        '[class*="jackpot"], [class*="prize"]'
                    ).each((j, jp) => {
                        const t = $(jp).text().trim();

                        if (t.includes('$')) {
                            jackpot = t.replace(/\s+/g, ' ');
                        }
                    });

                    break;
                }

                parent = parent.parent();
            }

            if (angka.length > 0) {
                markets.push({
                    pasaran: nama,
                    tanggal_undian: tanggal,
                    jackpot,
                    angka_keluar: angka
                });
            }
        });

        const payload = {
            status: 'sukses',
            waktu_update_wib: dapatkanWaktuWIB(),
            total_pasaran: markets.length,
            data: markets
        };

        setCache(cacheKey, payload);

        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        return res.json(payload);
    } catch (error) {
        return res.status(502).json({
            status: 'error',
            pesan: error.message
        });
    }
});

// ==========================================================
// ================= PASARAN TAMBAHAN (HANYA TERCEPAT DI LOG & CONFIG.JS) =================
// ==========================================================

const PASARAN_TAMBAHAN = {
    'hk': {
        nama: 'HONGKONG',
        sumber: [
            { url: 'https://live.angka.live/livedrawhk/' },
            {
                url: 'https://hongkonglivedraw.biz/live-draw-hk/hk.php',
                prizeSelectors: {
                    p1: 'tr:nth-of-type(3) td.box-value',
                    p2: 'tr:nth-of-type(4) td.box-value',
                    p3: 'tr:nth-of-type(5) td.box-value'
                }
            }
        ]
    },

    'hk-lotto': {
        nama: 'HONGKONG LOTTO',
        sumber: [
            { url: 'https://hongkonglotto.com/positionPlace', isJson: true }
        ]
    },

    'sgp4d': {
        nama: 'SINGAPORE 4D',
        sumber: [
            { url: 'https://livedrawhijau.org/singaporepools/update_sgp_pools', hijau: true },
            {
                url: 'https://livedraw.online/singapore/',
                prizeSelectors: {
                    p1: '.result-winner',
                    p2: 'tr:nth-child(2) .result-sub-winner',
                    p3: 'tr:nth-child(3) .result-sub-winner'
                }
            }
        ]
    },

    'sgp-toto': {
        nama: 'SINGAPORE TOTO',
        sumber: [
            {
                url: 'https://livedraw.online/singapore-toto/',
                prizeSelectors: {
                    p1: 'h3 span.text-gold'
                }
            },
            { url: 'https://livedrawhijau.org/singaporetoto/update_sgptoto', hijau: true }
        ]
    },

    'sydney': {
        nama: 'SYDNEY POOLS',
        sumber: [
            {
                url: 'https://livedrawnorthcarolinaday.wiki/livedraw/sydney.php',
                prizeSelectors: {
                    p1: 'tr:nth-child(2) td.warnaisi',
                    p2: 'tr:nth-child(3) td.warnaisi',
                    p3: 'tr:nth-child(4) td.warnaisi'
                }
            },
            {
                url: 'https://www.sydneypoolstoday.com/',
                gambar: true,
                prizeSelectors: {
                    p1: 'table.sample:eq(0) tr:nth-child(1) td:nth-child(2)',
                    p2: 'table.sample:eq(0) tr:nth-child(3) td:nth-child(2)',
                    p3: 'table.sample:eq(0) tr:nth-child(5) td:nth-child(2)'
                }
            }
        ]
    },

    'sydney-lotto': {
        nama: 'SYDNEY LOTTO',
        sumber: [
            { url: 'https://sydneylotto.com/positionPlace', isJson: true }
        ]
    },

    'china': {
        nama: 'CINA',
        sumber: [
            {
                url: 'https://www.chinapools.asia/apps/home-left',
                prizeSelectors: {
                    p1: '#table_home_1 tr:nth-child(1) td.td2_home1',
                    p2: '#table_home_1 tr:nth-child(2) td.td2_home1',
                    p3: '#table_home_1 tr:nth-child(3) td.td2_home1'
                }
            }
        ]
    },

    'magnum4d': {
        nama: 'MAGNUM 4D',
        sumber: [
            { url: 'https://togel-online.cc/livedraw/magnum4d', selector: 'p.text-gold' }
        ]
    },

    'pcso': {
        nama: 'PCSO',
        sumber: [
            { url: 'https://togel-online.cc/livedraw/pcso', selector: 'p.text-gold' }
        ]
    },

    'japan': {
        nama: 'JAPAN',
        sumber: [
            { url: 'https://www.japanpools.online/', selector: '.win-number .circle', gabung: true }
        ]
    },

    'cambodia': {
        nama: 'CAMBODIA',
        sumber: [{
            url: 'https://www.magnumcambodia.com',
            gambar: true,
            prizeSelectors: {
                p1: "table[bordercolor='#EEEEEE'] tr:first-child td:nth-child(1)",
                p2: "table[bordercolor='#EEEEEE'] tr:first-child td:nth-child(2)",
                p3: "table[bordercolor='#EEEEEE'] tr:first-child td:nth-child(3)"
            }
        }]
    },

    'taipei': {
        nama: 'TAIPEI',
        sumber: [
            { url: 'https://togel-online.cc/livedraw/taipei', selector: 'p.text-gold' }
        ]
    }
};

function hostDari(url) {
    try { return new URL(url).hostname; } catch (e) { return url; }
}

async function prosesPasaranTambahan(slug, cfg) {
    const hariIni = iso(partsInTZ(new Date(), 'Asia/Jakarta'));
    const kunciCache = `tambahan_${slug}_${hariIni}`;

    const hit = getCache(kunciCache);
    if (hit) return hit;

    const hitBelum = getBelumUpdateCache(kunciCache);
    if (hitBelum) return hitBelum;

    const ctrl = new AbortController();
    const galat = [];

    try {
        let menang;

        try {
            menang = await Promise.any(
                cfg.sumber.map(src =>
                    ambilDanParseSumber(src, {
                        signal: ctrl.signal,
                        izinkanApiKey: false,
                        digits: cfg.digits || 4,
                        position: cfg.position || 'LAST'
                    }).catch(err => {
                        galat.push(`${hostDari(src.url)}: ${err.message}`);
                        throw err;
                    })
                )
            );

            ctrl.abort();
        } catch (firstErr) {
            ctrl.abort();

            const adaBlokir = galat.some(g =>
                /403|407|429|503|cloudflare|ditolak/i.test(g)
            );

            if (!adaBlokir) {
                throw firstErr;
            }

            const ctrlProxy = new AbortController();
            try {
                menang = await Promise.any(
                    cfg.sumber.map(src =>
                        ambilDanParseSumber(src, {
                            signal: ctrlProxy.signal,
                            izinkanApiKey: true,
                            digits: cfg.digits || 4,
                            position: cfg.position || 'LAST'
                        }).catch(err => {
                            galat.push(`${hostDari(src.url)} (proxy): ${err.message}`);
                            throw err;
                        })
                    )
                );
            } finally {
                ctrlProxy.abort();
            }
        }

        const payload = {
            status: 'sukses',
            pasaran: cfg.nama,
            tanggal_wib: getTanggalWIB(),
            angka_keluar: menang.p1,
            ...(menang.p2 ? { p1: menang.p1, p2: menang.p2, p3: menang.p3 } : {}),
            sumber: menang.sumber
        };

        setCache(kunciCache, payload);
        return payload;
    } catch (err) {
        const belum = {
            status: 'belum_update',
            pasaran: cfg.nama,
            pesan: 'Belum update: ' + [...new Set(galat)].join(' | ').slice(0, 300),
            detail_galat: galat
        };
        setBelumUpdateCache(kunciCache, belum);
        return belum;
    }
}

for (const [slug, cfg] of Object.entries(PASARAN_TAMBAHAN)) {
    app.get(`/api/result/${slug}`, async (req, res) => {
        const debug = req.query.debug === '1';
        const payload = await prosesPasaranTambahan(slug, cfg);

        if (payload.status === 'sukses') {
            res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
            return res.json(bentukResponsTambahan(payload, debug));
        }

        const { detail_galat, ...bersih } = payload;
        return res.json(debug ? { ...bersih, detail: detail_galat } : bersih);
    });
}

function bentukResponsTambahan(full, debug) {
    if (debug) return full;

    const { sumber, detail_galat, ...tanpaSumber } = full;

    return tanpaSumber;
}

// ================= BACKGROUND POLLER OTOMATIS (30 DETIK SEBELUM JAM UNDIAN) =================
const JADWAL_POLLER_WIB = [
    { id: 'macau_0000', jam: '00:01', run: () => prosesMacau('00:00') },
    { id: 'macau_1300', jam: '13:01', run: () => prosesMacau('13:00') },
    { id: 'macau_1600', jam: '16:01', run: () => prosesMacau('16:00') },
    { id: 'macau_1900', jam: '19:01', run: () => prosesMacau('19:00') },
    { id: 'macau_2200', jam: '22:01', run: () => prosesMacau('22:00') },
    { id: 'macau_2300', jam: '23:01', run: () => prosesMacau('23:00') },
    { id: 'hk_pools_day', jam: '11:00', run: () => prosesHkPools('day') },
    { id: 'hk_pools_night', jam: '23:00', run: () => prosesHkPools('night') },
    { id: 'bullseye', jam: '13:05', run: () => ambilBullseye() },
    { id: 'taiwan', jam: '20:45', run: () => prosesTaiwan() },
    { id: 'tambahan_hk', jam: '23:00', run: () => prosesPasaranTambahan('hk', PASARAN_TAMBAHAN['hk']) },
    { id: 'tambahan_hk-lotto', jam: '23:05', run: () => prosesPasaranTambahan('hk-lotto', PASARAN_TAMBAHAN['hk-lotto']) },
    { id: 'tambahan_sgp4d', jam: '17:30', run: () => prosesPasaranTambahan('sgp4d', PASARAN_TAMBAHAN['sgp4d']) },
    { id: 'tambahan_sgp-toto', jam: '17:30', run: () => prosesPasaranTambahan('sgp-toto', PASARAN_TAMBAHAN['sgp-toto']) },
    { id: 'tambahan_sydney', jam: '13:30', run: () => prosesPasaranTambahan('sydney', PASARAN_TAMBAHAN['sydney']) },
    { id: 'tambahan_sydney-lotto', jam: '13:45', run: () => prosesPasaranTambahan('sydney-lotto', PASARAN_TAMBAHAN['sydney-lotto']) },
    { id: 'tambahan_china', jam: '15:30', run: () => prosesPasaranTambahan('china', PASARAN_TAMBAHAN['china']) },
    { id: 'tambahan_japan', jam: '17:15', run: () => prosesPasaranTambahan('japan', PASARAN_TAMBAHAN['japan']) },
    { id: 'tambahan_cambodia', jam: '11:50', run: () => prosesPasaranTambahan('cambodia', PASARAN_TAMBAHAN['cambodia']) },
    { id: 'tambahan_magnum4d', jam: '18:15', run: () => prosesPasaranTambahan('magnum4d', PASARAN_TAMBAHAN['magnum4d']) },
    { id: 'tambahan_pcso', jam: '19:55', run: () => prosesPasaranTambahan('pcso', PASARAN_TAMBAHAN['pcso']) },
    { id: 'tambahan_taipei', jam: '21:05', run: () => prosesPasaranTambahan('taipei', PASARAN_TAMBAHAN['taipei']) },
    ...Object.entries(SLOT_WIB).map(([kunci, jam]) => {
        const [state, game] = kunci.split('/');
        return {
            id: `us_${kunci}`,
            jam,
            run: () => prosesUSMarket(state, game)
        };
    })
];

const pollerSelesaiHariIni = new Set();
const pollerSedangJalan = new Set();
let pollerTanggalTerakhir = '';

function getDetikWIBHariIni() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date());

    const h = Number(parts.find(p => p.type === 'hour').value);
    const m = Number(parts.find(p => p.type === 'minute').value);
    const s = Number(parts.find(p => p.type === 'second').value);
    return h * 3600 + m * 60 + s;
}

function jalankanPollerBackground() {
    const tglSekarang = iso(partsInTZ(new Date(), 'Asia/Jakarta'));
    if (tglSekarang !== pollerTanggalTerakhir) {
        pollerTanggalTerakhir = tglSekarang;
        pollerSelesaiHariIni.clear();
    }

    const detikSekarang = getDetikWIBHariIni();

    for (const item of JADWAL_POLLER_WIB) {
        if (pollerSelesaiHariIni.has(item.id) || pollerSedangJalan.has(item.id)) continue;

        const [hh, mm] = item.jam.split(':').map(Number);
        const targetDetik = hh * 3600 + mm * 60;
        const mulaiDetik = targetDetik - 30;
        const batasDetik = targetDetik + 360;

        const dalamJendela = mulaiDetik < 0
            ? (detikSekarang >= 86400 + mulaiDetik || detikSekarang <= batasDetik)
            : (detikSekarang >= mulaiDetik && detikSekarang <= batasDetik);

        if (dalamJendela) {
            pollerSedangJalan.add(item.id);
            item.run()
                .then(res => {
                    const data = res?.data || res;
                    if (data && data.status === 'sukses') {
                        pollerSelesaiHariIni.add(item.id);
                    }
                })
                .catch(() => {})
                .finally(() => {
                    pollerSedangJalan.delete(item.id);
                });
        }
    }
}

// ================= SETUP SERVER / EXPORT =================

const PORT = process.env.PORT || 8000;

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server berjalan di port ${PORT}`);
        setInterval(jalankanPollerBackground, 3000);
    });
}

module.exports = app;

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const app = express();
app.use(cors());

let CACHE = { data: null, time: 0 };

async function fetchTaiwan() {
  const url = 'https://www.taiwan-lotto.com/';
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,zh-TW;q=0.8',
    'Referer': 'https://www.google.com/',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };
  try {
    const { data } = await axios.get(url, { headers, timeout: 20000 });
    return data;
  } catch (e) {
    // kalau 403, coba lewat proxy AllOrigins
    console.log('Direct 403, coba proxy...');
    const proxy = await axios.get(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { timeout: 20000 });
    const decoded = JSON.parse(proxy.data.contents? JSON.stringify(proxy.data) : '{}');
    // AllOrigins balikin JSON {contents: "<html>..."}
    return proxy.data.contents || proxy.data;
  }
}

app.get('/', async (req, res) => {
  if (Date.now() - CACHE.time < 10*60*1000 && CACHE.data) return res.json(CACHE.data);
  try {
    const html = await fetchTaiwan();
    const $ = cheerio.load(html);
    const marqueeText = $('#marqueeinfo').text() || html;
    const special = marqueeText.match(/Special Prize\s*:\s*(\d+)/i)?.[1] || null;
    const grand = marqueeText.match(/Grand Prize\s*:\s*(\d+)/i)?.[1] || null;
    const regular = marqueeText.match(/Regular Prize\s*:\s*(\d+)/i)?.[1] || null;
    const result = {
      status: 'sukses',
      waktu_wib: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
      data: { special_prize: special, grand_prize: grand, regular_prize: regular },
      raw_length: marqueeText.length
    };
    CACHE = { data: result, time: Date.now() };
    res.json(result);
  } catch (e) {
    res.status(500).json({ status: 'error', pesan: e.message, stack: e.response?.status });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log('jalan di ' + PORT));

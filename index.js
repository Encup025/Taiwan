const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const app = express();
app.use(cors());

let CACHE = { data: null, time: 0 };

async function getHtml() {
  const target = 'https://www.taiwan-lotto.com/';
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html'
  };

  const proxies = [
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
    `https://corsproxy.io/?${encodeURIComponent(target)}`
  ];

  // 1. Coba direct dulu
  try {
    const r = await axios.get(target, { headers, timeout: 15000 });
    console.log('Direct sukses');
    return r.data;
  } catch (e) {}

  // 2. Coba proxy satu-satu
  for (const p of proxies) {
    try {
      console.log('Coba proxy: ' + p);
      const r = await axios.get(p, { headers, timeout: 15000 });
      if (r.data && r.data.length > 500) return r.data;
    } catch (e) {
      console.log('Proxy gagal: ' + p);
    }
  }
  throw new Error('Semua proxy gagal 403');
}

app.get('/', async (req, res) => {
  if (Date.now() - CACHE.time < 10*60*1000 && CACHE.data) return res.json({...CACHE.data, source: 'cache' });

  try {
    const html = await getHtml();
    const $ = cheerio.load(html);
    let marqueeText = $('#marqueeinfo').text();
    if (!marqueeText) marqueeText = html; // fallback baca semua html

    const special = marqueeText.match(/Special Prize\s*:\s*(\d+)/i)?.[1] || null;
    const grand = marqueeText.match(/Grand Prize\s*:\s*(\d+)/i)?.[1] || null;

    const result = {
      status: 'sukses',
      waktu_wib: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
      data: { special_prize: special, grand_prize: grand, raw: marqueeText.substring(0,200) }
    };
    CACHE = { data: result, time: Date.now() };
    res.json(result);
  } catch (e) {
    res.status(500).json({ status: 'error', pesan: e.message });
  }
});

app.get('/debug', async (req,res) => {
  try {
    const html = await getHtml();
    res.send(html.substring(0,2000));
  } catch(e) { res.send('Error: '+e.message) }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log('jalan'));

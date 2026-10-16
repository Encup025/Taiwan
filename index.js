const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const app = express();
app.use(cors());

let CACHE = { data: null, time: 0 };

app.get('/', async (req, res) => {
  // kalau cache masih baru 10 menit, kasih cache aja biar gak hit terus
  if (Date.now() - CACHE.time < 10*60*1000 && CACHE.data) {
    return res.json({...CACHE.data, source: 'cache' });
  }
  try {
    const { data } = await axios.get('https://www.taiwan-lotto.com/', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0',
        'Accept': 'text/html'
      }
    });
    const $ = cheerio.load(data);
    const marqueeText = $('#marqueeinfo').text();
    const special = marqueeText.match(/Special Prize\s*:\s*(\d+)/i)?.[1] || null;
    const grand = marqueeText.match(/Grand Prize\s*:\s*(\d+)/i)?.[1] || null;
    const regular = marqueeText.match(/Regular Prize\s*:\s*(\d+)/i)?.[1] || null;

    const result = {
      status: 'sukses',
      waktu_wib: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
      data: { special_prize: special, grand_prize: grand, regular_prize: regular }
    };
    CACHE = { data: result, time: Date.now() };
    res.json(result);
  } catch (e) {
    // kalau kena block, balikin cache terakhir biar Vercel gak error
    if (CACHE.data) return res.json({...CACHE.data, warning: 'Cloudflare block, pakai cache' });
    res.status(500).json({ status: 'error', pesan: e.message });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log('jalan di ' + PORT));

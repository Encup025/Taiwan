import express from 'express';
import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';
import cors from 'cors';

const app = express();
app.use(cors());

let CACHE = { data: null, time: 0 };

app.get('/', async (req, res) => {
  if (Date.now() - CACHE.time < 10*60*1000 && CACHE.data) return res.json({...CACHE.data, source: 'cache'});
  try {
    const response = await gotScraping.get('https://www.taiwan-lotto.com/', {
      headerGeneratorOptions: { browsers: [{ name: 'chrome', minVersion: 110 }] }
    });
    const html = response.body;
    const $ = cheerio.load(html);
    const marqueeText = $('#marqueeinfo').text() || html;
    const special = marqueeText.match(/Special Prize\s*:\s*(\d+)/i)?.[1] || null;
    const grand = marqueeText.match(/Grand Prize\s*:\s*(\d+)/i)?.[1] || null;
    const result = {
      status: 'sukses',
      waktu_wib: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
      data: { special_prize: special, grand_prize: grand }
    };
    CACHE = { data: result, time: Date.now() };
    res.json(result);
  } catch (e) {
    res.status(500).json({ status: 'error', pesan: e.message });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log('jalan di ' + PORT));

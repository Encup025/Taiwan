import express from 'express';
import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';
import cors from 'cors';

const app = express();
app.use(cors());

let CACHE = { data: null, time: 0 };

app.get('/', async (req, res) => {
  if (Date.now() - CACHE.time < 5*60*1000 && CACHE.data) {
    return res.json({...CACHE.data, source: 'cache'});
  }
  try {
    const response = await gotScraping.get('https://livedrawtaiwan.info/', {
      headerGeneratorOptions: { browsers: [{ name: 'chrome', minVersion: 110 }] }
    });
    const $ = cheerio.load(response.body);
    const text = $('body').text();

    // pola di livedrawtaiwan.info biasanya: Special Prize 12345678 dll
    const special = text.match(/Special Prize\s*[:\-]?\s*(\d{6,8})/i)?.[1] || null;
    const grand = text.match(/Grand Prize\s*[:\-]?\s*(\d{6,8})/i)?.[1] || null;
    const regular = text.match(/Regular Prize\s*[:\-]?\s*(\d{6,8})/i)?.[1] || null;

    // ambil semua angka 8 digit yang ada sebagai backup
    const allNumbers = [...new Set(text.match(/\d{8}/g) || [])];

    const result = {
      status: 'sukses',
      waktu_wib: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
      sumber: 'livedrawtaiwan.info',
      data: {
        special_prize: special || allNumbers[0] || null,
        grand_prize: grand || allNumbers[1] || null,
        regular_prize: regular || allNumbers[2] || null,
        semua_angka: allNumbers.slice(0,10)
      }
    };
    CACHE = { data: result, time: Date.now() };
    res.json(result);
  } catch (e) {
    res.status(500).json({ status: 'error', pesan: e.message, stack: e.stack?.substring(0,500) });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log('jalan di ' + PORT));

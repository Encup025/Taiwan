const express = require('express');
const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');
const cors = require('cors');
const app = express();
app.use(cors());

let CACHE = { data: null, time: 0 };
let BROWSER = null;

async function getBrowser() {
  if (BROWSER) return BROWSER;
  BROWSER = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--single-process'],
    headless: 'new'
  });
  return BROWSER;
}

app.get('/', async (req, res) => {
  if (Date.now() - CACHE.time < 10*60*1000 && CACHE.data) return res.json({...CACHE.data, source: 'cache' });
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0');
    await page.goto('https://www.taiwan-lotto.com/', { waitUntil: 'networkidle2', timeout: 30000 });
    const html = await page.content();
    const $ = cheerio.load(html);
    const marqueeText = $('#marqueeinfo').text();
    const special = marqueeText.match(/Special Prize\s*:\s*(\d+)/i)?.[1] || null;
    const grand = marqueeText.match(/Grand Prize\s*:\s*(\d+)/i)?.[1] || null;
    const result = {
      status: 'sukses',
      waktu_wib: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
      data: { special_prize: special, grand_prize: grand, full: marqueeText.substring(0,200) }
    };
    CACHE = { data: result, time: Date.now() };
    await page.close();
    res.json(result);
  } catch (e) {
    if(page) await page.close().catch(()=>{});
    res.status(500).json({ status: 'error', pesan: e.message });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log('jalan di ' + PORT));

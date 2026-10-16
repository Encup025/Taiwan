const express = require('express');
const puppeteer = require('puppeteer-core');
const cors = require('cors');
const app = express();
app.use(cors());

let CACHE = { data: null, time: 0 };

async function scrape() {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
        '--disable-background-timer-throttling'
      ],
      headless: 'new'
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.goto('https://www.taiwan-lotto.com/', { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForSelector('#marqueeinfo', { timeout: 15000 }).catch(()=>{});
    const text = await page.$eval('#marqueeinfo', el => el.innerText).catch(async () => await page.content());
    await browser.close();
    return text;
  } catch (e) {
    if (browser) await browser.close().catch(()=>{});
    throw e;
  }
}

app.get('/', async (req, res) => {
  if (Date.now() - CACHE.time < 10*60*1000 && CACHE.data) return res.json({...CACHE.data, source: 'cache'});
  try {
    const marqueeText = await scrape();
    const special = marqueeText.match(/Special Prize\s*:\s*(\d+)/i)?.[1] || null;
    const grand = marqueeText.match(/Grand Prize\s*:\s*(\d+)/i)?.[1] || null;
    const regular = marqueeText.match(/Regular Prize\s*:\s*(\d+)/i)?.[1] || null;
    const result = {
      status: 'sukses',
      waktu_wib: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
      data: { special_prize: special, grand_prize: grand, regular_prize: regular, full: marqueeText.substring(0,300) }
    };
    CACHE = { data: result, time: Date.now() };
    res.json(result);
  } catch (e) {
    res.status(500).json({ status: 'error', pesan: e.message });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log('jalan'));

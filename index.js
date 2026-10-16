import express from 'express';
import { gotScraping } from 'got-scraping';
import cors from 'cors';

const app = express();
app.use(cors());

app.get('/', async (req, res) => {
  try {
    const r = await gotScraping.get('https://livedrawtaiwan.info/', {
      headerGeneratorOptions: { browsers: [{ name: 'chrome' }] }
    });
    // kirim 2000 karakter pertama biar kita tau strukturnya
    res.json({
      status: 'sukses',
      panjang_html: r.body.length,
      preview: r.body.substring(0, 5000)
    });
  } catch(e){ res.status(500).json({error: e.message}) }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, ()=>console.log('jalan'));

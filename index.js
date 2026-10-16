import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());

app.get('/', async (req, res) => {
  try {
    // pakai proxy biar tembus JS
    const url = 'https://api.allorigins.win/get?url=' + encodeURIComponent('https://livedrawtaiwan.info/');
    const r = await fetch(url);
    const j = await r.json();
    const html = j.contents || '';

    // ambil angka
    const all = html.match(/\d{6,8}/g) || [];
    const special = html.match(/Special[^0-9]*(\d{6,8})/i)?.[1] || all[0] || null;

    res.json({
      status: 'sukses',
      sumber: 'livedrawtaiwan.info via allorigins',
      waktu_wib: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
      panjang_html: html.length,
      data: {
        special_prize: special,
        grand_prize: all[1] || null,
        regular_prize: all[2] || null,
        semua_angka: all.slice(0,10)
      },
      preview_html: html.substring(0, 1000)
    });
  } catch(e){
    res.status(500).json({status:'error', pesan: e.message});
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, ()=>console.log('jalan'));

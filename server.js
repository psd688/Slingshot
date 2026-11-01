const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const qrcode = require('qrcode');
const selfsigned = require('selfsigned');

const app = express();

// Force HTTPS in Cloud Production (ensures Android Chrome enables motion & gyro sensors)
app.use((req, res, next) => {
  if (IS_CLOUD && req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(301, `https://${req.get('host')}${req.url}`);
  }
  next();
});

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.use('/assets', express.static(path.join(__dirname, 'public', 'New folder')));

// Detect all local IPv4 addresses and prioritize Wi-Fi / Hotspot
function getAllIps() {
  const interfaces = os.networkInterfaces();
  const list = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const ip = iface.address;
        // Ignore link-local (169.254.x.x) and carrier dummy/test-net IPs (192.0.0.x)
        if (ip.startsWith('169.254.') || ip.startsWith('192.0.0.') || ip.startsWith('192.0.2.')) {
          continue;
        }

        const isRealLan = /^(192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|10\.)/.test(ip);
        const isWifiName = /wi-fi|wlan|wireless|en0|en1/i.test(name);

        list.push({
          name: name,
          ip: ip,
          isWifi: isRealLan && isWifiName,
          isRealLan: isRealLan
        });
      }
    }
  }

  // Prioritize real private LAN/Hotspot addresses (172.20.10.x, 192.168.x.x, 10.x.x.x)
  list.sort((a, b) => {
    if (a.isRealLan && !b.isRealLan) return -1;
    if (!a.isRealLan && b.isRealLan) return 1;
    if (a.isWifi && !b.isWifi) return -1;
    if (!a.isWifi && b.isWifi) return 1;
    return 0;
  });

  return list;
}

const allIps = getAllIps();
const PRIMARY_IP = allIps.length > 0 ? allIps[0].ip : 'localhost';
const HTTP_PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const GOOGLE_SHEETS_WEBHOOK_URL = process.env.GOOGLE_SHEETS_WEBHOOK_URL || 'https://script.google.com/macros/s/AKfycbzdV3Jg-F4E49r1GZ0c-5Xe2DahBLvQ6XC1hjMgjxwLYltpaHD3s-SXn0spsjQX4Ew/exec';

// Detect whether running in cloud environment (Render, Railway, Heroku, etc.)
const IS_CLOUD = Boolean(
  process.env.RENDER ||
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.VERCEL ||
  process.env.NODE_ENV === 'production' ||
  (process.env.PORT && !process.env.HTTPS_PORT)
);

// In-memory gallery of recent splashes
let splashHistory = [];
const MAX_HISTORY = 40;

// Asynchronous background logger for Google Sheets
function logParticipantToGoogleSheets(item) {
  if (!GOOGLE_SHEETS_WEBHOOK_URL) return;

  try {
    const payload = {
      name: item.name || 'VIP Guest',
      company: item.company || '',
      message: item.message || '',
      color: item.color || '#38bdf8',
      image: item.image || null,
      timestamp: item.timestamp || Date.now()
    };

    fetch(GOOGLE_SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(result => {
        if (result && result.status === 'success') {
          console.log(`📊 [Google Sheets] Saved row ${result.row} for "${payload.name}"`);
        } else {
          console.warn('⚠️ [Google Sheets] Response:', result);
        }
      })
      .catch(err => {
        console.error('❌ [Google Sheets Error]:', err.message);
      });
  } catch (err) {
    console.error('❌ [Google Sheets Catch]:', err.message);
  }
}

async function bootstrap() {
  const httpServer = http.createServer(app);
  const ioHttp = new Server(httpServer, {
    cors: { origin: '*' },
    maxHttpBufferSize: 25 * 1024 * 1024
  });

  let httpsServer = null;
  let ioHttps = null;

  // Only create self-signed HTTPS server when running locally (cloud provides SSL at edge)
  if (!IS_CLOUD) {
    try {
      const pems = await selfsigned.generate(
        [
          { name: 'commonName', value: PRIMARY_IP },
          { name: 'organizationName', value: 'Slingshot Interactive' }
        ],
        { days: 365 }
      );
      httpsServer = https.createServer({ key: pems.private, cert: pems.cert }, app);
    } catch (err) {
      const pems = await selfsigned.generate(null, { days: 365 });
      httpsServer = https.createServer({ key: pems.private, cert: pems.cert }, app);
    }

    ioHttps = new Server(httpsServer, {
      cors: { origin: '*' },
      maxHttpBufferSize: 25 * 1024 * 1024
    });
  }

  function setupSocket(io) {
    io.on('connection', (socket) => {
      socket.emit('init_history', splashHistory);

      socket.on('aim', (data) => {
        ioHttp.emit('aim_update', data);
        if (ioHttps) ioHttps.emit('aim_update', data);
      });

      socket.on('calibrate', (data) => {
        ioHttp.emit('aim_calibrate', data);
        if (ioHttps) ioHttps.emit('aim_calibrate', data);
      });

      socket.on('phone_state', (state) => {
        ioHttp.emit('phone_state_update', state);
        if (ioHttps) ioHttps.emit('phone_state_update', state);
      });

      socket.on('launch', (payload) => {
        const splashItem = {
          id: 'splash_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          timestamp: Date.now(),
          image: payload.image,
          name: payload.name || payload.text || 'VIP Guest',
          company: payload.company || '',
          message: payload.message || '',
          text: payload.name || payload.text || '',
          color: payload.color || '#ff007f',
          splatStyle: Math.floor(Math.random() * 5),
          targetX: payload.targetX ?? 0.5,
          targetY: payload.targetY ?? 0.5,
          force: payload.force || 1.0,
        };

        splashHistory.push(splashItem);
        if (splashHistory.length > MAX_HISTORY) {
          splashHistory.shift();
        }

        ioHttp.emit('splash_hit', splashItem);
        if (ioHttps) ioHttps.emit('splash_hit', splashItem);

        // Asynchronously save participant details & selfie to Google Sheets
        logParticipantToGoogleSheets(splashItem);
      });

      socket.on('clear_board', () => {
        splashHistory = [];
        ioHttp.emit('board_cleared');
        if (ioHttps) ioHttps.emit('board_cleared');
      });
    });
  }

  setupSocket(ioHttp);
  if (ioHttps) setupSocket(ioHttps);

  // API route for setup & QR code
  app.get('/api/info', async (req, res) => {
    const currentIps = getAllIps();
    const chosenIp = req.query.ip || (currentIps.length > 0 ? currentIps[0].ip : PRIMARY_IP);

    let httpsUrl, httpUrl, tvUrl;

    if (IS_CLOUD) {
      const host = req.get('host');
      const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
      httpsUrl = `${proto}://${host}/phone.html`;
      httpUrl = `${proto}://${host}/phone.html`;
      tvUrl = `${proto}://${host}/tv.html`;
    } else {
      httpsUrl = `https://${chosenIp}:${HTTPS_PORT}/phone.html`;
      httpUrl = `http://${chosenIp}:${HTTP_PORT}/phone.html`;
      tvUrl = `http://localhost:${HTTP_PORT}/tv.html`;
    }

    try {
      const qrDataUrl = await qrcode.toDataURL(httpsUrl, {
        margin: 1,
        width: 320,
        color: { dark: '#000000', light: '#ffffff' }
      });

      res.json({
        chosenIp,
        availableIps: currentIps,
        httpsPort: IS_CLOUD ? 443 : HTTPS_PORT,
        httpPort: HTTP_PORT,
        phoneHttpsUrl: httpsUrl,
        phoneHttpUrl: httpUrl,
        tvUrl: tvUrl,
        qrDataUrl: qrDataUrl
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Start listening
  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🎯 SLINGSHOT SERVER STARTED! [${IS_CLOUD ? 'CLOUD MODE' : 'LOCAL MODE'}]`);
    console.log(`======================================================`);
    console.log(`📺 TV / LED Screen: http://localhost:${HTTP_PORT}/tv.html`);
    if (!IS_CLOUD) {
      console.log(`\n📶 Detected Network Interfaces:`);
      allIps.forEach((item, idx) => {
        const tag = item.isWifi ? '⭐ [WI-FI / HOTSPOT]' : '[ETHERNET / LAN]';
        console.log(`   ${idx + 1}. ${item.name} -> ${item.ip} ${tag}`);
      });
      console.log(`\n📱 PRIMARY PHONE CONTROLLER LINK:`);
      console.log(`   👉 HTTPS: https://${PRIMARY_IP}:${HTTPS_PORT}/phone.html`);
      console.log(`   👉 HTTP:  http://${PRIMARY_IP}:${HTTP_PORT}/phone.html`);
    } else {
      console.log(`🌐 Server running in Cloud Production on port ${HTTP_PORT}`);
    }
    console.log(`\n⚙️  Operator Dashboard: http://localhost:${HTTP_PORT}/\n`);
  });

  if (httpsServer) {
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`🔒 HTTPS Server running on port ${HTTPS_PORT} for Camera & Sensors.`);
    });
  }
}

bootstrap().catch(err => {
  console.error('Failed to start server:', err);
});

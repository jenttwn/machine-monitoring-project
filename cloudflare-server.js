// cloudflare-server.js
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { exec } = require('child_process');
const axios = require('axios');
const compression = require('compression');

// =================CONFIG=================
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/xxxxxxxxxxxxxxxxxx/exec'; // เปลี่ยนเป็น URL ของคุณ
const PORT = 3000;
// ========================================

const app = express();
let tunnelProcess = null;
let tunnelUrl = null;

// เปิด compression เพื่อลดขนาดข้อมูล
app.use(compression());

// Cache สำหรับ static files
app.use((req, res, next) => {
    if (req.path.includes('.css') || req.path.includes('.js') || req.path.includes('.png')) {
        res.set('Cache-Control', 'public, max-age=86400');
    }
    next();
});

// Middleware logging (แบบย่อ)
let requestCount = 0;
app.use((req, res, next) => {
    requestCount++;
    const shortPath = req.path.substring(0, 50);
    console.log(`[${requestCount}] ${req.method} ${shortPath}`);
    next();
});

// Proxy config ที่ optimize แล้ว
const proxyConfig = {
    changeOrigin: true,
    timeout: 45000,
    proxyTimeout: 45000,
    
    // เพิ่ม connection pooling
    agent: require('http').Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 20,
        maxFreeSockets: 10
    }),
    
    // Log performance
    onProxyReq: (proxyReq, req, res) => {
        req.startTime = Date.now();
    },
    
    onProxyRes: (proxyRes, req, res) => {
        const duration = Date.now() - req.startTime;
        if (duration > 5000) {
            console.log(`⚠️ Slow response: ${req.path} took ${duration}ms`);
        }
    },
    
    onError: (err, req, res) => {
        console.error(`❌ ${req.path.split('/')[1]} Error:`, err.message);
        res.status(502).json({ 
            error: 'Server unavailable',
            details: err.message,
            retryAfter: 5 
        });
    }
};

// Proxy routes
app.use('/floor2', createProxyMiddleware({
    target: '192.168.x.x:8080', //Edit Http according to your http
    pathRewrite: { '^/floor1': '' },
    ...proxyConfig
}));

app.use('/floor3', createProxyMiddleware({
    target: 'http://192.168.x.x:8080', //Edit Http according to your http
    pathRewrite: { '^/floor2': '' },
    ...proxyConfig
}));

app.use('/floor3s', createProxyMiddleware({
    target: 'http://192.168.x.x:8080', //Edit Http according to your http
    pathRewrite: { '^/floor3': '' },
    ...proxyConfig
}));

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        tunnelUrl: tunnelUrl,
        timestamp: new Date().toISOString(),
        requests: requestCount
    });
});

// Statistics endpoint
app.get('/stats', (req, res) => {
    res.json({
        totalRequests: requestCount,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        tunnelUrl: tunnelUrl
    });
});

// ส่ง URL ไป GAS
async function updateGAS(url) {
    console.log(`📤 Updating GAS with Cloudflare Tunnel URL: ${url}`);
    try {
        const response = await axios.get(`${GAS_WEB_APP_URL}?tunnel_url=${encodeURIComponent(url)}`, {
            timeout: 15000
        });
        console.log('✅ GAS Updated:', response.data);
        return true;
    } catch (err) {
        console.error('❌ GAS Update Failed:', err.message);
        return false;
    }
}

// เริ่ม Cloudflare Quick Tunnel
function startTunnel() {
    console.log('🔄 Starting Cloudflare Quick Tunnel...');
    
    tunnelProcess = exec(`cloudflared tunnel --url http://localhost:${PORT} --protocol http2`);
    
    let outputBuffer = '';
    
    tunnelProcess.stdout.on('data', (data) => {
        const output = data.toString();
        outputBuffer += output;
        
        // หา URL
        const patterns = [
            /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/,
            /Your quick Tunnel has been created! Visit it at[:\s]+(https:\/\/[^\s]+)/,
            /Visit[:\s]+(https:\/\/[^\s]+\.trycloudflare\.com)/
        ];
        
        for (const pattern of patterns) {
            const match = output.match(pattern);
            if (match) {
                const url = match[1] || match[0];
                if (!tunnelUrl) {
                    tunnelUrl = url;
                    console.log('\n' + '='.repeat(60));
                    console.log('🎉 Cloudflare Tunnel URL Ready:');
                    console.log('📍 ' + tunnelUrl);
                    console.log('='.repeat(60) + '\n');
                    updateGAS(tunnelUrl);
                }
                break;
            }
        }
    });
    
    tunnelProcess.stderr.on('data', (data) => {
        const error = data.toString();
        
        // หา URL จาก stderr
        const urlMatch = error.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (urlMatch && !tunnelUrl) {
            tunnelUrl = urlMatch[0];
            console.log('\n' + '='.repeat(60));
            console.log('🎉 Cloudflare Tunnel URL Ready:');
            console.log('📍 ' + tunnelUrl);
            console.log('='.repeat(60) + '\n');
            updateGAS(tunnelUrl);
        }
    });
    
    tunnelProcess.on('exit', (code) => {
        if (code !== 0) {
            console.log('🔄 Restarting Cloudflare Tunnel...');
            tunnelUrl = null;
            setTimeout(startTunnel, 5000);
        }
    });
}

// เริ่ม Server
app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('🚀 Cloudflare Tunnel Machine Data Proxy');
    console.log('='.repeat(60));
    console.log(`📍 Local:  http://localhost:${PORT}`);
    console.log(`📡 Routes: /floor1, /floor2, /floor3`);
    console.log('\n🔧 Optimizations:');
    console.log('  ✅ Compression enabled');
    console.log('  ✅ Connection pooling (20 sockets)');
    console.log('  ✅ Keep-alive enabled');
    console.log('  ✅ Extended timeouts (45s)');
    console.log('  ✅ HTTP/2 protocol');
    console.log('='.repeat(60));
    
    startTunnel();
    console.log('\n⏳ Getting Cloudflare Tunnel URL...\n');
});

// Monitor performance ทุก 30 วินาที
setInterval(() => {
    const uptime = Math.floor(process.uptime());
    const memory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    console.log(`\n📊 Stats: ${requestCount} requests | Uptime: ${uptime}s | Memory: ${memory}MB`);
}, 30000);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down Cloudflare Tunnel...');
    if (tunnelProcess) {
        tunnelProcess.kill();
    }
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Unhandled Rejection:', err.message);
});

//run command: node cloudflare-server.js
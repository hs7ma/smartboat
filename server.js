require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocketHandler = require('./services/websocket-handler');

const app = express();
const server = http.createServer(app);
const wsHandler = new WebSocketHandler(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        esp32_connected: wsHandler.esp32Client !== null,
        dashboard_clients: wsHandler.dashboardClients.size,
        openai_configured: !!process.env.OPENAI_API_KEY,
        timestamp: Date.now()
    });
});

app.post('/api/rudder', (req, res) => {
    const { angle } = req.body;
    if (angle === undefined || angle < 30 || angle > 150) {
        return res.status(400).json({ error: 'Angle must be between 30 and 150' });
    }
    const sent = wsHandler.sendToEsp32(JSON.stringify({
        type: 'rudder_command',
        angle: angle
    }));
    if (sent) {
        res.json({ success: true, angle });
    } else {
        res.status(503).json({ error: 'ESP32 not connected' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================`);
    console.log(`  Smart Boat Server`);
    console.log(`  HTTP: http://localhost:${PORT}`);
    console.log(`  WebSocket: ws://localhost:${PORT}/ws`);
    console.log(`  OpenAI: ${process.env.OPENAI_API_KEY ? 'Configured' : 'NOT configured'}`);
    console.log(`========================================`);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});
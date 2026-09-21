require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocketHandler = require('./services/websocket-handler');
const ImageStore = require('./services/image-store');

const app = express();
const server = http.createServer(app);
const wsHandler = new WebSocketHandler(server);
const imageStore = wsHandler.imageStore || new ImageStore();

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        controller_connected: wsHandler.controllerClient !== null,
        camera_connected: wsHandler.cameraClient !== null,
        dashboard_clients: wsHandler.dashboardClients.size,
        openai_configured: !!(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY),
        image_store_configured: imageStore.isEnabled(),
        timestamp: Date.now()
    });
});

app.get('/api/images', async (req, res) => {
    try {
        if (!imageStore.isEnabled()) {
            return res.json({ images: [], configured: false });
        }
        const limit = req.query.limit;
        const images = await imageStore.list(limit);
        res.json({ images, configured: true });
    } catch (err) {
        console.error('[API] /api/images error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/images/:id', async (req, res) => {
    try {
        if (!imageStore.isEnabled()) {
            return res.status(503).json({ error: 'Image store not configured' });
        }
        const image = await imageStore.getById(req.params.id);
        if (!image) {
            return res.status(404).json({ error: 'Image not found' });
        }
        res.json({ image });
    } catch (err) {
        console.error('[API] /api/images/:id error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/rudder', (req, res) => {
    const { angle } = req.body;
    if (angle === undefined || angle < 30 || angle > 150) {
        return res.status(400).json({ error: 'Angle must be between 30 and 150' });
    }
    const sent = wsHandler.sendToController(JSON.stringify({
        type: 'rudder_command',
        angle: angle
    }));
    if (sent) {
        res.json({ success: true, angle });
    } else {
        res.status(503).json({ error: 'Controller not connected' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
    const aiConfigured = !!(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
    console.log(`========================================`);
    console.log(`  Tigris eye Server`);
    console.log(`  HTTP: http://localhost:${PORT}`);
    console.log(`  WebSocket: ws://localhost:${PORT}/ws`);
    console.log(`  AI Service: ${aiConfigured ? 'Configured' : 'NOT configured'}`);
    console.log(`  ImageStore: ${imageStore.isEnabled() ? 'Configured' : 'NOT configured'}`);
    console.log(`========================================`);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});

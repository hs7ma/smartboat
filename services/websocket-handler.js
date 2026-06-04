const WebSocket = require('ws');
const OpenAIService = require('./openai-service');

class WebSocketHandler {
    constructor(server) {
        this.wss = new WebSocket.Server({ server, path: '/ws' });
        this.openaiService = new OpenAIService();
        this.esp32Client = null;
        this.dashboardClients = new Set();
        this.imageBuffer = '';
        this.isReceivingImage = false;

        this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

        console.log('[WS] WebSocket server initialized on /ws');
    }

    handleConnection(ws, req) {
        const clientIp = req.socket.remoteAddress;
        console.log(`[WS] New connection from: ${clientIp}`);

        let clientType = 'unknown';

        ws.on('message', async (data) => {
            try {
                const message = data.toString();

                if (message.includes('"device_info"')) {
                    clientType = 'esp32';
                    this.esp32Client = ws;
                    console.log('[WS] ESP32 device registered');
                    this.broadcastToDashboards(JSON.stringify({
                        type: 'device_status',
                        status: 'connected',
                        firmware: '1.0.0'
                    }));
                    return;
                }

                if (message.includes('"type":"dashboard"')) {
                    clientType = 'dashboard';
                    this.dashboardClients.add(ws);
                    console.log('[WS] Dashboard client registered');
                    return;
                }

                if (message.includes('"sensor_data"')) {
                    this.handleSensorData(message);
                    return;
                }

                if (message.includes('"camera_image"')) {
                    this.handleCameraImage(message);
                    return;
                }

                if (message.includes('"rudder_command"')) {
                    if (this.esp32Client && this.esp32Client.readyState === WebSocket.OPEN) {
                        this.esp32Client.send(message);
                        console.log('[WS] Rudder command forwarded to ESP32');
                    }
                    return;
                }

            } catch (err) {
                console.error('[WS] Error processing message:', err.message);
            }
        });

        ws.on('close', () => {
            if (clientType === 'esp32') {
                this.esp32Client = null;
                console.log('[WS] ESP32 disconnected');
                this.broadcastToDashboards(JSON.stringify({
                    type: 'device_status',
                    status: 'disconnected'
                }));
            } else if (clientType === 'dashboard') {
                this.dashboardClients.delete(ws);
                console.log('[WS] Dashboard client disconnected');
            }
        });

        ws.on('error', (err) => {
            console.error('[WS] WebSocket error:', err.message);
        });
    }

    handleSensorData(message) {
        try {
            const data = JSON.parse(message);
            this.broadcastToDashboards(JSON.stringify({
                type: 'sensor_data',
                tds: data.tds,
                turbidity: data.turbidity,
                tof_distance: data.tof_distance,
                rudder_angle: data.rudder_angle,
                timestamp: Date.now()
            }));
        } catch (e) {
            this.broadcastToDashboards(message);
        }
    }

    handleCameraImage(message) {
        try {
            const data = JSON.parse(message);
            if (data.image) {
                console.log('[WS] Image received from ESP32, size:', data.image.length);

                this.broadcastToDashboards(JSON.stringify({
                    type: 'camera_image',
                    image: data.image,
                    timestamp: Date.now()
                }));

                this.analyzeImage(data.image);
            }
        } catch (e) {
            console.error('[WS] Error handling camera image:', e.message);
        }
    }

    async analyzeImage(base64Image) {
        try {
            const analysis = await this.openaiService.analyzeWaterImage(base64Image);
            console.log('[AI] Analysis result:', analysis.water_quality, `(${analysis.pollution_level}%)`);

            this.broadcastToDashboards(JSON.stringify({
                type: 'ai_analysis',
                ...analysis,
                timestamp: Date.now()
            }));
        } catch (err) {
            console.error('[AI] Analysis failed:', err.message);
            this.broadcastToDashboards(JSON.stringify({
                type: 'ai_analysis_error',
                error: err.message,
                timestamp: Date.now()
            }));
        }
    }

    broadcastToDashboards(message) {
        this.dashboardClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    sendToEsp32(message) {
        if (this.esp32Client && this.esp32Client.readyState === WebSocket.OPEN) {
            this.esp32Client.send(message);
            return true;
        }
        return false;
    }
}

module.exports = WebSocketHandler;
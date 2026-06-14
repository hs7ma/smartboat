const WebSocket = require('ws');
const OpenAIService = require('./openai-service');

class WebSocketHandler {
    constructor(server) {
        this.wss = new WebSocket.Server({ server, path: '/ws', maxPayload: 10 * 1024 * 1024 });
        this.openaiService = new OpenAIService();
        this.controllerClient = null;
        this.cameraClient = null;
        this.dashboardClients = new Set();

        this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

        console.log('[WS] WebSocket server initialized on /ws (max payload: 10MB)');
    }

    handleConnection(ws, req) {
        const clientIp = req.socket.remoteAddress;
        console.log(`[WS] New connection from: ${clientIp}`);

        let clientType = 'unknown';

        ws.on('message', async (data) => {
            try {
                const message = data.toString();

                if (message.includes('"device_info"')) {
                    const deviceInfo = JSON.parse(message);
                    const device = deviceInfo.device || 'unknown';
                    
                    if (device === 'controller_module') {
                        clientType = 'controller';
                        this.controllerClient = ws;
                        console.log('[WS] Controller module (ESP32-S3) registered');
                        this.broadcastToDashboards(JSON.stringify({
                            type: 'device_status',
                            device: 'controller',
                            status: 'connected',
                            firmware: deviceInfo.firmware || '1.0.0'
                        }));
                    } else if (device === 'camera_module') {
                        clientType = 'camera';
                        this.cameraClient = ws;
                        console.log('[WS] Camera module (ESP32-CAM) registered');
                        this.broadcastToDashboards(JSON.stringify({
                            type: 'device_status',
                            device: 'camera',
                            status: 'connected',
                            firmware: deviceInfo.firmware || '1.0.0'
                        }));
                    } else {
                        // Legacy fallback for old firmware
                        clientType = 'esp32';
                        this.controllerClient = ws;
                        console.log('[WS] Legacy ESP32 device registered');
                        this.broadcastToDashboards(JSON.stringify({
                            type: 'device_status',
                            device: 'controller',
                            status: 'connected',
                            firmware: '1.0.0'
                        }));
                    }
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
                    if (this.controllerClient && this.controllerClient.readyState === WebSocket.OPEN) {
                        this.controllerClient.send(message);
                        console.log('[WS] Rudder command forwarded to controller');
                    }
                    return;
                }

            } catch (err) {
                console.error('[WS] Error processing message:', err.message);
            }
        });

        ws.on('close', () => {
            if (clientType === 'controller' || clientType === 'esp32') {
                this.controllerClient = null;
                console.log('[WS] Controller module disconnected');
                this.broadcastToDashboards(JSON.stringify({
                    type: 'device_status',
                    device: 'controller',
                    status: 'disconnected'
                }));
            } else if (clientType === 'camera') {
                this.cameraClient = null;
                console.log('[WS] Camera module disconnected');
                this.broadcastToDashboards(JSON.stringify({
                    type: 'device_status',
                    device: 'camera',
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
                console.log('[WS] Image received from camera module, size:', data.image.length);

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

    sendToController(message) {
        if (this.controllerClient && this.controllerClient.readyState === WebSocket.OPEN) {
            this.controllerClient.send(message);
            return true;
        }
        return false;
    }
}

module.exports = WebSocketHandler;

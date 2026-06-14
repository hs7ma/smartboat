const ws = new DashboardWS();
const ui = new UIComponents();

function flashElement(el) {
    if (!el) return;
    el.classList.remove('data-flash');
    void el.offsetWidth;
    el.classList.add('data-flash');
}

ws.onOpen = () => {
    ui.setConnectionStatus(true);
};

ws.onClose = () => {
    ui.setConnectionStatus(false);
    ui.setControllerStatus(false);
    ui.setCameraStatus(false);
};

ws.onMessage = (data) => {
    switch (data.type) {
        case 'sensor_data':
            ui.updateTDS(data.tds);
            ui.updateTurbidity(data.turbidity);
            ui.updateTOF(data.tof_distance);
            if (data.rudder_angle !== undefined) {
                ui.updateRudder(data.rudder_angle);
            }
            flashElement(document.querySelector('.tds-card'));
            flashElement(document.querySelector('.turbidity-card'));
            flashElement(document.querySelector('.tof-card'));
            break;

        case 'camera_image':
            if (data.image) {
                ui.updateCameraImage(data.image);
                flashElement(document.querySelector('.camera-section'));
            }
            break;

        case 'ai_analysis':
            ui.updateAIAnalysis(data);
            flashElement(document.querySelector('.ai-section'));
            break;

        case 'ai_analysis_error':
            console.error('[AI] Analysis error:', data.error);
            document.getElementById('aiWaterQuality').textContent = 'Analysis Error';
            break;

        case 'device_status':
            if (data.device === 'controller') {
                ui.setControllerStatus(data.status === 'connected');
            } else if (data.device === 'camera') {
                ui.setCameraStatus(data.status === 'connected');
            } else {
                // Legacy fallback
                ui.setControllerStatus(data.status === 'connected');
            }
            break;
    }
};

function sendRudderCommand(angle) {
    ws.send({
        type: 'rudder_command',
        angle: angle
    });
    ui.updateRudder(angle);
}

ws.connect();

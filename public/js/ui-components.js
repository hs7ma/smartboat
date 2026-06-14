class UIComponents {
    constructor() {
        this.lastTOFDistance = null;
        this.generateCompassTicks();
    }

    generateCompassTicks() {
        const g = document.getElementById('tickMarks');
        if (!g) return;
        for (let i = 0; i < 36; i++) {
            const angle = i * 10;
            const isMajor = angle % 30 === 0;
            const r1 = isMajor ? 82 : 85;
            const r2 = 90;
            const rad = (angle - 90) * Math.PI / 180;
            const x1 = 100 + r1 * Math.cos(rad);
            const y1 = 100 + r1 * Math.sin(rad);
            const x2 = 100 + r2 * Math.cos(rad);
            const y2 = 100 + r2 * Math.sin(rad);
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x1);
            line.setAttribute('y1', y1);
            line.setAttribute('x2', x2);
            line.setAttribute('y2', y2);
            if (isMajor) line.classList.add('major');
            g.appendChild(line);
        }
    }

    updateTDS(value) {
        const el = document.getElementById('tdsValue');
        el.textContent = Math.round(value);
        el.classList.remove('value-pop');
        void el.offsetWidth;
        el.classList.add('value-pop');

        const maxTDS = 2000;
        const percent = Math.min(value / maxTDS, 1);
        const circumference = 2 * Math.PI * 80;
        document.getElementById('tdsGauge').setAttribute('stroke-dasharray', `${percent * circumference} ${circumference}`);
    }

    updateTurbidity(value) {
        const el = document.getElementById('turbValue');
        el.textContent = Math.round(value);
        el.classList.remove('value-pop');
        void el.offsetWidth;
        el.classList.add('value-pop');

        const maxNTU = 3000;
        const percent = Math.min(value / maxNTU, 1);
        const circumference = 2 * Math.PI * 80;
        document.getElementById('turbGauge').setAttribute('stroke-dasharray', `${percent * circumference} ${circumference}`);
    }

    updateTOF(distance) {
        const tofValue = document.getElementById('tofValue');
        const indicator = document.getElementById('tofIndicator');
        const maxDist = 200;

        tofValue.textContent = Math.round(distance);
        tofValue.classList.remove('value-pop');
        void tofValue.offsetWidth;
        tofValue.classList.add('value-pop');

        const percent = Math.min(distance / maxDist, 1) * 100;
        indicator.style.left = `${percent}%`;

        if (distance < 30) {
            tofValue.style.color = '#dc2626';
        } else if (distance < 60) {
            tofValue.style.color = '#d97706';
        } else {
            tofValue.style.color = '#059669';
        }

        this.lastTOFDistance = distance;
    }

    updateRudder(angle) {
        const needle = document.getElementById('rudderNeedleSvg');
        const badge = document.getElementById('rudderAngleBadge');
        const compassText = document.getElementById('compassAngleText');
        const ripple = document.getElementById('compassRipple');
        const rotation = (angle - 90) * 1.2;

        if (needle) {
            needle.style.transform = `rotate(${rotation}deg)`;
        }
        if (badge) badge.innerHTML = `${angle}&deg;`;
        if (compassText) compassText.textContent = `${angle}\u00B0`;

        if (ripple) {
            ripple.classList.remove('active');
            void ripple.offsetWidth;
            ripple.classList.add('active');
        }
    }

    updateCameraImage(base64Image) {
        const img = document.getElementById('cameraImage');
        const overlay = document.getElementById('cameraOverlay');
        const timestamp = document.getElementById('cameraTimestamp');
        const liveDot = document.getElementById('cameraLiveDot');

        img.src = `data:image/jpeg;base64,${base64Image}`;
        overlay.classList.add('hidden');
        timestamp.textContent = new Date().toLocaleTimeString();

        if (liveDot) {
            liveDot.classList.add('visible');
        }
    }

    updateAIAnalysis(analysis) {
        const qualityMap = {
            'clean': { text: 'Clean - Good', class: 'clean', score: 90 },
            'slightly_polluted': { text: 'Slightly Polluted', class: 'slightly_polluted', score: 70 },
            'polluted': { text: 'Polluted', class: 'polluted', score: 45 },
            'heavily_polluted': { text: 'Heavily Polluted', class: 'heavily_polluted', score: 25 },
            'dangerous': { text: 'Dangerous!', class: 'dangerous', score: 10 },
            'skipped': { text: 'Analyzing...', class: 'clean', score: 0 }
        };

        const quality = qualityMap[analysis.water_quality] || qualityMap['clean'];
        const title = document.getElementById('aiWaterQuality');
        title.textContent = quality.text;

        const pollutionLevel = analysis.pollution_level || 0;
        const score = Math.max(0, 100 - pollutionLevel);

        const scoreRing = document.getElementById('scoreFillRing');
        const scoreNumber = document.getElementById('scoreNumber');
        const circumference = 2 * Math.PI * 50;
        const dashArray = (score / 100) * circumference;
        scoreRing.setAttribute('stroke-dasharray', `${dashArray} ${circumference}`);
        scoreNumber.textContent = score;

        if (score >= 75) {
            scoreRing.style.stroke = '#10b981';
            scoreNumber.style.fill = '#059669';
        } else if (score >= 50) {
            scoreRing.style.stroke = '#2563eb';
            scoreNumber.style.fill = '#2563eb';
        } else if (score >= 25) {
            scoreRing.style.stroke = '#d97706';
            scoreNumber.style.fill = '#d97706';
        } else {
            scoreRing.style.stroke = '#dc2626';
            scoreNumber.style.fill = '#dc2626';
        }

        const pollutionBar = document.getElementById('pollutionBar');
        const pollutionValue = document.getElementById('pollutionValue');
        pollutionBar.style.width = `${pollutionLevel}%`;
        pollutionValue.textContent = `${pollutionLevel}%`;

        document.getElementById('aiWaterColor').textContent = analysis.water_color || '--';
        document.getElementById('aiTurbidity').textContent = analysis.turbidity_visual || '--';

        const riskEl = document.getElementById('aiRiskLevel');
        riskEl.textContent = analysis.risk_level || '--';
        const riskColors = {
            none: '#059669', low: '#2563eb', medium: '#d97706',
            high: '#ea580c', critical: '#dc2626'
        };
        riskEl.style.color = riskColors[analysis.risk_level] || '#8aadd4';

        const objectsEl = document.getElementById('aiObjectsDetected');
        if (analysis.objects_detected && analysis.objects_detected.length > 0) {
            objectsEl.innerHTML = analysis.objects_detected
                .map(obj => `<span class="object-tag">${obj}</span>`).join('');
        } else {
            objectsEl.innerHTML = '<span class="no-data">None</span>';
        }

        const contaminantsEl = document.getElementById('aiContaminants');
        if (analysis.contaminants && analysis.contaminants.length > 0) {
            contaminantsEl.innerHTML = analysis.contaminants
                .map(c => `<span class="contaminant-tag">${c}</span>`).join('');
        } else {
            contaminantsEl.innerHTML = '<span class="no-data">None</span>';
        }

        if (analysis.description) {
            document.getElementById('aiDescription').innerHTML = `<p>${analysis.description}</p>`;
        } else {
            document.getElementById('aiDescription').innerHTML = '<p>Waiting for analysis...</p>';
        }

        const recEl = document.getElementById('aiRecommendation');
        const recText = document.getElementById('recommendationText');
        if (analysis.recommendation) {
            recEl.style.display = 'flex';
            recText.textContent = analysis.recommendation;
        } else {
            recEl.style.display = 'none';
        }

        document.getElementById('aiTimestamp').textContent = new Date().toLocaleTimeString();
    }

    setConnectionStatus(connected) {
        const statusDot = document.querySelector('#wsStatus .status-dot');
        const statusText = document.getElementById('wsStatusText');
        if (connected) {
            statusDot.className = 'status-dot online';
            statusText.textContent = 'Connected';
        } else {
            statusDot.className = 'status-dot offline';
            statusText.textContent = 'Disconnected';
        }
    }

    setControllerStatus(connected) {
        const deviceDot = document.getElementById('controllerDot');
        const deviceText = document.getElementById('controllerStatusText');
        if (!deviceDot || !deviceText) return;
        if (connected) {
            deviceDot.className = 'status-dot online';
            deviceText.textContent = 'Controller Online';
        } else {
            deviceDot.className = 'status-dot offline';
            deviceText.textContent = 'Controller Offline';
        }
    }

    setCameraStatus(connected) {
        const cameraDot = document.getElementById('cameraDot');
        const cameraText = document.getElementById('cameraStatusText');
        if (!cameraDot || !cameraText) return;
        if (connected) {
            cameraDot.className = 'status-dot online';
            cameraText.textContent = 'Camera Online';
        } else {
            cameraDot.className = 'status-dot offline';
            cameraText.textContent = 'Camera Offline';
        }
    }
}
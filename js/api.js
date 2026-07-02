const sendCmd = async (cmd, throttle = 0, turn = 0) => {
    const now = Date.now();
    const isStop = cmd === 'stop';

    // Check if parameters changed OR if it has been 300ms since the last command (heartbeat)
    const hasChanged = cmd !== lastSentCmd.cmd || throttle !== lastSentCmd.throttle || turn !== lastSentCmd.turn;
    const isHeartbeat = !isStop && (now - lastSentCmd.time >= 300);

    if (!hasChanged && !isHeartbeat) {
        // avoid spamming the server unless we need a heartbeat to keep motors alive.
        return;
    }

    if (currentController) {
        // abort the previous fetch if a new command arrives before it finishes.
        currentController.abort();
    }

    currentController = new AbortController();
    const { signal } = currentController;

    lastSentCmd = { cmd, throttle, turn, time: now };

    try {
        let url = `/control?cmd=${encodeURIComponent(cmd)}`;

        if (throttle) {
            url += `&throttle=${throttle.toFixed(2)}`;
        }

        if (turn) {
            url += `&turn=${turn.toFixed(2)}`;
        }

        await fetch(url, { signal });
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error('Command error:', e);
        }
    }
};


const updateSensor = async () => {
    if (window.isStreamSensors === false) {
        // throttle requests if the ui is hidden or minimized.
        setTimeout(updateSensor, 1000);
        return;
    }
    try {
        const res = await fetch('/sensor.json');
        const data = await res.json();
        const panel = document.getElementById('sensor-status');

        if (typeof recordSensorData === 'function') {
            recordSensorData(data);
        }

        const poseModeSelect = document.getElementById('pose-mode-select');
        if (data.pose_mode && poseModeSelect && document.activeElement !== poseModeSelect) {
            poseModeSelect.value = data.pose_mode;
        }

        const zuptSelect = document.getElementById('zupt-select');
        if (data.zupt_enabled !== undefined && zuptSelect && document.activeElement !== zuptSelect) {
            zuptSelect.value = data.zupt_enabled ? "true" : "false";
        }

        const panSlider = document.getElementById('camera-pan-slider');
        const panValue = document.getElementById('camera-pan-value');
        if (data.camera_rotation !== undefined && panSlider && panValue && document.activeElement !== panSlider && !cameraJoystickState.isDragging) {
            panSlider.value = data.camera_rotation;
            panValue.textContent = Math.round(data.camera_rotation) + '\u00B0';
            currentCameraPan = data.camera_rotation;
        }

        const tiltSlider = document.getElementById('camera-tilt-slider');
        const tiltValue = document.getElementById('camera-tilt-value');
        if (data.camera_angle !== undefined && tiltSlider && tiltValue && document.activeElement !== tiltSlider && !cameraJoystickState.isDragging) {
            tiltSlider.value = data.camera_angle;
            tiltValue.textContent = Math.round(data.camera_angle) + '\u00B0';
            currentCameraTilt = data.camera_angle;
        }

        const widgetPan = document.getElementById('widget-pan');
        const widgetTilt = document.getElementById('widget-tilt');
        if (widgetPan) widgetPan.textContent = Math.round(currentCameraPan);
        if (widgetTilt) widgetTilt.textContent = Math.round(currentCameraTilt);

        // Animate the car model widget
        const carServoBase = document.getElementById('car-servo-base');
        const carCameraLens = document.getElementById('car-camera-lens');
        
        if (carServoBase) {
            // offset by 65 degrees because that's our physical center position.
            let panAngle = currentCameraPan - 65;
            carServoBase.style.transform = `rotateZ(${panAngle}deg)`;
        }
        if (carCameraLens) {
            let tiltVal = Math.max(30, Math.min(120, currentCameraTilt));
            // dampen the visual rotation so it doesn't clip through the css model.
            let tiltRotation = (75 - tiltVal) * 0.8; 
            carCameraLens.style.transform = `rotateX(${tiltRotation}deg)`;
        }

        if (!panel) return;

        if (!data || Object.keys(data).length === 0) {
            panel.innerHTML = '<div class="sensor-item"><div class="sensor-label">No sensors</div><div class="sensor-value">--</div></div>';
            return;
        }

        const items = [];
        const hSensors = window.hiddenSensors || new Set();
        
        if (!hSensors.has('env') && (data.temp !== undefined || data.humidity !== undefined || data.pressure !== undefined)) {
            const t = data.temp !== undefined ? `${data.temp}\u00B0C` : '--';
            const h = data.humidity !== undefined ? `${data.humidity}%` : '--';
            const p = data.pressure !== undefined ? `${data.pressure}hPa` : '--';
            items.push(['Environment', `<span class="sensor-value-compact">T:&nbsp;${t}&nbsp;&nbsp;H:&nbsp;${h}&nbsp;&nbsp;P:&nbsp;${p}</span>`, '']);
        }
        if (!hSensors.has('gas') && (data.gas !== undefined || data.gas_percent !== undefined)) {
            const raw = data.gas !== undefined ? data.gas : '--';
            const pct = data.gas_percent !== undefined ? `${data.gas_percent}%` : '--';
            items.push(['Gas (MQ-2)', `<span class="sensor-value-compact">Raw:&nbsp;${raw}&nbsp;&nbsp;Pct:&nbsp;${pct}</span>`, '']);
        }

        if (!hSensors.has('accel') && data.accel) {
            const ax = typeof data.accel[0] === 'number' ? data.accel[0].toFixed(2) : '--';
            const ay = typeof data.accel[1] === 'number' ? data.accel[1].toFixed(2) : '--';
            const az = typeof data.accel[2] === 'number' ? data.accel[2].toFixed(2) : '--';
            items.push(['Accel (m/s²)', `<span class="sensor-value-compact">X:&nbsp;${ax}&nbsp;&nbsp;Y:&nbsp;${ay}&nbsp;&nbsp;Z:&nbsp;${az}</span>`, '']);
        }

        if (!hSensors.has('gyro') && data.gyro) {
            const gx = typeof data.gyro[0] === 'number' ? data.gyro[0].toFixed(2) : '--';
            const gy = typeof data.gyro[1] === 'number' ? data.gyro[1].toFixed(2) : '--';
            const gz = typeof data.gyro[2] === 'number' ? data.gyro[2].toFixed(2) : '--';
            items.push(['Gyro (\u00B0/s)', `<span class="sensor-value-compact">X:&nbsp;${gx}&nbsp;&nbsp;Y:&nbsp;${gy}&nbsp;&nbsp;Z:&nbsp;${gz}</span>`, '']);
        }

        if (!hSensors.has('distance') && data.ultrasonic_cm !== undefined) {
            items.push(['Distance', data.ultrasonic_cm, 'cm']);
        }

        if (!hSensors.has('sys') && data.cpu_temp !== undefined) {
            items.push(['System Health', `<span class="sensor-value-compact">CPU Temp:&nbsp;${data.cpu_temp}\u00B0C</span>`, '']);
        }

        if (items.length === 0) {
            if (data && data.devices && !data.devices.bme280 && !data.devices.imu && !data.devices.mq2 && !data.devices.ultrasonic) {
                panel.innerHTML = '<div class="sensor-item"><div class="sensor-label">Sensors</div><div class="sensor-value sensor-error">Offline</div></div>';
            } else {
                panel.innerHTML = '<div class="sensor-item"><div class="sensor-label">Loading...</div><div class="sensor-value">--</div></div>';
            }
        } else {
            panel.innerHTML = items.map(([label, value, unit]) =>
                `<div class="sensor-item"><div class="sensor-label">${label}</div>` +
                `<div class="sensor-value">${value ?? '--'}${unit ? ' ' + unit : ''}</div></div>`
            ).join('');
        }
    } catch (e) {
        const panel = document.getElementById('sensor-status');

        if (panel) {
            panel.innerHTML =
                '<div class="sensor-item"><div class="sensor-label">Connection</div><div class="sensor-value sensor-error">Failed</div></div>';
        }
    }
};

updateSensor();
setInterval(updateSensor, CONFIG.sensorInterval);

const robotActionStatus = document.getElementById('robot-action-status');

const showRobotActionStatus = (message, status = '') => {
    if (!robotActionStatus) return;

    robotActionStatus.textContent = message;
    robotActionStatus.className = status ? `settings-status ${status}` : 'settings-status';

    setTimeout(() => {
        robotActionStatus.textContent = '';
        robotActionStatus.className = 'settings-status';
    }, 3500);
};

const clearMiniMapState = () => {
    if (typeof mapState === 'undefined') return;

    mapState.path = [];
    mapState.smoothedPath = [];
    mapState.gasMarkers = [];
    mapState.obstacleHints = [];
    mapState.customPins = [];
    mapOffsetX = 0;
    mapOffsetY = 0;
    fsMapOffsetX = 0;
    fsMapOffsetY = 0;
};

const runRobotAction = async (buttonId, url, runningText, successText, clearMap = false) => {
    const btn = document.getElementById(buttonId);
    if (!btn) return;

    btn.onclick = async (e) => {
        e.stopPropagation();

        const oldText = btn.textContent;
        btn.disabled = true;
        btn.textContent = runningText;
        showRobotActionStatus('Running...');

        try {
            const res = await fetch(url);
            const data = await res.json();

            if (data.ok) {
                showRobotActionStatus(successText, 'success');

                if (clearMap) {
                    clearMiniMapState();
                }
            } else {
                showRobotActionStatus(data.message || 'Action failed', 'error');
            }
        } catch (err) {
            showRobotActionStatus('Connection failed', 'error');
        }

        btn.disabled = false;
        btn.textContent = oldText;
    };
};

runRobotAction('emergency-stop-btn', '/control?cmd=stop', 'Stopping...', 'Motors Stopped!');
document.getElementById('emergency-stop-btn')?.addEventListener('click', centerCamera);
runRobotAction('reset-pose-btn', '/reset_pose', 'Resetting...', 'Map reset', true);
runRobotAction('calibrate-mpu-btn', '/calibrate_mpu', 'Calibrating...', 'MPU calibrated and map reset', true);
runRobotAction('calibrate-mq2-btn', '/calibrate_mq2', 'Calibrating...', 'MQ-2 calibrated');

const poseModeSelect = document.getElementById('pose-mode-select');
if (poseModeSelect) {
    poseModeSelect.onchange = async () => {
        const mode = poseModeSelect.value;
        try {
            const res = await fetch(`/set_pose_mode?mode=${mode}`);
            const data = await res.json();
            if (data.ok) {
                showRobotActionStatus(`Tracking: ${mode === 'encoders' ? 'Encoders' : 'Accelerometer'}`, 'success');
                clearMiniMapState();
                
                if (mode === 'accelerometer' || mode === 'imu') {
                    try {
                        // automatically enable zupt because imus drift terribly without it.
                        const zuptRes = await fetch(`/set_zupt?enabled=true`);
                        const zuptData = await zuptRes.json();
                        if (zuptData.ok) {
                            const zuptSelect = document.getElementById('zupt-select');
                            if (zuptSelect) zuptSelect.value = "true";
                            showRobotActionStatus('ZUPT Auto-Enabled for Accelerometer', 'success');
                        }
                    } catch (err) {}
                } else if (mode === 'encoders') {
                    try {
                        const zuptRes = await fetch(`/set_zupt?enabled=false`);
                        const zuptData = await zuptRes.json();
                        if (zuptData.ok) {
                            const zuptSelect = document.getElementById('zupt-select');
                            if (zuptSelect) zuptSelect.value = "false";
                            showRobotActionStatus('ZUPT Auto-Disabled for Encoders', 'success');
                        }
                    } catch (err) {}
                }
            } else {
                showRobotActionStatus(data.message || 'Failed to change mode', 'error');
            }
        } catch (err) {
            showRobotActionStatus('Connection failed', 'error');
        }
    };
}

const zuptSelect = document.getElementById('zupt-select');
if (zuptSelect) {
    zuptSelect.onchange = async () => {
        const enabled = zuptSelect.value;
        try {
            const res = await fetch(`/set_zupt?enabled=${enabled}`);
            const data = await res.json();
            if (data.ok) {
                showRobotActionStatus(`ZUPT Calibration: ${enabled === 'true' ? 'Enabled' : 'Disabled'}`, 'success');
            } else {
                showRobotActionStatus(data.message || 'Failed to change ZUPT', 'error');
            }
        } catch (err) {
            showRobotActionStatus('Network error changing ZUPT', 'error');
        }
    };
}





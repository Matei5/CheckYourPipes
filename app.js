const sensorPanel = document.getElementById('sensor-panel');
const sensorToggle = document.getElementById('sensor-toggle');
const joystickContainer = document.getElementById('joystick-container');
const sizeButtons = document.querySelectorAll('.size-btn');

const sensitivitySettings = {
    small: { maxDistance: 20, deadZone: 4 },
    medium: { maxDistance: 27, deadZone: 6 },
    large: { maxDistance: 35, deadZone: 8 }
};

let currentSize = localStorage.getItem('sensorSize') || 'medium';

sensorPanel.classList.remove('size-small', 'size-medium', 'size-large');
sensorPanel.classList.add('size-' + currentSize);
joystickContainer.classList.remove('size-small', 'size-medium', 'size-large');
joystickContainer.classList.add('size-' + currentSize);
sizeButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.size == currentSize);
});

sensorToggle.addEventListener('click', () => {
    sensorPanel.classList.toggle('collapsed');
});

sizeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const newSize = btn.dataset.size;
        
        sizeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        sensorPanel.classList.remove('size-small', 'size-medium', 'size-large');
        sensorPanel.classList.add('size-' + newSize);
        
        joystickContainer.classList.remove('size-small', 'size-medium', 'size-large');
        joystickContainer.classList.add('size-' + newSize);
        
        updateJoystickSensitivity(newSize);
        
        localStorage.setItem('sensorSize', newSize);
        currentSize = newSize;
    });
});

const joystickState = {
    isDragging: false,
    lastCommand: null,
    lastThrottle: 0,
    lastTurn: 0,
    x: 0,
    y: 0,
    animationFrameId: null,
    updateIntervalId: null
};

const stick = document.getElementById('joystick-stick');
const base = document.getElementById('joystick-base');

let maxDistance = sensitivitySettings[currentSize].maxDistance;
let deadZone = sensitivitySettings[currentSize].deadZone;

function updateJoystickSensitivity(size) {
    maxDistance = sensitivitySettings[size].maxDistance;
    deadZone = sensitivitySettings[size].deadZone;
}

function getBaseRect() {
    return base.getBoundingClientRect();
}

function getAngleAndDistance(x, y) {
    const rect = getBaseRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    return { dx, dy, distance, angle };
}

function getThrottleAndTurn(dx, dy, distance) {
    // Returns { throttle: 0-1, turn: -1 to 1 (for forward/back), command: 'forward'|'back'|'left'|'right'|null }
    if (distance < deadZone) {
        return { throttle: 0, turn: 0, command: null };
    }
    
    // Normalize throttle (0 to 1 based on distance)
    const throttle = Math.min(1.0, distance / maxDistance);
    
    const angle = Math.atan2(dy, dx);
    const normalizedAngle = (angle + Math.PI) / (2 * Math.PI) * 360;
    
    let command = null;
    let turn = 0;
    
    if (normalizedAngle < 45 || normalizedAngle >= 315) {
        command = 'right';
    } else if (normalizedAngle >= 45 && normalizedAngle < 135) {
        command = 'forward';
        turn = dx / (maxDistance * 0.7);
        turn = Math.max(-1, Math.min(1, turn));
    } else if (normalizedAngle >= 135 && normalizedAngle < 225) {
        command = 'left';
    } else if (normalizedAngle >= 225 && normalizedAngle < 315) {
        command = 'back';
        turn = dx / (maxDistance * 0.7);
        turn = Math.max(-1, Math.min(1, turn));
    }
    
    return { throttle, turn, command };
}

function updateStickPosition(x, y) {
    const rect = getBaseRect();
    const localX = x - rect.left;
    const localY = y - rect.top;
    const angleAndDistance = getAngleAndDistance(localX, localY);
    const distance = angleAndDistance.distance;
    const constrainedDistance = Math.min(distance, maxDistance);
    const angle = angleAndDistance.angle;
    const offsetX = Math.cos(angle) * constrainedDistance;
    const offsetY = Math.sin(angle) * constrainedDistance;
    
    joystickState.x = offsetX;
    joystickState.y = offsetY;
    
    stick.style.transform = 'translate(calc(-50% + ' + offsetX + 'px), calc(-50% + ' + offsetY + 'px))';
    
    const { throttle, turn, command } = getThrottleAndTurn(offsetX, offsetY, constrainedDistance);
    joystickState.lastThrottle = throttle;
    joystickState.lastTurn = turn;
    joystickState.lastCommand = command;
}

function springBack() {
    const springStrength = 0.15;
    const friction = 0.92;
    
    function animate() {
        joystickState.x *= friction;
        joystickState.y *= friction;
        
        stick.style.transform = 'translate(calc(-50% + ' + joystickState.x + 'px), calc(-50% + ' + joystickState.y + 'px))';
        
        if (Math.abs(joystickState.x) > 0.5 || Math.abs(joystickState.y) > 0.5) {
            joystickState.animationFrameId = requestAnimationFrame(animate);
        } else {
            joystickState.x = 0;
            joystickState.y = 0;
            stick.style.transform = 'translate(-50%, -50%)';
            joystickState.lastCommand = null;
            joystickState.lastThrottle = 0;
            joystickState.lastTurn = 0;
            sendCmd('stop', 0, 0);
        }
    }
    
    if (joystickState.animationFrameId) {
        cancelAnimationFrame(joystickState.animationFrameId);
    }
    animate();
}

function startJoystickUpdates() {
    if (joystickState.updateIntervalId) {
        clearInterval(joystickState.updateIntervalId);
    }
    joystickState.updateIntervalId = setInterval(() => {
        if (joystickState.lastCommand) {
            sendCmd(joystickState.lastCommand, joystickState.lastThrottle, joystickState.lastTurn);
        } else {
            sendCmd('stop', 0, 0);
        }
    }, 50);
}

function stopJoystickUpdates() {
    if (joystickState.updateIntervalId) {
        clearInterval(joystickState.updateIntervalId);
        joystickState.updateIntervalId = null;
    }
}

base.addEventListener('touchstart', (e) => {
    joystickState.isDragging = true;
    stick.classList.add('active');
    const touch = e.touches[0];
    updateStickPosition(touch.clientX, touch.clientY);
    startJoystickUpdates();
    e.preventDefault();
});

document.addEventListener('touchmove', (e) => {
    if (!joystickState.isDragging) return;
    const touch = e.touches[0];
    updateStickPosition(touch.clientX, touch.clientY);
    e.preventDefault();
});

document.addEventListener('touchend', () => {
    if (!joystickState.isDragging) return;
    joystickState.isDragging = false;
    stick.classList.remove('active');
    stopJoystickUpdates();
    springBack();
});

stick.addEventListener('mousedown', () => {
    joystickState.isDragging = true;
    stick.classList.add('active');
    startJoystickUpdates();
});

document.addEventListener('mousemove', (e) => {
    if (!joystickState.isDragging) return;
    updateStickPosition(e.clientX, e.clientY);
});

document.addEventListener('mouseup', () => {
    if (!joystickState.isDragging) return;
    joystickState.isDragging = false;
    stick.classList.remove('active');
    stopJoystickUpdates();
    springBack();
});

async function updateSensor() {
    try {
        const response = await fetch('/sensor.json');
        const data = await response.json();
        const panel = document.getElementById('sensor-status');

        if (data.error) {
            panel.innerHTML = '<div class="sensor-item"><div class="sensor-label">Error</div><div class="sensor-value sensor-error">Sensor Error</div></div>';
            return;
        }

        let html = `
            <div class="sensor-item">
                <div class="sensor-label">Temperature</div>
                <div class="sensor-value">${data.temperature ?? '--'} °C</div>
            </div>
            <div class="sensor-item">
                <div class="sensor-label">Humidity</div>
                <div class="sensor-value">${data.humidity ?? '--'} %</div>
            </div>
            <div class="sensor-item">
                <div class="sensor-label">Pressure</div>
                <div class="sensor-value">${data.pressure ?? '--'} hPa</div>
            </div>
        `;

        if (data.acceleration) {
            html += `
            <div class="sensor-item">
                <div class="sensor-label">Accel X</div>
                <div class="sensor-value">${data.acceleration.x ?? '--'} m/s²</div>
            </div>
            <div class="sensor-item">
                <div class="sensor-label">Accel Y</div>
                <div class="sensor-value">${data.acceleration.y ?? '--'} m/s²</div>
            </div>
            <div class="sensor-item">
                <div class="sensor-label">Accel Z</div>
                <div class="sensor-value">${data.acceleration.z ?? '--'} m/s²</div>
            </div>
            `;
        }

        if (data.gyroscope) {
            html += `
            <div class="sensor-item">
                <div class="sensor-label">Gyro X</div>
                <div class="sensor-value">${data.gyroscope.x ?? '--'} rad/s</div>
            </div>
            <div class="sensor-item">
                <div class="sensor-label">Gyro Y</div>
                <div class="sensor-value">${data.gyroscope.y ?? '--'} rad/s</div>
            </div>
            <div class="sensor-item">
                <div class="sensor-label">Gyro Z</div>
                <div class="sensor-value">${data.gyroscope.z ?? '--'} rad/s</div>
            </div>
            `;
        }

        panel.innerHTML = html;
    } catch (err) {
        document.getElementById('sensor-status').innerHTML =
            '<div class="sensor-item"><div class="sensor-label">Error</div><div class="sensor-value sensor-error">Load Failed</div></div>';
    }
}

async function sendCmd(cmd, throttle = null, turn = null) {
    try {
        let url = '/control?cmd=' + encodeURIComponent(cmd);
        if (throttle !== null) {
            url += '&throttle=' + encodeURIComponent(throttle.toFixed(2));
        }
        if (turn !== null && turn !== 0) {
            url += '&turn=' + encodeURIComponent(turn.toFixed(2));
        }
        await fetch(url);
    } catch (err) {
        console.error('Command failed:', err);
    }
}

document.addEventListener('keydown', function(event) {
    const key = event.key.toLowerCase();
    if (key == 'w') sendCmd('forward', 1.0, 0);
    else if (key == 's') sendCmd('back', 1.0, 0);
    else if (key == 'a') sendCmd('left', 1.0, 0);
    else if (key == 'd') sendCmd('right', 1.0, 0);
    else if (key == ' ') {
        event.preventDefault();
        sendCmd('stop', 0, 0);
    }
});

document.addEventListener('keyup', function(event) {
    const key = event.key.toLowerCase();
    if (key == 'w' || key == 's' || key == 'a' || key == 'd') {
        sendCmd('stop', 0, 0);
    }
});

const SENSOR_FETCH_INTERVAL_MS = 1000;

updateSensor();
setInterval(updateSensor, SENSOR_FETCH_INTERVAL_MS);

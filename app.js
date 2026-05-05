// Sensor panel state
const sensorPanel = document.getElementById('sensor-panel');
const sensorToggle = document.getElementById('sensor-toggle');
const joystickContainer = document.getElementById('joystick-container');
const sizeButtons = document.querySelectorAll('.size-btn');

// Sensitivity settings for each size
const sensitivitySettings = {
    small: { maxDistance: 20, deadZone: 4 },
    medium: { maxDistance: 27, deadZone: 6 },
    large: { maxDistance: 35, deadZone: 8 }
};

// Load saved size from localStorage or default to medium
let currentSize = localStorage.getItem('sensorSize') || 'medium';

// Apply saved size on load
sensorPanel.classList.remove('size-small', 'size-medium', 'size-large');
sensorPanel.classList.add('size-' + currentSize);
joystickContainer.classList.remove('size-small', 'size-medium', 'size-large');
joystickContainer.classList.add('size-' + currentSize);
sizeButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.size == currentSize);
});

// Toggle panel open/close
sensorToggle.addEventListener('click', () => {
    sensorPanel.classList.toggle('collapsed');
});

// Size button handlers
sizeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const newSize = btn.dataset.size;
        
        // Update active button
        sizeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update panel size
        sensorPanel.classList.remove('size-small', 'size-medium', 'size-large');
        sensorPanel.classList.add('size-' + newSize);
        
        // Update joystick size
        joystickContainer.classList.remove('size-small', 'size-medium', 'size-large');
        joystickContainer.classList.add('size-' + newSize);
        
        // Update joystick sensitivity
        updateJoystickSensitivity(newSize);
        
        // Save to localStorage
        localStorage.setItem('sensorSize', newSize);
        currentSize = newSize;
    });
});

// Joystick state
const joystickState = {
    isDragging: false,
    lastCommand: 'stop',
    x: 0,
    y: 0,
    animationFrameId: null
};

const stick = document.getElementById('joystick-stick');
const base = document.getElementById('joystick-base');

// Initialize sensitivity based on current size
let maxDistance = sensitivitySettings[currentSize].maxDistance;
let deadZone = sensitivitySettings[currentSize].deadZone;

// Function to update joystick sensitivity
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

function determineCommand(dx, dy, distance) {
    if (distance < deadZone) return 'stop';
    
    const angle = Math.atan2(dy, dx);
    const normalizedAngle = (angle + Math.PI) / (2 * Math.PI) * 360;
    
    if (normalizedAngle < 45 || normalizedAngle >= 315) return 'right';
    if (normalizedAngle >= 45 && normalizedAngle < 135) return 'forward';
    if (normalizedAngle >= 135 && normalizedAngle < 225) return 'left';
    if (normalizedAngle >= 225 && normalizedAngle < 315) return 'back';
    
    return 'stop';
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
    
    const command = determineCommand(offsetX, offsetY, constrainedDistance);
    if (command != joystickState.lastCommand) {
        joystickState.lastCommand = command;
        sendCmd(command);
    }
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
            joystickState.lastCommand = 'stop';
            sendCmd('stop');
        }
    }
    
    if (joystickState.animationFrameId) {
        cancelAnimationFrame(joystickState.animationFrameId);
    }
    animate();
}

// Touch events
base.addEventListener('touchstart', (e) => {
    joystickState.isDragging = true;
    stick.classList.add('active');
    const touch = e.touches[0];
    updateStickPosition(touch.clientX, touch.clientY);
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
    springBack();
});

// Mouse events
stick.addEventListener('mousedown', () => {
    joystickState.isDragging = true;
    stick.classList.add('active');
});

document.addEventListener('mousemove', (e) => {
    if (!joystickState.isDragging) return;
    updateStickPosition(e.clientX, e.clientY);
});

document.addEventListener('mouseup', () => {
    if (!joystickState.isDragging) return;
    joystickState.isDragging = false;
    stick.classList.remove('active');
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

        panel.innerHTML = `
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
    } catch (err) {
        document.getElementById('sensor-status').innerHTML =
            '<div class="sensor-item"><div class="sensor-label">Error</div><div class="sensor-value sensor-error">Load Failed</div></div>';
    }
}

async function sendCmd(cmd) {
    try {
        await fetch('/control?cmd=' + encodeURIComponent(cmd));
    } catch (err) {
        console.error('Command failed:', err);
    }
}

document.addEventListener('keydown', function(event) {
    const key = event.key.toLowerCase();
    if (key == 'w') sendCmd('forward');
    else if (key == 's') sendCmd('back');
    else if (key == 'a') sendCmd('left');
    else if (key == 'd') sendCmd('right');
    else if (key == ' ') {
        event.preventDefault();
        sendCmd('stop');
    }
});

document.addEventListener('keyup', function(event) {
    const key = event.key.toLowerCase();
    if (key == 'w' || key == 's' || key == 'a' || key == 'd') {
        sendCmd('stop');
    }
});

// Read from config
const SENSOR_FETCH_INTERVAL = 1000; // milliseconds

updateSensor();
setInterval(updateSensor, SENSOR_FETCH_INTERVAL);

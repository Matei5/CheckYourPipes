// Sensor panel state
const sensorPanel = document.getElementById('sensor-panel');
const sensorToggle = document.getElementById('sensor-toggle');
const directionalPad = document.getElementById('directional-pad');
const sizeButtons = document.querySelectorAll('.size-btn');

// Command mapping for directional buttons
const buttonCommandMap = {
    'dir-forward': 'forward',
    'dir-back': 'back',
    'dir-left': 'left',
    'dir-right': 'right',
    'dir-forward-left': 'forward',
    'dir-forward-right': 'forward',
    'dir-back-left': 'back',
    'dir-back-right': 'back',
};

// Load saved size from localStorage or default to medium
let currentSize = localStorage.getItem('sensorSize') || 'medium';

// Apply saved size on load
sensorPanel.classList.remove('size-small', 'size-medium', 'size-large');
sensorPanel.classList.add('size-' + currentSize);
document.getElementById('joystick-container').classList.remove('size-small', 'size-medium', 'size-large');
document.getElementById('joystick-container').classList.add('size-' + currentSize);
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
        
        // Update directional pad size
        document.getElementById('joystick-container').classList.remove('size-small', 'size-medium', 'size-large');
        document.getElementById('joystick-container').classList.add('size-' + newSize);
        
        // Save to localStorage
        localStorage.setItem('sensorSize', newSize);
        currentSize = newSize;
    });
});

// Directional pad state
const padState = {
    isDragging: false,
    lastCommand: 'stop',
    currentButton: null,
    startX: 0,
    startY: 0
};

// Get all directional buttons
const dirButtons = document.querySelectorAll('.dir-btn:not(.dir-btn-spacer)');

// Function to get command from button ID
function getCommand(buttonId) {
    return buttonCommandMap[buttonId] || 'stop';
}

// Function to activate a button
function activateButton(button) {
    if (padState.currentButton && padState.currentButton !== button) {
        padState.currentButton.classList.remove('active');
    }
    
    if (button) {
        button.classList.add('active');
        const command = getCommand(button.id);
        if (command !== padState.lastCommand) {
            padState.lastCommand = command;
            sendCmd(command);
        }
        padState.currentButton = button;
    }
}

// Function to deactivate all buttons
function deactivateAll() {
    if (padState.currentButton) {
        padState.currentButton.classList.remove('active');
        padState.currentButton = null;
    }
    if (padState.lastCommand !== 'stop') {
        padState.lastCommand = 'stop';
        sendCmd('stop');
    }
}

// Function to find button at coordinates
function getButtonAtCoordinates(clientX, clientY) {
    return dirButtons.find(btn => {
        const rect = btn.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right &&
               clientY >= rect.top && clientY <= rect.bottom;
    });
}

// Touch events
directionalPad.addEventListener('touchstart', (e) => {
    padState.isDragging = true;
    const touch = e.touches[0];
    padState.startX = touch.clientX;
    padState.startY = touch.clientY;
    
    const button = getButtonAtCoordinates(touch.clientX, touch.clientY);
    if (button) {
        activateButton(button);
    }
    e.preventDefault();
}, false);

document.addEventListener('touchmove', (e) => {
    if (!padState.isDragging) return;
    const touch = e.touches[0];
    
    const button = getButtonAtCoordinates(touch.clientX, touch.clientY);
    if (button) {
        activateButton(button);
    } else {
        deactivateAll();
    }
    e.preventDefault();
}, false);

document.addEventListener('touchend', () => {
    if (!padState.isDragging) return;
    padState.isDragging = false;
    deactivateAll();
}, false);

// Mouse events
directionalPad.addEventListener('mousedown', (e) => {
    padState.isDragging = true;
    padState.startX = e.clientX;
    padState.startY = e.clientY;
    
    const button = getButtonAtCoordinates(e.clientX, e.clientY);
    if (button) {
        activateButton(button);
    }
});

document.addEventListener('mousemove', (e) => {
    if (!padState.isDragging) return;
    
    const button = getButtonAtCoordinates(e.clientX, e.clientY);
    if (button) {
        activateButton(button);
    } else {
        deactivateAll();
    }
});

document.addEventListener('mouseup', () => {
    if (!padState.isDragging) return;
    padState.isDragging = false;
    deactivateAll();
});

// Prevent context menu on long press
directionalPad.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    return false;
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
    if (['w', 'a', 's', 'd'].includes(key)) {
        sendCmd('stop');
    }
});

// Read from config
const SENSOR_FETCH_INTERVAL = 1000; // milliseconds

updateSensor();
setInterval(updateSensor, SENSOR_FETCH_INTERVAL);

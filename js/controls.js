// Removed updateActiveArrow as we no longer use directional arrows
const updateJoystickCommand = () => {
    if (!joystickState.isDragging) return;

    const container = document.getElementById('joystick-container');
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const maxDistance = rect.width / 2;

    const dx = joystickState.dx;
    const dy = joystickState.dy;

    const ratioX = maxDistance > 0 ? dx / maxDistance : 0;
    const ratioY = maxDistance > 0 ? dy / maxDistance : 0;
    const d = Math.hypot(ratioX, ratioY);

    const deadZone = 0.15;
    if (d < deadZone) {
        // small deadzone prevents accidental drift when releasing the stick.
        sendCmd('stop', 0, 0);
        return;
    }

    let cmd = 'stop';
    let throttle = 0;
    let turn = 0;

    // Calculate angle in degrees
    const angle = Math.atan2(ratioY, ratioX);
    const deg = angle * 180 / Math.PI;

    // Determine if motion is primarily horizontal (pivot turn) or vertical (forward/back)
    // Left/Right pivot wedges: [-25, 25] and [155, 180] or [-180, -155]
    if (Math.abs(deg) < 25 || Math.abs(deg) > 155) {
        // horizontal stick movement triggers on-the-spot pivot turns.
        cmd = ratioX < 0 ? 'left' : 'right';
        throttle = Math.abs(ratioX) * CURRENT_THROTTLE;
        turn = 0;
    } else {
        // vertical/diagonal movement triggers forward/back driving with steering.
        cmd = ratioY < 0 ? 'forward' : 'back';
        throttle = d * CURRENT_THROTTLE; // Proportional speed based on how far handle is dragged
        if (throttle > CURRENT_THROTTLE) throttle = CURRENT_THROTTLE;
        turn = ratioX; // Proportional steering
    }

    sendCmd(cmd, throttle, turn);
};

const handleJoystickStart = (clientX, clientY) => {
    const container = document.getElementById('joystick-container');
    if (!container) return;

    joystickState.isDragging = true;

    const rect = container.getBoundingClientRect();
    joystickState.centerX = rect.left + rect.width / 2;
    joystickState.centerY = rect.top + rect.height / 2;

    handleJoystickMove(clientX, clientY);

    if (joystickState.intervalId) {
        clearInterval(joystickState.intervalId);
    }
    joystickState.intervalId = setInterval(updateJoystickCommand, 80);
};

const handleJoystickMove = (clientX, clientY) => {
    if (!joystickState.isDragging) return;

    let dx = clientX - joystickState.centerX;
    let dy = clientY - joystickState.centerY;

    // Full 360-degree analog movement (snapping removed)

    const container = document.getElementById('joystick-container');
    const joystickHandle = document.getElementById('joystick-handle');
    if (!container || !joystickHandle) return;

    const rect = container.getBoundingClientRect();
    const maxDistance = rect.width / 2;

    const d = Math.hypot(dx, dy);
    if (d > maxDistance) {
        dx = (dx / d) * maxDistance;
        dy = (dy / d) * maxDistance;
    }

    joystickState.dx = dx;
    joystickState.dy = dy;

    joystickHandle.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
};

const handleJoystickEnd = () => {
    if (!joystickState.isDragging) return;

    joystickState.isDragging = false;
    if (joystickState.intervalId) {
        clearInterval(joystickState.intervalId);
        joystickState.intervalId = null;
    }

    joystickState.dx = 0;
    joystickState.dy = 0;

    const joystickHandle = document.getElementById('joystick-handle');
    if (joystickHandle) {
        joystickHandle.style.transform = 'translate3d(0, 0, 0)';
    }

    sendCmd('stop', 0, 0);
    updateActiveArrow('stop');
};

const joystickContainer = document.getElementById('joystick-container');
if (joystickContainer) {
    joystickContainer.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        handleJoystickStart(e.clientX, e.clientY);
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (joystickState.isDragging) {
            handleJoystickMove(e.clientX, e.clientY);
        }
    });

    window.addEventListener('mouseup', () => {
        if (joystickState.isDragging) {
            handleJoystickEnd();
        }
    });

    joystickContainer.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            handleJoystickStart(e.touches[0].clientX, e.touches[0].clientY);
            e.preventDefault();
        }
    });

    window.addEventListener('touchmove', (e) => {
        if (joystickState.isDragging && e.touches.length === 1) {
            handleJoystickMove(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true }); // passive true improves touch scrolling performance on mobile.

    window.addEventListener('touchend', () => {
        if (joystickState.isDragging) {
            handleJoystickEnd();
        }
    });

    window.addEventListener('touchcancel', () => {
        if (joystickState.isDragging) {
            handleJoystickEnd();
        }
    });
}

const cameraJoystickState = {
    isDragging: false,
    centerX: 0,
    centerY: 0,
    dx: 0,
    dy: 0,
    intervalId: null
};

let currentCameraPan = 65.0;
let currentCameraTilt = 75.0;

const updateCameraJoystickCommand = () => {
    if (!cameraJoystickState.isDragging) return;

    const container = document.getElementById('camera-joystick-container');
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const maxDistance = rect.width / 2;

    const dx = cameraJoystickState.dx;
    const dy = cameraJoystickState.dy;

    const d = Math.hypot(dx, dy);
    const ratioX = maxDistance > 0 ? dx / maxDistance : 0;
    const ratioY = maxDistance > 0 ? dy / maxDistance : 0;

    const deadZone = 0.15;
    if (d / maxDistance < deadZone) return;

    // We update every 80ms (dt = 0.08s)
    // limit max speed so servo doesn't jerk too fast.
    const maxSpeed = 90.0;
    const deltaPan = ratioX * maxSpeed * 0.08;
    const deltaTilt = -ratioY * maxSpeed * 0.08;

    currentCameraPan = Math.max(30.0, Math.min(120.0, currentCameraPan + deltaPan));
    currentCameraTilt = Math.max(30.0, Math.min(120.0, currentCameraTilt + deltaTilt));

    const pan = Math.round(currentCameraPan);
    const tilt = Math.round(currentCameraTilt);

    if (cameraPanSlider && cameraPanValue) {
        cameraPanSlider.value = pan;
        cameraPanValue.textContent = pan + '\u00B0';
    }

    if (cameraTiltSlider && cameraTiltValue) {
        cameraTiltSlider.value = tilt;
        cameraTiltValue.textContent = tilt + '\u00B0';
    }

    sendCameraServo(pan, tilt);
};

const handleCameraJoystickStart = (clientX, clientY) => {
    const container = document.getElementById('camera-joystick-container');
    if (!container) return;

    cameraJoystickState.isDragging = true;

    const rect = container.getBoundingClientRect();
    cameraJoystickState.centerX = rect.left + rect.width / 2;
    cameraJoystickState.centerY = rect.top + rect.height / 2;

    handleCameraJoystickMove(clientX, clientY);

    if (cameraJoystickState.intervalId) {
        clearInterval(cameraJoystickState.intervalId);
    }
    cameraJoystickState.intervalId = setInterval(updateCameraJoystickCommand, 80);
};

const handleCameraJoystickMove = (clientX, clientY) => {
    if (!cameraJoystickState.isDragging) return;

    let dx = clientX - cameraJoystickState.centerX;
    let dy = clientY - cameraJoystickState.centerY;

    const container = document.getElementById('camera-joystick-container');
    const joystickHandle = document.getElementById('camera-joystick-handle');
    if (!container || !joystickHandle) return;

    const rect = container.getBoundingClientRect();
    const maxDistance = rect.width / 2;

    const d = Math.hypot(dx, dy);
    if (d > maxDistance) {
        dx = (dx / d) * maxDistance;
        dy = (dy / d) * maxDistance;
    }

    cameraJoystickState.dx = dx;
    cameraJoystickState.dy = dy;

    joystickHandle.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
};

const handleCameraJoystickEnd = () => {
    if (!cameraJoystickState.isDragging) return;

    cameraJoystickState.isDragging = false;
    if (cameraJoystickState.intervalId) {
        clearInterval(cameraJoystickState.intervalId);
        cameraJoystickState.intervalId = null;
    }

    cameraJoystickState.dx = 0;
    cameraJoystickState.dy = 0;

    const joystickHandle = document.getElementById('camera-joystick-handle');
    if (joystickHandle) {
        joystickHandle.style.transform = 'translate3d(0, 0, 0)';
    }
};

const centerCamera = () => {
    currentCameraPan = 65.0;
    currentCameraTilt = 75.0;

    if (cameraPanSlider && cameraPanValue) {
        cameraPanSlider.value = 65;
        cameraPanValue.textContent = '65\u00B0';
    }

    if (cameraTiltSlider && cameraTiltValue) {
        cameraTiltSlider.value = 75;
        cameraTiltValue.textContent = '75\u00B0';
    }

    sendCameraServo(65, 75);
};

const cameraJoystickContainer = document.getElementById('camera-joystick-container');
if (cameraJoystickContainer) {
    cameraJoystickContainer.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        handleCameraJoystickStart(e.clientX, e.clientY);
        e.preventDefault();
    });

    cameraJoystickContainer.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        centerCamera();
    });

    window.addEventListener('mousemove', (e) => {
        if (cameraJoystickState.isDragging) {
            handleCameraJoystickMove(e.clientX, e.clientY);
        }
    });

    window.addEventListener('mouseup', () => {
        if (cameraJoystickState.isDragging) {
            handleCameraJoystickEnd();
        }
    });

    cameraJoystickContainer.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            handleCameraJoystickStart(e.touches[0].clientX, e.touches[0].clientY);
            e.preventDefault();
        }
    });

    window.addEventListener('touchmove', (e) => {
        if (cameraJoystickState.isDragging && e.touches.length === 1) {
            handleCameraJoystickMove(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true });

    let lastCameraTapTime = 0;
    window.addEventListener('touchend', (e) => {
        if (cameraJoystickState.isDragging) {
            handleCameraJoystickEnd();

            // Double tap to center camera view
            const now = Date.now();
            if (now - lastCameraTapTime < 300) {
                centerCamera();
            }
            lastCameraTapTime = now;
        }
    });

    window.addEventListener('touchcancel', () => {
        if (cameraJoystickState.isDragging) {
            handleCameraJoystickEnd();
        }
    });
}

const keys = new Set();
let keyMovementInterval = null;

const updateKeyMovement = () => {
    const has = (k) => keys.has(k);

    if (!has('w') && !has('s') && !has('a') && !has('d')) {
        if (keyMovementInterval) {
            clearInterval(keyMovementInterval);
            keyMovementInterval = null;
        }
        return sendCmd('stop', 0, 0);
    }

    // Start a heartbeat interval if it's not already running
    if (!keyMovementInterval) {
        keyMovementInterval = setInterval(updateKeyMovement, 200);
    }

    if (has('w') && has('a')) {
        sendCmd('forward', CURRENT_THROTTLE, -1.0);
    } else if (has('w') && has('d')) {
        sendCmd('forward', CURRENT_THROTTLE, 1.0);
    } else if (has('s') && has('a')) {
        sendCmd('back', CURRENT_THROTTLE, -1.0);
    } else if (has('s') && has('d')) {
        sendCmd('back', CURRENT_THROTTLE, 1.0);
    } else if (has('w')) {
        sendCmd('forward', CURRENT_THROTTLE, 0);
    } else if (has('s')) {
        sendCmd('back', CURRENT_THROTTLE, 0);
    } else if (has('a')) {
        sendCmd('left', 1.0, 0);
    } else if (has('d')) {
        sendCmd('right', 1.0, 0);
    }
};

const isUserTyping = () => {
    return ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
};

// true when any centre-screen modal is blocking the ui.
const isModalOpen = () => {
    const ids = ['data-modal', 'map-modal', 'snapshot-modal', 'pin-edit-modal', 'keybinds-modal'];
    return ids.some(id => document.getElementById(id)?.classList.contains('open'));
};

let toastTimer = null;
const showToast = (message, color = '#94d4a8') => {
    const el = document.getElementById('toast-notification');
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';
    el.style.borderColor = color + '44';
    el.style.color = color;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, 2500);
};

document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (isUserTyping()) return;
    const k = e.key.toLowerCase();

    // Escape closes whatever modal is currently open.
    if (k === 'escape') {
        const ids = ['snapshot-modal', 'pin-edit-modal', 'keybinds-modal', 'data-modal', 'map-modal'];
        for (const id of ids) {
            const el = document.getElementById(id);
            if (el?.classList.contains('open')) {
                el.classList.remove('open');
                break;
            }
        }
        return;
    }

    // Space (emergency stop) works regardless of modal state.
    if (k === ' ') {
        e.preventDefault();
        keys.clear();
        sendCmd('stop', 0, 0);
        document.getElementById('emergency-stop-btn')?.click();
        return;
    }

    // Ctrl+Z (show UI) works regardless of modal state.
    if (k === 'z' && e.ctrlKey) {
        document.body.classList.remove('hide-ui');
        return;
    }

    // all other shortcuts are blocked while a modal is open.
    if (isModalOpen()) return;

    if (['w', 's', 'a', 'd'].includes(k)) {
        keys.add(k);
        updateKeyMovement();
    } else if (k === 'h') {
        document.body.classList.toggle('hide-ui');
    } else if (k === 'q') {
        if (typeof openSnapshotModal === 'function') openSnapshotModal();
    } else if (k === 'e') {
        document.getElementById('minimap-popup')?.click();
    } else if (k === 'r') {
        document.getElementById('reset-pose-btn')?.click();
    } else if (k === 'c') {
        document.getElementById('calibrate-mpu-btn')?.click();
    } else if (k === 'p') {
        if (typeof takePanorama === 'function') takePanorama();
    } else if (k === 'f') {
        if (typeof setHighResState === 'function') setHighResState(true);
    }
});

document.addEventListener('keyup', (e) => {
    if (isUserTyping()) return;
    const k = e.key.toLowerCase();

    if (['w', 's', 'a', 'd'].includes(k)) {
        keys.delete(k);
        updateKeyMovement();
    } else if (k === 'f') {
        if (typeof setHighResState === 'function') setHighResState(false);
    }
});

window.isHighResOn = false;
window.setHighResState = (state) => {
    window.isHighResOn = state;
    const overlay = document.getElementById('hires-overlay');
    const img = document.getElementById('hires-stream-img');
    const btn = document.getElementById('toggle-hires-btn');
    
    if (state) {
        fetch('/set_camera_res?high=true').catch(e => console.error(e));
        if (overlay && img) {
            img.src = '/stream.mjpg?' + Date.now();
            overlay.style.display = 'flex';
        }
        if (btn) {
            btn.textContent = 'High-Res: ON';
            btn.classList.add('active');
        }
        showToast('🔍 High-Res ON', '#7dd3fc');
    } else {
        if (overlay) overlay.style.display = 'none';
        if (img) img.src = '';
        fetch('/set_camera_res?high=false').catch(e => console.error(e));
        if (btn) {
            btn.textContent = 'High-Res: OFF';
            btn.classList.remove('active');
        }
        showToast('High-Res OFF', '#94a3b8');
    }
};

document.getElementById('toggle-hires-btn')?.addEventListener('click', () => {
    window.setHighResState(!window.isHighResOn);
});

document.getElementById('hires-overlay')?.addEventListener('dblclick', () => {
    window.setHighResState(false);
});

window.addEventListener('blur', () => {
    keys.clear();
    if (joystickState.isDragging) {
        handleJoystickEnd();
    } else {
        sendCmd('stop', 0, 0);
    }

    if (cameraJoystickState.isDragging) {
        handleCameraJoystickEnd();
    }

    // Reset camera keyboard state
    cameraKeys.clear();
    if (cameraKeyIntervalId) {
        clearInterval(cameraKeyIntervalId);
        cameraKeyIntervalId = null;
    }
});



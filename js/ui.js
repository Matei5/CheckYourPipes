let CURRENT_SIZE = localStorage.getItem('sensorSize');
if (!CURRENT_SIZE) {
    if (window.innerWidth <= 600 || /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
        CURRENT_SIZE = 'xs';
    } else {
        CURRENT_SIZE = 'medium';
    }
}
let CURRENT_THROTTLE = parseFloat(localStorage.getItem('throttle')) || 0.8;

const applySize = (size) => {
    const els = [
        'sensor-panel',
        'controls-container',
        'camera-container',
        'settings-toggle',
        'settings-panel',
        'keybinds-toggle',
        'keybinds-modal-content',
        'data-toggle',
        'fullscreen-toggle',
        'data-modal-content',
        'minimap-panel',
        'car-model-widget',
        'pin-edit-modal-content'
    ];

    els.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('size-xs', 'size-small', 'size-medium', 'size-large');
            el.classList.add(`size-${size}`);
        }
    });

    document.querySelectorAll('.size-btn[data-size]').forEach(b =>
        b.classList.toggle('active', b.dataset.size === size)
    );
};

applySize(CURRENT_SIZE);

const sensorPanelDefault = document.getElementById('sensor-panel');
const sensorToggleDefault = document.getElementById('sensor-toggle');

if (sensorPanelDefault && sensorToggleDefault) {
    sensorPanelDefault.classList.add('open');
    sensorToggleDefault.textContent = 'Hide';
    sensorToggleDefault.classList.add('active');
}

const throttleSlider = document.getElementById('throttle-slider');
const throttleValue = document.getElementById('throttle-value');

if (throttleSlider && throttleValue) {
    throttleSlider.value = CURRENT_THROTTLE;
    throttleValue.textContent = Math.round(CURRENT_THROTTLE * 100) + '%';

    throttleSlider.addEventListener('input', (e) => {
        CURRENT_THROTTLE = parseFloat(e.target.value);
        throttleValue.textContent = Math.round(CURRENT_THROTTLE * 100) + '%';
        localStorage.setItem('throttle', CURRENT_THROTTLE);
    });

    throttleSlider.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}

const trimSlider = document.getElementById('motor-trim-slider');
const trimValue = document.getElementById('motor-trim-value');
let CURRENT_TRIM = parseFloat(localStorage.getItem('motorTrim')) || 0.0;

if (trimSlider && trimValue) {
    trimSlider.value = CURRENT_TRIM;
    trimValue.textContent = (CURRENT_TRIM > 0 ? '+' : '') + Math.round(CURRENT_TRIM * 100) + '% L';
    
    // Send initial loaded trim to backend
    fetch(`/trim?value=${CURRENT_TRIM}`).catch(e => console.error(e));

    trimSlider.addEventListener('input', (e) => {
        CURRENT_TRIM = parseFloat(e.target.value);
        let text = Math.abs(Math.round(CURRENT_TRIM * 100)) + '%';
        if (CURRENT_TRIM > 0) text = '+' + text + ' L';
        else if (CURRENT_TRIM < 0) text = text + ' R';
        else text = '0% (center)';
        trimValue.textContent = text;
        localStorage.setItem('motorTrim', CURRENT_TRIM);
        
        fetch(`/trim?value=${CURRENT_TRIM}`).catch(e => console.error(e));
    });

    trimSlider.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}

let lastCameraSentTime = 0;
let cameraTimer = null;
let pendingCameraUpdate = null;

const sendCameraServo = (pan, tilt) => {
    const now = Date.now();
    const minInterval = 80; // ms

    if (pan !== undefined) {
        pendingCameraUpdate = pendingCameraUpdate || {};
        pendingCameraUpdate.rotation = pan;
    }
    if (tilt !== undefined) {
        pendingCameraUpdate = pendingCameraUpdate || {};
        pendingCameraUpdate.angle = tilt;
    }

    if (!pendingCameraUpdate) return;

    const executeSend = async () => {
        const update = pendingCameraUpdate;
        pendingCameraUpdate = null;
        lastCameraSentTime = Date.now();

        let queryParts = [];
        if (update.rotation !== undefined) {
            queryParts.push(`rotation=${update.rotation}`);
        }
        if (update.angle !== undefined) {
            queryParts.push(`angle=${update.angle}`);
        }

        if (queryParts.length === 0) return;

        try {
            await fetch(`/camera_servo?${queryParts.join('&')}`);
        } catch (e) {
            console.error('Failed to set camera servo:', e);
        }
    };

    if (now - lastCameraSentTime >= minInterval) {
        if (cameraTimer) {
            clearTimeout(cameraTimer);
            cameraTimer = null;
        }
        executeSend();
    } else {
        if (!cameraTimer) {
            cameraTimer = setTimeout(() => {
                cameraTimer = null;
                executeSend();
            }, minInterval - (now - lastCameraSentTime));
        }
    }
};

const cameraPanSlider = document.getElementById('camera-pan-slider');
const cameraPanValue = document.getElementById('camera-pan-value');
const cameraTiltSlider = document.getElementById('camera-tilt-slider');
const cameraTiltValue = document.getElementById('camera-tilt-value');

if (cameraPanSlider && cameraPanValue) {
    cameraPanSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        cameraPanValue.textContent = val + '\u00B0';
        currentCameraPan = val;
        sendCameraServo(val, undefined);
    });
    cameraPanSlider.addEventListener('click', (e) => e.stopPropagation());
}

if (cameraTiltSlider && cameraTiltValue) {
    cameraTiltSlider.addEventListener('input', (e) => {
        let val = parseInt(e.target.value);
        if (val < 30) {
            val = 30;
            e.target.value = 30;
        }
        cameraTiltValue.textContent = val + '\u00B0';
        currentCameraTilt = val;
        sendCameraServo(undefined, val);
    });
    cameraTiltSlider.addEventListener('click', (e) => e.stopPropagation());
}

const sensorToggle = document.getElementById('sensor-toggle');

if (sensorToggle) {
    sensorToggle.onclick = (e) => {
        e.stopPropagation();
        const sensorPanel = document.getElementById('sensor-panel');
        if (!sensorPanel) return;

        sensorPanel.classList.toggle('open');
        const isOpen = sensorPanel.classList.contains('open');
        sensorToggle.textContent = isOpen ? 'Hide' : 'Show';
        sensorToggle.classList.toggle('active', isOpen);
    };
}

const settingsToggle = document.getElementById('settings-toggle');

if (settingsToggle) {
    settingsToggle.onclick = () => {
        const settingsPanel = document.getElementById('settings-panel');
        if (settingsPanel) {
            settingsPanel.classList.toggle('open');
            if (settingsPanel.classList.contains('open')) {
                document.getElementById('keybinds-panel')?.classList.remove('open');
            }
        }
    };
}

const fullscreenToggle = document.getElementById('fullscreen-toggle');

if (fullscreenToggle) {
    fullscreenToggle.onclick = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable fullscreen: ${err.message}`);
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    };
}

window.hiddenSensors = new Set();
try {
    const stored = JSON.parse(localStorage.getItem('hiddenSensors') || '[]');
    if (Array.isArray(stored)) {
        window.hiddenSensors = new Set(stored);
    }
} catch (e) {
    console.error('Failed to parse hiddenSensors', e);
}

document.querySelectorAll('#sensor-toggles-container .size-btn').forEach(btn => {
    const sensor = btn.dataset.sensor;
    if (window.hiddenSensors.has(sensor)) {
        btn.classList.remove('active');
    }
    btn.onclick = () => {
        btn.classList.toggle('active');
        if (btn.classList.contains('active')) {
            window.hiddenSensors.delete(sensor);
        } else {
            window.hiddenSensors.add(sensor);
        }
        localStorage.setItem('hiddenSensors', JSON.stringify([...window.hiddenSensors]));
        if (typeof updateSensor === 'function') updateSensor();
    };
});

const toggleHideUiBtn = document.getElementById('toggle-hide-ui');
if (toggleHideUiBtn) {
    toggleHideUiBtn.onclick = () => {
        document.body.classList.toggle('hide-ui');
        if (document.body.classList.contains('hide-ui')) {
            const isTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
            const toast = document.getElementById('hide-ui-toast');
            if (toast) {
                if (isTouch) {
                    toast.textContent = "Double-tap anywhere to restore UI";
                } else {
                    toast.textContent = "Press 'H' or Double-click anywhere to restore UI";
                }
                toast.classList.add('show');
                setTimeout(() => toast.classList.remove('show'), 3000);
            }
        }
    };
}

// Mobile double-tap / tap-to-unhide logic
let lastTapTime = 0;
document.addEventListener('touchstart', (e) => {
    if (document.body.classList.contains('hide-ui')) {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTapTime;
        if (tapLength < 400 && tapLength > 0) {
            document.body.classList.remove('hide-ui');
            e.preventDefault();
        }
        lastTapTime = currentTime;
    }
}, { passive: false });

document.addEventListener('dblclick', (e) => {
    if (document.body.classList.contains('hide-ui')) {
        document.body.classList.remove('hide-ui');
    }
});

const keybindsToggleBtn = document.getElementById('keybinds-toggle');
if (keybindsToggleBtn) {
    keybindsToggleBtn.onclick = () => {
        const kbPanel = document.getElementById('keybinds-panel');
        if (kbPanel) {
            kbPanel.classList.toggle('open');
            if (kbPanel.classList.contains('open')) {
                document.getElementById('settings-panel')?.classList.remove('open');
            }
        }
    };
}

const dataToggle = document.getElementById('data-toggle');

if (dataToggle) {
    dataToggle.onclick = () => {
        const dataModal = document.getElementById('data-modal');
        if (!dataModal) return;

        dataModal.classList.toggle('open');

        if (dataModal.classList.contains('open')) {
            renderCharts();
        }
    };
}

const dataModalClose = document.getElementById('data-modal-close');

if (dataModalClose) {
    dataModalClose.onclick = () => {
        const dataModal = document.getElementById('data-modal');
        if (dataModal) {
            dataModal.classList.remove('open');
        }
        // Clear the snapshot indicator line when closing the charts
        window.chartSnapshotTime = null;
    };
}

const dataModal = document.getElementById('data-modal');

if (dataModal) {
    dataModal.addEventListener('click', (e) => {
        if (e.target.id === 'data-modal') {
            dataModal.classList.remove('open');
        }
    });
}

const chartRefreshBtn = document.getElementById('chart-refresh-btn');
const chartAutoUpdateBtn = document.getElementById('chart-autoupdate-btn');

if (chartRefreshBtn) {
    chartRefreshBtn.onclick = (e) => {
        e.stopPropagation();
        
        const startEl = document.getElementById('chart-start-time');
        const endEl = document.getElementById('chart-end-time');
        if (startEl && endEl && sessionData.length > 0) {
            const activeQuickBtn = document.querySelector('.quick-time-btn.active');
            if (activeQuickBtn) {
                const mins = parseInt(activeQuickBtn.dataset.minutes);
                const maxTime = sessionData[sessionData.length - 1].timestamp;
                const startTime = Math.max(sessionData[0].timestamp, maxTime - (mins * 60 * 1000));
                startEl.value = formatTimeHHMMSS(startTime);
                endEl.value = formatTimeHHMMSS(maxTime);
            } else {
                endEl.value = formatTimeHHMMSS(sessionData[sessionData.length - 1].timestamp);
            }
        }

        renderCharts();
    };
}

const chartApplyFilterBtn = document.getElementById('chart-apply-filter-btn');
const chartClearFilterBtn = document.getElementById('chart-clear-filter-btn');
const chartStartTime = document.getElementById('chart-start-time');
const chartEndTime = document.getElementById('chart-end-time');

const formatTimeHHMMSS = (timestamp) => {
    const date = new Date(timestamp);
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
};

const setupTimeInputScroll = (input) => {
    if (!input) return;
    input.addEventListener('wheel', (e) => {
        e.preventDefault();
        
        let val = input.value;
        if (!val) {
            if (sessionData.length > 0) {
                if (input.id === 'chart-start-time') {
                    val = formatTimeHHMMSS(sessionData[0].timestamp);
                } else {
                    val = formatTimeHHMMSS(sessionData[sessionData.length - 1].timestamp);
                }
            } else {
                val = formatTimeHHMMSS(Date.now());
            }
        }

        let [h, m, s] = val.split(':').map(Number);
        h = h || 0; m = m || 0; s = s || 0;

        const rect = input.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const ratio = x / rect.width;

        const isUp = e.deltaY < 0;
        const delta = isUp ? 1 : -1;

        if (ratio < 0.35) {
            h = (h + delta + 24) % 24;
        } else if (ratio < 0.70) {
            m = (m + delta + 60) % 60;
        } else {
            s = (s + delta + 60) % 60;
        }

        const hStr = h.toString().padStart(2, '0');
        const mStr = m.toString().padStart(2, '0');
        const sStr = s.toString().padStart(2, '0');
        
        input.value = `${hStr}:${mStr}:${sStr}`;
        
        document.querySelectorAll('.quick-time-btn').forEach(btn => btn.classList.remove('active'));
        renderCharts();
    }, { passive: false });
};

if (chartStartTime) setupTimeInputScroll(chartStartTime);
if (chartEndTime) setupTimeInputScroll(chartEndTime);

document.querySelectorAll('.quick-time-btn').forEach(btn => {
    btn.onclick = (e) => {
        e.stopPropagation();
        if (sessionData.length === 0) return;

        const mins = parseInt(btn.dataset.minutes);
        const maxTime = sessionData[sessionData.length - 1].timestamp;
        const startTime = maxTime - (mins * 60 * 1000);

        if (chartStartTime) chartStartTime.value = formatTimeHHMMSS(startTime);
        if (chartEndTime) chartEndTime.value = formatTimeHHMMSS(maxTime);

        document.querySelectorAll('.quick-time-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        renderCharts();
    };
});

if (chartApplyFilterBtn) {
    chartApplyFilterBtn.onclick = () => {
        document.querySelectorAll('.quick-time-btn').forEach(btn => btn.classList.remove('active'));
        renderCharts();
    };
}

if (chartClearFilterBtn) {
    chartClearFilterBtn.onclick = () => {
        if (sessionData.length > 0) {
            if (chartStartTime) chartStartTime.value = formatTimeHHMMSS(sessionData[0].timestamp);
            if (chartEndTime) chartEndTime.value = formatTimeHHMMSS(sessionData[sessionData.length - 1].timestamp);
        } else {
            if (chartStartTime) chartStartTime.value = '';
            if (chartEndTime) chartEndTime.value = '';
        }
        document.querySelectorAll('.quick-time-btn').forEach(btn => btn.classList.remove('active'));
        renderCharts();
    };
}

if (chartAutoUpdateBtn) {
    chartAutoUpdateBtn.onclick = (e) => {
        e.stopPropagation();
        chartAutoUpdatePlaying = !chartAutoUpdatePlaying;

        if (chartAutoUpdatePlaying) {
            chartAutoUpdateBtn.classList.remove('paused');
            chartAutoUpdateBtn.classList.add('playing');
            chartAutoUpdateBtn.textContent = '⏸ Pause';
            chartAutoUpdateBtn.title = 'Pause Auto-Refresh';
            renderCharts();
        } else {
            chartAutoUpdateBtn.classList.remove('playing');
            chartAutoUpdateBtn.classList.add('paused');
            chartAutoUpdateBtn.textContent = '▶ Play';
            chartAutoUpdateBtn.title = 'Resume Auto-Refresh';
        }
    };
}

document.querySelectorAll('.size-btn[data-size]').forEach(btn => {
    btn.onclick = (e) => {
        e.stopPropagation();
        applySize(btn.dataset.size);
        localStorage.setItem('sensorSize', btn.dataset.size);
    };
});


const joystickState = {
    isDragging: false,
    centerX: 0,
    centerY: 0,
    dx: 0,
    dy: 0,
    intervalId: null
};

let currentController = null;
let lastSentCmd = { cmd: null, throttle: null, turn: null, time: 0 };


const snapshotBtn = document.getElementById('snapshot-btn');
const snapshotModal = document.getElementById('snapshot-modal');
const snapshotModalClose = document.getElementById('snapshot-modal-close');
const snapshotCanvas = document.getElementById('snapshot-canvas');
const snapshotUndo = document.getElementById('snapshot-undo');
const snapshotClear = document.getElementById('snapshot-clear');
const snapshotCancel = document.getElementById('snapshot-cancel');
const snapshotSave = document.getElementById('snapshot-save');
const snapshotLabel = document.getElementById('snapshot-label');
const videoImg = document.querySelector('#video-container img');

let snapshotCtx = null;
if (snapshotCanvas) {
    snapshotCtx = snapshotCanvas.getContext('2d');
}

let baseSnapshotImage = null;
let snapshotRectangles = [];
let snapDrag = { isDrawing: false, startX: 0, startY: 0, currentX: 0, currentY: 0 };
let activeSnapshotPose = null;

const renderSnapshotCanvas = () => {
    if (!snapshotCtx || !baseSnapshotImage) return;
    
    // Draw base image
    snapshotCtx.clearRect(0, 0, snapshotCanvas.width, snapshotCanvas.height);
    snapshotCtx.drawImage(baseSnapshotImage, 0, 0, snapshotCanvas.width, snapshotCanvas.height);

    // Draw saved rectangles
    snapshotCtx.lineWidth = 3;
    snapshotRectangles.forEach(rect => {
        const rectColor = rect.color || 'red';
        snapshotCtx.strokeStyle = rectColor;
        snapshotCtx.fillStyle = rectColor;
        snapshotCtx.globalAlpha = 0.2;
        snapshotCtx.setLineDash([8, 4]);
        snapshotCtx.beginPath();
        snapshotCtx.rect(rect.x, rect.y, rect.w, rect.h);
        snapshotCtx.fill();
        snapshotCtx.globalAlpha = 1.0;
        snapshotCtx.stroke();
    });

    // Draw active rectangle
    if (snapDrag.isDrawing) {
        const pickerColor = document.getElementById('snapshot-color-picker')?.value || 'red';
        snapshotCtx.strokeStyle = pickerColor;
        snapshotCtx.fillStyle = pickerColor;
        snapshotCtx.globalAlpha = 0.2;
        snapshotCtx.setLineDash([8, 4]);
        snapshotCtx.beginPath();
        
        const w = snapDrag.currentX - snapDrag.startX;
        const h = snapDrag.currentY - snapDrag.startY;
        
        snapshotCtx.rect(snapDrag.startX, snapDrag.startY, w, h);
        snapshotCtx.fill();
        snapshotCtx.globalAlpha = 1.0;
        snapshotCtx.stroke();
    }
    
    // Reset line dash
    snapshotCtx.setLineDash([]);
};

const generatePinThumbnail = (canvas, rectangles) => {
    if (!rectangles || rectangles.length === 0) {
        return null;
    }

    let largest = rectangles[0];
    let maxArea = Math.abs(largest.w * largest.h);
    
    for (let i = 1; i < rectangles.length; i++) {
        const area = Math.abs(rectangles[i].w * rectangles[i].h);
        if (area > maxArea) {
            maxArea = area;
            largest = rectangles[i];
        }
    }

    let rx = largest.w < 0 ? largest.x + largest.w : largest.x;
    let ry = largest.h < 0 ? largest.y + largest.h : largest.y;
    let rw = Math.abs(largest.w);
    let rh = Math.abs(largest.h);

    const paddingX = rw * 0.25;
    const paddingY = rh * 0.25;
    
    let cropX = Math.max(0, rx - paddingX);
    let cropY = Math.max(0, ry - paddingY);
    let cropW = Math.min(canvas.width - cropX, rw + paddingX * 2);
    let cropH = Math.min(canvas.height - cropY, rh + paddingY * 2);

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 120;
    thumbCanvas.height = 120;
    const thumbCtx = thumbCanvas.getContext('2d');

    thumbCtx.fillStyle = '#1e293b';
    thumbCtx.fillRect(0, 0, 120, 120);

    const cropRatio = cropW / cropH;
    let dx = 0, dy = 0, dw = 120, dh = 120;

    if (cropRatio > 1) {
        dh = 120 / cropRatio;
        dy = (120 - dh) / 2;
    } else {
        dw = 120 * cropRatio;
        dx = (120 - dw) / 2;
    }

    thumbCtx.drawImage(
        canvas, 
        cropX, cropY, cropW, cropH,
        dx, dy, dw, dh
    );

    return thumbCanvas.toDataURL('image/jpeg', 0.9);
};

const openSnapshotModal = () => {
    if (!videoImg || !lastPoseData || !snapshotModal) return;

    // Create offscreen canvas to capture the image
    const offCanvas = document.createElement('canvas');
    offCanvas.width = videoImg.naturalWidth || videoImg.width || 640;
    offCanvas.height = videoImg.naturalHeight || videoImg.height || 480;
    
    const offCtx = offCanvas.getContext('2d');
    
    try {
        offCtx.drawImage(videoImg, 0, 0, offCanvas.width, offCanvas.height);
        
        // Setup base image for annotation
        baseSnapshotImage = new Image();
        baseSnapshotImage.onload = () => {
            snapshotCanvas.width = baseSnapshotImage.width;
            snapshotCanvas.height = baseSnapshotImage.height;
            snapshotRectangles = [];
            snapDrag.isDrawing = false;
            activeSnapshotPose = { x: lastPoseData.x, y: lastPoseData.y };
            snapshotLabel.value = '';
            
            renderSnapshotCanvas();
            snapshotModal.classList.add('open');
            setTimeout(() => snapshotLabel?.focus(), 100);
        };
        baseSnapshotImage.src = offCanvas.toDataURL('image/jpeg', 0.85);
    } catch (err) {
        console.error('Failed to capture snapshot:', err);
        alert('Could not capture camera frame. Ensure the stream is active.');
    }
};

const closeSnapshotModal = () => {
    if (snapshotModal) {
        snapshotModal.classList.remove('open');
    }
    baseSnapshotImage = null;
    snapshotRectangles = [];
};

// Wiring buttons
if (snapshotBtn) snapshotBtn.onclick = openSnapshotModal;
if (snapshotModalClose) snapshotModalClose.onclick = closeSnapshotModal;
if (snapshotCancel) snapshotCancel.onclick = closeSnapshotModal;

const snapshotPanoramaBtn = document.getElementById('snapshot-panorama-btn');
if (snapshotPanoramaBtn) {
    snapshotPanoramaBtn.onclick = () => {
        closeSnapshotModal();
        if (typeof takePanorama === 'function') takePanorama();
    };
}

if (snapshotUndo) {
    snapshotUndo.onclick = () => {
        if (snapshotRectangles.length > 0) {
            snapshotRectangles.pop();
            renderSnapshotCanvas();
        }
    };
}

if (snapshotClear) {
    snapshotClear.onclick = () => {
        snapshotRectangles = [];
        renderSnapshotCanvas();
    };
}

if (snapshotSave) {
    snapshotSave.onclick = () => {
        if (!baseSnapshotImage || !activeSnapshotPose) return;
        
        // Final render guarantees all rectangles are baked into the canvas
        renderSnapshotCanvas();
        
        const dataUrl = snapshotCanvas.toDataURL('image/jpeg', 0.85);
        const labelText = snapshotLabel.value.trim();
        if (!labelText) {
            alert("Please enter a name for the snapshot.");
            snapshotLabel.focus();
            return;
        }
        
        const thumbnailDataUrl = generatePinThumbnail(snapshotCanvas, snapshotRectangles);

        const getAverageData = () => {
            const now = Date.now();
            const recentData = sessionData.filter(d => now - d.timestamp <= 3000);
            if (recentData.length === 0) return null;
            const avg = {};
            const keys = ['temp', 'humidity', 'pressure', 'ultrasonic_cm', 'gas_percent'];
            keys.forEach(k => {
                const vals = recentData.map(d => d[k]).filter(v => v !== null && v !== undefined);
                if (vals.length > 0) avg[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
            });
            avg.startTime = recentData[0].timestamp;
            avg.endTime = recentData[recentData.length - 1].timestamp;
            return avg;
        };

        mapState.customPins.push({
            x: activeSnapshotPose.x,
            y: activeSnapshotPose.y,
            label: labelText,
            snapshot: dataUrl,
            thumbnail: thumbnailDataUrl,
            rectangles: [...snapshotRectangles],
            timestamp: Date.now(),
            sensorData: getAverageData()
        });
        
        renderPinList();
        drawMiniMap(lastPoseData);
        drawFullscreenMap(lastPoseData);
        closeSnapshotModal();
    };
}

// Canvas Mouse Events
const getSnapshotMousePos = (evt) => {
    const rect = snapshotCanvas.getBoundingClientRect();
    const scaleX = snapshotCanvas.width / rect.width;
    const scaleY = snapshotCanvas.height / rect.height;
    
    let clientX = evt.clientX;
    let clientY = evt.clientY;
    
    if (evt.touches && evt.touches.length > 0) {
        clientX = evt.touches[0].clientX;
        clientY = evt.touches[0].clientY;
    }
    
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
};

if (snapshotCanvas) {
    const startDrawing = (e) => {
        e.preventDefault();
        const pos = getSnapshotMousePos(e);
        snapDrag.startX = pos.x;
        snapDrag.startY = pos.y;
        snapDrag.currentX = pos.x;
        snapDrag.currentY = pos.y;
        snapDrag.isDrawing = true;
    };
    
    const moveDrawing = (e) => {
        if (!snapDrag.isDrawing) return;
        e.preventDefault();
        const pos = getSnapshotMousePos(e);
        snapDrag.currentX = pos.x;
        snapDrag.currentY = pos.y;
        renderSnapshotCanvas();
    };
    
    const stopDrawing = (e) => {
        if (!snapDrag.isDrawing) return;
        e.preventDefault();
        snapDrag.isDrawing = false;
        
        const w = snapDrag.currentX - snapDrag.startX;
        const h = snapDrag.currentY - snapDrag.startY;
        
        // Only save if it's a real rectangle, not a click
        if (Math.abs(w) > 5 && Math.abs(h) > 5) {
            snapshotRectangles.push({
                x: snapDrag.startX,
                y: snapDrag.startY,
                w: w,
                h: h,
                color: document.getElementById('snapshot-color-picker')?.value || 'red'
            });
        }
        renderSnapshotCanvas();
    };
    
    snapshotCanvas.addEventListener('mousedown', startDrawing);
    snapshotCanvas.addEventListener('mousemove', moveDrawing);
    window.addEventListener('mouseup', stopDrawing);
    
    snapshotCanvas.addEventListener('touchstart', startDrawing, {passive: false});
    snapshotCanvas.addEventListener('touchmove', moveDrawing, {passive: false});
    window.addEventListener('touchend', stopDrawing);
}

// Global keybinds are now handled in the main document.addEventListener('keydown') listener.

const pinEditModal = document.getElementById('pin-edit-modal');
const pinEditModalClose = document.getElementById('pin-edit-modal-close');
const pinEditLabel = document.getElementById('pin-edit-label');
const pinEditSnapshotContainer = document.getElementById('pin-edit-snapshot-container');
const pinEditSnapshotImg = document.getElementById('pin-edit-snapshot-img');
const pinEditDeleteBtn = document.getElementById('pin-edit-delete');
const pinEditCancelBtn = document.getElementById('pin-edit-cancel');
const pinEditSaveBtn = document.getElementById('pin-edit-save');

let editingPinIndex = -1;

const openPinEditModal = (index, pin) => {
    if (!pinEditModal) return;
    
    editingPinIndex = index;
    pinEditLabel.value = pin.label || '';
    
    const modalContent = document.getElementById('pin-edit-modal-content');
    if (pin.snapshot) {
        pinEditSnapshotImg.src = pin.snapshot;
        pinEditSnapshotContainer.style.display = 'block';
        if (modalContent) modalContent.classList.add('has-snapshot');
    } else {
        pinEditSnapshotImg.src = '';
        pinEditSnapshotContainer.style.display = 'none';
        if (modalContent) modalContent.classList.remove('has-snapshot');
    }
    
    const sensorDataContainer = document.getElementById('pin-edit-sensor-data');
    if (pin.sensorData && pin.sensorData.startTime && sensorDataContainer) {
        sensorDataContainer.style.display = 'block';
        sensorDataContainer.innerHTML = `
            <strong style="color: #e2e8f0; display:block; margin-bottom:8px; font-size: 0.9em;">3-Sec Average Data:</strong>
            <div style="display:flex; flex-wrap:wrap; gap:10px; font-size: 0.85em; color: var(--text-secondary);">
                ${pin.sensorData.temp != null ? `<div style="display:flex; align-items:center; gap:4px; background: rgba(0,0,0,0.3); padding:4px 8px; border-radius:12px;"><span>🌡️</span> ${pin.sensorData.temp.toFixed(1)}°C</div>` : ''}
                ${pin.sensorData.humidity != null ? `<div style="display:flex; align-items:center; gap:4px; background: rgba(0,0,0,0.3); padding:4px 8px; border-radius:12px;"><span>💧</span> ${pin.sensorData.humidity.toFixed(1)}%</div>` : ''}
                ${pin.sensorData.pressure != null ? `<div style="display:flex; align-items:center; gap:4px; background: rgba(0,0,0,0.3); padding:4px 8px; border-radius:12px;"><span>⚙️</span> ${pin.sensorData.pressure.toFixed(1)}hPa</div>` : ''}
                ${pin.sensorData.gas_percent != null ? `<div style="display:flex; align-items:center; gap:4px; background: rgba(0,0,0,0.3); padding:4px 8px; border-radius:12px;"><span>☁️</span> ${pin.sensorData.gas_percent.toFixed(1)}%</div>` : ''}
                ${pin.sensorData.ultrasonic_cm != null ? `<div style="display:flex; align-items:center; gap:4px; background: rgba(0,0,0,0.3); padding:4px 8px; border-radius:12px;"><span>📏</span> ${pin.sensorData.ultrasonic_cm.toFixed(1)}cm</div>` : ''}
            </div>
        `;
        
        const viewDataBtn = document.getElementById('pin-edit-view-data');
        if (viewDataBtn) {
            viewDataBtn.style.display = 'block';
            viewDataBtn.onclick = () => {
                const dataModal = document.getElementById('data-modal');
                if (dataModal) {
                    // Set global snapshot time to draw the vertical line in chart plugin
                    window.chartSnapshotTime = pin.timestamp;
                    
                    // Clear any existing filters so the full graph is visible
                    const chartStartTime = document.getElementById('chart-start-time');
                    const chartEndTime = document.getElementById('chart-end-time');
                    if (chartStartTime) chartStartTime.value = '';
                    if (chartEndTime) chartEndTime.value = '';
                    
                    dataModal.classList.add('open');
                    renderCharts();
                    closePinEditModal();
                    if (snapshotModal) snapshotModal.classList.remove('open');
                    if (document.getElementById('map-modal')) document.getElementById('map-modal').classList.remove('open');
                }
            };
        }
    } else {
        if (sensorDataContainer) sensorDataContainer.style.display = 'none';
        const viewDataBtn = document.getElementById('pin-edit-view-data');
        if (viewDataBtn) viewDataBtn.style.display = 'none';
    }
    
    pinEditModal.classList.add('open');
    // Auto-focus the label field so user can immediately type
    setTimeout(() => pinEditLabel?.focus(), 100);
};

const closePinEditModal = () => {
    if (!pinEditModal) return;
    pinEditModal.classList.remove('open');
    editingPinIndex = -1;
};

if (pinEditModalClose) pinEditModalClose.onclick = closePinEditModal;
if (pinEditCancelBtn) pinEditCancelBtn.onclick = closePinEditModal;

if (pinEditSaveBtn) {
    pinEditSaveBtn.onclick = () => {
        if (editingPinIndex >= 0 && editingPinIndex < mapState.customPins.length) {
            mapState.customPins[editingPinIndex].label = pinEditLabel.value.trim();
            renderPinList();
            drawMiniMap(lastPoseData);
            if (fsCanvas && fsCanvas.offsetParent !== null) {
                drawFullscreenMap(lastPoseData);
            }
        }
        closePinEditModal();
    };
}

if (pinEditLabel) {
    pinEditLabel.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (pinEditSaveBtn) pinEditSaveBtn.click();
        }
    });
}

// Enter key to save snapshot label
if (snapshotLabel) {
    snapshotLabel.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (snapshotSave) snapshotSave.click();
        }
    });
}

if (pinEditDeleteBtn) {
    pinEditDeleteBtn.onclick = () => {
        if (editingPinIndex >= 0 && editingPinIndex < mapState.customPins.length) {
            const ok = confirm('Are you sure you want to delete this pin?');
            if (ok) {
                mapState.customPins.splice(editingPinIndex, 1);
                renderPinList();
                drawMiniMap(lastPoseData);
                if (fsCanvas && fsCanvas.offsetParent !== null) {
                    drawFullscreenMap(lastPoseData);
                }
                closePinEditModal();
            }
        }
    };
}

window.isTakingPanorama = false;

const takePanorama = async () => {
    if (window.isTakingPanorama) return;
    window.isTakingPanorama = true;

    keys.clear();
    sendCmd('stop', 0, 0);

    // 3 pan positions (wide sweep), 3 tilt positions (high to low).
    const panPositions  = [120, 75, 30];
    const tiltPositions = [120, 75, 30];
    const videoImg = document.querySelector('#video-container img');

    const frames = [];   // rows of canvases: frames[row][col]

    try {
        for (let tilt of tiltPositions) {
            const row = [];
            for (let pan of panPositions) {
                await fetch(`/camera_servo?rotation=${pan}&angle=${tilt}`);
                // wait for servo to physically settle and camera auto-exposure to adjust
                await new Promise(r => setTimeout(r, 2500));

                const fw = videoImg.naturalWidth  || 640;
                const fh = videoImg.naturalHeight || 480;
                const canvas = document.createElement('canvas');
                canvas.width  = fw;
                canvas.height = fh;
                canvas.getContext('2d').drawImage(videoImg, 0, 0, fw, fh);
                row.push(canvas);
            }
            frames.push(row);
        }

        const cols  = panPositions.length;
        const rows  = tiltPositions.length;
        const fw    = frames[0][0].width;
        const fh    = frames[0][0].height;

        const grid  = document.createElement('canvas');
        grid.width  = fw * cols;
        grid.height = fh * rows;
        const ctx   = grid.getContext('2d');

        frames.forEach((row, r) => {
            row.forEach((frame, c) => {
                ctx.drawImage(frame, c * fw, r * fh);
            });
        });

        openSnapshotModalWithCustomImage(grid.toDataURL('image/jpeg', 0.85));
    } catch (e) {
        console.error('Photo grid capture failed', e);
    } finally {
        window.isTakingPanorama = false;
        // Reset camera back to center
        fetch(`/camera_servo?rotation=65&angle=75`).catch(e => console.error(e));
        if (typeof centerCamera === 'function') centerCamera();
    }
};

const openSnapshotModalWithCustomImage = (dataUrl) => {
    if (!lastPoseData || !snapshotModal) return;

    baseSnapshotImage = new Image();
    baseSnapshotImage.onload = () => {
        snapshotCanvas.width = baseSnapshotImage.width;
        snapshotCanvas.height = baseSnapshotImage.height;
        snapshotRectangles = [];
        snapDrag.isDrawing = false;
        activeSnapshotPose = { x: lastPoseData.x, y: lastPoseData.y };
        snapshotLabel.value = '';
        
        renderSnapshotCanvas();
        snapshotModal.classList.add('open');
        setTimeout(() => document.getElementById('snapshot-label')?.focus(), 100);
    };
    baseSnapshotImage.src = dataUrl;
};

const exportMapState = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(mapState));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", "robot_map_state.json");
    dlAnchorElem.click();
};

const importMapState = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (Array.isArray(data)) {
                // Legacy support for older snapshot-only exports
                mapState.customPins = data;
            } else if (data && typeof data === 'object') {
                // Full map state restore
                Object.assign(mapState, data);
                mapState.path = mapState.path || [];
                mapState.smoothedPath = mapState.smoothedPath || [];
                mapState.gasMarkers = mapState.gasMarkers || [];
                mapState.obstacleHints = mapState.obstacleHints || [];
                mapState.customPins = mapState.customPins || [];
            }
            if (typeof renderPinList === 'function') renderPinList();
            if (typeof drawMiniMap === 'function') drawMiniMap(lastPoseData);
            if (typeof drawFullscreenMap === 'function') drawFullscreenMap(lastPoseData);
        } catch (err) {
            alert("Invalid JSON file");
        }
    };
    reader.readAsText(file);
};

const generateReport = () => {
    const win = window.open('', '_blank');
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Robot Snapshot Report</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
            :root {
                --bg: #0f172a;
                --text-main: #f8fafc;
                --text-muted: #94a3b8;
                --accent: #3b82f6;
                --card-bg: rgba(30, 41, 59, 0.7);
                --card-border: rgba(255, 255, 255, 0.1);
            }
            body {
                margin: 0;
                padding: 60px 20px;
                font-family: 'Inter', sans-serif;
                background-color: var(--bg);
                color: var(--text-main);
                background-image: 
                    radial-gradient(circle at 15% 50%, rgba(59, 130, 246, 0.15) 0%, transparent 50%),
                    radial-gradient(circle at 85% 30%, rgba(168, 85, 247, 0.15) 0%, transparent 50%);
                background-attachment: fixed;
                display: flex;
                flex-direction: column;
                align-items: center;
                min-height: 100vh;
                box-sizing: border-box;
            }
            .container {
                max-width: 800px;
                width: 100%;
                display: flex;
                flex-direction: column;
                gap: 32px;
            }
            h1 {
                text-align: center;
                font-size: 2.5rem;
                font-weight: 700;
                margin: 0 0 12px 0;
                background: linear-gradient(135deg, #60a5fa, #a855f7);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                letter-spacing: -0.02em;
            }
            .header-desc {
                text-align: center;
                color: var(--text-muted);
                margin-bottom: 24px;
                font-size: 1.1rem;
            }
            .snapshot {
                background: var(--card-bg);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                border: 1px solid var(--card-border);
                border-radius: 20px;
                padding: 24px;
                box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
                transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
                display: flex;
                flex-direction: column;
                gap: 20px;
            }
            .snapshot:hover {
                transform: translateY(-4px);
                box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.6), 0 0 24px rgba(59, 130, 246, 0.15);
                border-color: rgba(255, 255, 255, 0.2);
            }
            .snapshot-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                flex-wrap: wrap;
                gap: 16px;
                padding-bottom: 20px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            }
            .snapshot h2 {
                margin: 0;
                font-size: 1.5rem;
                color: #e2e8f0;
                font-weight: 600;
            }
            .snapshot-meta {
                display: flex;
                flex-wrap: wrap;
                gap: 12px;
                color: var(--text-muted);
                font-size: 0.9rem;
            }
            .meta-item {
                display: flex;
                align-items: center;
                gap: 8px;
                background: rgba(0, 0, 0, 0.25);
                padding: 8px 14px;
                border-radius: 30px;
                border: 1px solid rgba(255, 255, 255, 0.03);
            }
            .meta-icon {
                color: var(--accent);
                font-size: 1.1rem;
            }
            .snapshot img {
                width: 100%;
                height: auto;
                border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.08);
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
                background: #000;
            }
            .empty-state {
                text-align: center;
                padding: 80px 20px;
                background: var(--card-bg);
                border-radius: 20px;
                border: 2px dashed rgba(255, 255, 255, 0.1);
                color: var(--text-muted);
            }
            .empty-state h3 {
                color: #e2e8f0;
                font-size: 1.3rem;
                margin: 0 0 8px 0;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div>
                <h1>Robot Snapshot Report</h1>
                <div class="header-desc">Generated on ${new Date().toLocaleString()}</div>
            </div>
    `;

    if (mapState.customPins.length === 0) {
        html += `
            <div class="empty-state">
                <h3>No snapshots found</h3>
                <p>Drive around and take snapshots to see them generated here.</p>
            </div>
        `;
    } else {
        mapState.customPins.forEach(pin => {
            const d = new Date(pin.timestamp).toLocaleString();
            html += `
            <div class="snapshot">
                <div class="snapshot-header">
                    <h2>${pin.label}</h2>
                    <div class="snapshot-meta">
                        <div class="meta-item">
                            <span class="meta-icon">⏱</span> ${d}
                        </div>
                        <div class="meta-item">
                            <span class="meta-icon">📍</span> ${pin.x.toFixed(2)}m, ${pin.y.toFixed(2)}m
                        </div>
                    </div>
                </div>
                <img src="${pin.snapshot}" alt="Snapshot ${pin.label}" loading="lazy" />
                ${pin.sensorData ? `
                    <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:16px;">
                        <strong style="color: #e2e8f0; width: 100%;">3-Sec Average Data:</strong>
                        ${pin.sensorData.temp != null ? `<div class="meta-item"><span class="meta-icon">🌡️</span> ${pin.sensorData.temp.toFixed(1)}°C</div>` : ''}
                        ${pin.sensorData.humidity != null ? `<div class="meta-item"><span class="meta-icon">💧</span> ${pin.sensorData.humidity.toFixed(1)}%</div>` : ''}
                        ${pin.sensorData.pressure != null ? `<div class="meta-item"><span class="meta-icon">⚙️</span> ${pin.sensorData.pressure.toFixed(1)}hPa</div>` : ''}
                        ${pin.sensorData.gas_percent != null ? `<div class="meta-item"><span class="meta-icon">☁️</span> ${pin.sensorData.gas_percent.toFixed(1)}%</div>` : ''}
                        ${pin.sensorData.ultrasonic_cm != null ? `<div class="meta-item"><span class="meta-icon">📏</span> ${pin.sensorData.ultrasonic_cm.toFixed(1)}cm</div>` : ''}
                    </div>
                ` : ''}
            </div>`;
        });
    }

    html += `
        </div>
    </body>
    </html>`;
    
    win.document.write(html);
    win.document.close();
};



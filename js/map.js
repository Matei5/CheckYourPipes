

let mapZoom = parseFloat(localStorage.getItem('mapZoom')) || 1.0;
let mapOffsetX = 0;
let mapOffsetY = 0;
let lastPoseData = null;

const MAP_ZOOM_MIN = 0.5;
const MAP_ZOOM_MAX = 4.0;
const MAP_ZOOM_STEP = 0.25;

const updateMapZoomLabel = () => {
    const label = document.getElementById('minimap-zoom-label');

    if (label) {
        label.textContent = `${mapZoom.toFixed(2)}x`;
    }
};

const setMapZoom = (newZoom) => {
    mapZoom = Math.max(MAP_ZOOM_MIN, Math.min(MAP_ZOOM_MAX, newZoom));
    localStorage.setItem('mapZoom', mapZoom);
    updateMapZoomLabel();
};

const minimapZoomIn = document.getElementById('minimap-zoom-in');
const minimapZoomOut = document.getElementById('minimap-zoom-out');

if (minimapZoomIn) {
    minimapZoomIn.onclick = (e) => {
        e.stopPropagation();
        setMapZoom(mapZoom + MAP_ZOOM_STEP);
    };
}

if (minimapZoomOut) {
    minimapZoomOut.onclick = (e) => {
        e.stopPropagation();
        setMapZoom(mapZoom - MAP_ZOOM_STEP);
    };
}

updateMapZoomLabel();

const mapState = {
    path: [],
    smoothedPath: [],
    gasMarkers: [],
    obstacleHints: [],
    customPins: [],
    lastGasMarkerTime: 0,
    lastObstacleTime: 0,
    lastMovedTime: 0,
    lastSavedTime: 0
};

const resizeMiniMapCanvas = () => {
    const canvas = document.getElementById('minimap-canvas');
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const size = Math.round(Math.min(rect.width || 220, rect.height || 220));

    if (canvas.width !== size || canvas.height !== size) {
        canvas.width = size;
        canvas.height = size;
    }
};

const drawMapGrid = (ctx, width, height, scale, offsetX = mapOffsetX, offsetY = mapOffsetY) => {
    ctx.strokeStyle = COLOR_PALETTE.mapGrid;
    ctx.lineWidth = 1;

    const centerX = width / 2 + offsetX;
    const centerY = height / 2 + offsetY;
    const step = scale;

    ctx.beginPath();

    // Draw vertical grid lines (X) relative to panned center
    let x = centerX;
    while (x < width) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        x += step;
    }
    x = centerX - step;
    while (x > 0) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        x -= step;
    }

    // Draw horizontal grid lines (Y) relative to panned center
    let y = centerY;
    while (y < height) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        y += step;
    }
    y = centerY - step;
    while (y > 0) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        y -= step;
    }

    ctx.stroke();

    // Draw main axes relative to panned center
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, height);
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();
};

const smoothPathPoints = (path, windowSize = 5) => {
    if (path.length <= 2) return path;
    const smoothed = [];
    const half = Math.floor(windowSize / 2);

    for (let i = 0; i < path.length; i++) {
        // keep the active tip raw so the ui doesn't feel sluggish.
        if (i === path.length - 1) {
            smoothed.push(path[i]);
            continue;
        }

        let sumX = 0;
        let sumY = 0;
        let weightSum = 0;

        const start = Math.max(0, i - half);
        const end = Math.min(path.length - 1, i + half);

        for (let j = start; j <= end; j++) {
            const dist = Math.abs(j - i);
            const weight = 1 / (dist + 1);
            sumX += path[j].x * weight;
            sumY += path[j].y * weight;
            weightSum += weight;
        }

        smoothed.push({
            x: sumX / weightSum,
            y: sumY / weightSum,
            heading: path[i].heading
        });
    }
    return smoothed;
};

const updateSmoothedPath = (newRawPoint) => {
    mapState.path.push(newRawPoint);
    
    const N = mapState.path.length;
    if (N <= 2) {
        mapState.smoothedPath = [...mapState.path];
        return;
    }
    
    // Ensure smoothedPath is the same length
    while (mapState.smoothedPath.length < N) {
        mapState.smoothedPath.push(null);
    }
    
    // the current pose is never smoothed.
    mapState.smoothedPath[N - 1] = { ...mapState.path[N - 1] };
    
    // only recompute the sliding window tail to save cpu cycles.
    const startIdx = Math.max(0, N - 4);
    const endIdx = N - 2;
    const windowSize = 5;
    const half = 2;
    
    for (let i = startIdx; i <= endIdx; i++) {
        let sumX = 0;
        let sumY = 0;
        let weightSum = 0;
        
        const wStart = Math.max(0, i - half);
        const wEnd = Math.min(N - 1, i + half);
        
        for (let j = wStart; j <= wEnd; j++) {
            const dist = Math.abs(j - i);
            const weight = 1 / (dist + 1);
            sumX += mapState.path[j].x * weight;
            sumY += mapState.path[j].y * weight;
            weightSum += weight;
        }
        
        mapState.smoothedPath[i] = {
            x: sumX / weightSum,
            y: sumY / weightSum,
            heading: mapState.path[i].heading
        };
    }
};

const drawMiniMap = (pose) => {
    const canvas = document.getElementById('minimap-canvas');
    if (!canvas) return;

    resizeMiniMapCanvas();

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    const baseScale = (width < 180 ? 18 : width < 250 ? 24 : 30) * 3;
    const scale = baseScale * mapZoom;
    const centerX = width / 2;
    const centerY = height / 2;

    const robotX = Number(pose.x || 0);
    const robotY = Number(pose.y || 0);
    const heading = Number(pose.heading || 0);

    const toCanvas = (x, y) => ({
        x: centerX + mapOffsetX + (x - robotX) * scale,
        y: centerY + mapOffsetY - (y - robotY) * scale
    });

    drawMapGrid(ctx, width, height, scale);

    const now = Date.now();
    let shouldSave = false;

    if (mapState.path.length === 0) {
        shouldSave = true;
        mapState.lastMovedTime = now;
    } else {
        const lastPt = mapState.path[mapState.path.length - 1];
        const dist = Math.hypot(robotX - lastPt.x, robotY - lastPt.y);
        const diffHeading = Math.abs(heading - lastPt.heading);

        // Thresholds for motion: 1cm or ~1 degree
        if (dist > 0.01 || diffHeading > 0.02) {
            shouldSave = true;
            mapState.lastMovedTime = now;
        } else {
            // log final resting position slowly without bloating the path array.
            const stationaryDuration = now - (mapState.lastMovedTime || now);
            if (stationaryDuration < 3000) {
                if (now - (mapState.lastSavedTime || 0) > 1000) {
                    shouldSave = true;
                }
            }
        }
    }

    if (shouldSave) {
        updateSmoothedPath({
            x: robotX,
            y: robotY,
            heading
        });
        mapState.lastSavedTime = now;
    }

    if (
        pose.ultrasonic_cm !== undefined &&
        pose.ultrasonic_cm !== null &&
        pose.ultrasonic_cm < CONFIG.obstacleThresholdCm &&
        now - mapState.lastObstacleTime > 500
    ) {
        const distance = pose.ultrasonic_cm / 100;

        mapState.obstacleHints.push({
            x: robotX + Math.cos(heading) * distance,
            y: robotY + Math.sin(heading) * distance
        });

        mapState.lastObstacleTime = now;

        if (mapState.obstacleHints.length > CONFIG.maxObstacleHints) {
            mapState.obstacleHints.shift();
        }
    }

    if (
        pose.gas !== undefined &&
        pose.gas !== null &&
        Number(pose.gas) > CONFIG.gasMarkerThreshold &&
        now - mapState.lastGasMarkerTime > 1000
    ) {
        mapState.gasMarkers.push({
            x: robotX,
            y: robotY,
            value: Number(pose.gas)
        });

        mapState.lastGasMarkerTime = now;

        if (mapState.gasMarkers.length > CONFIG.maxGasMarkers) {
            mapState.gasMarkers.shift();
        }
    }

    if (mapState.smoothedPath.length > 1) {
        const smoothedPath = mapState.smoothedPath;

        ctx.save();
        ctx.strokeStyle = COLOR_PALETTE.mapPath;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Add a noticeable glow shadow to the path line
        ctx.shadowColor = COLOR_PALETTE.mapPath;
        ctx.shadowBlur = 6;

        ctx.beginPath();

        const canvasPoints = smoothedPath.map(p => toCanvas(p.x, p.y));

        ctx.moveTo(canvasPoints[0].x, canvasPoints[0].y);

        if (canvasPoints.length === 2) {
            ctx.lineTo(canvasPoints[1].x, canvasPoints[1].y);
        } else {
            for (let i = 1; i < canvasPoints.length - 1; i++) {
                const xc = (canvasPoints[i].x + canvasPoints[i + 1].x) / 2;
                const yc = (canvasPoints[i].y + canvasPoints[i + 1].y) / 2;
                ctx.quadraticCurveTo(canvasPoints[i].x, canvasPoints[i].y, xc, yc);
            }
            ctx.lineTo(canvasPoints[canvasPoints.length - 1].x, canvasPoints[canvasPoints.length - 1].y);
        }

        ctx.stroke();
        ctx.restore();
    }

    mapState.obstacleHints.forEach(obstacle => {
        const point = toCanvas(obstacle.x, obstacle.y);

        ctx.beginPath();
        ctx.fillStyle = COLOR_PALETTE.mapObstacle;
        ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
        ctx.fill();
    });

    mapState.gasMarkers.forEach(marker => {
        const point = toCanvas(marker.x, marker.y);

        ctx.beginPath();
        ctx.strokeStyle = COLOR_PALETTE.mapGas;
        ctx.lineWidth = 2;
        ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
        ctx.stroke();
    });

    // Render custom pins on minimap
    mapState.customPins.forEach(pin => {
        const point = toCanvas(pin.x, pin.y);

        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = 'rgba(168, 85, 247, 0.95)'; // Vibrant Noticeable purple
        ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
        ctx.shadowColor = 'rgba(168, 85, 247, 0.8)';
        ctx.shadowBlur = 6;
        ctx.fill();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.fillStyle = '#ffffff';
        ctx.arc(point.x, point.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });

    const robotCanvasX = centerX + mapOffsetX;
    const robotCanvasY = centerY + mapOffsetY;

    ctx.beginPath();
    ctx.fillStyle = COLOR_PALETTE.mapRobot;
    ctx.arc(robotCanvasX, robotCanvasY, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = COLOR_PALETTE.mapHeading;
    ctx.lineWidth = 3;
    ctx.moveTo(robotCanvasX, robotCanvasY);
    ctx.lineTo(
        robotCanvasX + Math.cos(heading) * 18,
        robotCanvasY - Math.sin(heading) * 18
    );
    ctx.stroke();

    ctx.fillStyle = COLOR_PALETTE.textDim;
    ctx.font = '10px Arial';
    ctx.fillText(`x ${robotX.toFixed(2)} m`, 8, height - 22);
    ctx.fillText(`y ${robotY.toFixed(2)} m`, 8, height - 10);
};

const updateMiniMap = async () => {
    let pose;
    try {
        const res = await fetch('/pose.json');
        pose = await res.json();
    } catch (e) {
        pose = {
            x: 0,
            y: 0,
            heading: 0
        };
    }
    lastPoseData = pose;
    drawMiniMap(pose);

    const mapModal = document.getElementById('map-modal');
    if (mapModal && mapModal.classList.contains('open')) {
        drawFullscreenMap(pose);
    }
};

updateMiniMap();
setInterval(updateMiniMap, CONFIG.poseInterval);

window.addEventListener('resize', resizeMiniMapCanvas);

const canvas = document.getElementById('minimap-canvas');
const minimapCenterBtn = document.getElementById('minimap-center');

const dragState = {
    isDragging: false,
    startX: 0,
    startY: 0
};

if (canvas) {
    canvas.addEventListener('mousedown', (e) => {
        dragState.isDragging = true;
        dragState.startX = e.clientX - mapOffsetX;
        dragState.startY = e.clientY - mapOffsetY;
        canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!dragState.isDragging) return;
        mapOffsetX = e.clientX - dragState.startX;
        mapOffsetY = e.clientY - dragState.startY;
        if (lastPoseData) {
            drawMiniMap(lastPoseData);
        }
    });

    window.addEventListener('mouseup', () => {
        if (dragState.isDragging) {
            dragState.isDragging = false;
            canvas.style.cursor = 'grab';
        }
    });

    // Touch events for mobile
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        dragState.isDragging = true;
        dragState.startX = e.touches[0].clientX - mapOffsetX;
        dragState.startY = e.touches[0].clientY - mapOffsetY;
    });

    window.addEventListener('touchmove', (e) => {
        if (!dragState.isDragging || e.touches.length !== 1) return;
        mapOffsetX = e.touches[0].clientX - dragState.startX;
        mapOffsetY = e.touches[0].clientY - dragState.startY;
        if (lastPoseData) {
            drawMiniMap(lastPoseData);
        }
    }, { passive: true });

    window.addEventListener('touchend', () => {
        dragState.isDragging = false;
    });
}

if (minimapCenterBtn) {
    minimapCenterBtn.onclick = (e) => {
        e.stopPropagation();
        mapOffsetX = 0;
        mapOffsetY = 0;
        if (lastPoseData) {
            drawMiniMap(lastPoseData);
        }
    };
}

let fsMapZoom = parseFloat(localStorage.getItem('fsMapZoom')) || 1.0;
let fsMapOffsetX = 0;
let fsMapOffsetY = 0;
let fsMapAutoFit = true;
const mapModal = document.getElementById('map-modal');
const mapModalClose = document.getElementById('map-modal-close');
const fullscreenMapCanvas = document.getElementById('fullscreen-map-canvas');
const mapTooltip = document.getElementById('map-tooltip');

const renderPinList = () => {
    const container = document.getElementById('pin-list-container');
    const searchInput = document.getElementById('pin-search');
    const sortSelect = document.getElementById('pin-sort');
    
    if (!container || !searchInput || !sortSelect) return;
    
    const query = searchInput.value.toLowerCase();
    const sortVal = sortSelect.value;
    
    let pins = mapState.customPins.map((pin, i) => ({...pin, originalIndex: i}));
    
    pins.forEach(p => { if (!p.timestamp) p.timestamp = Date.now(); });
    
    if (query) {
        pins = pins.filter(p => p.label.toLowerCase().includes(query));
    }
    
    if (sortVal === 'time_desc') {
        pins.sort((a, b) => b.timestamp - a.timestamp);
    } else if (sortVal === 'time_asc') {
        pins.sort((a, b) => a.timestamp - b.timestamp);
    } else if (sortVal === 'name_asc') {
        pins.sort((a, b) => a.label.localeCompare(b.label));
    }
    
    container.innerHTML = '';
    
    if (pins.length === 0) {
        container.innerHTML = '<div style="color:var(--text-secondary); text-align:center; padding: 20px;">No pins found.</div>';
        return;
    }
    
    pins.forEach(pin => {
        const div = document.createElement('div');
        div.style.background = 'var(--bg-card)';
        div.style.border = '1px solid var(--border-color)';
        div.style.borderRadius = '4px';
        div.style.padding = '8px';
        div.style.cursor = 'pointer';
        div.style.display = 'flex';
        div.style.gap = '8px';
        div.style.alignItems = 'center';
        
        let imgHtml = '';
        if (pin.snapshot) {
            const imgSrc = pin.thumbnail || pin.snapshot;
            imgHtml = `<img src="${imgSrc}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-color);">`;
        } else {
            imgHtml = `<div style="width: 50px; height: 50px; border-radius: 4px; background: var(--bg-surface); display:flex; align-items:center; justify-content:center; border: 1px solid var(--border-color);">📌</div>`;
        }
        
        const dateStr = new Date(pin.timestamp).toLocaleTimeString();
        
        div.innerHTML = `
            ${imgHtml}
            <div style="flex:1; overflow: hidden;">
                <div style="font-weight: 500; white-space: nowrap; text-overflow: ellipsis; overflow: hidden;" title="${pin.label}">${pin.label}</div>
                <div style="font-size: 0.8em; color: var(--text-secondary);">${dateStr}</div>
                <div style="font-size: 0.8em; color: var(--text-secondary);">(${pin.x.toFixed(1)}m, ${pin.y.toFixed(1)}m)</div>
            </div>
            <button class="snapshot-edit-btn" style="padding: 6px 10px; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 6px; color: #60a5fa; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(59, 130, 246, 0.3)'; this.style.borderColor='rgba(59, 130, 246, 0.6)';" onmouseout="this.style.background='rgba(59, 130, 246, 0.15)'; this.style.borderColor='rgba(59, 130, 246, 0.3)';" onclick="openPinEditModal(${pin.originalIndex}, mapState.customPins[${pin.originalIndex}]); event.stopPropagation();" title="Edit Pin">&#9998;</button>
        `;
        
        div.onclick = () => {
            mapState.panX = -pin.x * mapState.scale;
            mapState.panY = -pin.y * mapState.scale;
            if (lastPoseData) drawFullscreenMap(lastPoseData);
        };
        
        container.appendChild(div);
    });
};

document.getElementById('pin-search')?.addEventListener('input', renderPinList);
document.getElementById('pin-sort')?.addEventListener('change', renderPinList);
const minimapPopupBtn = document.getElementById('minimap-popup');
const fsCanvas = document.getElementById('fullscreen-map-canvas');

const resizeFullscreenMapCanvas = () => {
    if (!fsCanvas) return;
    const rect = fsCanvas.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (fsCanvas.width !== width || fsCanvas.height !== height) {
        fsCanvas.width = width;
        fsCanvas.height = height;
    }
};

const calculateAutoFit = (pose) => {
    if (!fsCanvas || mapState.path.length < 2) {
        fsMapOffsetX = 0;
        fsMapOffsetY = 0;
        return;
    }

    const width = fsCanvas.width;
    const height = fsCanvas.height;

    const robotX = Number(pose.x || 0);
    const robotY = Number(pose.y || 0);

    let minX = robotX;
    let maxX = robotX;
    let minY = robotY;
    let maxY = robotY;

    mapState.path.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    });

    const spanX = maxX - minX;
    const spanY = maxY - minY;

    // Use 35% padding around the path ("a bit over enough")
    const padding = 1.35;
    // Set a minimum span of 3 meters to avoid zooming in too far
    const finalSpanX = Math.max(spanX * padding, 3.0);
    const finalSpanY = Math.max(spanY * padding, 3.0);

    const mapCenterX = (minX + maxX) / 2;
    const mapCenterY = (minY + maxY) / 2;

    const baseScale = (width < 400 ? 20 : width < 800 ? 30 : 40) * 3;
    
    // Required scale (pixels per meter)
    const scaleX = width / finalSpanX;
    const scaleY = height / finalSpanY;
    const fitScale = Math.min(scaleX, scaleY);

    fsMapZoom = Math.max(0.25, Math.min(10.0, fitScale / baseScale));
    const scale = baseScale * fsMapZoom;

    // Calculate offsets so (mapCenterX, mapCenterY) aligns with canvas center
    fsMapOffsetX = -(mapCenterX - robotX) * scale;
    fsMapOffsetY = (mapCenterY - robotY) * scale;
};

const drawFullscreenMap = (pose) => {
    if (!fsCanvas) return;
    resizeFullscreenMapCanvas();

    if (fsMapAutoFit) {
        calculateAutoFit(pose);
    }

    const ctx = fsCanvas.getContext('2d');
    const width = fsCanvas.width;
    const height = fsCanvas.height;

    ctx.clearRect(0, 0, width, height);

    const baseScale = (width < 400 ? 20 : width < 800 ? 30 : 40) * 3;
    const scale = baseScale * fsMapZoom;
    const centerX = width / 2;
    const centerY = height / 2;

    const robotX = Number(pose.x || 0);
    const robotY = Number(pose.y || 0);
    const heading = Number(pose.heading || 0);

    const toCanvas = (x, y) => ({
        x: centerX + fsMapOffsetX + (x - robotX) * scale,
        y: centerY + fsMapOffsetY - (y - robotY) * scale
    });

    drawMapGrid(ctx, width, height, scale, fsMapOffsetX, fsMapOffsetY);

    // Render path
    if (mapState.smoothedPath.length > 1) {
        const smoothedPath = mapState.smoothedPath;

        ctx.save();
        ctx.strokeStyle = COLOR_PALETTE.mapPath;
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Add a noticeable glow shadow to the path line
        ctx.shadowColor = COLOR_PALETTE.mapPath;
        ctx.shadowBlur = 10;

        ctx.beginPath();

        const canvasPoints = smoothedPath.map(p => toCanvas(p.x, p.y));
        ctx.moveTo(canvasPoints[0].x, canvasPoints[0].y);

        if (canvasPoints.length === 2) {
            ctx.lineTo(canvasPoints[1].x, canvasPoints[1].y);
        } else {
            for (let i = 1; i < canvasPoints.length - 1; i++) {
                const xc = (canvasPoints[i].x + canvasPoints[i + 1].x) / 2;
                const yc = (canvasPoints[i].y + canvasPoints[i + 1].y) / 2;
                ctx.quadraticCurveTo(canvasPoints[i].x, canvasPoints[i].y, xc, yc);
            }
            ctx.lineTo(canvasPoints[canvasPoints.length - 1].x, canvasPoints[canvasPoints.length - 1].y);
        }
        ctx.stroke();
        ctx.restore();
    }

    // Render obstacles
    mapState.obstacleHints.forEach(obstacle => {
        const point = toCanvas(obstacle.x, obstacle.y);
        ctx.beginPath();
        ctx.fillStyle = COLOR_PALETTE.mapObstacle;
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    // Render gas markers
    mapState.gasMarkers.forEach(marker => {
        const point = toCanvas(marker.x, marker.y);
        ctx.beginPath();
        ctx.strokeStyle = COLOR_PALETTE.mapGas;
        ctx.lineWidth = 2.5;
        ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
        ctx.fill();
    });

    // Render custom pins
    mapState.customPins.forEach(pin => {
        const point = toCanvas(pin.x, pin.y);

        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = 'rgba(168, 85, 247, 0.95)'; // Vibrant noticeable purple
        ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
        ctx.shadowColor = 'rgba(168, 85, 247, 0.8)';
        ctx.shadowBlur = 10;
        ctx.fill();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.fillStyle = '#ffffff';
        ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });

    // Render robot pose
    const robotCanvasX = centerX + fsMapOffsetX;
    const robotCanvasY = centerY + fsMapOffsetY;

    ctx.beginPath();
    ctx.fillStyle = COLOR_PALETTE.mapRobot;
    ctx.arc(robotCanvasX, robotCanvasY, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = COLOR_PALETTE.mapHeading;
    ctx.lineWidth = 3.5;
    ctx.moveTo(robotCanvasX, robotCanvasY);
    ctx.lineTo(
        robotCanvasX + Math.cos(heading) * 22,
        robotCanvasY - Math.sin(heading) * 22
    );
    ctx.stroke();

    // Render metadata
    ctx.fillStyle = COLOR_PALETTE.textDim;
    ctx.font = '12px Arial';
    ctx.fillText(`Robot Pose: (${robotX.toFixed(2)}m, ${robotY.toFixed(2)}m, ${(heading * 180 / Math.PI).toFixed(0)}\u00B0)`, 16, height - 34);
    ctx.fillText(`Zoom: ${fsMapZoom.toFixed(2)}x (Panned: X ${fsMapOffsetX.toFixed(0)}, Y ${fsMapOffsetY.toFixed(0)})`, 16, height - 16);
};

const canvasToWorld = (cx, cy, pose, width, height, zoom) => {
    const baseScale = (width < 400 ? 20 : width < 800 ? 30 : 40) * 3;
    const scale = baseScale * zoom;
    const centerX = width / 2;
    const centerY = height / 2;
    const robotX = Number(pose.x || 0);
    const robotY = Number(pose.y || 0);

    const wx = robotX + (cx - centerX - fsMapOffsetX) / scale;
    const wy = robotY + (centerY + fsMapOffsetY - cy) / scale;
    return { x: wx, y: wy };
};

const worldToCanvas = (wx, wy, pose, width, height, zoom) => {
    const baseScale = (width < 400 ? 20 : width < 800 ? 30 : 40) * 3;
    const scale = baseScale * zoom;
    const centerX = width / 2;
    const centerY = height / 2;
    const robotX = Number(pose.x || 0);
    const robotY = Number(pose.y || 0);

    const cx = centerX + fsMapOffsetX + (wx - robotX) * scale;
    const cy = centerY + fsMapOffsetY - (wy - robotY) * scale;
    return { x: cx, y: cy };
};

const findPinAt = (cx, cy) => {
    if (!lastPoseData || !fsCanvas) return null;
    const width = fsCanvas.width;
    const height = fsCanvas.height;
    const clickRadius = 15; // pixels

    // Check custom pins
    for (let i = 0; i < mapState.customPins.length; i++) {
        const pin = mapState.customPins[i];
        const p = worldToCanvas(pin.x, pin.y, lastPoseData, width, height, fsMapZoom);
        const dist = Math.hypot(cx - p.x, cy - p.y);
        if (dist <= clickRadius) {
            return { type: 'custom', index: i, pin, dist };
        }
    }

    // Check gas markers
    for (let i = 0; i < mapState.gasMarkers.length; i++) {
        const marker = mapState.gasMarkers[i];
        const p = worldToCanvas(marker.x, marker.y, lastPoseData, width, height, fsMapZoom);
        const dist = Math.hypot(cx - p.x, cy - p.y);
        if (dist <= clickRadius) {
            return { type: 'gas', index: i, marker, dist };
        }
    }

    // Check obstacle hints
    for (let i = 0; i < mapState.obstacleHints.length; i++) {
        const obs = mapState.obstacleHints[i];
        const p = worldToCanvas(obs.x, obs.y, lastPoseData, width, height, fsMapZoom);
        const dist = Math.hypot(cx - p.x, cy - p.y);
        if (dist <= clickRadius) {
            return { type: 'obstacle', index: i, obs, dist };
        }
    }

    // Check robot
    const rp = worldToCanvas(lastPoseData.x, lastPoseData.y, lastPoseData, width, height, fsMapZoom);
    const distRobot = Math.hypot(cx - rp.x, cy - rp.y);
    if (distRobot <= clickRadius) {
        return { type: 'robot', x: lastPoseData.x, y: lastPoseData.y, dist: distRobot };
    }

    return null;
};

const showTooltip = (cx, cy, content) => {
    const tooltip = document.getElementById('map-tooltip');
    if (!tooltip) return;

    tooltip.innerHTML = content;
    tooltip.style.display = 'block';

    const tooltipRect = tooltip.getBoundingClientRect();
    const parent = tooltip.parentElement;
    const parentRect = parent.getBoundingClientRect();

    let left = cx + 15;
    let top = cy + 15;

    if (left + tooltipRect.width > parentRect.width) {
        left = cx - tooltipRect.width - 15;
    }
    if (top + tooltipRect.height > parentRect.height) {
        top = cy - tooltipRect.height - 15;
    }

    tooltip.style.left = `${Math.max(5, left)}px`;
    tooltip.style.top = `${Math.max(5, top)}px`;
};

const hideTooltip = () => {
    const tooltip = document.getElementById('map-tooltip');
    if (tooltip) {
        tooltip.style.display = 'none';
    }
};

const handleMapClick = (cx, cy) => {
    if (!lastPoseData || !fsCanvas) return;

    const found = findPinAt(cx, cy);
    if (found) {
        if (found.type === 'custom') {
            openPinEditModal(found.index, found.pin);
            hideTooltip();
        }
    } else {
        const world = canvasToWorld(cx, cy, lastPoseData, fsCanvas.width, fsCanvas.height, fsMapZoom);
        setTimeout(() => {
            const label = prompt(`Add a custom map marker at:\nCoordinate X: ${world.x.toFixed(2)}m\nCoordinate Y: ${world.y.toFixed(2)}m\n\nEnter custom text / label:`);
            if (label && label.trim() !== '') {
                mapState.customPins.push({
                    x: world.x,
                    y: world.y,
                    label: label.trim(),
                    timestamp: Date.now()
                });
                renderPinList();
                drawFullscreenMap(lastPoseData);
            }
        }, 50);
    }
};

let fsDragState = {
    isDragging: false,
    startX: 0,
    startY: 0,
    hasDragged: false
};

if (fsCanvas) {
    fsCanvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        fsDragState.isDragging = true;
        fsDragState.startX = e.clientX - fsMapOffsetX;
        fsDragState.startY = e.clientY - fsMapOffsetY;
        fsDragState.hasDragged = false;
        fsCanvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!mapModal || !mapModal.classList.contains('open')) return;

        if (!fsDragState.isDragging) {
            const rect = fsCanvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;

            if (cx >= 0 && cx <= rect.width && cy >= 0 && cy <= rect.height) {
                const found = findPinAt(cx, cy);
                if (found) {
                    let content = '';
                    if (found.type === 'custom') {
                        content = `📌 <strong>Custom Pin</strong><br>Note: ${found.pin.label}<br>Pose: (${found.pin.x.toFixed(2)}m, ${found.pin.y.toFixed(2)}m)`;
                        if (found.pin.snapshot) {
                            content += `<br><img src="${found.pin.snapshot}" alt="Snapshot">`;
                        }
                    } else if (found.type === 'gas') {
                        content = `🔥 <strong>Gas Spike</strong><br>Value: ${found.marker.value}<br>Pose: (${found.marker.x.toFixed(2)}m, ${found.marker.y.toFixed(2)}m)`;
                    } else if (found.type === 'obstacle') {
                        content = `⚠️ <strong>Obstacle Hint</strong><br>Pose: (${found.obs.x.toFixed(2)}m, ${found.obs.y.toFixed(2)}m)`;
                    } else if (found.type === 'robot') {
                        content = `🤖 <strong>Robot</strong><br>Pose: (${found.x.toFixed(2)}m, ${found.y.toFixed(2)}m)`;
                    }
                    showTooltip(cx, cy, content);
                } else {
                    hideTooltip();
                }
            } else {
                hideTooltip();
            }
            return;
        }

        const newOffsetX = e.clientX - fsDragState.startX;
        const newOffsetY = e.clientY - fsDragState.startY;

        if (Math.abs(newOffsetX - fsMapOffsetX) > 3 || Math.abs(newOffsetY - fsMapOffsetY) > 3) {
            fsDragState.hasDragged = true;
            hideTooltip();
            fsMapAutoFit = false;
        }

        fsMapOffsetX = newOffsetX;
        fsMapOffsetY = newOffsetY;

        if (lastPoseData) {
            drawFullscreenMap(lastPoseData);
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (!fsDragState.isDragging) return;
        fsDragState.isDragging = false;
        fsCanvas.style.cursor = 'grab';

        if (!fsDragState.hasDragged) {
            const rect = fsCanvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            handleMapClick(cx, cy);
        }
    });

    let touchStartDist = 0;
    let initialZoom = 1.0;

    fsCanvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            fsDragState.isDragging = true;
            fsDragState.startX = e.touches[0].clientX - fsMapOffsetX;
            fsDragState.startY = e.touches[0].clientY - fsMapOffsetY;
            fsDragState.hasDragged = false;
            hideTooltip();
        } else if (e.touches.length === 2) {
            fsDragState.isDragging = false;
            touchStartDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            initialZoom = fsMapZoom;
        }
    });

    fsCanvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1 && fsDragState.isDragging) {
            const newOffsetX = e.touches[0].clientX - fsDragState.startX;
            const newOffsetY = e.touches[0].clientY - fsDragState.startY;

            if (Math.abs(newOffsetX - fsMapOffsetX) > 3 || Math.abs(newOffsetY - fsMapOffsetY) > 3) {
                fsDragState.hasDragged = true;
                fsMapAutoFit = false;
            }

            fsMapOffsetX = newOffsetX;
            fsMapOffsetY = newOffsetY;

            if (lastPoseData) {
                drawFullscreenMap(lastPoseData);
            }
        } else if (e.touches.length === 2 && touchStartDist > 0) {
            fsMapAutoFit = false;
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const factor = dist / touchStartDist;
            fsMapZoom = Math.max(0.25, Math.min(10.0, initialZoom * factor));
            localStorage.setItem('fsMapZoom', fsMapZoom);
            if (lastPoseData) {
                drawFullscreenMap(lastPoseData);
            }
        }
    }, { passive: true });

    fsCanvas.addEventListener('touchend', (e) => {
        if (fsDragState.isDragging) {
            fsDragState.isDragging = false;
            if (!fsDragState.hasDragged && e.changedTouches.length > 0) {
                const rect = fsCanvas.getBoundingClientRect();
                const cx = e.changedTouches[0].clientX - rect.left;
                const cy = e.changedTouches[0].clientY - rect.top;

                const found = findPinAt(cx, cy);
                if (found) {
                    let content = '';
                    if (found.type === 'custom') {
                        content = `📌 <strong>Custom Pin</strong><br>Note: ${found.pin.label}<br>Pose: (${found.pin.x.toFixed(2)}m, ${found.pin.y.toFixed(2)}m)<br><em style="font-size:0.9em;color:#ff7171;">Tap again to delete</em>`;
                    } else if (found.type === 'gas') {
                        content = `🔥 <strong>Gas Spike</strong><br>Value: ${found.marker.value}<br>Pose: (${found.marker.x.toFixed(2)}m, ${found.marker.y.toFixed(2)}m)`;
                    } else if (found.type === 'obstacle') {
                        content = `⚠️ <strong>Obstacle Hint</strong><br>Pose: (${found.obs.x.toFixed(2)}m, ${found.obs.y.toFixed(2)}m)`;
                    } else if (found.type === 'robot') {
                        content = `🤖 <strong>Robot</strong><br>Pose: (${found.x.toFixed(2)}m, ${found.y.toFixed(2)}m)`;
                    }

                    const tooltip = document.getElementById('map-tooltip');
                    const isAlreadyShowingThisPin = tooltip && tooltip.style.display === 'block' && tooltip.innerHTML.includes(found.type === 'custom' ? found.pin.label : found.type);

                    if (found.type === 'custom' && isAlreadyShowingThisPin) {
                        handleMapClick(cx, cy);
                    } else {
                        showTooltip(cx, cy, content);
                    }
                } else {
                    hideTooltip();
                    handleMapClick(cx, cy);
                }
            }
        }
        touchStartDist = 0;
    });

    fsCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        fsMapAutoFit = false;
        const zoomFactor = 1.1;
        let newZoom = fsMapZoom;
        if (e.deltaY < 0) {
            newZoom *= zoomFactor;
        } else {
            newZoom /= zoomFactor;
        }
        fsMapZoom = Math.max(0.25, Math.min(10.0, newZoom));
        localStorage.setItem('fsMapZoom', fsMapZoom);
        if (lastPoseData) {
            drawFullscreenMap(lastPoseData);
        }
    }, { passive: false });
}

if (minimapPopupBtn && mapModal) {
    minimapPopupBtn.onclick = (e) => {
        e.stopPropagation();
        fsMapAutoFit = true;
        mapModal.classList.add('open');
        resizeFullscreenMapCanvas();
        renderPinList();
        if (lastPoseData) {
            drawFullscreenMap(lastPoseData);
        }
    };
}

const fsMapFitBtn = document.getElementById('fs-map-fit-btn');
if (fsMapFitBtn) {
    fsMapFitBtn.onclick = (e) => {
        e.stopPropagation();
        fsMapAutoFit = true;
        if (lastPoseData) {
            drawFullscreenMap(lastPoseData);
        }
    };
}

if (mapModalClose && mapModal) {
    mapModalClose.onclick = (e) => {
        e.stopPropagation();
        mapModal.classList.remove('open');
        hideTooltip();
    };
}

if (mapModal) {
    mapModal.addEventListener('click', (e) => {
        if (e.target.id === 'map-modal') {
            mapModal.classList.remove('open');
            hideTooltip();
        }
    });
}

window.addEventListener('resize', resizeFullscreenMapCanvas);

// Arrow keys for camera pan/tilt control
const cameraKeys = new Set();
let cameraKeyIntervalId = null;

const updateCameraKeyMovement = () => {
    if (cameraKeys.size === 0) {
        if (cameraKeyIntervalId) {
            clearInterval(cameraKeyIntervalId);
            cameraKeyIntervalId = null;
        }
        return;
    }

    const has = (k) => cameraKeys.has(k);
    const step = 2; // degrees per tick (50ms)

    if (has('arrowleft')) {
        currentCameraPan = Math.max(0.0, Math.min(120.0, currentCameraPan - step));
    }
    if (has('arrowright')) {
        currentCameraPan = Math.max(0.0, Math.min(120.0, currentCameraPan + step));
    }
    if (has('arrowup')) {
        currentCameraTilt = Math.max(30.0, Math.min(120.0, currentCameraTilt + step));
    }
    if (has('arrowdown')) {
        currentCameraTilt = Math.max(30.0, Math.min(120.0, currentCameraTilt - step));
    }

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

document.addEventListener('keydown', (e) => {
    if (isUserTyping()) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        e.preventDefault();

        if (!cameraKeys.has(k)) {
            cameraKeys.add(k);

            // Execute first step immediately
            updateCameraKeyMovement();

            // Set up polling interval for continuous smooth motion
            if (!cameraKeyIntervalId) {
                cameraKeyIntervalId = setInterval(updateCameraKeyMovement, 50);
            }
        }
    }
});

document.addEventListener('keyup', (e) => {
    if (isUserTyping()) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        cameraKeys.delete(k);
        if (cameraKeys.size === 0 && cameraKeyIntervalId) {
            clearInterval(cameraKeyIntervalId);
            cameraKeyIntervalId = null;
        }
    }
});

const downsampleLTTB = (data, threshold) => {
    const dataLength = data.length;
    if (threshold >= dataLength || threshold === 0) {
        return data; // Nothing to downsample
    }

    const sampled = [];
    let sampledIndex = 0;

    // Bucket size. Leave room for start and end data points
    const bucketSize = (dataLength - 2) / (threshold - 2);

    let a = 0; // Point a is the first point of the previous bucket
    let maxAreaPoint = null;
    let maxArea = -1;
    let area = -1;
    let nextA = 0;

    sampled[sampledIndex++] = data[a]; // Always add the first point

    for (let i = 0; i < threshold - 2; i++) {
        // Calculate point b (average point of the next bucket)
        let avgX = 0;
        let avgY = 0;
        let avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
        let avgRangeEnd = Math.floor((i + 2) * bucketSize) + 1;
        avgRangeEnd = avgRangeEnd < dataLength ? avgRangeEnd : dataLength;

        const avgRangeLength = avgRangeEnd - avgRangeStart;

        for (; avgRangeStart < avgRangeEnd; avgRangeStart++) {
            avgX += data[avgRangeStart].timestamp; // X axis is time
            // For Y, we average the primary metrics. Since our data has multiple keys, 
            // let's use the gas or temperature sensor as the proxy for variation.
            avgY += (data[avgRangeStart].gas || data[avgRangeStart].temp || 0);
        }
        if (avgRangeLength > 0) {
            avgX /= avgRangeLength;
            avgY /= avgRangeLength;
        }

        // Get the range for this bucket
        let rangeOffs = Math.floor(i * bucketSize) + 1;
        const rangeTo = Math.floor((i + 1) * bucketSize) + 1;

        // Point a's coordinates
        const pointAX = data[a].timestamp;
        const pointAY = data[a].gas || data[a].temp || 0;

        maxArea = area = -1;

        for (; rangeOffs < rangeTo; rangeOffs++) {
            // Calculate triangle area over three buckets
            const pointBX = data[rangeOffs].timestamp;
            const pointBY = data[rangeOffs].gas || data[rangeOffs].temp || 0;
            
            area = Math.abs(
                (pointAX - avgX) * (pointBY - pointAY) - 
                (pointAX - pointBX) * (avgY - pointAY)
            ) * 0.5;

            if (area > maxArea) {
                maxArea = area;
                maxAreaPoint = data[rangeOffs];
                nextA = rangeOffs; // Next a is this selected b
            }
        }

        sampled[sampledIndex++] = maxAreaPoint; // Select the point that maximizes the triangle area
        a = nextA; // Move to the next bucket
    }

    sampled[sampledIndex++] = data[dataLength - 1]; // Always add the last point

    return sampled;
};



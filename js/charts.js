const renderCharts = () => {
    if (sessionData.length === 0) {
        const chartsContainer = document.getElementById('charts-container');

        if (chartsContainer) {
            chartsContainer.innerHTML =
                `<div style="padding: 20px; text-align: center; color: ${COLOR_PALETTE.textDim};">No data recorded yet. Drive around to collect sensor data.</div>`;
        }

        return;
    }

    const startEl = document.getElementById('chart-start-time');
    const endEl = document.getElementById('chart-end-time');
    if (startEl && endEl) {
        if (!startEl.value && !endEl.value) {
            startEl.value = formatTimeHHMMSS(sessionData[0].timestamp);
            endEl.value = formatTimeHHMMSS(sessionData[sessionData.length - 1].timestamp);
        } else if (chartAutoUpdatePlaying) {
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
    }

    let filteredData = [...sessionData];
    
    const startTimeInput = startEl?.value;
    const endTimeInput = endEl?.value;
    
    if (startTimeInput || endTimeInput) {
        filteredData = filteredData.filter(d => {
            const date = new Date(d.timestamp);
            const h = date.getHours().toString().padStart(2, '0');
            const m = date.getMinutes().toString().padStart(2, '0');
            const s = date.getSeconds().toString().padStart(2, '0');
            const timeStr = `${h}:${m}:${s}`;
            
            if (startTimeInput && timeStr < startTimeInput) return false;
            if (endTimeInput && timeStr > endTimeInput) return false;
            return true;
        });
    }

    if (filteredData.length === 0) {
        const chartsContainer = document.getElementById('charts-container');
        if (chartsContainer) {
            chartsContainer.innerHTML =
                `<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No data found for the selected time range.</div>`;
        }
        return;
    }

    const sortedData = filteredData.sort((a, b) => a.timestamp - b.timestamp);

    // downsample using lttb to preserve visual peaks/drops of the time-series.
    const maxPoints = 150;
    const chartData = downsampleLTTB(sortedData, maxPoints);

    const labels = chartData.map(d => new Date(d.timestamp).toLocaleTimeString());
    const originalTimestamps = chartData.map(d => d.timestamp);

    renderChart('environment', labels, [
        {
            label: 'Temperature (\u00B0C)',
            data: chartData.map(d => d.temp),
            borderColor: COLOR_PALETTE.red,
            backgroundColor: COLOR_PALETTE.redTransparent,
            yAxisID: 'y'
        },
        {
            label: 'Humidity (%)',
            data: chartData.map(d => d.humidity),
            borderColor: COLOR_PALETTE.blue,
            backgroundColor: COLOR_PALETTE.blueTransparent,
            yAxisID: 'y2'
        }
    ], {
        y: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: '\u00B0C' }
        },
        y2: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: '%' }
        }
    }, originalTimestamps);

    renderChart('motion', labels, [
        {
            label: 'Accel X (m/s²)',
            data: chartData.map(d => d.accel?.[0] ?? null),
            borderColor: COLOR_PALETTE.red,
            backgroundColor: COLOR_PALETTE.redTransparent
        },
        {
            label: 'Accel Y (m/s²)',
            data: chartData.map(d => d.accel?.[1] ?? null),
            borderColor: COLOR_PALETTE.green,
            backgroundColor: COLOR_PALETTE.greenTransparent
        },
        {
            label: 'Accel Z (m/s²)',
            data: chartData.map(d => d.accel?.[2] ?? null),
            borderColor: COLOR_PALETTE.blue,
            backgroundColor: COLOR_PALETTE.blueTransparent
        }
    ], {}, originalTimestamps);

    renderChart('distance', labels, [
        {
            label: 'Distance (cm)',
            data: chartData.map(d => d.ultrasonic_cm),
            borderColor: COLOR_PALETTE.purple,
            backgroundColor: COLOR_PALETTE.purpleTransparent,
            fill: true
        }
    ], {}, originalTimestamps);

    renderChart('gas', labels, [
        {
            label: 'Gas sensor raw value',
            data: chartData.map(d => d.gas),
            borderColor: COLOR_PALETTE.mapGas,
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            fill: true
        }
    ], {}, originalTimestamps);

};

// Track all pin x-pixel positions for hover detection: { canvasId -> [{x, label}] }
window.chartPinPositions = {};
window.showAllPinLines = false;

const drawPinLine = (ctx, x, topY, bottomY, label, isSelected) => {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x, bottomY);
    ctx.lineWidth = isSelected ? 2 : 1.5;
    ctx.strokeStyle = isSelected ? '#f43f5e' : '#a855f7';
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    
    if (isSelected) {
        ctx.fillStyle = '#f43f5e';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('📍 Pin', x + 6, topY + 14);
    }
    ctx.restore();
};

const findClosestIdx = (timestamps, targetTs) => {
    let closestIdx = -1;
    let minDiff = Infinity;
    timestamps.forEach((ts, idx) => {
        const diff = Math.abs(ts - targetTs);
        if (diff < minDiff) { minDiff = diff; closestIdx = idx; }
    });
    return closestIdx;
};

const verticalLinePlugin = {
    id: 'verticalLine',
    afterDraw: (chart) => {
        if (!chart.config.options.originalTimestamps) return;
        
        const ctx = chart.ctx;
        const xAxis = chart.scales.x;
        const topY = chart.scales.y.top;
        const bottomY = chart.scales.y.bottom;
        const timestamps = chart.config.options.originalTimestamps;
        const chartId = chart.canvas.id;
        
        if (timestamps.length === 0) return;
        
        const rangeStart = timestamps[0];
        const rangeEnd = timestamps[timestamps.length - 1];
        
        // Collect all pin x positions for this canvas for hover detection
        const pinPositions = [];
        window.chartPinPositions[chartId] = pinPositions;

        // Draw all-pin lines if toggle is active
        if (window.showAllPinLines && typeof mapState !== 'undefined' && mapState.customPins) {
            mapState.customPins.forEach(pin => {
                if (!pin.timestamp) return;
                const ts = pin.timestamp;
                if (ts < rangeStart || ts > rangeEnd) return;
                const idx = findClosestIdx(timestamps, ts);
                if (idx === -1) return;
                const x = xAxis.getPixelForValue(idx);
                const isSelected = window.chartSnapshotTime && Math.abs(ts - window.chartSnapshotTime) < 500;
                drawPinLine(ctx, x, topY, bottomY, pin.label, isSelected);
                pinPositions.push({ x, label: pin.label, timestamp: ts });
            });
        }
        
        // Draw the selected single pin line (from "View Data" button)
        if (window.chartSnapshotTime) {
            const snapshotTs = window.chartSnapshotTime;
            if (snapshotTs >= rangeStart && snapshotTs <= rangeEnd) {
                const idx = findClosestIdx(timestamps, snapshotTs);
                if (idx !== -1) {
                    const x = xAxis.getPixelForValue(idx);
                    // Only draw if not already drawn by the all-pins loop
                    if (!window.showAllPinLines) {
                        drawPinLine(ctx, x, topY, bottomY, null, true);
                        ctx.save();
                        ctx.fillStyle = '#f43f5e';
                        ctx.font = 'bold 11px sans-serif';
                        ctx.fillText('📍 Pin', x + 6, topY + 14);
                        ctx.restore();
                    }
                }
            }
        }
    }
};

// Hover detection for pin labels across all chart canvases
const pinTooltip = document.getElementById('chart-pin-tooltip');
const pinTooltipText = document.getElementById('chart-pin-tooltip-text');
const HOVER_RADIUS = 10; // pixels

document.addEventListener('mousemove', (e) => {
    if (!pinTooltip || !pinTooltipText) return;
    if (!window.showAllPinLines) { pinTooltip.style.display = 'none'; return; }
    
    let found = null;
    for (const canvasId in window.chartPinPositions) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) continue;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        // Only detect if mouse is over this canvas
        if (mouseX < 0 || mouseY < 0 || mouseX > rect.width || mouseY > rect.height) continue;
        
        for (const pos of window.chartPinPositions[canvasId]) {
            if (Math.abs(mouseX - pos.x) <= HOVER_RADIUS) {
                found = { label: pos.label, clientX: e.clientX, clientY: e.clientY };
                break;
            }
        }
        if (found) break;
    }
    
    if (found) {
        pinTooltipText.textContent = found.label;
        pinTooltip.style.display = 'block';
        pinTooltip.style.left = (found.clientX + 14) + 'px';
        pinTooltip.style.top = (found.clientY - 10) + 'px';
        document.body.style.cursor = 'pointer';
    } else {
        pinTooltip.style.display = 'none';
        document.body.style.cursor = '';
    }
});

// Click to open pin edit modal when clicking a pin line
document.addEventListener('click', (e) => {
    if (!window.showAllPinLines) return;
    
    for (const canvasId in window.chartPinPositions) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) continue;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        if (mouseX < 0 || mouseY < 0 || mouseX > rect.width || mouseY > rect.height) continue;
        
        for (const pos of window.chartPinPositions[canvasId]) {
            if (Math.abs(mouseX - pos.x) <= HOVER_RADIUS) {
                // Find the pin in mapState by matching timestamp
                if (typeof mapState === 'undefined' || !mapState.customPins) return;
                const pinIdx = mapState.customPins.findIndex(p => p.timestamp === pos.timestamp);
                if (pinIdx !== -1 && typeof openPinEditModal === 'function') {
                    // Hide tooltip before opening modal
                    if (pinTooltip) pinTooltip.style.display = 'none';
                    openPinEditModal(pinIdx, mapState.customPins[pinIdx]);
                }
                return;
            }
        }
    }
});

const renderChart = (chartId, labels, datasets, yAxes = {}, originalTimestamps = []) => {
    const canvas = document.getElementById(`chart-${chartId}`);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    if (charts[chartId]) {
        charts[chartId].destroy();
    }

    const options = {
        responsive: true,
        maintainAspectRatio: true,
        animation: {
            duration: 400,
            easing: 'easeOutQuart'
        },
        interaction: {
            mode: 'index',
            intersect: false
        },
        originalTimestamps: originalTimestamps,
        plugins: {
            legend: {
                labels: {
                    color: COLOR_PALETTE.textBright,
                    font: { size: 11 }
                }
            },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                borderColor: 'rgba(59, 130, 246, 0.4)',
                borderWidth: 1,
                titleColor: '#ffffff',
                bodyColor: '#cbd5e1',
                padding: 10,
                cornerRadius: 6,
                displayColors: true
            }
        },
        scales: {
            x: {
                ticks: { 
                    color: COLOR_PALETTE.textDim, 
                    font: { size: 10 },
                    maxTicksLimit: 8,
                    autoSkip: true,
                    maxRotation: 0
                },
                grid: { 
                    color: 'rgba(255, 255, 255, 0.05)',
                    drawOnChartArea: true
                }
            },
            y: {
                ticks: { color: COLOR_PALETTE.textDim, font: { size: 10 } },
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ...yAxes.y
            }
        },
        elements: {
            line: {
                tension: 0.4,
                borderWidth: 2,
                capBezierPoints: true
            },
            point: {
                radius: 0,
                hoverRadius: 5,
                hitRadius: 6
            }
        }
    };

    if (yAxes.y2) {
        options.scales.y2 = {
            ticks: { color: COLOR_PALETTE.textDim, font: { size: 10 } },
            grid: { drawOnChartArea: false },
            ...yAxes.y2
        };
    }

    charts[chartId] = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options,
        plugins: [verticalLinePlugin]
    });
};

// Pin lines toggle button
const chartPinsToggleBtn = document.getElementById('chart-pins-toggle-btn');
if (chartPinsToggleBtn) {
    chartPinsToggleBtn.addEventListener('click', () => {
        window.showAllPinLines = !window.showAllPinLines;
        if (window.showAllPinLines) {
            chartPinsToggleBtn.style.background = 'rgba(168,85,247,0.4)';
            chartPinsToggleBtn.style.borderColor = 'rgba(168,85,247,0.8)';
            chartPinsToggleBtn.style.boxShadow = '0 0 8px rgba(168,85,247,0.4)';
        } else {
            chartPinsToggleBtn.style.background = 'rgba(168,85,247,0.15)';
            chartPinsToggleBtn.style.borderColor = 'rgba(168,85,247,0.4)';
            chartPinsToggleBtn.style.boxShadow = '';
        }
        renderCharts();
    });
}

const dataExportBtn = document.getElementById('data-export-btn');

if (dataExportBtn) {
    dataExportBtn.onclick = () => {
        if (sessionData.length === 0) {
            showExportStatus('No data to export', 'error');
            return;
        }

        const sortedData = [...sessionData].sort((a, b) => a.timestamp - b.timestamp);

        const headers = [
            // Time Group
            'Timestamp',
            // Position/Odometry Group
            'Robot X (m)',
            'Robot Y (m)',
            'Robot Heading (rad)',
            // Environment Group
            'Temperature (\u00B0C)',
            'Humidity (%)',
            'Pressure (hPa)',
            // Gas Spike Group
            'Gas Raw',
            'Gas (%)',
            // Distance Group
            'Distance (cm)',
            // IMU Motion Group
            'Accel X (m/s²)',
            'Accel Y (m/s²)',
            'Accel Z (m/s²)',
            'Gyro X (rad/s)',
            'Gyro Y (rad/s)',
            'Gyro Z (rad/s)'
        ];

        const rows = [];
        let lastData = null;

        for (let i = 0; i < sortedData.length; i++) {
            const d = sortedData[i];
            
            if (lastData) {
                const hasChanged = 
                    d.temp !== lastData.temp ||
                    d.humidity !== lastData.humidity ||
                    d.pressure !== lastData.pressure ||
                    d.ultrasonic_cm !== lastData.ultrasonic_cm ||
                    d.gas !== lastData.gas ||
                    d.gas_percent !== lastData.gas_percent ||
                    d.x !== lastData.x ||
                    d.y !== lastData.y ||
                    d.heading !== lastData.heading ||
                    (d.accel?.[0] !== lastData.accel?.[0] || d.accel?.[1] !== lastData.accel?.[1] || d.accel?.[2] !== lastData.accel?.[2]) ||
                    (d.gyro?.[0] !== lastData.gyro?.[0] || d.gyro?.[1] !== lastData.gyro?.[1] || d.gyro?.[2] !== lastData.gyro?.[2]);
                
                if (!hasChanged) {
                    continue;
                }
            }

            rows.push([
                new Date(d.timestamp).toLocaleString(),
                d.x ?? '',
                d.y ?? '',
                d.heading ?? '',
                d.temp ?? '',
                d.humidity ?? '',
                d.pressure ?? '',
                d.gas ?? '',
                d.gas_percent ?? '',
                d.ultrasonic_cm ?? '',
                d.accel?.[0] ?? '',
                d.accel?.[1] ?? '',
                d.accel?.[2] ?? '',
                d.gyro?.[0] ?? '',
                d.gyro?.[1] ?? '',
                d.gyro?.[2] ?? ''
            ]);

            lastData = d;
        }

        const csvContent = [
            headers.map(h => `"${h}"`).join(','),
            ...rows.map(r => r.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `robot_session_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showExportStatus('✓ CSV exported successfully', 'success');
    };
}

const showExportStatus = (message, status) => {
    const statusEl = document.getElementById('export-status');
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.className = `export-status ${status}`;

    setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = 'export-status';
    }, 3000);
};

// --- CSV Import ---
const MAX_SESSION_ROWS = 20000;

const parseCSVToSessionData = (csvText) => {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];
    
    // Strip quotes helper
    const unquote = s => s.replace(/^"|"$/g, '').trim();
    const num = s => { const n = parseFloat(s); return isNaN(n) ? null : n; };
    
    const headers = lines[0].split(',').map(unquote);
    
    // Map header names to field keys
    const colMap = {
        'Timestamp':           'timestamp_str',
        'Robot X (m)':         'x',
        'Robot Y (m)':         'y',
        'Robot Heading (rad)': 'heading',
        'Temperature (°C)':    'temp',
        'Humidity (%)':        'humidity',
        'Pressure (hPa)':      'pressure',
        'Gas Raw':             'gas',
        'Gas (%)':             'gas_percent',
        'Distance (cm)':       'ultrasonic_cm',
        'Accel X (m/s²)':      'ax',
        'Accel Y (m/s²)':      'ay',
        'Accel Z (m/s²)':      'az',
        'Gyro X (rad/s)':      'gx',
        'Gyro Y (rad/s)':      'gy',
        'Gyro Z (rad/s)':      'gz',
    };
    
    const colIdx = {};
    headers.forEach((h, i) => { if (colMap[h]) colIdx[colMap[h]] = i; });
    
    const parsed = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(unquote);
        if (cols.length < 2) continue;
        
        const tsStr = cols[colIdx['timestamp_str']];
        const tsMs = tsStr ? new Date(tsStr).getTime() : null;
        if (!tsMs || isNaN(tsMs)) continue;
        
        const row = { timestamp: tsMs };
        
        ['x','y','heading','temp','humidity','pressure','gas','gas_percent','ultrasonic_cm'].forEach(k => {
            if (colIdx[k] !== undefined) row[k] = num(cols[colIdx[k]]);
        });
        
        const ax = num(cols[colIdx['ax']]);
        const ay = num(cols[colIdx['ay']]);
        const az = num(cols[colIdx['az']]);
        if (ax !== null || ay !== null || az !== null) row.accel = [ax, ay, az];
        
        const gx = num(cols[colIdx['gx']]);
        const gy = num(cols[colIdx['gy']]);
        const gz = num(cols[colIdx['gz']]);
        if (gx !== null || gy !== null || gz !== null) row.gyro = [gx, gy, gz];
        
        parsed.push(row);
    }
    return parsed;
};

const dataImportInput = document.getElementById('data-import-input');
if (dataImportInput) {
    dataImportInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // Reset input so same file can be re-imported
        dataImportInput.value = '';
        
        const reader = new FileReader();
        reader.onload = (ev) => {
            const importedRows = parseCSVToSessionData(ev.target.result);
            if (importedRows.length === 0) {
                showExportStatus('⚠ No valid rows found in CSV', 'error');
                return;
            }
            
            const merged = [...sessionData, ...importedRows];
            
            if (merged.length > MAX_SESSION_ROWS) {
                // Too big to extend — ask user
                const ok = confirm(
                    `Merging would create ${merged.length.toLocaleString()} rows (limit: ${MAX_SESSION_ROWS.toLocaleString()}).\n\n` +
                    `Click OK to overwrite current data with the imported CSV (${importedRows.length.toLocaleString()} rows).\n` +
                    `Click Cancel to abort.`
                );
                if (!ok) return;
                // Overwrite
                sessionData.length = 0;
                importedRows.forEach(r => sessionData.push(r));
                showExportStatus(`✓ Overwrote with ${importedRows.length.toLocaleString()} imported rows`, 'success');
            } else {
                // Extend — merge, sort by timestamp, deduplicate by timestamp
                const seen = new Set(sessionData.map(r => r.timestamp));
                let added = 0;
                importedRows.forEach(r => {
                    if (!seen.has(r.timestamp)) {
                        sessionData.push(r);
                        seen.add(r.timestamp);
                        added++;
                    }
                });
                sessionData.sort((a, b) => a.timestamp - b.timestamp);
                showExportStatus(`✓ Added ${added} rows (${sessionData.length.toLocaleString()} total)`, 'success');
            }
            
            renderCharts();
        };
        reader.readAsText(file);
    });
}

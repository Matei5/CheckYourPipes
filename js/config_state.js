

const COLOR_PALETTE = {
    red: 'rgb(255, 99, 132)',
    redTransparent: 'rgba(255, 99, 132, 0.1)',
    blue: 'rgb(54, 162, 235)',
    blueTransparent: 'rgba(54, 162, 235, 0.1)',
    green: 'rgb(75, 192, 75)',
    greenTransparent: 'rgba(75, 192, 75, 0.1)',
    purple: 'rgb(153, 102, 255)',
    purpleTransparent: 'rgba(153, 102, 255, 0.1)',

    mapGrid: 'rgba(255, 255, 255, 0.08)',
    mapPath: 'rgba(57, 255, 20, 0.95)',
    mapRobot: 'rgba(59, 130, 246, 0.95)',
    mapHeading: 'rgba(255, 255, 255, 0.9)',
    mapObstacle: 'rgba(251, 146, 60, 0.95)',
    mapGas: 'rgba(239, 68, 68, 0.95)',

    textBright: 'rgba(255, 255, 255, 0.7)',
    textDim: 'rgba(255, 255, 255, 0.5)',
    gridLine: 'rgba(255, 255, 255, 0.1)'
};

const CONFIG = {
    sizes: {
        small: { maxDistance: 20, deadZone: 4 },
        medium: { maxDistance: 27, deadZone: 6 },
        large: { maxDistance: 35, deadZone: 8 }
    },
    sensorInterval: 1000,
    poseInterval: 200,
    updateInterval: 50,
    dataMaxAge: 7200000,
    gasMarkerThreshold: 100,
    obstacleThresholdCm: 50,
    maxPathPoints: 1000,
    maxGasMarkers: 200,
    maxObstacleHints: 300
};

let sessionData = [];
let charts = {};
let chartAutoUpdatePlaying = false;

const loadSessionData = () => {
    try {
        const stored = localStorage.getItem('robotSessionData');
        sessionData = stored ? JSON.parse(stored) : [];
    } catch (e) {
        sessionData = [];
    }
};

const saveSessionData = () => {
    try {
        localStorage.setItem('robotSessionData', JSON.stringify(sessionData));
    } catch (e) {
        console.error('Failed to save session data:', e);
    }
};

const recordSensorData = (sensorData) => {
    const timestamp = Date.now();

    sessionData.push({
        timestamp,
        temp: sensorData.temp,
        humidity: sensorData.humidity,
        pressure: sensorData.pressure,
        ultrasonic_cm: sensorData.ultrasonic_cm,
        gas: sensorData.gas,
        accel: sensorData.accel,
        gyro: sensorData.gyro,
        temp_mpu: sensorData.temp_mpu,
        x: sensorData.x,
        y: sensorData.y,
        heading: sensorData.heading,
        gas_percent: sensorData.gas_percent,
    });

    const cutoff = timestamp - CONFIG.dataMaxAge;
    sessionData = sessionData.filter(d => d.timestamp > cutoff);

    // Limit array size to prevent localStorage overflow (Max ~3000 records)
    if (sessionData.length > 3000) {
        sessionData = sessionData.slice(-3000);
    }

    saveSessionData();

    if (chartAutoUpdatePlaying && typeof renderCharts === 'function') {
        const dataModal = document.getElementById('data-modal');
        if (dataModal && dataModal.classList.contains('open')) {
            renderCharts();
        }
    }
};

loadSessionData();



/**
 * CORNEA-OPTICS ABLATION-OS | MULTI-REFRACTIVE SIMULATION ENGINE
 * Supporting: Astigmatism (Ablation.cs), Myopia (Munnerlyn), Hyperopia, Presbyopia, and Compound
 */

// ===================================================================
// 1. Core Mathematical Primitives from Ablation.cs
// ===================================================================

class Point_Type {
    constructor(x = 0.0, y = 0.0) {
        this.X = x;
        this.Y = y;
    }
}

function CCW(p0, p1, p2) {
    let dx1 = p1.X - p0.X;
    let dy1 = p1.Y - p0.Y;
    let dx2 = p2.X - p0.X;
    let dy2 = p2.Y - p0.Y;

    if (dx1 * dy2 > dy1 * dx2) return 1;
    if (dx1 * dy2 < dy1 * dx2) return -1;
    if (dx1 * dy2 === dy1 * dx2) {
        if (dx1 * dx2 < 0) return -1;
        else if ((dx1 * dx1 + dy1 * dy1) >= (dx2 * dx2 + dy2 * dy2)) return 0;
        else return 1;
    }
    return 0;
}

function intersection(p11, p12, p21, p22) {
    return ((CCW(p11, p12, p21) * CCW(p11, p12, p22) <= 0) &&
            (CCW(p21, p22, p11) * CCW(p21, p22, p12) <= 0));
}

// ===================================================================
// 2. Audio Synthesizer (Laser Zap Pulses)
// ===================================================================
let audioCtx = null;
let soundEnabled = true;

function playLaserSound(freq = 880) {
    if (!soundEnabled) return;
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(120, audioCtx.currentTime + 0.04);

        gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start();
        osc.stop(audioCtx.currentTime + 0.04);
    } catch (e) {
        // audio might be blocked before first user interaction
    }
}

// ===================================================================
// 3. State & Simulation Model
// ===================================================================
const State = {
    // Surgery Mode: 'astigmatism' | 'myopia' | 'compound' | 'hyperopia' | 'presbyopia' | 'smile'
    mode: 'astigmatism',
    smileExtracted: false,
    capThickness: 120,      // um (Zeiss VisuMax standard cap depth)

    // Clinical Refractive Inputs
    asti_degree: 90.0,      // Astigmatism angle (0° to 180°)
    cylinder: 2.0,          // Diopters (-D)
    sphere: -4.0,           // Myopia (-D) or Hyperopia (+D)
    presbyAdd: 2.0,         // Presbyopia Near Add (+D)
    optical_zone: 6.5,      // mm
    
    // Architecture
    total_phase: 3,
    layers: [4, 4, 4],
    num_of_points: 2800,
    depth_per_shot: 0.25,   // ~0.25 um per laser pulse (Excimer ArF 193nm standard)

    // Generated Arrays
    mintable: [],
    maxtable: [],
    point_XY_pos: [],
    shots: [],              // shots[i][k]
    total_shots_per_point: [],

    // Execution / Animation State
    currentPhase: 0,
    currentLayer: 0,
    isPlaying: false,
    simSpeed: 5,            // 1 to 10
    animFrameId: null,
    lastStepTime: 0,
    currentChords: null,    // { PP10, PP11, PP20, PP21, c1, c2, radius }

    // Display Toggles
    showAxes: true,
    showChords: true,
    showPoints: true,
    activeView: '2d'
};

// ===================================================================
// 4. Data Initialization & Table Synthesis
// ===================================================================
function initCornealGrid() {
    State.point_XY_pos = [];
    const radiusMax = 4.2; // Cornea half-diameter ~8.4 mm
    const targetPoints = State.num_of_points;
    
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < targetPoints; i++) {
        const r = Math.sqrt(i / targetPoints) * radiusMax;
        const theta = i * goldenAngle;
        const x = r * Math.cos(theta);
        const y = r * Math.sin(theta);
        State.point_XY_pos.push(new Point_Type(x, y));
    }
}

function generateAblationTables() {
    State.mintable = [];
    State.maxtable = [];
    State.layers = [];

    const phases = State.total_phase;
    const layersPerPhase = parseInt(document.getElementById('inputLayersPerPhase').value) || 4;
    const halfOZ = State.optical_zone / 2.0;

    for (let i = 0; i < phases; i++) {
        State.layers[i] = layersPerPhase;
        State.mintable[i] = [];
        State.maxtable[i] = [];

        for (let j = 0; j < layersPerPhase; j++) {
            const progress = (j + 0.5) / layersPerPhase;
            const r0 = 0.4 + progress * (halfOZ - 0.7);
            const spotRadius = 0.55 + 0.45 * Math.sin(progress * Math.PI);
            
            State.mintable[i][j] = r0;
            State.maxtable[i][j] = r0 + spotRadius;
        }
    }

    // Reset shots buffers: shots[total_phase][num_of_points]
    State.shots = [];
    for (let i = 0; i < phases; i++) {
        State.shots[i] = new Uint16Array(State.point_XY_pos.length);
    }
    State.total_shots_per_point = new Uint16Array(State.point_XY_pos.length);
    State.currentPhase = 0;
    State.currentLayer = 0;
    State.currentChords = null;
}

// ===================================================================
// 5. Multi-Refractive Ablation Layer Execution
// ===================================================================
function executeAblationLayer(i, j) {
    const r0 = State.mintable[i][j];
    const theta = State.asti_degree * Math.PI / 180.0;
    const radius = State.maxtable[i][j] - r0;

    const PP10 = new Point_Type();
    const PP11 = new Point_Type();
    const PP20 = new Point_Type();
    const PP21 = new Point_Type();
    const P0 = new Point_Type(0.0, 0.0);

    PP10.X = r0 * Math.cos(theta) - radius * Math.sin(theta);
    PP10.Y = r0 * Math.sin(theta) + radius * Math.cos(theta);
    PP11.X = r0 * Math.cos(theta) + radius * Math.sin(theta);
    PP11.Y = r0 * Math.sin(theta) - radius * Math.cos(theta);

    const center_X_1 = r0 * Math.cos(theta);
    const center_Y_1 = r0 * Math.sin(theta);

    PP20.X = -PP10.X;
    PP20.Y = -PP10.Y;
    PP21.X = -PP11.X;
    PP21.Y = -PP11.Y;

    // Cache current chord geometry for live UI rendering
    State.currentChords = {
        PP10, PP11, PP20, PP21,
        c1: new Point_Type(center_X_1, center_Y_1),
        c2: new Point_Type(-center_X_1, -center_Y_1),
        radius, r0, theta
    };

    // Update Live Math Watch variables
    document.getElementById('watchTheta').innerText = theta.toFixed(4);
    document.getElementById('watchR0').innerText = r0.toFixed(3);
    document.getElementById('watchRadius').innerText = radius.toFixed(3);
    document.getElementById('watchPP10').innerText = `${PP10.X.toFixed(2)}, ${PP10.Y.toFixed(2)}`;
    document.getElementById('watchPP11').innerText = `${PP11.X.toFixed(2)}, ${PP11.Y.toFixed(2)}`;

    const halfOZ = State.optical_zone / 2.0;
    const totalLayers = State.total_phase * State.layers[0];
    const currentLayerIdx = i * State.layers[0] + j;

    const P1 = new Point_Type();

    // 1. Astigmatism Component (from Ablation.cs)
    const runAstigmatism = (State.mode === 'astigmatism' || State.mode === 'compound');
    const cylMultiplier = Math.max(1, Math.round(State.cylinder * 1.5));

    // 2. Myopia Component (Munnerlyn Parabolic Flattening)
    const runMyopia = (State.mode === 'myopia' || State.mode === 'compound');
    const myoDiopter = Math.abs(State.sphere);
    const myoPerLayer = (myoDiopter * 1.8) / totalLayers;

    // 3. Hyperopia Component (Annular Ring Steepening)
    const runHyperopia = (State.mode === 'hyperopia');
    const hypDiopter = Math.abs(State.sphere);
    const hypPerLayer = (hypDiopter * 2.2) / totalLayers;

    // 4. Presbyopia Component (Central Multifocal Bump + Intermediate Distance)
    const runPresbyopia = (State.mode === 'presbyopia');
    const presbyAdd = State.presbyAdd;

    for (let k = 0; k < State.num_of_points; k++) {
        P1.X = State.point_XY_pos[k].X;
        P1.Y = State.point_XY_pos[k].Y;
        const r_sq = P1.X * P1.X + P1.Y * P1.Y;
        const r = Math.sqrt(r_sq);

        let deltaShots = 0;

        // A. Astigmatism logic (Ablation.cs)
        if (runAstigmatism) {
            if (intersection(P0, P1, PP10, PP11)) {
                const rad = Math.sqrt((P1.X - center_X_1) * (P1.X - center_X_1) +
                                      (P1.Y - center_Y_1) * (P1.Y - center_Y_1));
                if (rad <= radius) {
                    deltaShots += cylMultiplier;
                }
            } else if (intersection(P0, P1, PP20, PP21)) {
                const rad = Math.sqrt((P1.X + center_X_1) * (P1.X + center_X_1) +
                                      (P1.Y + center_Y_1) * (P1.Y + center_Y_1));
                if (rad <= radius) {
                    deltaShots += cylMultiplier;
                }
            }
        }

        // B. Myopia logic (Munnerlyn central peak, parabolic falloff to OZ boundary)
        if (runMyopia && r <= halfOZ) {
            const munnerlynFactor = Math.max(0, 1 - (r_sq / (halfOZ * halfOZ)));
            // Stagger scanning pulses per layer
            const layerRingR = (currentLayerIdx / totalLayers) * halfOZ;
            const distToScan = Math.abs(r - layerRingR);
            if (distToScan < 0.65) {
                deltaShots += Math.round(munnerlynFactor * myoPerLayer * 14);
            }
        }

        // C. Hyperopia logic (Central safe zone untouched, mid-periphery annular ring 1.5mm - 3.8mm ablated)
        if (runHyperopia) {
            const innerR = 1.2;
            const outerR = 3.8;
            if (r >= innerR && r <= outerR) {
                const peakR = 2.4;
                const ringFactor = Math.exp(-Math.pow((r - peakR) / 0.8, 2));
                const layerRingR = innerR + (currentLayerIdx / totalLayers) * (outerR - innerR);
                if (Math.abs(r - layerRingR) < 0.7) {
                    deltaShots += Math.round(ringFactor * hypPerLayer * 18);
                }
            }
        }

        // D. Presbyopia logic (PresbyMAX: Aspheric base + Central near-add reading zone)
        if (runPresbyopia) {
            // Near-add pupil center (0 - 1.5mm) has a steepening refractive transition
            if (r > 1.2 && r <= halfOZ) {
                // Distance ablation ring
                const ringFactor = Math.max(0, 1 - (Math.abs(r - 2.8) / 1.6));
                deltaShots += Math.round(ringFactor * presbyAdd * 4);
            } else if (r <= 1.2) {
                // Central micro-island reading zone (Add +2.0D)
                deltaShots += Math.round((1 - r / 1.2) * (presbyAdd * 2));
            }
        }

        // E. SMILE Femtosecond Lenticule Logic (Zeiss VisuMax Photodisruption)
        if (State.mode === 'smile' && r <= halfOZ) {
            const munnerlynFactor = Math.max(0, 1 - (r_sq / (halfOZ * halfOZ)));
            let cylLenticule = 0;
            if (intersection(P0, P1, PP10, PP11)) {
                const rad = Math.sqrt((P1.X - center_X_1) * (P1.X - center_X_1) +
                                      (P1.Y - center_Y_1) * (P1.Y - center_Y_1));
                if (rad <= radius) cylLenticule += cylMultiplier;
            } else if (intersection(P0, P1, PP20, PP21)) {
                const rad = Math.sqrt((P1.X + center_X_1) * (P1.X + center_X_1) +
                                      (P1.Y + center_Y_1) * (P1.Y + center_Y_1));
                if (rad <= radius) cylLenticule += cylMultiplier;
            }
            const layerRingR = (currentLayerIdx / totalLayers) * halfOZ;
            if (Math.abs(r - layerRingR) < 0.75) {
                deltaShots += Math.round(munnerlynFactor * myoPerLayer * 14) + cylLenticule + 1;
            }
        }

        if (deltaShots > 0) {
            State.shots[i][k] += deltaShots;
            State.total_shots_per_point[k] += deltaShots;
        }
    }

    playLaserSound(550 + (i * 120) + (j * 35));
    highlightCodeLine(28);
    updateMetrics();
}

function executeAllInstantly() {
    for (let i = 0; i < State.total_phase; i++) {
        for (let j = 0; j < State.layers[i]; j++) {
            executeAblationLayer(i, j);
        }
    }
    State.currentPhase = State.total_phase;
    State.currentLayer = State.layers[State.total_phase - 1];
    stopSimulation();
    renderAll();
    highlightCodeLine(36);
}

// ===================================================================
// 6. Simulation Loop Controller
// ===================================================================
function stepSimulation() {
    if (State.currentPhase >= State.total_phase) {
        stopSimulation();
        return false;
    }

    executeAblationLayer(State.currentPhase, State.currentLayer);

    State.currentLayer++;
    if (State.currentLayer >= State.layers[State.currentPhase]) {
        State.currentLayer = 0;
        State.currentPhase++;
    }

    renderAll();
    return State.currentPhase < State.total_phase;
}

function startSimulation() {
    if (State.currentPhase >= State.total_phase) {
        resetSimulation();
    }
    State.isPlaying = true;
    document.getElementById('iconPlayPause').className = 'fa-solid fa-pause';
    document.getElementById('textPlayPause').innerText = '暫停';

    function loop(timestamp) {
        if (!State.isPlaying) return;
        const interval = 1000 / (State.simSpeed * 2.5);

        if (timestamp - State.lastStepTime > interval) {
            State.lastStepTime = timestamp;
            const hasMore = stepSimulation();
            if (!hasMore) {
                stopSimulation();
                return;
            }
        }
        State.animFrameId = requestAnimationFrame(loop);
    }
    State.animFrameId = requestAnimationFrame(loop);
}

function stopSimulation() {
    State.isPlaying = false;
    if (State.animFrameId) {
        cancelAnimationFrame(State.animFrameId);
        State.animFrameId = null;
    }
    document.getElementById('iconPlayPause').className = 'fa-solid fa-play';
    document.getElementById('textPlayPause').innerText = '繼續消融';
}

function resetSimulation() {
    stopSimulation();
    document.getElementById('textPlayPause').innerText = '開始消融';
    generateAblationTables();
    renderAll();
    updateMetrics();
}

// ===================================================================
// 7. 2D Canvas Heatmap & Laser Animation Renderer
// ===================================================================
const canvas2D = document.getElementById('ablationCanvas2D');
const ctx2D = canvas2D.getContext('2d');

function resizeCanvases() {
    const rect = canvas2D.parentElement.getBoundingClientRect();
    canvas2D.width = rect.width * window.devicePixelRatio;
    canvas2D.height = rect.height * window.devicePixelRatio;
    ctx2D.scale(window.devicePixelRatio, window.devicePixelRatio);

    const profileCanvas = document.getElementById('profileCanvas');
    if (profileCanvas) {
        const pRect = profileCanvas.parentElement.getBoundingClientRect();
        profileCanvas.width = pRect.width * window.devicePixelRatio;
        profileCanvas.height = pRect.height * window.devicePixelRatio;
        profileCanvas.getContext('2d').scale(window.devicePixelRatio, window.devicePixelRatio);
    }
}

function getHeatmapColor(val, maxVal) {
    if (val <= 0) return 'rgba(26, 36, 56, 0.4)';
    const norm = Math.min(1.0, val / Math.max(1, maxVal));
    
    let r, g, b;
    if (norm < 0.2) {
        const t = norm / 0.2;
        r = 0; g = Math.round(180 * t); b = 255;
    } else if (norm < 0.4) {
        const t = (norm - 0.2) / 0.2;
        r = 0; g = 255; b = Math.round(255 * (1 - t * 0.5));
    } else if (norm < 0.7) {
        const t = (norm - 0.4) / 0.3;
        r = Math.round(255 * t); g = 255; b = 0;
    } else {
        const t = (norm - 0.7) / 0.3;
        r = 255; g = Math.round(255 * (1 - t * 0.8)); b = 0;
    }
    return `rgba(${r}, ${g}, ${b}, 0.85)`;
}

function render2D() {
    const width = canvas2D.width / window.devicePixelRatio;
    const height = canvas2D.height / window.devicePixelRatio;
    ctx2D.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const scale = Math.min(width, height) / 9.2; // mm to pixels

    // 1. Cornea Limbus Ring (Outer Boundary ~8.4 mm)
    const limbusR = 4.2 * scale;
    ctx2D.save();
    
    const bgGrad = ctx2D.createRadialGradient(cx, cy, 0, cx, cy, limbusR);
    bgGrad.addColorStop(0, '#0a101d');
    bgGrad.addColorStop(0.7, '#070c16');
    bgGrad.addColorStop(1, '#04070c');
    ctx2D.fillStyle = bgGrad;
    ctx2D.beginPath();
    ctx2D.arc(cx, cy, limbusR, 0, Math.PI * 2);
    ctx2D.fill();

    ctx2D.strokeStyle = 'rgba(0, 242, 254, 0.25)';
    ctx2D.lineWidth = 1.5;
    ctx2D.stroke();

    // 2. Optical Zone Guideline Ring
    const ozR = (State.optical_zone / 2.0) * scale;
    ctx2D.strokeStyle = 'rgba(79, 172, 254, 0.4)';
    ctx2D.setLineDash([4, 4]);
    ctx2D.beginPath();
    ctx2D.arc(cx, cy, ozR, 0, Math.PI * 2);
    ctx2D.stroke();
    ctx2D.setLineDash([]);

    // 3. Astigmatism Meridian Line (if mode includes astigmatism)
    if (State.showAxes && (State.mode === 'astigmatism' || State.mode === 'compound')) {
        const theta = State.asti_degree * Math.PI / 180.0;
        
        ctx2D.strokeStyle = 'rgba(255, 51, 102, 0.6)';
        ctx2D.lineWidth = 1.5;
        ctx2D.beginPath();
        ctx2D.moveTo(cx - Math.cos(theta) * limbusR, cy + Math.sin(theta) * limbusR);
        ctx2D.lineTo(cx + Math.cos(theta) * limbusR, cy - Math.sin(theta) * limbusR);
        ctx2D.stroke();

        ctx2D.strokeStyle = 'rgba(0, 242, 254, 0.3)';
        ctx2D.setLineDash([3, 3]);
        ctx2D.beginPath();
        ctx2D.moveTo(cx - Math.cos(theta + Math.PI/2) * limbusR, cy + Math.sin(theta + Math.PI/2) * limbusR);
        ctx2D.lineTo(cx + Math.cos(theta + Math.PI/2) * limbusR, cy - Math.sin(theta + Math.PI/2) * limbusR);
        ctx2D.stroke();
        ctx2D.setLineDash([]);

        ctx2D.font = '11px "JetBrains Mono"';
        ctx2D.fillStyle = '#ff3366';
        ctx2D.fillText(`${State.asti_degree}°`, cx + Math.cos(theta) * (limbusR + 14) - 10, cy - Math.sin(theta) * (limbusR + 14) + 4);
    }

    // 4. Draw Points Cloud & Heatmap
    let maxShots = 1;
    for (let k = 0; k < State.num_of_points; k++) {
        if (State.total_shots_per_point[k] > maxShots) {
            maxShots = State.total_shots_per_point[k];
        }
    }

    if (State.showPoints) {
        for (let k = 0; k < State.num_of_points; k++) {
            const p = State.point_XY_pos[k];
            const px = cx + p.X * scale;
            const py = cy - p.Y * scale;
            const shots = State.total_shots_per_point[k];

            ctx2D.fillStyle = getHeatmapColor(shots, maxShots);
            ctx2D.beginPath();
            const ptR = shots > 0 ? 2.5 : 1.2;
            ctx2D.arc(px, py, ptR, 0, Math.PI * 2);
            ctx2D.fill();
        }
    }

    // 5. Draw Active Laser Chords / Beams
    if (State.showChords && State.currentChords) {
        const { PP10, PP11, PP20, PP21, c1, c2, radius } = State.currentChords;

        const c1x = cx + c1.X * scale;
        const c1y = cy - c1.Y * scale;
        const spotPixelR = radius * scale;

        if (State.mode === 'astigmatism' || State.mode === 'compound') {
            const spotGrad1 = ctx2D.createRadialGradient(c1x, c1y, 0, c1x, c1y, spotPixelR);
            spotGrad1.addColorStop(0, 'rgba(0, 242, 254, 0.45)');
            spotGrad1.addColorStop(0.8, 'rgba(0, 242, 254, 0.15)');
            spotGrad1.addColorStop(1, 'rgba(0, 242, 254, 0)');
            ctx2D.fillStyle = spotGrad1;
            ctx2D.beginPath();
            ctx2D.arc(c1x, c1y, spotPixelR, 0, Math.PI * 2);
            ctx2D.fill();

            ctx2D.strokeStyle = '#00f2fe';
            ctx2D.lineWidth = 2.5;
            ctx2D.beginPath();
            ctx2D.moveTo(cx + PP10.X * scale, cy - PP10.Y * scale);
            ctx2D.lineTo(cx + PP11.X * scale, cy - PP11.Y * scale);
            ctx2D.stroke();

            const c2x = cx + c2.X * scale;
            const c2y = cy - c2.Y * scale;
            const spotGrad2 = ctx2D.createRadialGradient(c2x, c2y, 0, c2x, c2y, spotPixelR);
            spotGrad2.addColorStop(0, 'rgba(255, 51, 102, 0.45)');
            spotGrad2.addColorStop(0.8, 'rgba(255, 51, 102, 0.15)');
            spotGrad2.addColorStop(1, 'rgba(255, 51, 102, 0)');
            ctx2D.fillStyle = spotGrad2;
            ctx2D.beginPath();
            ctx2D.arc(c2x, c2y, spotPixelR, 0, Math.PI * 2);
            ctx2D.fill();

            ctx2D.strokeStyle = '#ff3366';
            ctx2D.lineWidth = 2.5;
            ctx2D.beginPath();
            ctx2D.moveTo(cx + PP20.X * scale, cy - PP20.Y * scale);
            ctx2D.lineTo(cx + PP21.X * scale, cy - PP21.Y * scale);
            ctx2D.stroke();
        } else if (State.mode === 'hyperopia') {
            // Draw annular ring scan indication
            ctx2D.strokeStyle = 'rgba(241, 196, 15, 0.6)';
            ctx2D.lineWidth = 3;
            ctx2D.beginPath();
            ctx2D.arc(cx, cy, 2.4 * scale, 0, Math.PI * 2);
            ctx2D.stroke();
        } else if (State.mode === 'myopia') {
            // Draw central scanning spot
            ctx2D.strokeStyle = 'rgba(0, 242, 254, 0.6)';
            ctx2D.lineWidth = 2;
            ctx2D.beginPath();
            ctx2D.arc(cx, cy, (State.currentLayer + 1) * 0.4 * scale, 0, Math.PI * 2);
            ctx2D.stroke();
        } else if (State.mode === 'smile') {
            // Femtosecond Laser Cavitation Micro-bubble Spiral Scanner (1030nm)
            const bubbleR = (State.currentLayer + 1) * 0.45 * scale;
            ctx2D.strokeStyle = 'rgba(46, 213, 115, 0.85)';
            ctx2D.lineWidth = 2.5;
            ctx2D.beginPath();
            ctx2D.arc(cx, cy, bubbleR, 0, Math.PI * 2);
            ctx2D.stroke();

            // 2.0 mm Side Cut Arc at superior margin (110° to 140°)
            const sideCutR = (State.optical_zone / 2.0) * scale;
            ctx2D.strokeStyle = '#2ed573';
            ctx2D.lineWidth = 5;
            ctx2D.beginPath();
            ctx2D.arc(cx, cy, sideCutR, -Math.PI * 0.7, -Math.PI * 0.3);
            ctx2D.stroke();

            ctx2D.font = '10px "JetBrains Mono"';
            ctx2D.fillStyle = '#2ed573';
            ctx2D.fillText("2.0mm 微創小切口 (Side Cut)", cx - 70, cy - sideCutR - 10);

            if (State.smileExtracted) {
                ctx2D.font = '13px "Noto Sans TC", "Inter"';
                ctx2D.fillStyle = '#2ed573';
                ctx2D.fillText("✓ 微透鏡已取出 (Lenticule Extracted) · 角膜平整貼合", cx - 120, cy + limbusR + 24);
            }
        }
    }

    ctx2D.restore();
}

// ===================================================================
// 8. 3D Corneal Curvature Deformation (Three.js)
// ===================================================================
let threeScene, threeCamera, threeRenderer, threeControls, corneaMesh;
const GRID_RES = 64;

function init3D() {
    const container = document.getElementById('threeContainer');
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 500;

    threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x06090e);

    threeCamera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    threeCamera.position.set(0, -9, 11);

    threeRenderer = new THREE.WebGLRenderer({ antialias: true });
    threeRenderer.setSize(width, height);
    threeRenderer.setPixelRatio(window.devicePixelRatio);
    container.innerHTML = '';
    container.appendChild(threeRenderer.domElement);

    if (window.THREE && window.THREE.OrbitControls) {
        threeControls = new THREE.OrbitControls(threeCamera, threeRenderer.domElement);
        threeControls.enableDamping = true;
        threeControls.dampingFactor = 0.05;
        threeControls.maxPolarAngle = Math.PI / 2 + 0.1;
    }

    const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
    threeScene.add(ambLight);

    const dirLight1 = new THREE.DirectionalLight(0x00f2fe, 0.8);
    dirLight1.position.set(5, 10, 8);
    threeScene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xff3366, 0.5);
    dirLight2.position.set(-5, -10, 6);
    threeScene.add(dirLight2);

    buildCornea3DGeometry();

    function animate3D() {
        requestAnimationFrame(animate3D);
        if (threeControls) threeControls.update();
        threeRenderer.render(threeScene, threeCamera);
    }
    animate3D();
}

function buildCornea3DGeometry() {
    if (corneaMesh) {
        threeScene.remove(corneaMesh);
    }

    const geom = new THREE.PlaneGeometry(8.0, 8.0, GRID_RES, GRID_RES);
    const pos = geom.attributes.position;
    const colors = [];

    const R_cornea = 7.8;

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const r2 = x * x + y * y;

        let z = 0;
        if (r2 < R_cornea * R_cornea) {
            z = Math.sqrt(R_cornea * R_cornea - r2) - (R_cornea - 1.8);
        }
        pos.setZ(i, z);
        colors.push(0.1, 0.3, 0.6);
    }

    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshPhongMaterial({
        vertexColors: true,
        shininess: 90,
        wireframe: false,
        side: THREE.DoubleSide
    });

    corneaMesh = new THREE.Mesh(geom, mat);
    threeScene.add(corneaMesh);
}

function update3DCorneaDeformation() {
    if (!corneaMesh) return;
    const geom = corneaMesh.geometry;
    const pos = geom.attributes.position;
    const colorAttr = geom.attributes.color;
    const R_cornea = 7.8;

    let maxShots = 1;
    for (let k = 0; k < State.num_of_points; k++) {
        if (State.total_shots_per_point[k] > maxShots) maxShots = State.total_shots_per_point[k];
    }

    for (let idx = 0; idx < pos.count; idx++) {
        const x = pos.getX(idx);
        const y = pos.getY(idx);
        const r2 = x * x + y * y;

        let baseZ = 0;
        if (r2 < R_cornea * R_cornea) {
            baseZ = Math.sqrt(R_cornea * R_cornea - r2) - (R_cornea - 1.8);
        }

        let ablatedDepth = 0;
        let weightSum = 0;

        for (let k = 0; k < State.num_of_points; k += 12) {
            const p = State.point_XY_pos[k];
            const d2 = (x - p.X) * (x - p.X) + (y - p.Y) * (y - p.Y);
            if (d2 < 0.3) {
                const w = 1 / (d2 + 0.04);
                ablatedDepth += State.total_shots_per_point[k] * w;
                weightSum += w;
            }
        }

        const shotsVal = weightSum > 0 ? (ablatedDepth / weightSum) : 0;
        const depthMm = (shotsVal * State.depth_per_shot * 0.001) * 12.0;

        pos.setZ(idx, baseZ - depthMm);

        const norm = Math.min(1.0, shotsVal / Math.max(1, maxShots));
        if (norm > 0.05) {
            colorAttr.setXYZ(idx, 0.9 * norm, 1.0 - 0.7 * norm, 0.2 + 0.8 * (1 - norm));
        } else {
            colorAttr.setXYZ(idx, 0.05, 0.25, 0.5);
        }
    }

    pos.needsUpdate = true;
    colorAttr.needsUpdate = true;
    geom.computeVertexNormals();
}

// ===================================================================
// 9. Cross-Section Profile Graph
// ===================================================================
function renderProfile() {
    const canvas = document.getElementById('profileCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width / window.devicePixelRatio;
    const h = canvas.height / window.devicePixelRatio;

    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h * 0.45;
    const xRange = State.optical_zone / 2.0;

    // Coordinate axis
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, cy);
    ctx.lineTo(w - 40, cy);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 242, 254, 0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(40, cy);
    ctx.lineTo(w - 40, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    const steps = 120;
    const theta = State.asti_degree * Math.PI / 180.0;
    const profilePoints = [];

    let maxDepthUm = 0;
    for (let s = 0; s <= steps; s++) {
        const dist = -xRange + (2 * xRange * s) / steps;
        const x = dist * Math.cos(theta);
        const y = dist * Math.sin(theta);

        let totalShots = 0, count = 0;
        for (let k = 0; k < State.num_of_points; k++) {
            const p = State.point_XY_pos[k];
            const d2 = (x - p.X) * (x - p.X) + (y - p.Y) * (y - p.Y);
            if (d2 < 0.15) {
                totalShots += State.total_shots_per_point[k];
                count++;
            }
        }
        const avgShots = count > 0 ? totalShots / count : 0;
        const depthUm = avgShots * State.depth_per_shot;
        if (depthUm > maxDepthUm) maxDepthUm = depthUm;
        profilePoints.push({ dist, depthUm });
    }

    const xPixelScale = (w - 100) / (2 * xRange);
    const yPixelScale = 3.5;

    if (State.mode === 'smile') {
        const capOffset = 32;
        // Draw Cap Interface
        ctx.strokeStyle = 'rgba(0, 242, 254, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(40, cy + capOffset);
        ctx.lineTo(w - 40, cy + capOffset);
        ctx.stroke();

        // Draw Lenticule Area
        ctx.fillStyle = State.smileExtracted ? 'rgba(46, 213, 115, 0.08)' : 'rgba(46, 213, 115, 0.35)';
        ctx.strokeStyle = '#2ed573';
        ctx.lineWidth = 2.5;

        ctx.beginPath();
        ctx.moveTo(cx + profilePoints[0].dist * xPixelScale, cy + capOffset);
        for (let pt of profilePoints) {
            ctx.lineTo(cx + pt.dist * xPixelScale, cy + capOffset + pt.depthUm * yPixelScale);
        }
        ctx.lineTo(cx + profilePoints[profilePoints.length - 1].dist * xPixelScale, cy + capOffset);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.font = '11px "JetBrains Mono"';
        ctx.fillStyle = '#00f2fe';
        ctx.fillText("角膜帽 (Cap): 120 µm", 45, cy + capOffset - 6);
        ctx.fillStyle = '#2ed573';
        ctx.fillText(State.smileExtracted ? "✓ 基質微透鏡已抽出 · 視力矯正完成" : "SMILE 基質微透鏡 (Lenticule)", cx - 90, cy + capOffset + 50);
        ctx.fillText(`透鏡中心厚度: ${maxDepthUm.toFixed(1)} µm`, cx - 70, cy + capOffset + 70);
        return;
    }

    ctx.fillStyle = 'rgba(255, 51, 102, 0.18)';
    ctx.strokeStyle = '#ff3366';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.moveTo(cx + profilePoints[0].dist * xPixelScale, cy + profilePoints[0].depthUm * yPixelScale);
    for (let pt of profilePoints) {
        ctx.lineTo(cx + pt.dist * xPixelScale, cy + pt.depthUm * yPixelScale);
    }
    ctx.stroke();

    ctx.lineTo(cx + profilePoints[profilePoints.length - 1].dist * xPixelScale, cy);
    ctx.lineTo(cx + profilePoints[0].dist * xPixelScale, cy);
    ctx.closePath();
    ctx.fill();

    ctx.font = '12px "JetBrains Mono"';
    ctx.fillStyle = '#ff3366';
    ctx.fillText(`Max Ablation Depth: ${maxDepthUm.toFixed(1)} µm`, cx - 80, cy + 90);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`- ${xRange.toFixed(1)} mm`, 40, cy - 10);
    ctx.fillText(`+ ${xRange.toFixed(1)} mm`, w - 90, cy - 10);
}

function renderAll() {
    render2D();
    if (State.activeView === '3d') {
        update3DCorneaDeformation();
    } else if (State.activeView === 'profile') {
        renderProfile();
    }
}

// ===================================================================
// 10. Clinical Metrics & Safety Evaluation
// ===================================================================
function updateMetrics() {
    let totalShots = 0;
    let maxShotsOnSinglePoint = 0;

    for (let k = 0; k < State.num_of_points; k++) {
        const s = State.total_shots_per_point[k];
        totalShots += s;
        if (s > maxShotsOnSinglePoint) {
            maxShotsOnSinglePoint = s;
        }
    }

    const maxDepth = maxShotsOnSinglePoint * State.depth_per_shot;
    document.getElementById('metricTotalShots').innerText = totalShots.toLocaleString();
    document.getElementById('metricMaxDepth').innerText = `${maxDepth.toFixed(1)} µm`;

    const cornealThickness = 540;
    const flapThickness = 110;
    const rsb = cornealThickness - flapThickness - maxDepth;
    const rsbStatus = document.getElementById('rsbStatus');
    const rsbFill = document.getElementById('rsbFill');

    rsbStatus.innerText = `${rsb.toFixed(0)} µm (安全門檻 > 250µm)`;
    if (rsb >= 280) {
        rsbStatus.className = 'safety-status safe';
        rsbFill.style.background = 'linear-gradient(90deg, #2ecc71, #00f2fe)';
    } else {
        rsbStatus.className = 'safety-status warning';
        rsbFill.style.background = 'linear-gradient(90deg, #f1c40f, #e74c3c)';
    }
    rsbFill.style.width = `${Math.max(10, Math.min(100, (rsb / 500) * 100))}%`;

    const totalLayersAll = State.total_phase * State.layers[0];
    const layersDone = State.currentPhase * State.layers[0] + State.currentLayer;
    const progress = Math.min(100, Math.round((layersDone / totalLayersAll) * 100));

    document.getElementById('simProgressBar').style.width = `${progress}%`;
    document.getElementById('hudProgress').innerText = `${progress}%`;
    document.getElementById('hudPhase').innerText = `Phase ${Math.min(State.total_phase, State.currentPhase + 1)} / ${State.total_phase}`;
    document.getElementById('hudLayer').innerText = `Layer ${Math.min(State.layers[0], State.currentLayer + 1)} / ${State.layers[0]}`;

    document.getElementById('legendMid').innerText = `${(maxDepth / 2).toFixed(0)} µm`;
    document.getElementById('legendMax').innerText = `${maxDepth.toFixed(0)} µm`;
}

function highlightCodeLine(lineNum) {
    const lines = document.querySelectorAll('.code-line');
    lines.forEach(l => {
        if (parseInt(l.dataset.line) === lineNum) {
            l.classList.add('executing');
            l.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            l.classList.remove('executing');
        }
    });
}

// Switch between surgery modes
function setSurgeryMode(mode) {
    State.mode = mode;
    document.getElementById('badgeCurrentMode').innerText = mode.toUpperCase();

    // Toggle button active classes
    const modeCards = document.querySelectorAll('.mode-card');
    modeCards.forEach(c => {
        c.classList.toggle('active', c.dataset.mode === mode);
    });

    const grpSphere = document.getElementById('grpSphere');
    const grpPresbyAdd = document.getElementById('grpPresbyAdd');
    const grpAsti = document.getElementById('grpAstiDegree');
    const grpCyl = document.getElementById('grpCylinder');

    if (mode === 'astigmatism') {
        grpSphere.style.display = 'none';
        grpPresbyAdd.style.display = 'none';
        grpAsti.style.display = 'block';
        grpCyl.style.display = 'block';
    } else if (mode === 'myopia') {
        grpSphere.style.display = 'block';
        grpPresbyAdd.style.display = 'none';
        grpAsti.style.display = 'none';
        grpCyl.style.display = 'none';
        if (State.sphere >= 0) State.sphere = -4.0;
        document.getElementById('inputSphere').value = State.sphere;
        document.getElementById('valSphere').innerText = `${State.sphere.toFixed(2)} D`;
    } else if (mode === 'hyperopia') {
        grpSphere.style.display = 'block';
        grpPresbyAdd.style.display = 'none';
        grpAsti.style.display = 'none';
        grpCyl.style.display = 'none';
        if (State.sphere <= 0) State.sphere = 3.0;
        document.getElementById('inputSphere').value = State.sphere;
        document.getElementById('valSphere').innerText = `+${State.sphere.toFixed(2)} D`;
    } else if (mode === 'compound') {
        grpSphere.style.display = 'block';
        grpPresbyAdd.style.display = 'none';
        grpAsti.style.display = 'block';
        grpCyl.style.display = 'block';
        if (State.sphere >= 0) State.sphere = -4.0;
        document.getElementById('inputSphere').value = State.sphere;
        document.getElementById('valSphere').innerText = `${State.sphere.toFixed(2)} D`;
    } else if (mode === 'presbyopia') {
        grpSphere.style.display = 'block';
        grpPresbyAdd.style.display = 'block';
        grpAsti.style.display = 'none';
        grpCyl.style.display = 'none';
    } else if (mode === 'smile') {
        grpSphere.style.display = 'block';
        grpPresbyAdd.style.display = 'none';
        grpAsti.style.display = 'block';
        grpCyl.style.display = 'block';
        if (State.sphere >= 0) State.sphere = -5.5;
        document.getElementById('inputSphere').value = State.sphere;
        document.getElementById('valSphere').innerText = `${State.sphere.toFixed(2)} D`;
    }

    const btnExtract = document.getElementById('btnExtractLenticule');
    State.smileExtracted = false;
    if (btnExtract) {
        btnExtract.style.display = (mode === 'smile') ? 'inline-flex' : 'none';
        btnExtract.innerHTML = '<i class="fa-solid fa-scissors"></i> 取出微透鏡';
    }

    resetSimulation();
}

// ===================================================================
// 11. Event Listeners & UI Binding
// ===================================================================
function initEventListeners() {
    // Mode Buttons
    const modeCards = document.querySelectorAll('.mode-card');
    modeCards.forEach(mc => {
        mc.addEventListener('click', () => {
            setSurgeryMode(mc.dataset.mode);
        });
    });

    // Extract Lenticule Button for SMILE
    const btnExtract = document.getElementById('btnExtractLenticule');
    if (btnExtract) {
        btnExtract.addEventListener('click', () => {
            State.smileExtracted = !State.smileExtracted;
            if (State.smileExtracted) {
                btnExtract.innerHTML = '<i class="fa-solid fa-check"></i> 微透鏡已取出 (角膜平整)';
                playLaserSound(1100);
            } else {
                btnExtract.innerHTML = '<i class="fa-solid fa-scissors"></i> 取出微透鏡';
            }
            renderAll();
            updateMetrics();
        });
    }

    // Sphere Slider
    const inputSphere = document.getElementById('inputSphere');
    inputSphere.addEventListener('input', (e) => {
        State.sphere = parseFloat(e.target.value);
        const prefix = State.sphere > 0 ? '+' : '';
        document.getElementById('valSphere').innerText = `${prefix}${State.sphere.toFixed(2)} D`;
        resetSimulation();
    });

    // Presbyopia Add Slider
    const inputPresby = document.getElementById('inputPresbyAdd');
    inputPresby.addEventListener('input', (e) => {
        State.presbyAdd = parseFloat(e.target.value);
        document.getElementById('valPresbyAdd').innerText = `+${State.presbyAdd.toFixed(2)} D`;
        resetSimulation();
    });

    // Astigmatism Degree Slider
    const inputAsti = document.getElementById('inputAstiDegree');
    inputAsti.addEventListener('input', (e) => {
        State.asti_degree = parseFloat(e.target.value);
        document.getElementById('valAstiDegree').innerText = `${State.asti_degree}°`;
        resetSimulation();
    });

    // Cylinder Slider
    const inputCyl = document.getElementById('inputCylinder');
    inputCyl.addEventListener('input', (e) => {
        State.cylinder = parseFloat(e.target.value);
        document.getElementById('valCylinder').innerText = `-${State.cylinder.toFixed(2)} D`;
        document.getElementById('metricSE').innerText = `-${(State.cylinder / 2).toFixed(2)} D`;
        resetSimulation();
    });

    // Optical Zone Slider
    const inputOZ = document.getElementById('inputOpticalZone');
    inputOZ.addEventListener('input', (e) => {
        State.optical_zone = parseFloat(e.target.value);
        document.getElementById('valOpticalZone').innerText = `${State.optical_zone.toFixed(1)} mm`;
        resetSimulation();
    });

    // Phases & Layers
    const inputPhases = document.getElementById('inputPhases');
    inputPhases.addEventListener('input', (e) => {
        State.total_phase = parseInt(e.target.value);
        document.getElementById('valPhases').innerText = State.total_phase;
        resetSimulation();
    });

    const inputLayers = document.getElementById('inputLayersPerPhase');
    inputLayers.addEventListener('input', (e) => {
        document.getElementById('valLayers').innerText = e.target.value;
        resetSimulation();
    });

    const inputPoints = document.getElementById('inputPulseDensity');
    inputPoints.addEventListener('input', (e) => {
        State.num_of_points = parseInt(e.target.value);
        document.getElementById('valPoints').innerText = State.num_of_points;
        initCornealGrid();
        resetSimulation();
    });

    const inputSpeed = document.getElementById('inputSimSpeed');
    inputSpeed.addEventListener('input', (e) => {
        State.simSpeed = parseInt(e.target.value);
        document.getElementById('valSimSpeed').innerText = `${State.simSpeed * 50} Hz`;
    });

    document.getElementById('btnApplyParams').addEventListener('click', resetSimulation);

    // Playback Controls
    document.getElementById('btnPlayPause').addEventListener('click', () => {
        if (State.isPlaying) stopSimulation();
        else startSimulation();
    });

    document.getElementById('btnStep').addEventListener('click', () => {
        stopSimulation();
        stepSimulation();
    });

    document.getElementById('btnInstant').addEventListener('click', () => {
        executeAllInstantly();
    });

    document.getElementById('btnReset').addEventListener('click', resetSimulation);

    // Viewport Mode Tabs
    const viewTabs = [
        { id: 'tab2D', view: '2d', container: 'container2D' },
        { id: 'tab3D', view: '3d', container: 'container3D' },
        { id: 'tabCrossSection', view: 'profile', container: 'containerProfile' }
    ];

    viewTabs.forEach(vt => {
        document.getElementById(vt.id).addEventListener('click', () => {
            viewTabs.forEach(t => {
                document.getElementById(t.id).classList.remove('active');
                document.getElementById(t.container).classList.remove('active');
            });
            document.getElementById(vt.id).classList.add('active');
            document.getElementById(vt.container).classList.add('active');
            State.activeView = vt.view;
            renderAll();
        });
    });

    // Toggles
    document.getElementById('chkShowAxes').addEventListener('change', (e) => {
        State.showAxes = e.target.checked;
        render2D();
    });
    document.getElementById('chkShowChords').addEventListener('change', (e) => {
        State.showChords = e.target.checked;
        render2D();
    });
    document.getElementById('chkShowPoints').addEventListener('change', (e) => {
        State.showPoints = e.target.checked;
        render2D();
    });

    // Sound toggle
    const btnSound = document.getElementById('btnSoundToggle');
    btnSound.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        btnSound.classList.toggle('muted', !soundEnabled);
        btnSound.innerHTML = soundEnabled ? '<i class="fa-solid fa-volume-high"></i> 音效' : '<i class="fa-solid fa-volume-xmark"></i> 靜音';
    });

    // Presets
    const presets = document.querySelectorAll('.preset-btn');
    presets.forEach(p => {
        p.addEventListener('click', () => {
            presets.forEach(btn => btn.classList.remove('active'));
            p.classList.add('active');

            const mode = p.dataset.mode;
            if (p.dataset.degree) {
                State.asti_degree = parseFloat(p.dataset.degree);
                document.getElementById('inputAstiDegree').value = State.asti_degree;
                document.getElementById('valAstiDegree').innerText = `${State.asti_degree}°`;
            }
            if (p.dataset.power) {
                State.cylinder = parseFloat(p.dataset.power);
                document.getElementById('inputCylinder').value = State.cylinder;
                document.getElementById('valCylinder').innerText = `-${State.cylinder.toFixed(2)} D`;
            }
            if (p.dataset.myopia) {
                State.sphere = -parseFloat(p.dataset.myopia);
                document.getElementById('inputSphere').value = State.sphere;
                document.getElementById('valSphere').innerText = `${State.sphere.toFixed(2)} D`;
            }
            if (p.dataset.hyperopia) {
                State.sphere = parseFloat(p.dataset.hyperopia);
                document.getElementById('inputSphere').value = State.sphere;
                document.getElementById('valSphere').innerText = `+${State.sphere.toFixed(2)} D`;
            }
            if (p.dataset.add) {
                State.presbyAdd = parseFloat(p.dataset.add);
                document.getElementById('inputPresbyAdd').value = State.presbyAdd;
                document.getElementById('valPresbyAdd').innerText = `+${State.presbyAdd.toFixed(2)} D`;
            }

            setSurgeryMode(mode);
        });
    });

    window.addEventListener('resize', () => {
        resizeCanvases();
        renderAll();
    });
}

// ===================================================================
// 12. Bootstrapper
// ===================================================================
window.addEventListener('DOMContentLoaded', () => {
    initCornealGrid();
    generateAblationTables();
    resizeCanvases();
    init3D();
    initEventListeners();
    setSurgeryMode('astigmatism');
    renderAll();
    updateMetrics();
});

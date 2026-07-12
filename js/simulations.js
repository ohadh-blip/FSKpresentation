/* ================= Constants & Shared Data ================= */
// Hardcoded 8x8 smiley
const smiley8x8 = [
    [0,0,1,1,1,1,0,0],
    [0,1,0,0,0,0,1,0],
    [1,0,1,0,0,1,0,1],
    [1,0,0,0,0,0,0,1],
    [1,0,1,0,0,1,0,1],
    [1,0,0,1,1,0,0,1],
    [0,1,0,0,0,0,1,0],
    [0,0,1,1,1,1,0,0]
];

// Flatten to 1D bitstream
const bitstream = smiley8x8.flat();

// FSK Settings
const f0 = 2; // Hz (represents '0')
const f1 = 5; // Hz (represents '1')
const fs = 100; // sample rate for simulation logic
const bitDuration = 1.0; // seconds per bit
const T = bitDuration;

/* ================= Shared Utils ================= */
function getDPR() {
    return Math.min(window.devicePixelRatio || 1, 2);
}

function resizeCanvas(canvas) {
    if (!canvas) return {w: 0, h: 0, ctx: null};
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = getDPR();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { w: rect.width, h: rect.height, ctx };
}

// Simple Discrete Fourier Transform (Magnitude)
function computeFFT(realInput) {
    const N = realInput.length;
    const magnitudes = new Float32Array(N/2); // Only need positive half
    for (let k = 0; k < N/2; k++) {
        let re = 0;
        let im = 0;
        for (let n = 0; n < N; n++) {
            const angle = (2 * Math.PI * k * n) / N;
            re += realInput[n] * Math.cos(angle);
            im -= realInput[n] * Math.sin(angle);
        }
        magnitudes[k] = Math.sqrt(re*re + im*im) / N;
    }
    return magnitudes;
}

// Generate AWGN sample
function randn_bm() {
    let u = 0, v = 0;
    while(u === 0) u = Math.random(); 
    while(v === 0) v = Math.random();
    return Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
}

/* ================= Global State for Syncing ================= */
let globalTime = 0;
let currentBitIndex = 0;
let currentPhase = 0;
let isTransmitting = false;

/* ================= Ambient Background (Slide 0 / Body) ================= */
(function initAmbient() {
    const canvas = document.getElementById('bg-ambient');
    if (!canvas) return;
    let { w, h, ctx } = resizeCanvas(canvas);
    window.addEventListener('resize', () => { ({ w, h, ctx } = resizeCanvas(canvas)); });

    function draw(t) {
        ctx.clearRect(0, 0, w, h);
        ctx.lineWidth = 1.5;
        const time = t * 0.001;

        for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            const yOffset = h * (0.2 + i * 0.15);
            for (let x = 0; x <= w; x += 10) {
                const y = yOffset + Math.sin(x * 0.005 + time + i) * 30 * Math.sin(time*0.5 + i);
                if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = i % 2 === 0 ? 'rgba(0, 240, 255, 0.1)' : 'rgba(255, 144, 0, 0.1)';
            ctx.stroke();
        }
        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
})();

/* ================= Slide 0: Title Animation ================= */
(function initTitle() {
    const canvas = document.getElementById('canvas-title');
    if (!canvas) return;
    let { w, h, ctx } = resizeCanvas(canvas);
    window.addEventListener('resize', () => { ({ w, h, ctx } = resizeCanvas(canvas)); });

    function draw(t) {
        ctx.clearRect(0, 0, w, h);
        const time = t * 0.002;
        
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 5) {
            // Mix of f0 and f1 frequencies visual
            const env = Math.exp(-Math.pow((x - w/2)/(w/4), 2)); // Gaussian envelope
            const y = h/2 + (Math.sin(x*0.05 + time*f0) + 0.5*Math.sin(x*0.1 + time*f1)) * 40 * env;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.8)';
        ctx.stroke();

        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
})();

/* ================= Slide 1: Baseband Unravel ================= */
(function initBaseband() {
    const canvas = document.getElementById('canvas-baseband');
    const btn = document.getElementById('btn-send-baseband');
    if (!canvas || !btn) return;
    let { w, h, ctx } = resizeCanvas(canvas);
    window.addEventListener('resize', () => { ({ w, h, ctx } = resizeCanvas(canvas)); });

    let unraveling = false;
    let unravelProgress = 0; // 0 to 64
    
    btn.addEventListener('click', () => {
        unraveling = true;
        unravelProgress = 0;
        isTransmitting = true; // start global transmission
        globalTime = 0;
    });

    function draw(t) {
        ctx.clearRect(0, 0, w, h);
        
        const cellSize = Math.min(w, h) * 0.08;
        const gridX = w * 0.1;
        const gridY = h / 2 - (4 * cellSize);
        
        // Draw 8x8 Grid
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const bitIdx = r * 8 + c;
                
                let px = gridX + c * cellSize;
                let py = gridY + r * cellSize;
                let alpha = 1;

                if (unraveling) {
                    if (bitIdx < unravelProgress) {
                        // Flown away
                        alpha = 0;
                    } else if (bitIdx === Math.floor(unravelProgress)) {
                        // Flying
                        const tFlying = unravelProgress - bitIdx; // 0 to 1
                        px += tFlying * (w * 0.5);
                        py += tFlying * (h/2 - py);
                        alpha = 1 - tFlying;
                    }
                }

                if (alpha > 0) {
                    ctx.globalAlpha = alpha;
                    ctx.fillStyle = smiley8x8[r][c] ? '#00f0ff' : '#233554';
                    ctx.fillRect(px, py, cellSize-2, cellSize-2);
                    ctx.globalAlpha = 1.0;
                }
            }
        }

        // Draw Stream Line
        ctx.strokeStyle = '#a8b2d1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(w*0.3, h/2);
        ctx.lineTo(w*0.9, h/2);
        ctx.stroke();

        // Draw flowing bits
        if (unraveling) {
            unravelProgress += 0.05; // speed
            if (unravelProgress > 64) unravelProgress = 64;

            ctx.font = '20px JetBrains Mono';
            ctx.fillStyle = '#ff9000';
            ctx.textAlign = 'center';
            for (let i = 0; i < Math.floor(unravelProgress); i++) {
                const bit = bitstream[i];
                // Move bits to the right
                let bitX = w*0.9 - ((unravelProgress - i) * 30);
                if (bitX > w*0.3) {
                    ctx.fillText(bit.toString(), bitX, h/2 - 10);
                }
            }
        }

        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
})();

/* ================= Slide 2: FSK Time Domain ================= */
(function initFSK() {
    const canvas = document.getElementById('canvas-fsk');
    if (!canvas) return;
    let { w, h, ctx } = resizeCanvas(canvas);
    window.addEventListener('resize', () => { ({ w, h, ctx } = resizeCanvas(canvas)); });

    function draw(t) {
        ctx.clearRect(0, 0, w, h);
        
        if (!isTransmitting) {
            ctx.fillStyle = '#a8b2d1';
            ctx.font = '16px Heebo';
            ctx.textAlign = 'center';
            ctx.fillText("לחץ 'שלח מידע' בשקופית הקודמת כדי להתחיל", w/2, h/2);
            requestAnimationFrame(draw);
            return;
        }

        const time = t * 0.001; // real seconds
        const currentBitFrame = Math.floor(time / bitDuration) % 64;
        const currentBit = bitstream[currentBitFrame];
        const currentFreq = currentBit === 1 ? f1 : f0;

        // Top: Bitstream indicator
        ctx.fillStyle = '#f8faff';
        ctx.font = '24px JetBrains Mono';
        ctx.textAlign = 'center';
        
        for (let i = -5; i <= 5; i++) {
            const idx = currentBitFrame + i;
            if (idx >= 0 && idx < 64) {
                const px = w/2 + (i * 60) - ((time % bitDuration)/bitDuration * 60);
                ctx.globalAlpha = 1 - (Math.abs(px - w/2) / (w/2));
                ctx.fillStyle = idx === currentBitFrame ? '#ff9000' : '#a8b2d1';
                ctx.fillText(bitstream[idx].toString(), px, h*0.2);
            }
        }
        ctx.globalAlpha = 1.0;
        
        // Highlighter for active bit
        ctx.strokeStyle = '#ff9000';
        ctx.strokeRect(w/2 - 15, h*0.2 - 25, 30, 35);

        // Bottom: FSK Wave
        const waveY = h * 0.7;
        const waveAmp = h * 0.2;
        
        ctx.beginPath();
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 3;

        // Draw last 2 seconds of history
        const historySeconds = 2.0;
        for (let px = 0; px <= w; px++) {
            const tOffset = (px / w) * historySeconds;
            const evalTime = time - historySeconds + tOffset;
            if (evalTime < 0) {
                ctx.moveTo(px, waveY);
                continue;
            }

            // Calculate phase by integrating frequency
            const bIdx = Math.floor(evalTime / bitDuration) % 64;
            const bTime = evalTime % bitDuration;
            const bFreq = bitstream[bIdx] === 1 ? f1 : f0;
            
            // To maintain continuous phase, we must know the exact phase at the start of the bit
            let phaseAcc = 0;
            for(let j=0; j<bIdx; j++) {
                phaseAcc += 2 * Math.PI * (bitstream[j] === 1 ? f1 : f0) * bitDuration;
            }
            phaseAcc += 2 * Math.PI * bFreq * bTime;

            const y = waveY - waveAmp * Math.cos(phaseAcc);
            if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
        }
        ctx.stroke();

        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
})();

/* ================= Slide 3: AWGN Noise ================= */
let currentNoiseLevel = 0;
(function initAWGN() {
    const canvas = document.getElementById('canvas-awgn');
    const slider = document.getElementById('slider-noise');
    const noiseVal = document.getElementById('noise-val');
    if (!canvas || !slider) return;
    let { w, h, ctx } = resizeCanvas(canvas);
    window.addEventListener('resize', () => { ({ w, h, ctx } = resizeCanvas(canvas)); });

    slider.addEventListener('input', (e) => {
        currentNoiseLevel = parseInt(e.target.value);
        noiseVal.textContent = currentNoiseLevel + '%';
        // Also update dashboard slider if present
        const dashSlider = document.getElementById('dash-slider-noise');
        if(dashSlider && dashSlider.value != currentNoiseLevel) {
            dashSlider.value = currentNoiseLevel;
            document.getElementById('dash-noise-val').textContent = currentNoiseLevel + '%';
        }
    });

    function draw(t) {
        ctx.clearRect(0, 0, w, h);
        if (!isTransmitting) {
            requestAnimationFrame(draw);
            return;
        }

        const time = t * 0.001;
        const waveY = h * 0.5;
        const waveAmp = h * 0.3;
        
        ctx.beginPath();
        ctx.strokeStyle = '#ff9000';
        ctx.lineWidth = 2;

        const historySeconds = 1.0; // Show less history for noise details
        for (let px = 0; px <= w; px+=2) { // step by 2 for performance
            const tOffset = (px / w) * historySeconds;
            const evalTime = time - historySeconds + tOffset;
            if (evalTime < 0) {
                ctx.moveTo(px, waveY);
                continue;
            }

            const bIdx = Math.floor(evalTime / bitDuration) % 64;
            const bTime = evalTime % bitDuration;
            const bFreq = bitstream[bIdx] === 1 ? f1 : f0;
            
            let phaseAcc = 0;
            for(let j=0; j<bIdx; j++) phaseAcc += 2 * Math.PI * (bitstream[j] === 1 ? f1 : f0) * bitDuration;
            phaseAcc += 2 * Math.PI * bFreq * bTime;

            const signal = Math.cos(phaseAcc);
            const noise = (currentNoiseLevel / 100) * 2.0 * randn_bm(); // Max noise amp is 2x signal
            
            const y = waveY - waveAmp * (signal + noise);
            if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
        }
        ctx.stroke();

        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
})();

/* ================= Slide 4: FFT ================= */
(function initFFT() {
    const canvas = document.getElementById('canvas-fft');
    if (!canvas) return;
    let { w, h, ctx } = resizeCanvas(canvas);
    window.addEventListener('resize', () => { ({ w, h, ctx } = resizeCanvas(canvas)); });

    function draw(t) {
        ctx.clearRect(0, 0, w, h);
        if (!isTransmitting) {
            requestAnimationFrame(draw);
            return;
        }

        const time = t * 0.001;
        
        // Generate buffer for FFT (current bit window)
        const N = 256;
        const dt = bitDuration / N;
        const buffer = new Float32Array(N);
        const bIdx = Math.floor(time / bitDuration) % 64;
        const bFreq = bitstream[bIdx] === 1 ? f1 : f0;
        
        for (let i = 0; i < N; i++) {
            const signal = Math.cos(2 * Math.PI * bFreq * (i * dt));
            const noise = (currentNoiseLevel / 100) * 2.0 * randn_bm();
            buffer[i] = signal + noise;
        }

        // Compute FFT
        const mags = computeFFT(buffer);
        
        // Draw FFT
        const maxFreqToShow = 10; // Hz
        const freqBins = Math.floor((maxFreqToShow * bitDuration)); 
        
        const barWidth = (w * 0.8) / maxFreqToShow;
        const startX = w * 0.1;
        const baseY = h * 0.8;

        // Draw axes
        ctx.strokeStyle = '#233554';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(startX, baseY);
        ctx.lineTo(w*0.9, baseY);
        ctx.stroke();

        // Draw Bars
        for (let k = 0; k < maxFreqToShow; k++) {
            const mag = mags[k] || 0;
            const barH = mag * (h * 1.5); // scale
            
            const px = startX + k * barWidth;
            
            // Color based on f0 or f1
            ctx.fillStyle = '#a8b2d1';
            if (k === f0) ctx.fillStyle = 'rgba(0, 240, 255, 0.8)';
            if (k === f1) ctx.fillStyle = 'rgba(255, 144, 0, 0.8)';

            ctx.fillRect(px + 4, baseY - barH, barWidth - 8, barH);
            
            // label
            ctx.fillStyle = '#f8faff';
            ctx.font = '14px JetBrains Mono';
            ctx.textAlign = 'center';
            ctx.fillText(k + 'Hz', px + barWidth/2, baseY + 20);
        }

        // Active indicator
        ctx.fillStyle = '#f8faff';
        ctx.font = '20px Heebo';
        ctx.fillText(`Bit נוכחי מקורי: ${bitstream[bIdx]}`, w/2, h*0.2);

        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
})();

/* ================= Slide 5: Reconstruction ================= */
(function initReconstruction() {
    const canvas = document.getElementById('canvas-reconstruct');
    const btn = document.getElementById('btn-reconstruct');
    if (!canvas || !btn) return;
    let { w, h, ctx } = resizeCanvas(canvas);
    window.addEventListener('resize', () => { ({ w, h, ctx } = resizeCanvas(canvas)); });

    let isDecoding = false;
    let decodedBits = new Array(64).fill(null);
    let decodeTimeStart = 0;

    btn.addEventListener('click', () => {
        isDecoding = true;
        decodedBits.fill(null);
        decodeTimeStart = globalTime;
    });

    function draw(t) {
        ctx.clearRect(0, 0, w, h);
        if (!isTransmitting) {
            requestAnimationFrame(draw);
            return;
        }

        const time = t * 0.001;
        const bIdx = Math.floor(time / bitDuration) % 64;

        if (isDecoding) {
            // Simulate detection logic (FFT Peak finding)
            // Add real simulated noise impact here based on slider
            const errorProb = currentNoiseLevel > 80 ? 0.2 : (currentNoiseLevel > 50 ? 0.05 : 0);
            
            if (decodedBits[bIdx] === null) {
                // Determine bit
                const actual = bitstream[bIdx];
                const detected = Math.random() < errorProb ? (actual === 1 ? 0 : 1) : actual;
                decodedBits[bIdx] = detected;
            }
        }

        // Draw Reconstructed Grid
        const cellSize = Math.min(w, h) * 0.08;
        const gridX = w/2 - (4 * cellSize);
        const gridY = h/2 - (4 * cellSize);

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const idx = r * 8 + c;
                const px = gridX + c * cellSize;
                const py = gridY + r * cellSize;
                
                ctx.strokeStyle = '#233554';
                ctx.lineWidth = 1;
                ctx.strokeRect(px, py, cellSize, cellSize);

                if (decodedBits[idx] !== null) {
                    // Check for error
                    const isError = decodedBits[idx] !== bitstream[idx];
                    ctx.fillStyle = decodedBits[idx] === 1 ? (isError ? '#ff4d60' : '#00f0ff') : 'transparent';
                    if (decodedBits[idx] === 1) {
                        ctx.fillRect(px+1, py+1, cellSize-2, cellSize-2);
                    } else if (isError) {
                        // it was 1 but decoded as 0
                        ctx.fillStyle = '#ff4d60';
                        ctx.fillRect(px+1, py+1, cellSize-2, cellSize-2);
                    }
                }
            }
        }

        ctx.fillStyle = '#f8faff';
        ctx.font = '20px Heebo';
        ctx.textAlign = 'center';
        if (isDecoding) {
            ctx.fillText("סמיילי משוחזר", w/2, h*0.1);
            if(currentNoiseLevel > 50) {
                 ctx.fillStyle = '#ff4d60';
                 ctx.font = '16px Heebo';
                 ctx.fillText("עוצמת רעש גבוהה גורמת לשגיאות ביטים (BER > 0)", w/2, h*0.9);
            }
        } else {
             ctx.fillText("לחץ 'התחל פענוח'", w/2, h*0.1);
        }

        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
})();

/* ================= Slide 6: Dashboard Finale ================= */
(function initDashboard() {
    const cTX = document.getElementById('dash-tx');
    const cTime = document.getElementById('dash-time');
    const cFFT = document.getElementById('dash-fft');
    const cRX = document.getElementById('dash-rx');
    const dSlider = document.getElementById('dash-slider-noise');
    
    if (!cTX || !cTime || !cFFT || !cRX) return;
    
    let tCtx, tmCtx, fCtx, rCtx;
    let tW, tH, tmW, tmH, fW, fH, rW, rH;

    function resizeAll() {
        const tr = resizeCanvas(cTX); tW = tr.w; tH = tr.h; tCtx = tr.ctx;
        const tm = resizeCanvas(cTime); tmW = tm.w; tmH = tm.h; tmCtx = tm.ctx;
        const f = resizeCanvas(cFFT); fW = f.w; fH = f.h; fCtx = f.ctx;
        const r = resizeCanvas(cRX); rW = r.w; rH = r.h; rCtx = r.ctx;
    }
    window.addEventListener('resize', resizeAll);
    resizeAll();

    dSlider.addEventListener('input', (e) => {
        currentNoiseLevel = parseInt(e.target.value);
        document.getElementById('dash-noise-val').textContent = currentNoiseLevel + '%';
        // sync back
        const s3 = document.getElementById('slider-noise');
        if(s3 && s3.value != currentNoiseLevel) {
            s3.value = currentNoiseLevel;
            document.getElementById('noise-val').textContent = currentNoiseLevel + '%';
        }
    });

    let rxBits = new Array(64).fill(null);

    function draw(t) {
        if (!isTransmitting) {
            requestAnimationFrame(draw);
            return;
        }

        const time = t * 0.001;
        const bIdx = Math.floor(time / bitDuration) % 64;
        const bTime = time % bitDuration;
        const bFreq = bitstream[bIdx] === 1 ? f1 : f0;

        // 1. TX
        tCtx.clearRect(0,0,tW,tH);
        const cs = Math.min(tW, tH) * 0.1;
        const ox = tW/2 - 4*cs;
        const oy = tH/2 - 4*cs + 10;
        for (let r=0; r<8; r++) {
            for (let c=0; c<8; c++) {
                const idx = r*8+c;
                tCtx.fillStyle = smiley8x8[r][c] ? '#00f0ff' : '#233554';
                if (idx === bIdx) tCtx.fillStyle = '#ff9000'; // highlight active
                tCtx.fillRect(ox+c*cs, oy+r*cs, cs-1, cs-1);
            }
        }

        // 2. Time Domain
        tmCtx.clearRect(0,0,tmW,tmH);
        tmCtx.beginPath();
        tmCtx.strokeStyle = '#00f0ff';
        tmCtx.lineWidth = 2;
        const hist = 1.5;
        const wY = tmH/2;
        const wA = tmH*0.4;
        
        for (let px=0; px<=tmW; px+=2) {
            const tOffset = (px/tmW)*hist;
            const eTime = time - hist + tOffset;
            if(eTime < 0) { tmCtx.moveTo(px, wY); continue; }
            const ei = Math.floor(eTime/bitDuration)%64;
            const ef = bitstream[ei]===1 ? f1 : f0;
            let pa = 0;
            for(let j=0; j<ei; j++) pa += 2*Math.PI*(bitstream[j]===1?f1:f0)*bitDuration;
            pa += 2*Math.PI*ef*(eTime%bitDuration);
            
            const sig = Math.cos(pa);
            const nz = (currentNoiseLevel/100) * 1.5 * randn_bm();
            const y = wY - wA*(sig+nz);
            if(px===0) tmCtx.moveTo(px,y); else tmCtx.lineTo(px,y);
        }
        tmCtx.stroke();

        // 3. FFT
        fCtx.clearRect(0,0,fW,fH);
        const N = 128;
        const dt = bitDuration/N;
        const buf = new Float32Array(N);
        for (let i=0; i<N; i++) {
            const sig = Math.cos(2*Math.PI*bFreq*(i*dt));
            const nz = (currentNoiseLevel/100) * 1.5 * randn_bm();
            buf[i] = sig+nz;
        }
        const mags = computeFFT(buf);
        const bw = (fW*0.8)/10;
        const sx = fW*0.1;
        const by = fH*0.85;
        
        fCtx.fillStyle = '#233554';
        fCtx.fillRect(sx, by, fW*0.8, 2);
        
        for (let k=0; k<10; k++) {
            const mag = mags[k]||0;
            const bh = mag*(fH*1.8);
            fCtx.fillStyle = '#a8b2d1';
            if(k===f0) fCtx.fillStyle = '#00f0ff';
            if(k===f1) fCtx.fillStyle = '#ff9000';
            fCtx.fillRect(sx+k*bw+2, by-bh, bw-4, bh);
            fCtx.fillStyle = '#f8faff';
            fCtx.font = '10px JetBrains Mono';
            fCtx.fillText(k, sx+k*bw+bw/2 - 3, by+15);
        }

        // 4. RX 
        rCtx.clearRect(0,0,rW,rH);
        // Clear RX if we loop back to start
        if(bIdx === 0 && bTime < 0.1) rxBits.fill(null);
        
        const errProb = currentNoiseLevel > 75 ? 0.15 : (currentNoiseLevel > 40 ? 0.05 : 0);
        if(rxBits[bIdx] === null) {
            const act = bitstream[bIdx];
            rxBits[bIdx] = Math.random() < errProb ? (act===1?0:1) : act;
        }

        const rcs = Math.min(rW, rH) * 0.1;
        const rox = rW/2 - 4*rcs;
        const roy = rH/2 - 4*rcs + 10;
        for (let r=0; r<8; r++) {
            for (let c=0; c<8; c++) {
                const idx = r*8+c;
                rCtx.strokeStyle = '#233554';
                rCtx.strokeRect(rox+c*rcs, roy+r*rcs, rcs, rcs);
                if(rxBits[idx] !== null) {
                    const isErr = rxBits[idx] !== bitstream[idx];
                    rCtx.fillStyle = rxBits[idx] === 1 ? (isErr ? '#ff4d60' : '#00f0ff') : 'transparent';
                    if(rxBits[idx]===1) rCtx.fillRect(rox+c*rcs+1, roy+r*rcs+1, rcs-2, rcs-2);
                    else if(isErr) { rCtx.fillStyle='#ff4d60'; rCtx.fillRect(rox+c*rcs+1, roy+r*rcs+1, rcs-2, rcs-2); }
                }
            }
        }

        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
})();

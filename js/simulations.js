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

const bitstream = smiley8x8.flat();
const f0 = 2; // Hz (represents '0')
const f1 = 5; // Hz (represents '1')
const fs = 100; // sample rate for simulation logic
const bitDuration = 1.0; // seconds per bit
const T = bitDuration;

/* ================= Shared Utils ================= */
function getDPR() { return Math.min(window.devicePixelRatio || 1, 2); }

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

// Pre-allocated array for FFT calculations to prevent memory leaks in the loop
const MAX_FFT_N = 256;
const fftMagnitudes = new Float32Array(MAX_FFT_N/2);

function computeFFT(realInput) {
    const N = realInput.length;
    for (let k = 0; k < N/2; k++) {
        let re = 0;
        let im = 0;
        for (let n = 0; n < N; n++) {
            const angle = (2 * Math.PI * k * n) / N;
            re += realInput[n] * Math.cos(angle);
            im -= realInput[n] * Math.sin(angle);
        }
        fftMagnitudes[k] = Math.sqrt(re*re + im*im) / N;
    }
    return fftMagnitudes;
}

function randn_bm() {
    let u = 0, v = 0;
    while(u === 0) u = Math.random(); 
    while(v === 0) v = Math.random();
    return Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
}

// Global Observer to pause animations when canvas is out of view
function createVisibilityObserver(canvas, onVisible, onHidden) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) onVisible();
            else onHidden();
        });
    }, { threshold: 0.1 });
    observer.observe(canvas);
    return observer;
}

/* ================= Global State for Syncing ================= */
let globalTime = 0;
let isTransmitting = false;

/* ================= Slide 0: Ambient Background ================= */
(function initAmbient() {
    const canvas = document.getElementById('bg-ambient');
    if (!canvas) return;
    let { w, h, ctx } = resizeCanvas(canvas);
    window.addEventListener('resize', () => { ({ w, h, ctx } = resizeCanvas(canvas)); });

    let animId = null;
    let isVisible = false;

    function draw(t) {
        if (!isVisible) return;
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
            ctx.strokeStyle = i % 2 === 0 ? 'rgba(255, 194, 89, 0.1)' : 'rgba(255, 194, 89, 0.1)';
            ctx.stroke();
        }
        animId = requestAnimationFrame(draw);
    }

    createVisibilityObserver(canvas, 
        () => { isVisible = true; if(!animId) animId = requestAnimationFrame(draw); },
        () => { isVisible = false; if(animId) { cancelAnimationFrame(animId); animId = null; } }
    );
})();

/* ================= Slide 0: Title Animation ================= */
(function initTitle() {
    const canvas = document.getElementById('canvas-title');
    if (!canvas) return;
    let { w, h, ctx } = resizeCanvas(canvas);
    window.addEventListener('resize', () => { ({ w, h, ctx } = resizeCanvas(canvas)); });

    let animId = null;
    let isVisible = false;

    function draw(t) {
        if (!isVisible) return;
        ctx.clearRect(0, 0, w, h);
        const time = t * 0.002;
        
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 5) {
            const env = Math.exp(-Math.pow((x - w/2)/(w/4), 2));
            const y = h/2 + (Math.sin(x*0.05 + time*f0) + 0.5*Math.sin(x*0.1 + time*f1)) * 40 * env;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(255, 194, 89, 0.8)';
        ctx.stroke();
        animId = requestAnimationFrame(draw);
    }

    createVisibilityObserver(canvas, 
        () => { isVisible = true; if(!animId) animId = requestAnimationFrame(draw); },
        () => { isVisible = false; if(animId) { cancelAnimationFrame(animId); animId = null; } }
    );
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
    let animId = null;
    let isVisible = false;
    
    btn.addEventListener('click', () => {
        unraveling = true;
        unravelProgress = 0;
        isTransmitting = true; 
        globalTime = 0;
    });

    function draw(t) {
        if (!isVisible) return;
        ctx.clearRect(0, 0, w, h);
        
        const cellSize = Math.min(w, h) * 0.08;
        const gridX = w * 0.1;
        const gridY = h / 2 - (4 * cellSize);
        
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const bitIdx = r * 8 + c;
                let px = gridX + c * cellSize;
                let py = gridY + r * cellSize;
                let alpha = 1;

                if (unraveling) {
                    if (bitIdx < unravelProgress) {
                        alpha = 0;
                    } else if (bitIdx === Math.floor(unravelProgress)) {
                        const tFlying = unravelProgress - bitIdx;
                        px += tFlying * (w * 0.5);
                        py += tFlying * (h/2 - py);
                        alpha = 1 - tFlying;
                    }
                }

                if (alpha > 0) {
                    ctx.globalAlpha = alpha;
                    ctx.fillStyle = smiley8x8[r][c] ? '#ffc259' : '#233554';
                    ctx.fillRect(px, py, cellSize-2, cellSize-2);
                    ctx.globalAlpha = 1.0;
                }
            }
        }

        ctx.strokeStyle = '#a8b2d1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(w*0.3, h/2);
        ctx.lineTo(w*0.9, h/2);
        ctx.stroke();

        if (unraveling) {
            unravelProgress += 0.05;
            if (unravelProgress > 64) unravelProgress = 64;

            ctx.font = '20px JetBrains Mono';
            ctx.fillStyle = '#ffc259';
            ctx.textAlign = 'center';
            for (let i = 0; i < Math.floor(unravelProgress); i++) {
                const bit = bitstream[i];
                let bitX = w*0.9 - ((unravelProgress - i) * 30);
                if (bitX > w*0.3) {
                    ctx.fillText(bit.toString(), bitX, h/2 - 10);
                }
            }
        }
        animId = requestAnimationFrame(draw);
    }

    createVisibilityObserver(canvas, 
        () => { isVisible = true; if(!animId) animId = requestAnimationFrame(draw); },
        () => { isVisible = false; if(animId) { cancelAnimationFrame(animId); animId = null; } }
    );
})();

/* ================= Slide 2: FSK Time Domain ================= */
(function initFSK() {
    const canvas = document.getElementById('canvas-fsk');
    if (!canvas) return;
    let { w, h, ctx } = resizeCanvas(canvas);
    window.addEventListener('resize', () => { ({ w, h, ctx } = resizeCanvas(canvas)); });

    let animId = null;
    let isVisible = false;

    function draw(t) {
        if (!isVisible) return;
        ctx.clearRect(0, 0, w, h);
        
        if (!isTransmitting) {
            ctx.fillStyle = '#a8b2d1';
            ctx.font = '16px Heebo';
            ctx.textAlign = 'center';
            ctx.fillText("לחץ 'שלח מידע' בשקופית הקודמת כדי להתחיל", w/2, h/2);
            animId = requestAnimationFrame(draw);
            return;
        }

        const time = t * 0.001; 
        const currentBitFrame = Math.floor(time / bitDuration) % 64;

        ctx.fillStyle = '#f8faff';
        ctx.font = '24px JetBrains Mono';
        ctx.textAlign = 'center';
        
        for (let i = -5; i <= 5; i++) {
            const idx = currentBitFrame + i;
            if (idx >= 0 && idx < 64) {
                const px = w/2 + (i * 60) - ((time % bitDuration)/bitDuration * 60);
                ctx.globalAlpha = 1 - (Math.abs(px - w/2) / (w/2));
                ctx.fillStyle = idx === currentBitFrame ? '#ffc259' : '#a8b2d1';
                ctx.fillText(bitstream[idx].toString(), px, h*0.2);
            }
        }
        ctx.globalAlpha = 1.0;
        
        ctx.strokeStyle = '#ffc259';
        ctx.strokeRect(w/2 - 15, h*0.2 - 25, 30, 35);

        const waveY = h * 0.7;
        const waveAmp = h * 0.2;
        
        ctx.beginPath();
        ctx.strokeStyle = '#ffc259';
        ctx.lineWidth = 3;

        const historySeconds = 2.0;
        for (let px = 0; px <= w; px++) {
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
            for(let j=0; j<bIdx; j++) {
                phaseAcc += 2 * Math.PI * (bitstream[j] === 1 ? f1 : f0) * bitDuration;
            }
            phaseAcc += 2 * Math.PI * bFreq * bTime;

            const y = waveY - waveAmp * Math.cos(phaseAcc);
            if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
        }
        ctx.stroke();

        animId = requestAnimationFrame(draw);
    }

    createVisibilityObserver(canvas, 
        () => { isVisible = true; if(!animId) animId = requestAnimationFrame(draw); },
        () => { isVisible = false; if(animId) { cancelAnimationFrame(animId); animId = null; } }
    );
})();

/* ================= Slide 3: AWGN Noise ================= */
let currentNoiseLevel = 10;
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
        const dashSlider = document.getElementById('dash-slider-noise');
        if(dashSlider && dashSlider.value != currentNoiseLevel) {
            dashSlider.value = currentNoiseLevel;
            document.getElementById('dash-noise-val').textContent = currentNoiseLevel + '%';
        }
    });

    let animId = null;
    let isVisible = false;

    function draw(t) {
        if (!isVisible) return;
        ctx.clearRect(0, 0, w, h);
        if (!isTransmitting) {
            animId = requestAnimationFrame(draw);
            return;
        }

        const time = t * 0.001;
        const waveY = h * 0.5;
        const waveAmp = h * 0.3;
        
        ctx.beginPath();
        ctx.strokeStyle = '#ffc259';
        ctx.lineWidth = 2;

        const historySeconds = 1.0; 
        for (let px = 0; px <= w; px+=2) {
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
            const noise = (currentNoiseLevel / 100) * 2.0 * randn_bm(); 
            
            const y = waveY - waveAmp * (signal + noise);
            if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
        }
        ctx.stroke();

        animId = requestAnimationFrame(draw);
    }

    createVisibilityObserver(canvas, 
        () => { isVisible = true; if(!animId) animId = requestAnimationFrame(draw); },
        () => { isVisible = false; if(animId) { cancelAnimationFrame(animId); animId = null; } }
    );
})();

/* ================= Slide 4: FFT ================= */
(function initFFT() {
    const canvas = document.getElementById('canvas-fft');
    if (!canvas) return;
    let { w, h, ctx } = resizeCanvas(canvas);
    window.addEventListener('resize', () => { ({ w, h, ctx } = resizeCanvas(canvas)); });

    let animId = null;
    let isVisible = false;
    
    // [PERF FIX] Hoist allocation out of the 60FPS loop
    const N = 256;
    const buffer = new Float32Array(N);

    function draw(t) {
        if (!isVisible) return;
        ctx.clearRect(0, 0, w, h);
        if (!isTransmitting) {
            animId = requestAnimationFrame(draw);
            return;
        }

        const time = t * 0.001;
        const dt = bitDuration / N;
        const bIdx = Math.floor(time / bitDuration) % 64;
        const bFreq = bitstream[bIdx] === 1 ? f1 : f0;
        
        for (let i = 0; i < N; i++) {
            const signal = Math.cos(2 * Math.PI * bFreq * (i * dt));
            const noise = (currentNoiseLevel / 100) * 2.0 * randn_bm();
            buffer[i] = signal + noise;
        }

        const mags = computeFFT(buffer);
        
        const maxFreqToShow = 10;
        const barWidth = (w * 0.8) / maxFreqToShow;
        const startX = w * 0.1;
        const baseY = h * 0.8;

        ctx.strokeStyle = '#233554';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(startX, baseY);
        ctx.lineTo(w*0.9, baseY);
        ctx.stroke();

        for (let k = 0; k < maxFreqToShow; k++) {
            const mag = mags[k] || 0;
            const barH = mag * (h * 1.5);
            const px = startX + k * barWidth;
            
            ctx.fillStyle = '#a8b2d1';
            if (k === f0) ctx.fillStyle = '#ffc259';
            if (k === f1) ctx.fillStyle = '#ffc259';

            ctx.fillRect(px + 4, baseY - barH, barWidth - 8, barH);
            
            ctx.fillStyle = '#f8faff';
            ctx.font = '14px JetBrains Mono';
            ctx.textAlign = 'center';
            ctx.fillText(k + 'Hz', px + barWidth/2, baseY + 20);
        }

        ctx.fillStyle = '#f8faff';
        ctx.font = '20px Heebo';
        ctx.fillText(`Bit נוכחי מקורי: ${bitstream[bIdx]}`, w/2, h*0.2);

        animId = requestAnimationFrame(draw);
    }

    createVisibilityObserver(canvas, 
        () => { isVisible = true; if(!animId) animId = requestAnimationFrame(draw); },
        () => { isVisible = false; if(animId) { cancelAnimationFrame(animId); animId = null; } }
    );
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
    let animId = null;
    let isVisible = false;
    let reconBitIndex = 0;
    let lastReconTime = 0;

    btn.addEventListener('click', () => {
        isDecoding = true;
        decodedBits.fill(null);
        reconBitIndex = 0;
        lastReconTime = performance.now();
    });

    function draw(t) {
        if (!isVisible) return;
        ctx.clearRect(0, 0, w, h);
        if (!isTransmitting) {
            animId = requestAnimationFrame(draw);
            return;
        }

        if (isDecoding) {
            const delta = t - lastReconTime;
            if (delta >= 100) { // 100ms per bit
                lastReconTime = t;
                if (reconBitIndex < 64) {
                    const errorProb = currentNoiseLevel > 80 ? 0.2 : (currentNoiseLevel > 50 ? 0.05 : 0);
                    const actual = bitstream[reconBitIndex];
                    const detected = Math.random() < errorProb ? (actual === 1 ? 0 : 1) : actual;
                    decodedBits[reconBitIndex] = detected;
                    reconBitIndex++;
                }
            }
        }

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
                    const isError = decodedBits[idx] !== bitstream[idx];
                    ctx.fillStyle = decodedBits[idx] === 1 ? (isError ? '#ff4d60' : '#ffc259') : 'transparent';
                    if (decodedBits[idx] === 1) {
                        ctx.fillRect(px+1, py+1, cellSize-2, cellSize-2);
                    } else if (isError) {
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

        animId = requestAnimationFrame(draw);
    }

    createVisibilityObserver(canvas, 
        () => { isVisible = true; if(!animId) animId = requestAnimationFrame(draw); },
        () => { isVisible = false; if(animId) { cancelAnimationFrame(animId); animId = null; } }
    );
})();

/* ================= Slide 6: Windowing ================= */
(function initWindowing() {
    const canvasTime = document.getElementById('canvas-windowing');
    const canvasFFT = document.getElementById('canvas-windowing-fft');
    if (!canvasTime || !canvasFFT) return;
    
    let wTime, hTime, ctxTime;
    let wFFT, hFFT, ctxFFT;
    
    function resizeAll() {
        const rt = resizeCanvas(canvasTime); wTime = rt.w; hTime = rt.h; ctxTime = rt.ctx;
        const rf = resizeCanvas(canvasFFT); wFFT = rf.w; hFFT = rf.h; ctxFFT = rf.ctx;
    }
    window.addEventListener('resize', resizeAll);
    resizeAll();

    let animId = null;
    let isVisible = false;

    const numBits = 8;
    const staticBuffer = new Float32Array(1024);
    
    for(let i = 0; i < 1024; i++) {
        const time = i / 1024;
        const bIdx = Math.floor(time * numBits);
        const bFreq = (bIdx % 2 === 0) ? f1 : f0;
        const sig = Math.cos(2 * Math.PI * bFreq * (i/1024 * 50)); 
        const noise = 0.5 * randn_bm();
        staticBuffer[i] = sig + noise;
    }

    let startTime = null;
    
    function draw(t) {
        if (!isVisible) return;
        ctxTime.clearRect(0, 0, wTime, hTime);
        ctxFFT.clearRect(0, 0, wFFT, hFFT);
        
        if (!startTime) startTime = t;
        const elapsed = t - startTime;
        
        // Draw the static wave
        ctxTime.beginPath();
        ctxTime.strokeStyle = '#a8b2d1';
        ctxTime.lineWidth = 2;
        const midY = hTime / 2;
        const amp = hTime * 0.3;
        for (let i = 0; i <= 1024; i++) {
            const x = (i / 1024) * wTime;
            const y = midY - amp * staticBuffer[i];
            if (i === 0) ctxTime.moveTo(x, y);
            else ctxTime.lineTo(x, y);
        }
        ctxTime.stroke();

        const msPerBit = 1000;
        const totalDuration = numBits * msPerBit;
        const loopTime = elapsed % totalDuration;
        
        const currentBitIndex = Math.floor(loopTime / msPerBit);
        const bitProgress = (loopTime % msPerBit) / msPerBit;
        const isTransitioning = bitProgress > 0.8;
        
        const windowWidth = wTime / numBits;
        
        let xOffset = currentBitIndex * windowWidth;
        if (isTransitioning) {
            const slideProgress = (bitProgress - 0.8) / 0.2;
            xOffset += slideProgress * windowWidth;
        }

        ctxTime.fillStyle = 'rgba(255, 194, 89, 0.4)';
        ctxTime.fillRect(xOffset, 0, windowWidth, hTime);
        
        ctxTime.strokeStyle = '#ffc259';
        ctxTime.lineWidth = 3;
        ctxTime.strokeRect(xOffset, 0, windowWidth, hTime);
        
        ctxTime.fillStyle = '#ffc259';
        ctxTime.font = '16px JetBrains Mono';
        ctxTime.textAlign = 'center';
        ctxTime.fillText('Window (T_bit)', xOffset + windowWidth/2, hTime * 0.1);

        // FFT Canvas Logic
        const maxFreqToShow = 10;
        const barWidth = (wFFT * 0.8) / maxFreqToShow;
        const startX = wFFT * 0.1;
        const by = hFFT * 0.8;
        
        ctxFFT.fillStyle = '#233554';
        ctxFFT.fillRect(startX, by, wFFT*0.8, 2);

        const currentFreq = (currentBitIndex % 2 === 0) ? f1 : f0;

        for (let k = 0; k < maxFreqToShow; k++) {
            let mag = 0.5 * Math.abs(randn_bm()); // Noise bed
            
            // Spike only if settled on a bit
            if (!isTransitioning && currentFreq === k) mag += 1.0;
            
            const barH = mag * (hFFT * 0.5);
            const px = startX + k * barWidth;
            
            ctxFFT.fillStyle = (!isTransitioning && currentFreq === k) ? '#ffc259' : '#a8b2d1';
            ctxFFT.fillRect(px + 4, by - barH, barWidth - 8, barH);
            
            ctxFFT.fillStyle = '#f8faff';
            ctxFFT.font = '14px JetBrains Mono';
            ctxFFT.textAlign = 'center';
            ctxFFT.fillText(k + 'Hz', px + barWidth/2, by + 20);
        }

        animId = requestAnimationFrame(draw);
    }

    createVisibilityObserver(canvasTime, 
        () => { isVisible = true; startTime = performance.now(); if(!animId) animId = requestAnimationFrame(draw); },
        () => { isVisible = false; if(animId) { cancelAnimationFrame(animId); animId = null; } }
    );
})();

/* ================= Slide 7: Dashboard Finale ================= */
(function initDashboard() {
    const cTX = document.getElementById('dash-tx');
    const cTime = document.getElementById('dash-time');
    const cFFT = document.getElementById('dash-fft');
    const cRX = document.getElementById('dash-rx');
    const dSlider = document.getElementById('dash-slider-noise');
    const btnStart = document.getElementById('btn-dash-start');
    
    if (!cTX || !cTime || !cFFT || !cRX || !btnStart) return;
    
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
        const s3 = document.getElementById('slider-noise');
        if(s3 && s3.value != currentNoiseLevel) {
            s3.value = currentNoiseLevel;
            document.getElementById('noise-val').textContent = currentNoiseLevel + '%';
        }
    });

    let rxBits = new Array(64).fill(null);
    let animId = null;
    let loopTimeout = null;
    let dashBitIndex = 0;
    let lastStepTime = 0;
    const STEP_MS = 100;
    let isVisible = false;

    function drawEmpty() {
        tCtx.clearRect(0,0,tW,tH);
        tmCtx.clearRect(0,0,tmW,tmH);
        fCtx.clearRect(0,0,fW,fH);
        rCtx.clearRect(0,0,rW,rH);
        
        // TX Grid
        const tcs = Math.min(tW, tH) * 0.1;
        const tox = tW/2 - 4*tcs;
        const toy = tH/2 - 4*tcs;
        // BUG 1 FIX: Strictly iterate < 8
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                tCtx.fillStyle = smiley8x8[r][c] ? '#ffc259' : '#233554';
                tCtx.fillRect(tox+c*tcs, toy+r*tcs, tcs-1, tcs-1);
            }
        }
        
        // RX Grid
        const rcs = Math.min(rW, rH) * 0.1;
        const rox = rW/2 - 4*rcs;
        const roy = rH/2 - 4*rcs;
        // BUG 1 FIX: Strictly iterate < 8
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                rCtx.strokeStyle = '#233554';
                rCtx.strokeRect(rox+c*rcs, roy+r*rcs, rcs, rcs);
            }
        }
        
        // FFT Bins
        const maxFreqToShow = 10;
        const barWidth = (fW * 0.8) / maxFreqToShow;
        const startX = fW * 0.1;
        const by = fH * 0.8;
        fCtx.fillStyle = '#233554';
        fCtx.fillRect(startX, by, fW*0.8, 2);
        
        fCtx.fillStyle = '#f8faff';
        fCtx.font = '14px JetBrains Mono';
        fCtx.textAlign = 'center';
        for (let k = 0; k < maxFreqToShow; k++) {
            const px = startX + k * barWidth;
            fCtx.fillText(k + 'Hz', px + barWidth/2, by + 20);
        }
    }
    setTimeout(drawEmpty, 100);

    function resetAndRestartDashboard() {
        dashBitIndex = 0;
        rxBits.fill(null);
        drawEmpty();
        lastStepTime = performance.now();
        animId = requestAnimationFrame(dashLoop);
    }

    btnStart.addEventListener('click', () => {
        if (animId) cancelAnimationFrame(animId);
        if (loopTimeout) clearTimeout(loopTimeout);
        
        // Hide button gracefully to prevent race conditions
        btnStart.style.transition = "opacity 0.5s ease";
        btnStart.style.opacity = "0";
        btnStart.style.pointerEvents = "none";
        
        resetAndRestartDashboard();
    });

    function dashLoop(t) {
        if (!isVisible) {
            animId = requestAnimationFrame(dashLoop);
            return;
        }

        // BUG 2 FIX: Explicitly intercept at index 64 to prevent out-of-bounds reading
        if (dashBitIndex === 64 || dashBitIndex > 63) {
            animId = null;
            loopTimeout = setTimeout(resetAndRestartDashboard, 1500);
            return; 
        }

        const delta = t - lastStepTime;
        if (delta >= STEP_MS) {
            lastStepTime = t;
            const act = bitstream[dashBitIndex];
            const bFreq = act === 1 ? f1 : f0;

            const errProb = currentNoiseLevel > 75 ? 0.15 : (currentNoiseLevel > 40 ? 0.05 : 0);
            const decoded = Math.random() < errProb ? (act===1?0:1) : act;
            rxBits[dashBitIndex] = decoded;

            // 1. TX Grid
            tCtx.clearRect(0,0,tW,tH);
            const tcs = Math.min(tW, tH) * 0.1;
            const tox = tW/2 - 4*tcs;
            const toy = tH/2 - 4*tcs;
            // BUG 1 FIX: Strictly iterate < 8
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    const idx = r * 8 + c;
                    tCtx.fillStyle = smiley8x8[r][c] ? '#ffc259' : '#233554';
                    if (idx === dashBitIndex) tCtx.fillStyle = '#ffffff'; // Changed indicator to white for contrast
                    tCtx.fillRect(tox+c*tcs, toy+r*tcs, tcs-1, tcs-1);
                }
            }

            // 2. Channel Time Domain
            tmCtx.clearRect(0,0,tmW,tmH);
            tmCtx.beginPath();
            tmCtx.strokeStyle = '#ffc259';
            tmCtx.lineWidth = 2;
            const wY = tmH/2;
            const wA = tmH*0.4;
            for (let px=0; px<=tmW; px+=2) {
                const phase = 2*Math.PI*bFreq * (px/tmW);
                const sig = Math.cos(phase);
                const nz = (currentNoiseLevel/100) * 1.5 * randn_bm();
                const y = wY - wA*(sig+nz);
                if(px===0) tmCtx.moveTo(px,y); else tmCtx.lineTo(px,y);
            }
            tmCtx.stroke();

            // 3. FFT
            fCtx.clearRect(0,0,fW,fH);
            const maxFreqToShow = 10;
            const barWidth = (fW * 0.8) / maxFreqToShow;
            const startX = fW * 0.1;
            const by = fH * 0.8;
            fCtx.fillStyle = '#233554';
            fCtx.fillRect(startX, by, fW*0.8, 2);

            for (let k = 0; k < maxFreqToShow; k++) {
                let mag = (currentNoiseLevel/100) * 0.2 * Math.abs(randn_bm());
                if (bFreq === k) mag += 1.0;
                
                const barH = mag * (fH * 0.5);
                const px = startX + k * barWidth;
                
                fCtx.fillStyle = (bFreq === k) ? '#ffc259' : '#a8b2d1';
                fCtx.fillRect(px + 4, by - barH, barWidth - 8, barH);
                
                fCtx.fillStyle = '#f8faff';
                fCtx.font = '14px JetBrains Mono';
                fCtx.textAlign = 'center';
                fCtx.fillText(k + 'Hz', px + barWidth/2, by + 20);
            }

            // 4. RX Grid
            rCtx.clearRect(0,0,rW,rH);
            const rcs = Math.min(rW, rH) * 0.1;
            const rox = rW/2 - 4*rcs;
            const roy = rH/2 - 4*rcs;
            
            // BUG 1 FIX: Strictly iterate < 8
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    const idx = r * 8 + c;
                    rCtx.strokeStyle = '#233554';
                    rCtx.strokeRect(rox+c*rcs, roy+r*rcs, rcs, rcs);
                    
                    if(rxBits[idx] !== null) {
                        const isErr = rxBits[idx] !== bitstream[idx];
                        rCtx.fillStyle = rxBits[idx] === 1 ? (isErr ? '#ff4d60' : '#ffc259') : 'transparent';
                        if(rxBits[idx]===1) rCtx.fillRect(rox+c*rcs+1, roy+r*rcs+1, rcs-2, rcs-2);
                        else if(isErr) { rCtx.fillStyle='#ff4d60'; rCtx.fillRect(rox+c*rcs+1, roy+r*rcs+1, rcs-2, rcs-2); }
                    }
                }
            }
            dashBitIndex++; 
        }
        animId = requestAnimationFrame(dashLoop);
    }

    createVisibilityObserver(document.getElementById('slide-7'), 
        () => { 
            isVisible = true; 
            // If the loop was already started before leaving, resume it fresh
            if (btnStart.style.opacity === "0" && !animId && !loopTimeout) {
                resetAndRestartDashboard();
            }
        },
        () => { 
            isVisible = false; 
            if (animId) { cancelAnimationFrame(animId); animId = null; }
            if (loopTimeout) { clearTimeout(loopTimeout); loopTimeout = null; }
        }
    );
})();

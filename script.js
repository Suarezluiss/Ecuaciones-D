window.addEventListener('DOMContentLoaded', () => {
    const dbg = (msg) => {
        const debugEl = document.getElementById('debug');
        if (debugEl) debugEl.textContent = 'Estado: ' + msg;
    };

    try {
        if (typeof window.p5 === 'undefined') {
            dbg('No cargó p5.js');
            return;
        }

        if (typeof window.Chart === 'undefined') {
            dbg('No cargó Chart.js');
            return;
        }

        dbg('Librerías cargadas, iniciando…');

        const el = (id) => document.getElementById(id);
        const setDisabled = (ids, flag) => ids.forEach(id => {
            const node = el(id);
            if (node) node.disabled = flag;
        });

        function renderMath() {
            if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
                window.MathJax.typesetClear?.();
                window.MathJax.typesetPromise().catch(err => {
                    dbg('Error MathJax: ' + err.message);
                });
            }
        }

        const COLORS = [
            '#f472b6',
            '#f59e0b',
            '#34d399',
            '#a78bfa',
            '#fb7185',
            '#22c55e',
            '#38bdf8',
            '#facc15'
        ];

        const state = {
            running: false,
            t: 0,
            y: 0,
            v: Number(el('v0')?.value ?? 0),
            m: Number(el('m')?.value ?? 2),
            g: Number(el('g')?.value ?? 9.81),
            k: Number(el('k')?.value ?? 4),
            model: el('model')?.value ?? 'linear',
            method: el('method')?.value ?? 'rk4',
            dt: Number(el('dt')?.value ?? 0.01),
            y0: Number(el('y0')?.value ?? 50),
            v0: Number(el('v0')?.value ?? 0),
            seriesT: [],
            seriesV: [],
            seriesY: [],
            shots: []
        };

        function acceleration(v, params) {
            const { g, k, m, model } = params;
            if (model === 'ideal') return g;
            if (model === 'linear') return g - (k / m) * v;
            return g - (k / m) * v * Math.abs(v);
        }

        function stepEuler(y, v, t, dt, params) {
            const a = acceleration(v, params);
            return {
                y: y + v * dt,
                v: v + a * dt
            };
        }

        function stepRK4(y, v, t, dt, params) {
            const a1 = acceleration(v, params);
            const k1y = v;
            const k1v = a1;

            const a2 = acceleration(v + 0.5 * dt * k1v, params);
            const k2y = v + 0.5 * dt * k1v;
            const k2v = a2;

            const a3 = acceleration(v + 0.5 * dt * k2v, params);
            const k3y = v + 0.5 * dt * k2v;
            const k3v = a3;

            const a4 = acceleration(v + dt * k3v, params);
            const k4y = v + dt * k3v;
            const k4v = a4;

            return {
                y: y + (dt / 6) * (k1y + 2 * k2y + 2 * k3y + k4y),
                v: v + (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)
            };
        }

        function v_terminal(params) {
            const { g, k, m, model } = params;
            if (model === 'ideal' || k === 0) return Infinity;
            if (model === 'linear') return (m * g) / k;
            return Math.sqrt((m * g) / k);
        }

        function analyticLinearV(t, { m, g, k }, v0) {
            if (k === 0) return v0 + g * t;
            return (m * g) / k + (v0 - (m * g) / k) * Math.exp(-(k / m) * t);
        }

        function analyticLinearY(t, { m, g, k }, v0) {
            if (k === 0) return v0 * t + 0.5 * g * t * t;
            return (m * g / k) * t + (m / k) * (v0 - (m * g) / k) * (1 - Math.exp(-(k / m) * t));
        }

        function analyticIdealY(t, g, v0) {
            return v0 * t + 0.5 * g * t * t;
        }

        function analyticQuadraticVFromRest(t, { m, g, k }) {
            if (k === 0) return g * t;
            const c = Math.sqrt((g * k) / m);
            const vt = Math.sqrt((m * g) / k);
            return vt * Math.tanh(c * t);
        }

        let chartV;
        let chartY;
        let customMode = false;

        function baseChartOptions(yTitle) {
            return {
                responsive: true,
                animation: false,
                plugins: {
                    legend: {
                        labels: { color: '#e5e7eb' }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: 't (s)', color: '#cbd5e1' },
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(255,255,255,.06)' }
                    },
                    y: {
                        title: { display: true, text: yTitle, color: '#cbd5e1' },
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(255,255,255,.06)' }
                    }
                }
            };
        }

        function initCharts() {
            const ctxV = el('chartV')?.getContext('2d');
            const ctxY = el('chartY')?.getContext('2d');

            if (!ctxV || !ctxY) {
                dbg('Faltan los canvas chartV/chartY');
                return;
            }

            chartV = new Chart(ctxV, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'v(t) simulada',
                            data: [],
                            borderColor: '#60a5fa',
                            backgroundColor: 'rgba(96,165,250,.15)',
                            borderWidth: 2.5,
                            pointRadius: 0,
                            tension: 0.2
                        },
                        {
                            label: 'v(t) analítica',
                            data: [],
                            borderColor: '#c084fc',
                            borderWidth: 2,
                            borderDash: [6, 4],
                            pointRadius: 0,
                            tension: 0.2
                        }
                    ]
                },
                options: baseChartOptions('v (m/s)')
            });

            chartY = new Chart(ctxY, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'y(t) simulada',
                            data: [],
                            borderColor: '#22d3ee',
                            backgroundColor: 'rgba(34,211,238,.15)',
                            borderWidth: 2.5,
                            pointRadius: 0,
                            tension: 0.2
                        },
                        {
                            label: 'y(t) analítica',
                            data: [],
                            borderColor: '#f59e0b',
                            borderWidth: 2,
                            borderDash: [6, 4],
                            pointRadius: 0,
                            tension: 0.2
                        }
                    ]
                },
                options: baseChartOptions('y (m)')
            });
        }

        function buildShotDatasets(kind) {
            return state.shots.map((shot, index) => {
                const color = COLORS[index % COLORS.length];
                return {
                    label: `${kind}(t) guardada ${index + 1}`,
                    data: kind === 'v' ? shot.V : shot.Y,
                    borderColor: color,
                    borderWidth: 1.8,
                    pointRadius: 0,
                    tension: 0.18,
                    borderDash: [3, 3]
                };
            });
        }

        function updateCharts() {
            if (!chartV || !chartY) return;

            const showA = el('showAnalytic')?.checked ?? false;

            const labels = [...state.seriesT];
            chartV.data.labels = labels;
            chartY.data.labels = labels;

            const vDatasets = [
                {
                    label: 'v(t) simulada',
                    data: state.seriesV,
                    borderColor: '#60a5fa',
                    backgroundColor: 'rgba(96,165,250,.15)',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    tension: 0.2
                },
                {
                    label: 'v(t) analítica',
                    data: showA
                        ? state.seriesT.map(t => {
                            if (state.model === 'linear') return analyticLinearV(t, state, state.v0);
                            if (state.model === 'ideal') return state.v0 + state.g * t;
                            if (state.model === 'quadratic' && state.v0 === 0) {
                                return analyticQuadraticVFromRest(t, state);
                            }
                            return null;
                        })
                        : [],
                    borderColor: '#c084fc',
                    borderWidth: 2,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    tension: 0.2
                },
                ...buildShotDatasets('v')
            ];

            const yDatasets = [
                {
                    label: 'y(t) simulada',
                    data: state.seriesY,
                    borderColor: '#22d3ee',
                    backgroundColor: 'rgba(34,211,238,.15)',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    tension: 0.2
                },
                {
                    label: 'y(t) analítica',
                    data: showA
                        ? state.seriesT.map(t => {
                            if (state.model === 'linear') return analyticLinearY(t, state, state.v0);
                            if (state.model === 'ideal') return analyticIdealY(t, state.g, state.v0);
                            return null;
                        })
                        : [],
                    borderColor: '#f59e0b',
                    borderWidth: 2,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    tension: 0.2
                },
                ...buildShotDatasets('y')
            ];

            chartV.data.datasets = vDatasets;
            chartY.data.datasets = yDatasets;

            chartV.update('none');
            chartY.update('none');
        }

        function syncKPI() {
            if (el('kpi_time')) el('kpi_time').textContent = state.t.toFixed(2);
            if (el('kpi_y')) el('kpi_y').textContent = state.y.toFixed(2);
            if (el('kpi_v')) el('kpi_v').textContent = state.v.toFixed(2);

            const vt = v_terminal(state);
            if (el('kpi_vt')) {
                el('kpi_vt').textContent = vt === Infinity ? '∞' : vt.toFixed(2);
            }
        }

        function resetSimulation() {
            state.t = 0;
            state.y0 = Number(el('y0').value);
            state.v = Number(el('v0').value);
            state.v0 = state.v;
            state.g = Number(el('g').value);
            state.k = Math.max(0, Number(el('k').value));
            state.m = Math.max(0.001, Number(el('m').value));
            state.model = el('model').value;
            state.method = el('method').value;
            state.dt = Math.max(0.001, Number(el('dt').value));

            state.y = 0;
            state.seriesT = [0];
            state.seriesV = [state.v];
            state.seriesY = [0];
            state.running = false;

            updateCharts();
            syncKPI();
        }

        function applyLock() {
            setDisabled(['g', 'k', 'm'], !customMode);

            const btn = el('btnToggleCustom');
            if (btn) {
                btn.textContent = customMode ? 'Bloquear parámetros' : 'Editar parámetros';
            }
        }

        // ── MODIFICACIÓN: agua y planeta gaseoso → cuadrática ──────────────
        function applyPreset(key) {
            if (key === 'custom') {
                customMode = true;
                applyLock();
                resetSimulation();
                return;
            }

            if (!customMode) {
                if (key === 'earth_air') {
                    el('g').value = 9.81;
                    el('k').value = 4;
                    el('m').value = 2;
                    el('model').value = 'linear';
                } else if (key === 'earth_vac') {
                    el('g').value = 9.81;
                    el('k').value = 0;
                    el('m').value = 2;
                    el('model').value = 'ideal';
                } else if (key === 'moon_vac') {
                    el('g').value = 1.62;
                    el('k').value = 0;
                    el('m').value = 2;
                    el('model').value = 'ideal';
                } else if (key === 'jupiter_dense') {
                    el('g').value = 24.79;
                    el('k').value = 15;
                    el('m').value = 2;
                    el('model').value = 'quadratic'; // ← MODIFICADO
                } else if (key === 'water') {
                    el('g').value = 9.81;
                    el('k').value = 40;
                    el('m').value = 2;
                    el('model').value = 'quadratic'; // ← MODIFICADO
                }
            }

            resetSimulation();
        }
        // ───────────────────────────────────────────────────────────────────

        function setKAndReport(k, unitHint) {
            const out = el('k_calc_status');

            if (!isFinite(k) || k <= 0) {
                if (out) out.textContent = 'Resultado: valor inválido. Revisa entradas.';
                return;
            }

            el('k').value = k;

            if (out) {
                out.textContent = `Resultado: k = ${k.toFixed(state.model === 'linear' ? 3 : 4)} ${unitHint}`;
            }

            resetSimulation();
        }

        function computeKFromVT(model, m, g, vt) {
            const vtabs = Math.abs(vt);
            if (!vtabs) return NaN;
            if (model === 'linear') return (m * g) / vtabs;
            if (model === 'quadratic') return (m * g) / (vtabs * vtabs);
            return NaN;
        }

        function computeKFromPropsQuad({ rho, Cd, A }) {
            return 0.5 * rho * Cd * A;
        }

        function computeKFromPropsLin({ mu, r }) {
            return 6 * Math.PI * mu * r;
        }

        function bindUI() {
            el('btnStart').onclick = () => {
                state.running = true;
                dbg('Simulación corriendo');
            };

            el('btnPause').onclick = () => {
                state.running = false;
                dbg('Pausado');
            };

            el('btnReset').onclick = () => {
                state.shots = [];
                resetSimulation();
                updateCharts();
                dbg('Reiniciado desde cero');
            };

            el('btnAddShot').onclick = () => {
                if (state.seriesT.length < 2) {
                    alert('Primero ejecuta una simulación antes de guardar una curva.');
                    return;
                }

                state.shots.push({
                    T: [...state.seriesT],
                    V: [...state.seriesV],
                    Y: [...state.seriesY],
                    meta: {
                        g: state.g,
                        k: state.k,
                        m: state.m,
                        model: state.model,
                        method: state.method,
                        dt: state.dt,
                        y0: state.y0,
                        v0: state.v0
                    }
                });

                updateCharts();
                alert(`Curva guardada. Total guardadas: ${state.shots.length}`);
            };

            const btnToggle = el('btnToggleCustom');
            if (btnToggle) {
                btnToggle.onclick = () => {
                    customMode = !customMode;
                    applyLock();

                    if (!customMode) {
                        const presetValue = el('preset').value;
                        if (presetValue !== 'custom') {
                            applyPreset(presetValue);
                        }
                    } else {
                        el('preset').value = 'custom';
                    }
                };
            }

            el('preset').onchange = (e) => {
                if (e.target.value === 'custom') {
                    customMode = true;
                    applyLock();
                    resetSimulation();
                } else {
                    customMode = false;
                    applyLock();
                    applyPreset(e.target.value);
                }
            };

            ['g', 'k', 'm', 'y0', 'v0', 'dt', 'model', 'method', 'showAnalytic'].forEach(id => {
                el(id)?.addEventListener('change', () => {
                    resetSimulation();
                    renderMath();
                });
            });

            el('btnCheckVT').onclick = () => {
                const user = Number(el('vt_user').value);
                const simVt = v_terminal(state);

                if (!isFinite(simVt)) {
                    el('vt_result').textContent = 'No aplica (ideal)';
                    el('vt_result').className = 'pill';
                    return;
                }

                if (isNaN(user)) {
                    el('vt_result').textContent = 'Ingresa un valor';
                    el('vt_result').className = 'pill bad';
                    return;
                }

                const diffPercent = 100 * Math.abs(user - simVt) / Math.abs(simVt);
                const ok = diffPercent <= 2;

                el('vt_result').textContent = ok
                    ? '✔ Correcto'
                    : `✖ Diferencia ${diffPercent.toFixed(1)}%`;

                el('vt_result').className = 'pill ' + (ok ? 'ok' : 'bad');
            };

            el('btnKFromVT')?.addEventListener('click', () => {
                if (state.model === 'ideal') {
                    el('k_calc_status').textContent = 'Resultado: en el modelo ideal no aplica k.';
                    return;
                }

                const vt = Number(el('vt_for_k')?.value ?? NaN);
                const kCalc = computeKFromVT(state.model, state.m, state.g, vt);
                setKAndReport(kCalc, state.model === 'linear' ? 'kg/s' : 'kg/m');
            });

            el('btnKFromPropsQuad')?.addEventListener('click', () => {
                if (state.model !== 'quadratic') {
                    el('k_calc_status').textContent = 'Resultado: selecciona modelo Cuadrático.';
                    return;
                }

                const rho = Number(el('rho')?.value ?? NaN);
                const Cd = Number(el('Cd')?.value ?? NaN);
                const A = Number(el('A')?.value ?? NaN);

                const kCalc = computeKFromPropsQuad({ rho, Cd, A });
                setKAndReport(kCalc, 'kg/m');
            });

            el('btnKFromPropsLin')?.addEventListener('click', () => {
                if (state.model !== 'linear') {
                    el('k_calc_status').textContent = 'Resultado: selecciona modelo Lineal.';
                    return;
                }

                const mu = Number(el('mu')?.value ?? NaN);
                const r = Number(el('r')?.value ?? NaN);

                const kCalc = computeKFromPropsLin({ mu, r });
                setKAndReport(kCalc, 'kg/s');
            });
        }

        const sketch = (p) => {
            let W = 0;
            let H = 0;
            let groundY;
            const radius = 16;
            const pxPerMeter = 5;

            p.setup = function () {
                const holder = el('p5-holder');
                if (!holder) {
                    dbg('Falta el contenedor #p5-holder');
                    return;
                }

                W = Math.max(holder.clientWidth - 4, 320);
                H = 400;

                const cnv = p.createCanvas(W, H);
                cnv.parent('p5-holder');

                groundY = H - 40;
            };

            p.windowResized = function () {
                const holder = el('p5-holder');
                if (!holder) return;

                W = Math.max(holder.clientWidth - 4, 320);
                H = 400;
                p.resizeCanvas(W, H);
                groundY = H - 40;
            };

            function worldToScreenY(yMeters) {
                return groundY - state.y0 * pxPerMeter + yMeters * pxPerMeter;
            }

            p.draw = function () {
                p.background(7, 12, 28);

                for (let i = 0; i < 22; i++) {
                    p.noStroke();
                    p.fill(255, 255, 255, 18);
                    p.circle((i * 53) % W, (i * 37) % (groundY - 20), 2);
                }

                p.stroke(255, 255, 255, 20);
                p.strokeWeight(1);
                for (let gy = groundY; gy > 40; gy -= 40) {
                    p.line(0, gy, W, gy);
                }

                p.noStroke();
                p.fill(20, 120, 255, 60);
                p.rect(0, groundY, W, 5, 3);

                if (state.running) {
                    const params = {
                        g: state.g,
                        k: state.k,
                        m: state.m,
                        model: state.model
                    };

                    const dt = state.dt;
                    const step = state.method === 'euler' ? stepEuler : stepRK4;
                    const result = step(state.y, state.v, state.t, dt, params);

                    state.t += dt;
                    state.y = result.y;
                    state.v = result.v;

                    const yClamped = Math.min(state.y, state.y0);

                    state.seriesT.push(Number(state.t.toFixed(4)));
                    state.seriesV.push(state.v);
                    state.seriesY.push(yClamped);

                    updateCharts();

                    if (state.y >= state.y0) {
                        state.y = state.y0;
                        state.v = 0;
                        state.running = false;
                        syncKPI();
                        dbg('Impacto alcanzado');
                    }
                }

                const yPix = worldToScreenY(state.y);

                p.drawingContext.shadowBlur = 20;
                p.drawingContext.shadowColor = 'rgba(96,165,250,0.8)';
                p.noStroke();
                p.fill(96, 165, 250);
                p.circle(W * 0.2, yPix, radius * 2);
                p.drawingContext.shadowBlur = 0;

                if (state.y >= state.y0) {
                    p.fill(52, 211, 153);
                    p.noStroke();
                    p.circle(W * 0.2, groundY, 10);
                }

                p.noStroke();
                p.fill(255);
                p.textSize(12);
                p.text(`t = ${state.t.toFixed(2)} s`, 12, 22);
                p.text(`y = ${state.y.toFixed(2)} m`, 12, 40);
                p.text(`v = ${state.v.toFixed(2)} m/s`, 12, 58);
            };
        };

        initCharts();
        applyLock();
        applyPreset('earth_air');
        resetSimulation();
        bindUI();
        new p5(sketch);
        setInterval(syncKPI, 100);

        setTimeout(renderMath, 300);

        dbg('Listo: pulsa Iniciar');
    } catch (e) {
        const debugEl = document.getElementById('debug');
        if (debugEl) {
            debugEl.textContent = 'Estado: ERROR → ' + (e?.message || e);
        }
    }
});
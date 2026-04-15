// ─── Combinations – Settings ───────────────────────────────────────────
// Manages all configurable game settings with localStorage persistence.

const CombinationsSettings = (() => {
    const STORAGE_KEY = 'combinations_settings';
    const SERIES_KEY = 'combinations_month_series';

    // Default settings
    const DEFAULTS = {
        mode: 'quick',              // 'quick' | 'daily'
        boardSize: 11,              // 5–21
        traySize: 7,                // 5–16
        dictionary: 'english',      // Dictionary folder name
        dailyDate: null,            // ISO date string for daily puzzle
    };

    // Board size categories
    const BOARD_CATEGORIES = {
        mini:     { min: 5,  max: 10, label: 'Mini' },
        standard: { min: 11, max: 15, label: 'Standard' },
        enduro:   { min: 16, max: 21, label: 'Enduro' },
    };

    // Letter scores (from distribution.csv)
    const LETTER_SCORES = {};

    let current = { ...DEFAULTS };

    // ── Persistence ──────────────────────────────────────────────────────
    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const saved = JSON.parse(raw);
                current = { ...DEFAULTS, ...saved };
            }
        } catch (e) {
            console.warn('CombinationsSettings: failed to load, using defaults', e);
            current = { ...DEFAULTS };
        }
        return current;
    }

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
        } catch (e) {
            console.warn('CombinationsSettings: failed to save', e);
        }
    }

    function get(key) { return current[key]; }

    function set(key, value) {
        if (key in DEFAULTS) {
            current[key] = value;
            save();
        }
    }

    function getAll() { return { ...current }; }

    // ── Board category helper ────────────────────────────────────────────
    function getBoardCategory(size) {
        if (size <= 10) return 'mini';
        if (size <= 15) return 'standard';
        return 'enduro';
    }

    // ── Length bonus ─────────────────────────────────────────────────────
    function getLengthBonus(wordLength) {
        if (wordLength <= 3) return 0;
        if (wordLength === 4) return 1;
        if (wordLength === 5) return 2;
        if (wordLength === 6) return 3;
        if (wordLength === 7) return 5;
        if (wordLength === 8) return 10;
        // 9+ letters: Letters x 1.5 rounded to nearest
        return Math.round(wordLength * 1.5);
    }

    // ── All used bonus ──────────────────────────────────────────────────
    function getAllUsedBonus(traySize) {
        return 10 * traySize;
    }

    // ── Daily puzzle params based on day of week ────────────────────────
    function getDailyParams(dateStr) {
        const date = new Date(dateStr);
        const day = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

        if (day === 0) {
            // Sunday: 21×21, tray 14–16
            return { boardSize: 21, trayMin: 14, trayMax: 16, category: 'enduro' };
        } else if (day <= 2) {
            // Mon–Tue: Mini 5–10, tray 5–7
            return { boardSize: null, boardMin: 5, boardMax: 10, trayMin: 5, trayMax: 7, category: 'mini' };
        } else if (day <= 4) {
            // Wed–Thu: Standard 11–15, tray 8–10
            return { boardSize: null, boardMin: 11, boardMax: 15, trayMin: 8, trayMax: 10, category: 'standard' };
        } else {
            // Fri–Sat: Enduro 16–21, tray 11–13
            return { boardSize: null, boardMin: 16, boardMax: 21, trayMin: 11, trayMax: 13, category: 'enduro' };
        }
    }

    // ── Month series score ─────────────────────────────────────────────
    function getMonthSeries() {
        try {
            const raw = localStorage.getItem(SERIES_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function saveMonthSeriesEntry(dateStr, points) {
        const series = getMonthSeries();
        const monthKey = dateStr.substring(0, 7); // YYYY-MM
        if (!series[monthKey]) series[monthKey] = {};
        series[monthKey][dateStr] = Math.max(series[monthKey][dateStr] || 0, points);
        try {
            localStorage.setItem(SERIES_KEY, JSON.stringify(series));
        } catch (e) {
            console.warn('Failed to save series', e);
        }
    }

    function getMonthSeriesTotal(monthKey) {
        const series = getMonthSeries();
        if (!series[monthKey]) return 0;
        return Object.values(series[monthKey]).reduce((a, b) => a + b, 0);
    }

    // ── Available dictionaries ──────────────────────────────────────────
    function getAvailableDictionaries() {
        return ['english'];
    }

    // ── Settings UI builder ─────────────────────────────────────────────
    function buildSettingsPanel(containerEl, onApply) {
        containerEl.innerHTML = '';
        const s = getAll();

        // Helper: create a labeled row
        function row(label, inputEl, id) {
            const r = document.createElement('div');
            r.className = 'setting-row';
            if (id) r.id = id;
            const lbl = document.createElement('label');
            lbl.textContent = label;
            r.appendChild(lbl);
            r.appendChild(inputEl);
            return r;
        }

        // Helper: create a select
        function sel(options, selected) {
            const select = document.createElement('select');
            options.forEach(opt => {
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = opt.label;
                if (String(opt.value) === String(selected)) o.selected = true;
                select.appendChild(o);
            });
            return select;
        }

        // Mode selector
        const modeSel = sel([
            { value: 'quick', label: 'Quick Play' },
            { value: 'daily', label: 'Daily Puzzle' },
        ], s.mode);
        containerEl.appendChild(row('Mode', modeSel));

        // --- Quick Play settings ---
        const quickGroup = document.createElement('div');
        quickGroup.id = 'quick-settings-group';

        // Board size
        const boardOpts = [];
        for (let i = 5; i <= 21; i++) {
            const cat = getBoardCategory(i);
            const catLabel = BOARD_CATEGORIES[cat].label;
            boardOpts.push({ value: i, label: `${i}×${i} (${catLabel})` });
        }
        const boardSel = sel(boardOpts, s.boardSize);
        quickGroup.appendChild(row('Board Size', boardSel));

        // Tray size
        const trayOpts = [];
        for (let i = 5; i <= 16; i++) {
            trayOpts.push({ value: i, label: `${i} Letters` });
        }
        const traySel = sel(trayOpts, s.traySize);
        quickGroup.appendChild(row('Tray Size', traySel));

        containerEl.appendChild(quickGroup);

        // --- Daily Puzzle settings ---
        const dailyGroup = document.createElement('div');
        dailyGroup.id = 'daily-settings-group';

        // Date picker
        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.value = s.dailyDate || new Date().toISOString().split('T')[0];
        dateInput.style.cssText = `
            background: rgba(255,255,255,.08);
            border: 1px solid rgba(255,255,255,.12);
            color: #e8e8f0;
            padding: .45rem .8rem;
            border-radius: 10px;
            font-family: inherit;
            font-size: .9rem;
            cursor: pointer;
            outline: none;
        `;
        dailyGroup.appendChild(row('Date', dateInput));

        // Daily info display
        const dailyInfoEl = document.createElement('div');
        dailyInfoEl.style.cssText = `
            padding: .6rem 1rem;
            margin-top: .5rem;
            background: rgba(167, 139, 250, .08);
            border-radius: 10px;
            font-size: .85rem;
            color: rgba(255,255,255,.6);
            line-height: 1.6;
        `;
        dailyGroup.appendChild(dailyInfoEl);

        function updateDailyInfo() {
            const params = getDailyParams(dateInput.value);
            const date = new Date(dateInput.value);
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const dayName = dayNames[date.getDay()];

            let boardStr = params.boardSize
                ? `${params.boardSize}×${params.boardSize}`
                : `${params.boardMin}–${params.boardMax}`;
            dailyInfoEl.innerHTML = `
                <strong>${dayName}</strong> — ${params.category.charAt(0).toUpperCase() + params.category.slice(1)} Puzzle<br>
                Board: ${boardStr} &nbsp;│&nbsp; Tray: ${params.trayMin}–${params.trayMax} tiles
            `;
        }

        dateInput.addEventListener('change', updateDailyInfo);
        updateDailyInfo();

        containerEl.appendChild(dailyGroup);

        // Dictionary
        const dictSel = sel(
            getAvailableDictionaries().map(d => ({ value: d, label: d.charAt(0).toUpperCase() + d.slice(1) })),
            s.dictionary
        );
        containerEl.appendChild(row('Dictionary', dictSel));

        // Toggle visibility
        function updateGroupVisibility() {
            quickGroup.style.display = modeSel.value === 'quick' ? '' : 'none';
            dailyGroup.style.display = modeSel.value === 'daily' ? '' : 'none';
        }
        modeSel.addEventListener('change', updateGroupVisibility);
        updateGroupVisibility();

        // Apply button
        const applyBtn = document.createElement('button');
        applyBtn.id = 'settings-apply-btn';
        applyBtn.className = 'btn-primary';
        applyBtn.textContent = 'Start Game';
        applyBtn.addEventListener('click', () => {
            set('mode', modeSel.value);
            set('dictionary', dictSel.value);

            if (modeSel.value === 'quick') {
                set('boardSize', parseInt(boardSel.value));
                set('traySize', parseInt(traySel.value));
            } else {
                set('dailyDate', dateInput.value);
                // Daily params are computed from date
            }
            if (onApply) onApply(getAll());
        });
        containerEl.appendChild(applyBtn);
    }

    // Initialise on load
    load();

    return {
        load, save, get, set, getAll,
        getLengthBonus,
        getAllUsedBonus,
        getBoardCategory,
        getDailyParams,
        buildSettingsPanel,
        getAvailableDictionaries,
        getMonthSeries,
        saveMonthSeriesEntry,
        getMonthSeriesTotal,
        BOARD_CATEGORIES,
    };
})();

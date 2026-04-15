// ─── Anagram Attack Settings ───────────────────────────────────────────
// Manages all configurable game settings with localStorage persistence.

const AnagramSettings = (() => {
    const STORAGE_KEY = 'anagram_attack_settings';

    // Default settings
    const DEFAULTS = {
        timer: 180,                  // seconds: 60 | 180 | 300 | 600
        bonusSpaces: true,           // Bonus spaces in answer tray?
        bonusSpacePosition: 'random_word', // 'fixed_round' | 'random_word'
        possibleWordsView: 'short_list',   // 'short_list' | 'number_only' | 'hidden'
        maxTray: 7,                  // 5 | 7 | 9
        bingo: true,                 // All-used bingo bonus?
        lengthBonus: true,           // Length-based bonus scoring?
        dictionary: 'english',       // Dictionary folder name
    };

    // Timer options
    const TIMER_OPTIONS = [
        { value: 60,  label: '1 min' },
        { value: 180, label: '3 min' },
        { value: 300, label: '5 min' },
        { value: 600, label: '10 min' },
    ];

    // Tray size options
    const TRAY_OPTIONS = [
        { value: 5, label: '5 Letters' },
        { value: 7, label: '7 Letters' },
        { value: 9, label: '9 Letters' },
    ];

    const BONUS_POSITION_OPTIONS = [
        { value: 'random_word', label: 'Random per Word' },
        { value: 'fixed_round', label: 'Fixed per Round' },
    ];

    const POSSIBLE_WORDS_OPTIONS = [
        { value: 'short_list',  label: 'Short List' },
        { value: 'number_only', label: 'Number Only' },
        { value: 'hidden',      label: 'Hidden' },
    ];

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
            console.warn('AnagramSettings: failed to load, using defaults', e);
            current = { ...DEFAULTS };
        }
        return current;
    }

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
        } catch (e) {
            console.warn('AnagramSettings: failed to save', e);
        }
    }

    function get(key) {
        return current[key];
    }

    function set(key, value) {
        if (key in DEFAULTS) {
            current[key] = value;
            save();
        }
    }

    function getAll() {
        return { ...current };
    }

    // ── Bingo bonus calculation ──────────────────────────────────────────
    // Formula: round(50 / 7 * maxTray)
    function getBingoBonus() {
        return Math.round((50 / 7) * current.maxTray);
    }

    // ── Length bonus lookup ──────────────────────────────────────────────
    function getLengthBonus(wordLength) {
        if (!current.lengthBonus) return 0;
        if (wordLength <= 3) return 0;
        if (wordLength === 4) return 1;
        if (wordLength === 5) return 2;
        if (wordLength === 6) return 3;
        if (wordLength === 7) return 5;
        return 10; // 8+
    }

    // ── Available dictionaries scan ──────────────────────────────────────
    // Returns a static list; in a real app you'd scan the server
    function getAvailableDictionaries() {
        return ['english'];
    }

    // ── Settings UI builder ──────────────────────────────────────────────
    function buildSettingsPanel(containerEl, onApply) {
        containerEl.innerHTML = '';
        const s = getAll();

        // Helper: create a labeled row
        function row(label, inputEl) {
            const r = document.createElement('div');
            r.className = 'setting-row';
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
                if (opt.value == selected) o.selected = true;
                select.appendChild(o);
            });
            return select;
        }

        // Helper: toggle switch
        function toggle(checked) {
            const wrapper = document.createElement('label');
            wrapper.className = 'toggle-switch';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = checked;
            const slider = document.createElement('span');
            slider.className = 'toggle-slider';
            wrapper.appendChild(cb);
            wrapper.appendChild(slider);
            return { wrapper, cb };
        }

        // Timer
        const timerSel = sel(TIMER_OPTIONS, s.timer);
        containerEl.appendChild(row('Time Limit', timerSel));

        // Tray Size
        const traySel = sel(TRAY_OPTIONS, s.maxTray);
        containerEl.appendChild(row('Tray Size', traySel));

        // Bonus Spaces
        const bonusToggle = toggle(s.bonusSpaces);
        containerEl.appendChild(row('Bonus Spaces', bonusToggle.wrapper));

        // Bonus Space Position
        const bonusPosSel = sel(BONUS_POSITION_OPTIONS, s.bonusSpacePosition);
        const bonusPosRow = row('Bonus Position', bonusPosSel);
        bonusPosRow.style.display = s.bonusSpaces ? '' : 'none';
        containerEl.appendChild(bonusPosRow);

        bonusToggle.cb.addEventListener('change', () => {
            bonusPosRow.style.display = bonusToggle.cb.checked ? '' : 'none';
        });

        // Possible Words View
        const posWordsSel = sel(POSSIBLE_WORDS_OPTIONS, s.possibleWordsView);
        containerEl.appendChild(row('Possible Words', posWordsSel));

        // Bingo
        const bingoToggle = toggle(s.bingo);
        containerEl.appendChild(row('Bingo Bonus (All Used)', bingoToggle.wrapper));

        // Length Bonus
        const lengthToggle = toggle(s.lengthBonus);
        containerEl.appendChild(row('Length Bonus', lengthToggle.wrapper));

        // Dictionary
        const dictSel = sel(
            getAvailableDictionaries().map(d => ({ value: d, label: d.charAt(0).toUpperCase() + d.slice(1) })),
            s.dictionary
        );
        containerEl.appendChild(row('Dictionary', dictSel));

        // Apply button
        const applyBtn = document.createElement('button');
        applyBtn.id = 'settings-apply-btn';
        applyBtn.className = 'btn-primary';
        applyBtn.textContent = 'Start Game';
        applyBtn.addEventListener('click', () => {
            set('timer', parseInt(timerSel.value));
            set('maxTray', parseInt(traySel.value));
            set('bonusSpaces', bonusToggle.cb.checked);
            set('bonusSpacePosition', bonusPosSel.value);
            set('possibleWordsView', posWordsSel.value);
            set('bingo', bingoToggle.cb.checked);
            set('lengthBonus', lengthToggle.cb.checked);
            set('dictionary', dictSel.value);
            if (onApply) onApply(getAll());
        });
        containerEl.appendChild(applyBtn);
    }

    // Initialise on load
    load();

    return {
        load, save, get, set, getAll,
        getBingoBonus, getLengthBonus,
        buildSettingsPanel,
        TIMER_OPTIONS, TRAY_OPTIONS,
        getAvailableDictionaries,
    };
})();

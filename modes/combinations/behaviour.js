// ─── Combinations – Core Gameplay Behaviour ───────────────────────────
// Fixed rack tiles that are reusable. Tiles placed on board stay yellow/
// temporary, auto-submit when valid new words are formed, tiles never
// consumed — freely movable at all times.

const CombinationsGame = (() => {
    // ── State ────────────────────────────────────────────────────────────
    let dictionary = new Set();
    let distribution = [];
    let weightPool = [];

    // Board state
    let boardSize = 11;
    let board = [];         // 2D: board[row][col] = { letter, score, fixed } | null
    let bonusBoard = [];    // 2D: bonus info for each cell
    let rack = [];          // Player's tile rack (FIXED — never changes)
    let placedTiles = [];   // Tiles currently on board from rack: [{row, col, rackIdx}]

    // Scoring / tracking
    let score = 0;
    let movesHistory = [];            // [{words, totalScore, type}]
    let foundCombinations = new Set(); // "WORD@r,c,dir" keys to prevent duplicate scoring
    let combinationsFound = 0;
    let puzzleCompleted = false;
    let topFiveTarget = [];
    let tileIdCounter = 0;
    let dictionaryLoaded = false;
    let traySize = 7;
    let gameActive = false;

    // Seeded RNG
    let rngState = 0;

    // Callbacks
    let settings = null;
    let onUpdate = null;
    let onLoadStatus = null;
    let onAutoScore = null;
    let onMoveRejected = null;
    let onPuzzleComplete = null;

    // ── Seeded RNG (Mulberry32) ─────────────────────────────────────────
    function seedRng(seed) { rngState = seed | 0; }

    function seededRandom() {
        rngState |= 0;
        rngState = rngState + 0x6D2B79F5 | 0;
        let t = Math.imul(rngState ^ rngState >>> 15, 1 | rngState);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    function seededInt(min, max) {
        return min + Math.floor(seededRandom() * (max - min + 1));
    }

    function seededShuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(seededRandom() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash;
    }

    // ── Initialisation ──────────────────────────────────────────────────
    async function init(gameSettings, callbacks) {
        settings = gameSettings;
        onUpdate       = callbacks.onUpdate       || (() => {});
        onLoadStatus   = callbacks.onLoadStatus   || (() => {});
        onAutoScore    = callbacks.onAutoScore    || (() => {});
        onMoveRejected = callbacks.onMoveRejected || (() => {});
        onPuzzleComplete = callbacks.onPuzzleComplete || (() => {});

        // Reset
        score = 0;
        movesHistory = [];
        foundCombinations.clear();
        combinationsFound = 0;
        puzzleCompleted = false;
        topFiveTarget = [];
        tileIdCounter = 0;
        gameActive = false;
        placedTiles = [];
        rack = [];

        // Determine board and tray params
        if (settings.mode === 'daily') {
            const params = CombinationsSettings.getDailyParams(settings.dailyDate);
            const dateSeed = hashString(settings.dailyDate);
            seedRng(dateSeed);
            boardSize = params.boardSize || seededInt(params.boardMin, params.boardMax);
            traySize = seededInt(params.trayMin, params.trayMax);
        } else {
            boardSize = settings.boardSize;
            traySize  = settings.traySize;
            seedRng(Date.now());
        }

        // Load dictionary
        onLoadStatus('Loading dictionary…', false);
        await loadDictionary(settings.dictionary);
        if (!dictionaryLoaded) {
            onLoadStatus('⚠ Dictionary failed to load. Use a local server (e.g. Live Server).', true);
            return;
        }
        onLoadStatus(`Dictionary ready (${dictionary.size.toLocaleString()} words)`, false);
        buildWeightPool();

        // Generate board
        generateBoard();

        // Fill rack (FIXED — once and for all)
        for (let i = 0; i < traySize; i++) {
            rack.push(randomTile(settings.mode === 'daily'));
        }

        gameActive = true;
        onUpdate(getState());
    }

    // ── Dictionary loading ──────────────────────────────────────────────
    async function loadDictionary(dictName) {
        dictionary.clear();
        distribution = [];
        const dictPath = `../../dictionary/${dictName}/dictionary.txt`;
        const distPath = `../../dictionary/${dictName}/distribution.csv`;

        function xhrGet(url) {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.onload = () => {
                    if (xhr.status === 200 || xhr.status === 0) resolve(xhr.responseText);
                    else reject(new Error(`XHR ${xhr.status} for ${url}`));
                };
                xhr.onerror = () => reject(new Error(`XHR network error for ${url}`));
                xhr.send();
            });
        }

        try {
            const [dictText, distText] = await Promise.all([xhrGet(dictPath), xhrGet(distPath)]);

            dictText.split(/\r?\n/).forEach(w => {
                const word = w.trim().toUpperCase();
                if (word.length >= 2 && /^[A-Z]+$/.test(word)) dictionary.add(word);
            });

            distText.split(/\r?\n/).slice(1).forEach(line => {
                const parts = line.split(',');
                if (parts.length >= 3 && parts[0].trim() !== '*' && parts[0].trim() !== '') {
                    distribution.push({
                        letter: parts[0].trim().toUpperCase(),
                        weight: parseInt(parts[1]) || 1,
                        score:  parseInt(parts[2]) || 1
                    });
                }
            });

            if (dictionary.size < 100) throw new Error('Dictionary too small');
            dictionaryLoaded = true;
        } catch (e) {
            console.error('[CombinationsGame] Dictionary load failed:', e);
            dictionaryLoaded = false;
        }
    }

    function buildWeightPool() {
        weightPool = [];
        distribution.forEach(d => {
            for (let i = 0; i < d.weight; i++) weightPool.push(d);
        });
    }

    function getLetterScore(letter) {
        const d = distribution.find(x => x.letter === letter.toUpperCase());
        return d ? d.score : 1;
    }

    function randomTile(useSeeded) {
        const rnd = useSeeded ? seededRandom() : Math.random();
        const d = weightPool[Math.floor(rnd * weightPool.length)];
        return { id: tileIdCounter++, letter: d.letter, score: d.score };
    }

    // ── Board generation ────────────────────────────────────────────────
    function generateBoard() {
        board = [];
        bonusBoard = [];
        for (let r = 0; r < boardSize; r++) {
            board[r] = [];
            bonusBoard[r] = [];
            for (let c = 0; c < boardSize; c++) {
                board[r][c] = null;
                bonusBoard[r][c] = null;
            }
        }
        placeBonusTiles();
        placeInitialWords();
        calculateTargetScores();
    }

    function placeBonusTiles() {
        const bonusTypes = [
            { type: 'DL', label: '×2L', color: 'letter', mult: 2 },
            { type: 'TL', label: '×3L', color: 'letter', mult: 3 },
            { type: 'QL', label: '×4L', color: 'letter', mult: 4 },
            { type: 'DW', label: '×2W', color: 'word',   mult: 2 },
            { type: 'TW', label: '×3W', color: 'word',   mult: 3 },
            { type: 'QW', label: '×4W', color: 'word',   mult: 4 },
        ];

        const totalCells = boardSize * boardSize;
        const numBonuses = Math.floor(totalCells * 0.12);
        const centerR = Math.floor(boardSize / 2);
        const centerC = Math.floor(boardSize / 2);
        const placed = new Set();
        let count = 0;

        while (count < numBonuses) {
            const r = seededInt(0, boardSize - 1);
            const c = seededInt(0, boardSize - 1);
            const key = `${r},${c}`;
            if (r === centerR && c === centerC) continue;
            if (placed.has(key)) continue;

            const rnd = seededRandom();
            let bt;
            if      (rnd < 0.30) bt = bonusTypes[0];
            else if (rnd < 0.50) bt = bonusTypes[1];
            else if (rnd < 0.55) bt = bonusTypes[2];
            else if (rnd < 0.75) bt = bonusTypes[3];
            else if (rnd < 0.90) bt = bonusTypes[4];
            else                 bt = bonusTypes[5];

            const mirrors = getSymmetricPositions(r, c, boardSize);
            for (const [mr, mc] of mirrors) {
                const mk = `${mr},${mc}`;
                if (!placed.has(mk) && count < numBonuses) {
                    bonusBoard[mr][mc] = { ...bt };
                    placed.add(mk);
                    count++;
                }
            }
        }
        bonusBoard[centerR][centerC] = { type: 'STAR', label: '★', color: 'star', mult: 2 };
    }

    function getSymmetricPositions(r, c, size) {
        const set = new Set();
        const mr = size - 1 - r;
        const mc = size - 1 - c;
        set.add(`${r},${c}`);
        set.add(`${mr},${c}`);
        set.add(`${r},${mc}`);
        set.add(`${mr},${mc}`);
        return [...set].map(s => s.split(',').map(Number));
    }

    function placeInitialWords() {
        const centerR = Math.floor(boardSize / 2);
        const centerC = Math.floor(boardSize / 2);
        
        const candidates = [];
        for (const w of dictionary) {
            if (w.length >= 3 && w.length <= Math.min(8, boardSize)) {
                candidates.push(w);
                if (candidates.length >= 2000) break;
            }
        }
        seededShuffle(candidates);

        const targetWords = Math.min(6, Math.floor(boardSize / 1.8));
        let placed = 0;

        for (const word of candidates) {
            if (placed >= targetWords) break;

            let bestMatch = null;
            // 1st word must cross center
            if (placed === 0) {
                const isH = seededRandom() > 0.5;
                const offset = Math.floor(seededRandom() * word.length);
                const r = isH ? centerR : centerR - offset;
                const c = isH ? centerC - offset : centerC;
                if (canPlaceWordOnBoard(word, r, c, isH)) bestMatch = { r, c, isH };
            } else {
                // Subsequent words can be anywhere (isolated or jointed)
                for (let a = 0; a < 200; a++) {
                    const isH = seededRandom() > 0.5;
                    const r = seededInt(0, boardSize - 1);
                    const c = seededInt(0, boardSize - 1);
                    if (canPlaceWordOnBoard(word, r, c, isH)) {
                        bestMatch = { r, c, isH };
                        break;
                    }
                }
            }

            if (bestMatch) {
                const { r, c, isH } = bestMatch;
                for (let i = 0; i < word.length; i++) {
                    const rr = isH ? r : r + i;
                    const cc = isH ? c + i : c;
                    board[rr][cc] = { 
                        letter: word[i], 
                        score: getLetterScore(word[i]), 
                        fixed: true 
                    };
                }
                placed++;
            }
        }
    }

    function canPlaceWordOnBoard(word, r, c, isH) {
        if (isH) {
            if (c < 0 || c + word.length > boardSize) return false;
            for (let i = 0; i < word.length; i++) {
                const tr = r, tc = c + i;
                // Conflict check
                if (board[tr][tc] !== null && board[tr][tc].letter !== word[i]) return false;
                // Buffer check: non-intersecting spots shouldn't have vertical neighbors
                if (board[tr][tc] === null) {
                    if (tr > 0 && board[tr - 1][tc] !== null) return false;
                    if (tr < boardSize - 1 && board[tr + 1][tc] !== null) return false;
                }
            }
            // Start/End buffer (no horizontal neighbors)
            if (c > 0 && board[r][c - 1] !== null) return false;
            if (c + word.length < boardSize && board[r][c + word.length] !== null) return false;
        } else {
            if (r < 0 || r + word.length > boardSize) return false;
            for (let i = 0; i < word.length; i++) {
                const tr = r + i, tc = c;
                if (board[tr][tc] !== null && board[tr][tc].letter !== word[i]) return false;
                if (board[tr][tc] === null) {
                    if (tc > 0 && board[tr][tc - 1] !== null) return false;
                    if (tc < boardSize - 1 && board[tr][tc + 1] !== null) return false;
                }
            }
            if (r > 0 && board[r - 1][c] !== null) return false;
            if (r + word.length < boardSize && board[r + word.length][c] !== null) return false;
        }
        return true;
    }

    function calculateTargetScores() {
        const baseScore = boardSize * 3;
        topFiveTarget = [];
        for (let i = 0; i < 5; i++) {
            topFiveTarget.push(Math.floor(baseScore * (5 - i) * (1 + seededRandom() * 0.5)));
        }
        topFiveTarget.sort((a, b) => b - a);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  TILE PLACEMENT — tiles are temporary (yellow), freely movable
    // ══════════════════════════════════════════════════════════════════════

    function placeTileOnBoard(rackIdx, row, col) {
        if (!gameActive) return false;
        if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return false;
        if (board[row][col] !== null) return false;
        if (rackIdx < 0 || rackIdx >= rack.length) return false;

        // Check if this rack tile is already placed somewhere
        const existing = placedTiles.findIndex(p => p.rackIdx === rackIdx);
        if (existing !== -1) {
            // Remove from old position first
            const old = placedTiles[existing];
            board[old.row][old.col] = null;
            placedTiles.splice(existing, 1);
        }

        const tile = rack[rackIdx];
        board[row][col] = {
            letter: tile.letter,
            score: tile.score,
            fixed: false,
            rackIdx: rackIdx,
            tileId: tile.id
        };
        placedTiles.push({ row, col, rackIdx });

        // Auto-check for valid new combinations
        autoCheckCombinations();

        onUpdate(getState());
        return true;
    }

    function removeTileFromBoard(row, col) {
        if (!gameActive) return false;
        const cell = board[row][col];
        if (!cell || cell.fixed) return false;

        const idx = placedTiles.findIndex(p => p.row === row && p.col === col);
        if (idx === -1) return false;

        placedTiles.splice(idx, 1);
        board[row][col] = null;

        onUpdate(getState());
        return true;
    }

    function clearPlacedTiles() {
        if (!gameActive) return;
        for (const p of [...placedTiles]) {
            board[p.row][p.col] = null;
        }
        placedTiles = [];
        onUpdate(getState());
    }

    // Move a placed tile from one board cell to another
    function movePlacedTile(fromRow, fromCol, toRow, toCol) {
        if (!gameActive) return false;
        if (toRow < 0 || toRow >= boardSize || toCol < 0 || toCol >= boardSize) return false;
        if (board[toRow][toCol] !== null) return false;

        const cell = board[fromRow][fromCol];
        if (!cell || cell.fixed) return false;

        const idx = placedTiles.findIndex(p => p.row === fromRow && p.col === fromCol);
        if (idx === -1) return false;

        // Move
        board[toRow][toCol] = cell;
        board[fromRow][fromCol] = null;
        placedTiles[idx].row = toRow;
        placedTiles[idx].col = toCol;

        // Auto-check
        autoCheckCombinations();

        onUpdate(getState());
        return true;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  AUTO-CHECK COMBINATIONS
    // ══════════════════════════════════════════════════════════════════════

    function autoCheckCombinations() {
        if (placedTiles.length === 0) return;

        // 1. Connectivity Check: All placed tiles must be part of the same connected component
        // on the board (allowing fixed tiles to act as bridges).
        const placedSet = new Set(placedTiles.map(p => `${p.row},${p.col}`));
        const visited = new Set();
        const start = placedTiles[0];
        const queue = [`${start.row},${start.col}`];
        visited.add(queue[0]);

        let foundPlacedCount = 0;
        let hasFixedConnection = false;
        let head = 0;

        while (head < queue.length) {
            const key = queue[head++];
            const [r, c] = key.split(',').map(Number);
            const cell = board[r][c];

            if (placedSet.has(key)) foundPlacedCount++;
            if (cell && cell.fixed) hasFixedConnection = true;

            const neighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
            for (const [nr, nc] of neighbors) {
                if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize) {
                    const neighborCell = board[nr][nc];
                    const nkey = `${nr},${nc}`;
                    if (neighborCell && !visited.has(nkey)) {
                        visited.add(nkey);
                        queue.push(nkey);
                    }
                }
            }
        }

        // All placed tiles must be connected in a single group
        if (foundPlacedCount !== placedTiles.length) return;

        // 2. All placed tiles must be part of at least one word (ensured by findFormedWords loop)
        // and form a single contiguous group (ensured by BFS above).
        // Isolated words are now allowed (no board-adjacency required).

        // Find all words formed
        const words = findFormedWords();
        if (words.length === 0) return;

        // All words must be valid
        for (const w of words) {
            if (!dictionary.has(w.word)) return; // invalid word, don't auto-score
        }

        // Build combination key to detect duplicates
        // A combination is identified by the set of words and their positions
        const comboKey = words.map(w => `${w.word}@${w.startR},${w.startC},${w.direction}`).sort().join('|');
        if (foundCombinations.has(comboKey)) return; // already scored

        // ── NEW VALID COMBINATION! Score it ──────────────────────────────
        foundCombinations.add(comboKey);

        const { totalScore, allUsed } = scoreWords(words);
        const combinationType = words.length === 1 ? 'Linear' : 'Junction';

        score += totalScore;
        combinationsFound++;

        const moveRecord = {
            words: words.map(w => w.word),
            totalScore,
            type: combinationType,
            allUsed,
            tilesUsed: placedTiles.length,
            comboKey
        };
        movesHistory.push(moveRecord);

        // Check puzzle completion
        checkPuzzleCompletion();

        onAutoScore(moveRecord);
    }

    function findFormedWords() {
        const wordsMap = new Map(); // Use map to avoid duplicate words (by start pos/direction)
        const placedSet = new Set(placedTiles.map(p => `${p.row},${p.col}`));

        for (const p of placedTiles) {
            // Check horizontal word passing through this tile
            const hWord = getWordAt(p.row, p.col, 'horizontal');
            if (hWord) {
                const key = `H:${hWord.startR},${hWord.startC}`;
                wordsMap.set(key, hWord);
            }
            // Check vertical word passing through this tile
            const vWord = getWordAt(p.row, p.col, 'vertical');
            if (vWord) {
                const key = `V:${vWord.startR},${vWord.startC}`;
                wordsMap.set(key, vWord);
            }
        }

        return Array.from(wordsMap.values());
    }

    function getWordAt(row, col, direction) {
        let startR = row, startC = col;

        if (direction === 'horizontal') {
            while (startC > 0 && board[row][startC - 1] !== null) startC--;
            let word = '', tiles = [], c = startC;
            while (c < boardSize && board[row][c] !== null) {
                word += board[row][c].letter;
                tiles.push({ row, col: c, cell: board[row][c] });
                c++;
            }
            if (word.length < 2) return null;
            return { word, tiles, direction, startR: row, startC };
        } else {
            while (startR > 0 && board[startR - 1][col] !== null) startR--;
            let word = '', tiles = [], r = startR;
            while (r < boardSize && board[r][col] !== null) {
                word += board[r][col].letter;
                tiles.push({ row: r, col, cell: board[r][col] });
                r++;
            }
            if (word.length < 2) return null;
            return { word, tiles, direction, startR, startC: col };
        }
    }

    function containsPlaced(wordInfo, placedSet) {
        return wordInfo.tiles.some(t => placedSet.has(`${t.row},${t.col}`));
    }

    // ── Scoring ─────────────────────────────────────────────────────────
    function scoreWords(words) {
        let totalScore = 0;
        const placedSet = new Set(placedTiles.map(p => `${p.row},${p.col}`));

        for (const w of words) {
            let wordScore = 0;
            let wordMultiplier = 1;

            for (const t of w.tiles) {
                let tileScore = t.cell.score;

                // Bonuses only apply from placed (yellow) tiles
                if (placedSet.has(`${t.row},${t.col}`)) {
                    const bonus = bonusBoard[t.row][t.col];
                    if (bonus) {
                        if (bonus.color === 'letter') tileScore *= bonus.mult;
                        else if (bonus.color === 'word' || bonus.color === 'star') {
                            wordMultiplier *= bonus.mult;
                        }
                    }
                }
                wordScore += tileScore;
            }

            // Length bonus
            wordScore += CombinationsSettings.getLengthBonus(w.word.length);

            // Word multiplier
            wordScore *= wordMultiplier;
            totalScore += wordScore;
        }

        // All-used bonus (all rack tiles placed)
        const allUsed = placedTiles.length === traySize;
        if (allUsed) {
            totalScore += CombinationsSettings.getAllUsedBonus(traySize);
        }

        return { totalScore, allUsed };
    }

    function checkPuzzleCompletion() {
        if (puzzleCompleted) return;

        const playerTop5 = movesHistory
            .map(m => m.totalScore)
            .sort((a, b) => b - a)
            .slice(0, 5);

        const playerTop5Sum = playerTop5.reduce((a, b) => a + b, 0);
        const targetSum = topFiveTarget.reduce((a, b) => a + b, 0);

        // Win condition: Total sum of all moves >= Target top 5 sum
        if (score >= targetSum) {
            puzzleCompleted = true;
            
            // Rating is based on Best 5 moves vs Target Best 5 moves
            const rating = Math.round((playerTop5Sum / targetSum) * 100);

            if (settings.mode === 'daily') {
                CombinationsSettings.saveMonthSeriesEntry(settings.dailyDate, rating);
            }

            onPuzzleComplete({ 
                points: rating, 
                playerTop5, 
                targetTop5: topFiveTarget, 
                targetSum, 
                playerTop5Sum,
                totalScore: score 
            });
        }
    }

    // ── Shuffle rack ────────────────────────────────────────────────────
    function shuffleRack() {
        if (!gameActive) return;
        // Only shuffle tiles NOT currently placed on board
        const placedIdxs = new Set(placedTiles.map(p => p.rackIdx));
        const freeIndices = [];
        for (let i = 0; i < rack.length; i++) {
            if (!placedIdxs.has(i)) freeIndices.push(i);
        }
        // Fisher-Yates on free indices
        for (let i = freeIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const a = freeIndices[i], b = freeIndices[j];
            [rack[a], rack[b]] = [rack[b], rack[a]];
        }
        onUpdate(getState());
    }

    // ── State getters ───────────────────────────────────────────────────
    function getState() {
        const placedRackIdxs = new Set(placedTiles.map(p => p.rackIdx));
        return {
            board: board.map(row => row.map(cell => cell ? { ...cell } : null)),
            bonusBoard: bonusBoard.map(row => row.map(cell => cell ? { ...cell } : null)),
            rack: rack.map((t, i) => ({ ...t, placedOnBoard: placedRackIdxs.has(i) })),
            placedTiles: placedTiles.map(p => ({ ...p })),
            score,
            combinationsFound,
            movesHistory: [...movesHistory],
            boardSize,
            traySize,
            gameActive,
            puzzleCompleted,
            topFiveTarget: [...topFiveTarget],
            mode: settings ? settings.mode : 'quick',
            dailyDate: settings ? settings.dailyDate : null,
        };
    }

    function isGameActive() { return gameActive; }

    return {
        init,
        placeTileOnBoard,
        removeTileFromBoard,
        clearPlacedTiles,
        movePlacedTile,
        shuffleRack,
        getState,
        isGameActive,
    };
})();

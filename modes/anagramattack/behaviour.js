// ─── Anagram Attack – Core Gameplay Behaviour ─────────────────────────
// Handles dictionary loading, tile management, word validation,
// scoring, countdown, drag-and-drop, keyboard input, and bonus spaces.

const AnagramGame = (() => {
  // ── State ────────────────────────────────────────────────────────────
  let dictionary = new Set();           // All valid words (uppercase)
  let distribution = [];                // { letter, weight, score }
  let weightPool = [];                  // Weighted pool for random draw

  let playingTray = [];                 // [{ id, letter, score }]
  let answerTray = [];                  // [{ id, letter, score } | null (bonus slot) | { bonus: true, type, mult }]
  let bonusSlots = [];                  // indices in answerTray that are bonus slots

  let score = 0;
  let wordsFound = 0;
  let bestWord = '';
  let bestWordScore = 0;
  let timerRemaining = 0;
  let timerInterval = null;
  let tileIdCounter = 0;
  let gameActive = false;
  let countdownActive = false;
  let dictionaryLoaded = false;         // True after dictionary loads OK

  let settings = null;                  // Copy of current settings
  let onUpdate = null;                  // Callback for UI refresh
  let onGameOver = null;               // Callback for game end
  let onCountdown = null;              // Callback for countdown tick
  let onWordAccepted = null;           // Callback when valid word
  let onWordRejected = null;           // Callback when invalid word
  let onBingo = null;                  // Callback for bingo
  let onLoadStatus = null;             // Callback(msg, isError) for loading status

  // SFX
  let sfxBest = null;
  let sfxAllUsed = null;
  let sfxTime = null;

  // ── Initialisation ───────────────────────────────────────────────────
  async function init(gameSettings, callbacks) {
    settings = gameSettings;
    onUpdate = callbacks.onUpdate || (() => { });
    onGameOver = callbacks.onGameOver || (() => { });
    onCountdown = callbacks.onCountdown || (() => { });
    onWordAccepted = callbacks.onWordAccepted || (() => { });
    onWordRejected = callbacks.onWordRejected || (() => { });
    onBingo = callbacks.onBingo || (() => { });
    onLoadStatus = callbacks.onLoadStatus || (() => { });

    // Load SFX
    sfxBest = new Audio('../../sfx/time.ogg');
    sfxAllUsed = new Audio('../../sfx/allused.wav');
    sfxTime = new Audio('../../sfx/time.ogg');

    // Reset state
    score = 0;
    wordsFound = 0;
    bestWord = '';
    bestWordScore = 0;
    tileIdCounter = 0;
    gameActive = false;
    dictionaryLoaded = false;
    answerTray = [];
    playingTray = [];
    bonusSlots = [];

    // Load dictionary & distribution
    onLoadStatus('Loading dictionary…', false);
    await loadDictionary(settings.dictionary);
    if (!dictionaryLoaded) {
      onLoadStatus(`⚠ Dictionary failed to load. Open the game via a local server (e.g. Live Server) instead of file://.`, true);
      return; // abort — don't start game with broken dictionary
    }
    onLoadStatus(`Dictionary ready (${dictionary.size.toLocaleString()} words)`, false);
    buildWeightPool();

    // Fill playing tray
    fillPlayingTray();

    // Ensure at least one valid word
    ensurePlayable();

    // Setup answer tray with bonus slots
    setupAnswerTray();

    onUpdate(getState());
  }

    // ── Dictionary loading ───────────────────────────────────────────────
    // Uses XMLHttpRequest (synchronous-style via Promise) which works on
    // both file:/// and http:// protocols, unlike fetch() which is blocked
    // by browsers on file:// for security reasons.
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
                    if (xhr.status === 200 || xhr.status === 0) {
                        // status 0 is normal for file:// with XHR
                        resolve(xhr.responseText);
                    } else {
                        reject(new Error(`XHR ${xhr.status} for ${url}`));
                    }
                };
                xhr.onerror = () => reject(new Error(`XHR network error for ${url}`));
                xhr.send();
            });
        }

        try {
            const [dictText, distText] = await Promise.all([
                xhrGet(dictPath),
                xhrGet(distPath)
            ]);

            // Parse words — dictionary.txt has one word per line, uppercase
            dictText.split(/\r?\n/).forEach(w => {
                const word = w.trim().toUpperCase();
                if (word.length >= 2 && /^[A-Z]+$/.test(word)) dictionary.add(word);
            });

            // Parse distribution CSV
            const lines = distText.split(/\r?\n/).slice(1);
            lines.forEach(line => {
                const parts = line.split(',');
                if (parts.length >= 3 && parts[0].trim() !== '*' && parts[0].trim() !== '') {
                    distribution.push({
                        letter: parts[0].trim().toUpperCase(),
                        weight: parseInt(parts[1]) || 1,
                        score:  parseInt(parts[2]) || 1
                    });
                }
            });

            console.log(`[AnagramGame] Dictionary loaded: ${dictionary.size} words, ${distribution.length} letters`);
            // Sanity check — 'AM' must be present in an English dictionary
            if (dictionary.size < 100) {
                throw new Error('Dictionary seems too small — likely a load error');
            }
            dictionaryLoaded = true;
        } catch (e) {
            console.error('[AnagramGame] Dictionary load failed:', e);
            dictionaryLoaded = false;
        }
    }

  function buildWeightPool() {
    weightPool = [];
    distribution.forEach(d => {
      for (let i = 0; i < d.weight; i++) {
        weightPool.push(d);
      }
    });
  }

  // ── Tile generation ──────────────────────────────────────────────────
  function randomTile() {
    const d = weightPool[Math.floor(Math.random() * weightPool.length)];
    return { id: tileIdCounter++, letter: d.letter, score: d.score };
  }

  function fillPlayingTray() {
    while (playingTray.length < settings.maxTray) {
      playingTray.push(randomTile());
    }
  }

  // ── Answer tray setup (with bonus slots) ─────────────────────────────
  function setupAnswerTray(keepBonuses = false) {
    answerTray = [];
    if (!keepBonuses) {
      bonusSlots = [];
    }

    // The answer tray has maxTray slots
    // If bonusSpaces enabled, place 1 to 2 random bonus slots randomly
    if (settings.bonusSpaces) {
      if (!keepBonuses) {
        const types = ['x2_word', 'x3_word', 'x2_letter', 'x3_letter'];
        const numBonuses = Math.floor(Math.random() * 2) + 1; // 1 or 2 slots

        const indices = [];
        while (indices.length < numBonuses && indices.length < settings.maxTray) {
          const idx = Math.floor(Math.random() * settings.maxTray);
          if (!indices.includes(idx)) indices.push(idx);
        }

        indices.forEach(idx => {
          const rndType = types[Math.floor(Math.random() * types.length)];
          bonusSlots.push({ index: idx, type: rndType });
        });
      }

      for (let i = 0; i < settings.maxTray; i++) {
        const bonus = bonusSlots.find(b => b.index === i);
        if (bonus) {
          answerTray.push({ bonus: true, type: bonus.type, occupied: null });
        } else {
          answerTray.push(null); // empty slot
        }
      }
    } else {
      for (let i = 0; i < settings.maxTray; i++) {
        answerTray.push(null);
      }
    }
  }

  // ── Playability check ────────────────────────────────────────────────
  function getPlayingLetters() {
    return playingTray.map(t => t.letter);
  }

  function canFormWord(letters) {
    // Check if any word in dictionary can be formed from available letters
    const available = {};
    letters.forEach(l => {
      available[l] = (available[l] || 0) + 1;
    });

    for (const word of dictionary) {
      if (word.length < 2 || word.length > letters.length) continue;
      const needed = {};
      let valid = true;
      for (const ch of word) {
        needed[ch] = (needed[ch] || 0) + 1;
        if (needed[ch] > (available[ch] || 0)) {
          valid = false;
          break;
        }
      }
      if (valid) return true;
    }
    return false;
  }

  // Returns all words formable from letters[], sorted shortest→longest.
  // Caps at maxResults to keep UI fast (dictionary has 100k+ words).
  function getPossibleWords(letters, maxResults = 30) {
    const available = {};
    letters.forEach(l => { available[l] = (available[l] || 0) + 1; });
    const results = [];
    for (const word of dictionary) {
      if (word.length < 2 || word.length > letters.length) continue;
      const needed = {};
      let valid = true;
      for (const ch of word) {
        needed[ch] = (needed[ch] || 0) + 1;
        if (needed[ch] > (available[ch] || 0)) { valid = false; break; }
      }
      if (valid) {
        results.push(word);
        if (results.length >= maxResults) break;
      }
    }
    // Sort: shortest first, then alphabetical
    results.sort((a, b) => a.length - b.length || a.localeCompare(b));
    return results;
  }

  function ensurePlayable() {
    let attempts = 0;
    while (!canFormWord(getPlayingLetters()) && attempts < 100) {
      playingTray = [];
      fillPlayingTray();
      attempts++;
    }
  }

  // ── Game flow ────────────────────────────────────────────────────────
  function startCountdown(onDone) {
    countdownActive = true;
    let count = 3;
    onCountdown(count);
    const iv = setInterval(() => {
      count--;
      onCountdown(count);
      if (count <= 0) {
        clearInterval(iv);
        countdownActive = false;
        onDone();
      }
    }, 1000);
  }

  function startGame() {
    startCountdown(() => {
      gameActive = true;
      timerRemaining = settings.timer;
      onUpdate(getState());
      startTimer();
    });
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      timerRemaining--;
      if (timerRemaining <= 10 && timerRemaining > 0) {
        // play time warning
        try { sfxTime.currentTime = 0; sfxTime.play(); } catch (_) { }
      }
      if (timerRemaining <= 0) {
        timerRemaining = 0;
        endGame();
      }
      onUpdate(getState());
    }, 1000);
  }

  function endGame() {
    gameActive = false;
    if (timerInterval) clearInterval(timerInterval);
    onGameOver(getFinalState());
  }

  // ── Input handling ───────────────────────────────────────────────────

  // Move a tile from playing tray to first empty answer slot
  function typeLetter(letter) {
    if (!gameActive) return false;
    letter = letter.toUpperCase();

    // Find tile in playing tray
    const idx = playingTray.findIndex(t => t.letter === letter);
    if (idx === -1) return false;

    // Find first empty answer slot
    const emptyIdx = answerTray.findIndex(slot => {
      if (slot === null) return true;
      if (slot && slot.bonus && !slot.occupied) return true;
      return false;
    });
    if (emptyIdx === -1) return false;

    const tile = playingTray.splice(idx, 1)[0];
    if (answerTray[emptyIdx] && answerTray[emptyIdx].bonus) {
      answerTray[emptyIdx].occupied = tile;
    } else {
      answerTray[emptyIdx] = tile;
    }

    onUpdate(getState());
    return true;
  }

  // Move a specific tile from playing tray to a specific answer slot
  function moveTileToAnswer(tileId, answerIdx) {
    if (!gameActive) return false;

    const pIdx = playingTray.findIndex(t => t.id === tileId);
    if (pIdx === -1) return false;

    // Check if target slot is available
    const slot = answerTray[answerIdx];
    if (slot !== null && !(slot && slot.bonus && !slot.occupied)) return false;

    const tile = playingTray.splice(pIdx, 1)[0];
    if (slot && slot.bonus) {
      answerTray[answerIdx] = { ...slot, occupied: tile };
    } else {
      answerTray[answerIdx] = tile;
    }

    onUpdate(getState());
    return true;
  }

  // Move a tile from answer tray back to playing tray
  function moveTileToPlaying(answerIdx) {
    if (!gameActive) return false;

    const slot = answerTray[answerIdx];
    if (!slot) return false;

    let tile;
    if (slot.bonus) {
      if (!slot.occupied) return false;
      tile = slot.occupied;
      answerTray[answerIdx] = { bonus: true, type: slot.type, occupied: null };
    } else {
      tile = slot;
      answerTray[answerIdx] = null;
    }

    playingTray.push(tile);
    onUpdate(getState());
    return true;
  }

  // Backspace – remove last letter from answer tray
  function backspace() {
    if (!gameActive) return false;

    // Find rightmost occupied answer slot
    for (let i = answerTray.length - 1; i >= 0; i--) {
      const slot = answerTray[i];
      if (slot && slot.bonus && slot.occupied) {
        playingTray.push(slot.occupied);
        answerTray[i] = { bonus: true, type: slot.type, occupied: null };
        onUpdate(getState());
        return true;
      } else if (slot && !slot.bonus) {
        playingTray.push(slot);
        answerTray[i] = null;
        onUpdate(getState());
        return true;
      }
    }
    return false;
  }

  // Clear entire answer tray back to playing
  function clearAnswer() {
    if (!gameActive) return;
    for (let i = answerTray.length - 1; i >= 0; i--) {
      moveTileToPlaying(i);
    }
  }

  // ── Shuffle playing tray ─────────────────────────────────────────────
  function shufflePlayingTray() {
    if (!gameActive) return;
    for (let i = playingTray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playingTray[i], playingTray[j]] = [playingTray[j], playingTray[i]];
    }
    onUpdate(getState());
  }

  // ── Submit word ──────────────────────────────────────────────────────
  function submitWord() {
    if (!gameActive) return false;

    // Collect word from answer tray
    const usedTiles = [];
    let word = '';
    for (let i = 0; i < answerTray.length; i++) {
      const slot = answerTray[i];
      if (slot && slot.bonus && slot.occupied) {
        word += slot.occupied.letter;
        usedTiles.push({ idx: i, tile: slot.occupied, bonusSlot: slot });
      } else if (slot && !slot.bonus) {
        word += slot.letter;
        usedTiles.push({ idx: i, tile: slot, bonusSlot: null });
      }
    }

    if (word.length < 2) {
      onWordRejected(word);
      return false;
    }

    if (!dictionary.has(word.toUpperCase())) {
      onWordRejected(word);
      return false;
    }

    // ── Calculate score ──────────────────────────────────────────────
    let wordScore = 0;
    let letterMultiplier = 1;
    let wordMultiplier = 1;

    usedTiles.forEach(({ tile, bonusSlot }) => {
      let tileScore = tile.score;

      // Apply bonus if on bonus slot
      if (bonusSlot) {
        const type = bonusSlot.type;
        if (type === 'x2_letter') tileScore *= 2;
        else if (type === 'x3_letter') tileScore *= 3;
        else if (type === 'x2_word') wordMultiplier = Math.max(wordMultiplier, 2);
        else if (type === 'x3_word') wordMultiplier = Math.max(wordMultiplier, 3);
      }

      wordScore += tileScore;
    });

    wordScore *= wordMultiplier;

    // Length bonus
    const lb = AnagramSettings.getLengthBonus(word.length);
    wordScore += lb;

    // Check bingo (all tiles used)
    const allUsed = usedTiles.length === settings.maxTray;
    if (allUsed && settings.bingo) {
      const bingoBonus = AnagramSettings.getBingoBonus();
      wordScore += bingoBonus;
      onBingo(bingoBonus);
      try { sfxAllUsed.currentTime = 0; sfxAllUsed.play(); } catch (_) { }
    }

    score += wordScore;
    wordsFound++;

    // Track best word
    if (wordScore > bestWordScore) {
      bestWord = word;
      bestWordScore = wordScore;
      try { sfxBest.currentTime = 0; sfxBest.play(); } catch (_) { }
    }

    onWordAccepted(word, wordScore, lb, allUsed);

    // ── Replace used tiles ───────────────────────────────────────────
    answerTray = [];  // reset answer tray
    // Keep only tiles that were NOT used (still in playing tray)

    fillPlayingTray();
    ensurePlayable(); // reshuffle if necessary
    
    // Check if we keep bonuses or randomise them again
    setupAnswerTray(settings.bonusSpacePosition === 'fixed_round');

    onUpdate(getState());
    return true;
  }

  // ── State getters ────────────────────────────────────────────────────
    function getState() {
        const letters = playingTray.map(t => t.letter);
        return {
            playingTray: [...playingTray],
            answerTray: answerTray.map(slot => {
                if (!slot) return null;
                if (slot.bonus) return { bonus: true, type: slot.type, occupied: slot.occupied ? { ...slot.occupied } : null };
                return { ...slot };
            }),
            score,
            wordsFound,
            bestWord,
            bestWordScore,
            timerRemaining,
            gameActive,
            countdownActive,
            maxTray: settings ? settings.maxTray : 7,
            possibleWordsView: settings ? settings.possibleWordsView : 'short_list',
            possibleWords: gameActive ? getPossibleWords(letters) : [],
        };
    }

  function getFinalState() {
    return {
      ...getState(),
      finalScore: score,
    };
  }

  function isGameActive() {
    return gameActive;
  }

  // ── Drag & drop helpers ──────────────────────────────────────────────
  function getFirstEmptyAnswerSlot() {
    return answerTray.findIndex(slot => {
      if (slot === null) return true;
      if (slot && slot.bonus && !slot.occupied) return true;
      return false;
    });
  }

    return {
        init,
        startGame,
        typeLetter,
        moveTileToAnswer,
        moveTileToPlaying,
        backspace,
        clearAnswer,
        shufflePlayingTray,
        submitWord,
        getState,
        getFinalState,
        isGameActive,
        getFirstEmptyAnswerSlot,
        getPossibleWords,
    };
})();

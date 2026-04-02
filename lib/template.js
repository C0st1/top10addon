// ============================================================
// XSS-safe HTML Template for Configuration Page
// Fixes SEC-01: All dynamic content properly escaped via DOM API
// ============================================================

const { escapeHtml, escapeJs } = require('./utils');

/**
 * Build the configuration page HTML.
 * All user-facing dynamic content is rendered via safe DOM APIs
 * (createElement, textContent) instead of innerHTML.
 *
 * @param {string[]} countries
 * @returns {string}
 */
function buildConfigHTML(countries) {
    const safeCountries = JSON.stringify(countries);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Netflix Top 10 — Stremio Addon</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root { --red: #e50914; --bg: #0a0a0a; --surface: #111111; --surface2: #1a1a1a; --border: #2a2a2a; --text: #f0f0f0; --muted: #777; --success: #2ecc71; --warning: #f39c12; }
        html { scroll-behavior: smooth; }
        body { font-family: 'DM Sans', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; gap: 24px; }
        .card { width: 100%; max-width: 480px; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; box-shadow: 0 32px 80px rgba(0,0,0,0.6); position: relative; z-index:1; }
        .card-header { background: linear-gradient(135deg, #1a0000 0%, #1a0505 50%, #0a0a0a 100%); padding: 36px 36px 28px; border-bottom: 1px solid var(--border); }
        .card-header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 1px; }
        .card-header p { font-size: 13px; color: var(--muted); margin-top: 6px; }
        .logo-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
        .logo-n { font-family: 'Bebas Neue', sans-serif; font-size: 38px; color: var(--red); line-height: 1; letter-spacing: -1px; }
        .logo-badge { background: var(--red); color: #fff; font-size: 10px; font-weight: 600; padding: 4px 8px; border-radius: 4px; text-transform: uppercase; }
        .week-badge { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; padding: 4px 10px; border-radius: 6px; font-size: 11px; transition: 0.3s; color: #2ecc71; background: rgba(46, 204, 113, 0.1); border: 1px solid rgba(46, 204, 113, 0.3); }
        .card-body { padding: 28px 36px 36px; }
        .field { margin-bottom: 20px; position: relative; }
        .field label { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
        .field label .required-dot { width: 5px; height: 5px; background: var(--red); border-radius: 50%; }
        .field label .optional-tag { font-size: 10px; background: var(--surface2); border: 1px solid var(--border); padding: 1px 6px; border-radius: 3px; }
        input[type="text"], input[type="password"] { width: 100%; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 12px 14px; outline: none; transition: 0.2s; }
        input[type="text"]:focus, input[type="password"]:focus { border-color: var(--red); box-shadow: 0 0 0 3px rgba(229,9,20,0.15); }
        .toggle-field { display: flex; align-items: center; gap: 10px; margin: 15px 0 20px; cursor: pointer; }
        .toggle-field label { font-size: 13px; cursor: pointer; font-weight: 500;}
        input[type="checkbox"] { appearance: none; background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: 0.2s; }
        input[type="checkbox"]:checked { background: var(--red); border-color: var(--red); }
        input[type="checkbox"]:checked::after { content: '\\2714'; font-size: 12px; color: white; }
        .hint { font-size: 11.5px; color: var(--muted); margin-top: 6px; line-height: 1.4; }
        .hint a { color: #6699cc; text-decoration: none; }
        .multi-countries { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
        .country-tag { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(30,30,30,0.9); border: 1px solid #333; border-radius: 8px; font-size: 13px; color: #e0e0e0; cursor: grab; transition: border-color 0.2s, background 0.2s, transform 0.15s; }
        .country-tag:active { cursor: grabbing; transform: scale(0.98); }
        .country-tag.dragging { opacity: 0.5; background: #333; border-style: dashed; }
        .country-drag-handle { color: var(--muted); margin-right: 12px; user-select: none; font-size: 16px; cursor: grab; }
        .remove-tag { color: #888; font-size: 16px; cursor: pointer; padding: 2px 6px; transition: 0.2s; }
        .remove-tag:hover { color: var(--red); }
        .custom-select { position: relative; }
        .dropdown-list { display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--surface2); border: 1px solid var(--red); border-top: none; border-radius: 0 0 8px 8px; max-height: 200px; overflow-y: auto; z-index: 10; margin-top: -8px; padding-top: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        .dropdown-list.open { display: block; animation: openDrop 0.2s ease forwards; }
        .drop-item { padding: 10px 14px; font-size: 13px; cursor: pointer; border-bottom: 1px solid #222; transition: 0.15s; }
        .drop-item:hover { background: rgba(229,9,20,0.1); color: #fff; }
        .drop-item.selected { opacity: 0.5; cursor: not-allowed; }
        @keyframes openDrop { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
        .btn { display: block; width: 100%; padding: 14px; border: none; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; transition: 0.18s; }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-primary { background: var(--red); color: #fff; }
        .btn-primary:hover:not(:disabled) { background: #f40612; box-shadow: 0 6px 20px rgba(229,9,20,0.35); }
        .btn-secondary { background: var(--surface2); color: var(--text); border: 1px solid var(--border); margin-top: 10px; }
        .btn-sm { display: inline-block; width: auto; padding: 8px 18px; font-size: 12px; font-weight: 500; margin-top: 6px; background: rgba(255,255,255,0.1); color: #ccc; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; }
        .btn-sm:hover { background: rgba(255,255,255,0.2); color: #fff; border-color: rgba(255,255,255,0.3); }
        .key-status { display: inline-flex; font-size: 12px; margin-left: 8px; }
        .key-status.valid { color: var(--success); } .key-status.invalid { color: var(--red); }
        #resultArea { display: none; margin-top: 24px; animation: popIn 0.3s ease; }
        .url-box { display: flex; align-items: center; gap: 8px; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; }
        .url-box-text { flex: 1; font-family: monospace; font-size: 11px; color: #5dade2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .copy-btn { font-size: 11px; background: transparent; border: 1px solid #555; color: #fff; padding: 4px 10px; border-radius: 4px; cursor: pointer; transition: 0.2s;}
        .copy-btn.copied { background: rgba(46, 204, 113, 0.2); border-color: var(--success); color: var(--success); transform: scale(1.05); }
        .toast { display: none; align-items: center; gap: 8px; background: rgba(46, 204, 113, 0.1); border: 1px solid rgba(46, 204, 113, 0.3); border-radius: 6px; padding: 10px 14px; font-size: 13px; color: var(--success); margin-bottom: 15px; }
        .toast.show { display: flex; animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
        @keyframes popIn { 0% { opacity: 0; transform: translateY(-10px) scale(0.95); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
        .input-with-icon { position: relative; display: flex; align-items: center; }
        .input-with-icon input { padding-right: 48px; }
        .toggle-pwd { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); background: transparent; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #888; transition: 0.2s; outline: none; }
        .toggle-pwd:hover { color: #fff; transform: translateY(-50%) scale(1.1); }
        .field-row { display: flex; flex-direction: column; gap: 0; }
        .tooltip-container { position: relative; display: inline-block; margin-left: 6px; }
        .tooltip-icon { background: rgba(255,255,255,0.1); color: #aaa; border-radius: 50%; width: 15px; height: 15px; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; cursor: help; text-decoration: none; transition: 0.2s; }
        .tooltip-container:hover .tooltip-icon { background: rgba(255,255,255,0.2); color: #fff; }
        a.tooltip-icon { cursor: pointer; }
        a.tooltip-icon:hover { background: var(--red); color: #fff; transform: scale(1.15); box-shadow: 0 0 10px rgba(229,9,20,0.4); }
        .tooltip-content { visibility: hidden; opacity: 0; position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(100% + 8px); background: #222; color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 12px; white-space: nowrap; z-index: 100; font-weight: normal; text-transform: none; line-height: 1.4; box-shadow: 0 4px 12px rgba(0,0,0,0.5); transition: 0.15s; pointer-events: none; border: 1px solid #333; }
        .tooltip-content a { color: #5c9eff; text-decoration: none; pointer-events: auto; font-weight: bold; }
        .tooltip-content a:hover { text-decoration: underline; }
        .tooltip-container:hover .tooltip-content { visibility: visible; opacity: 1; pointer-events: auto; }
        details.advanced-settings { margin-top: 10px; border: 1px solid var(--border); border-radius: 6px; background: rgba(0,0,0,0.1); }
        details.advanced-settings summary { padding: 12px 16px; cursor: pointer; user-select: none; font-weight: 500; outline: none; font-size: 14px; }
        details.advanced-settings summary:hover { background: rgba(255,255,255,0.05); }
        .advanced-settings-content { padding: 16px; border-top: 1px solid var(--border); }
        .btn-group { display: flex; gap: 12px; margin-top: 24px; }
        .btn-danger { background: transparent; border: 1px solid #aaa; color: #aaa; }
        .btn-danger:hover { background: rgba(255, 255, 255, 0.1); color: #eee; }
        .footer { text-align: center; margin-top: 24px; font-size: 13px; color: #666; width: 100%; max-width: 900px; }
        .footer a { color: #888; text-decoration: none; }
        .footer a:hover { color: #fff; text-decoration: underline; }
        .loading-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 999; align-items: center; justify-content: center; }
        .loading-overlay.active { display: flex; }
        .loading-spinner { width: 40px; height: 40px; border: 3px solid #333; border-top-color: var(--red); border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (min-width: 800px) {
            .card { max-width: 900px; display: flex; flex-direction: row; }
            .card-header { width: 360px; flex-shrink: 0; border-bottom: none; border-right: 1px solid var(--border); padding: 48px; display: flex; flex-direction: column; justify-content: center; }
            .card-body { flex: 1; min-width: 0; padding: 48px; }
            .field-row { flex-direction: row; gap: 20px; margin-bottom: 20px; }
            .field-row .field { flex: 1; margin-bottom: 0; }
        }
    </style>
</head>
<body>
<div class="loading-overlay" id="loadingOverlay"><div class="loading-spinner"></div></div>
<div class="card">
    <div class="card-header">
        <div class="logo-row"><span class="logo-n">N</span><span class="logo-badge">Stremio Addon</span></div>
        <h1>Netflix Top 10</h1>
        <p>Dynamic unmerged catalogs per country with correct Stremio metadata matching.</p>
        <div class="week-badge"><span>Status: <strong>Live Data (Today)</strong></span></div>
    </div>
    <div class="card-body">
        <div class="field">
            <label><span class="required-dot"></span> Country <span class="optional-tag">Reorderable Catalogs</span>
                <div class="tooltip-container">
                    <span class="tooltip-icon">?</span>
                    <div class="tooltip-content">Click or search to select. Drag tags to re-order Stremio catalogs.</div>
                </div>
            </label>
            <div class="custom-select">
                <input type="text" id="countrySearch" placeholder="Search a country to add..." autocomplete="off">
                <div class="dropdown-list" id="countryDropdown"></div>
            </div>
            <div class="multi-countries" id="selectedCountries"></div>
        </div>
        <div class="field">
            <label><span class="required-dot"></span> TMDB API Key
                <div class="tooltip-container">
                    <a href="https://www.themoviedb.org/settings/api" target="_blank" class="tooltip-icon">?</a>
                    <div class="tooltip-content">Required for metadata.<br>Get yours free at <b style="color:#5c9eff;">themoviedb.org</b></div>
                </div>
            </label>
            <div class="input-with-icon">
                <input type="password" id="tmdbKey" placeholder="e.g. 8a7f3bc2d1...">
                <button class="toggle-pwd" id="toggleTmdbPwd" title="Show/Hide">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                </button>
            </div>
            <div style="margin-top:6px;"><button class="btn btn-sm" id="testKeyBtn">Test Key</button> <span id="keyStatus" class="key-status"></span></div>
        </div>
        <details class="advanced-settings">
            <summary>Advanced Settings</summary>
            <div class="advanced-settings-content">
                <div class="field">
                    <label>RPDB API Key <span class="optional-tag">optional</span>
                        <div class="tooltip-container">
                            <a href="https://ratingposterdb.com/" target="_blank" class="tooltip-icon">?</a>
                            <div class="tooltip-content">Adds Netflix-style rating overlays to posters.<br>Get yours at <b style="color:#5c9eff;">ratingposterdb.com</b></div>
                        </div>
                    </label>
                    <div class="input-with-icon">
                        <input type="password" id="rpdbKey" placeholder="e.g. t1-xxxxxx...">
                        <button class="toggle-pwd" id="toggleRpdbPwd" title="Show/Hide">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        </button>
                    </div>
                    <div style="margin-top:6px;"><button class="btn btn-sm" id="testRpdbBtn">Test Format</button> <span id="rpdbStatus" class="key-status"></span></div>
                </div>
                <div class="field" style="margin-bottom: 0;">
                    <label>Catalog Tab Overrides <span class="optional-tag">optional</span>
                        <div class="tooltip-container">
                            <span class="tooltip-icon">?</span>
                            <div class="tooltip-content">Isolate Netflix content into customizable Discover tabs.</div>
                        </div>
                    </label>
                    <div class="field-row" style="margin-bottom:0; gap:10px;">
                        <input type="text" id="movieOverride" placeholder="Movie Tab Name (e.g. Films)">
                        <input type="text" id="seriesOverride" placeholder="Series Tab Name (e.g. TV Shows)">
                    </div>
                </div>
            </div>
        </details>
        <div class="btn-group">
            <button class="btn btn-primary" id="generateBtn" style="flex: 2;">Generate Install Link</button>
            <button class="btn btn-danger" id="resetBtn" style="flex: 1;" title="Clear Configuration">Clear</button>
        </div>
        <div id="resultArea">
            <p style="font-size:12px;color:#999;">Manifest URL (credentials secured server-side):</p>
            <div class="url-box"><span class="url-box-text" id="manifestDisplayUrl"></span><button class="copy-btn" id="copyBtn">Copy</button></div>
            <div class="toast" id="copyToast">Copied to clipboard!</div>
            <button class="btn btn-secondary" id="installBtn">Install to Stremio</button>
        </div>
    </div>
</div>
<div class="footer">
    Netflix Top 10 Stremio Addon &nbsp;&bull;&nbsp; <a href="https://github.com/C0st1/top10addon" target="_blank">View on GitHub</a>
</div>
<script>
(function() {
    'use strict';

    // ============================================================
    // SEC-01 FIX: All DOM manipulation uses safe APIs
    // No innerHTML with user-controlled data
    // ============================================================

    var availableCountries = ${safeCountries};
    var selectedCountriesList = [];
    var currentManifestUrl = "";
    var searchInput = document.getElementById('countrySearch');
    var dropdown = document.getElementById('countryDropdown');
    var selectedContainer = document.getElementById('selectedCountries');

    function escapeAttr(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function renderDropdown(filter) {
        dropdown.innerHTML = '';
        var lowerFilter = (filter || '').toLowerCase();
        var matches = 0;
        availableCountries.forEach(function(c) {
            if (c.toLowerCase().indexOf(lowerFilter) !== -1) {
                matches++;
                var isSelected = selectedCountriesList.indexOf(c) !== -1;
                var item = document.createElement('div');
                item.className = 'drop-item' + (isSelected ? ' selected' : '');
                item.textContent = c; // Safe: textContent
                item.setAttribute('data-country', c);
                item.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (!isSelected) {
                        addCountry(c);
                        searchInput.value = '';
                        dropdown.classList.remove('open');
                    }
                });
                dropdown.appendChild(item);
            }
        });
        if (matches === 0) {
            var noResults = document.createElement('div');
            noResults.className = 'drop-item';
            noResults.style.pointerEvents = 'none';
            noResults.style.color = '#555';
            noResults.textContent = 'No countries found';
            dropdown.appendChild(noResults);
        }
    }

    searchInput.addEventListener('focus', function() {
        dropdown.classList.add('open');
        renderDropdown(searchInput.value);
    });
    searchInput.addEventListener('input', function(e) {
        renderDropdown(e.target.value);
    });
    document.addEventListener('click', function(e) {
        if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.remove('open');
        }
    });

    function addCountry(c) {
        if (selectedCountriesList.indexOf(c) === -1) {
            selectedCountriesList.push(c);
            renderTags();
            saveState();
        }
    }

    function removeCountry(c) {
        selectedCountriesList = selectedCountriesList.filter(function(x) { return x !== c; });
        renderTags();
        saveState();
        renderDropdown(searchInput.value);
    }

    // Drag and Drop — SEC-01 FIX: safe DOM manipulation
    var dragSrcEl = null;

    function handleDragStart(e) {
        dragSrcEl = this;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.getAttribute('data-country'));
        var self = this;
        setTimeout(function() { self.classList.add('dragging'); }, 0);
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        return false;
    }

    function handleDragEnter() { this.style.borderColor = '#e50914'; }
    function handleDragLeave() { this.style.borderColor = '#333'; }

    function handleDrop(e) {
        e.stopPropagation();
        this.style.borderColor = '#333';
        if (dragSrcEl !== this) {
            var dragCountry = dragSrcEl.getAttribute('data-country');
            var dropCountry = this.getAttribute('data-country');
            var fromIdx = selectedCountriesList.indexOf(dragCountry);
            var toIdx = selectedCountriesList.indexOf(dropCountry);
            if (fromIdx !== -1 && toIdx !== -1) {
                selectedCountriesList.splice(fromIdx, 1);
                selectedCountriesList.splice(toIdx, 0, dragCountry);
                renderTags();
                saveState();
            }
        }
        return false;
    }

    function handleDragEnd() {
        this.classList.remove('dragging');
        var tags = document.querySelectorAll('.country-tag');
        for (var i = 0; i < tags.length; i++) {
            tags[i].style.borderColor = '#333';
        }
    }

    function renderTags() {
        selectedContainer.innerHTML = '';
        selectedCountriesList.forEach(function(c) {
            var pill = document.createElement('div');
            pill.className = 'country-tag';
            pill.draggable = true;
            pill.setAttribute('data-country', c);

            // SEC-01 FIX: Use textContent instead of innerHTML for country name
            var leftDiv = document.createElement('div');
            leftDiv.style.display = 'flex';
            leftDiv.style.alignItems = 'center';

            var handle = document.createElement('span');
            handle.className = 'country-drag-handle';
            handle.textContent = '\\u2630'; // ☰
            leftDiv.appendChild(handle);

            var nameSpan = document.createElement('span');
            nameSpan.textContent = c; // Safe: textContent, no XSS possible
            leftDiv.appendChild(nameSpan);

            var removeBtn = document.createElement('span');
            removeBtn.className = 'remove-tag';
            removeBtn.textContent = '\\u00D7'; // ×
            removeBtn.addEventListener('click', function() { removeCountry(c); });

            pill.appendChild(leftDiv);
            pill.appendChild(removeBtn);

            pill.addEventListener('dragstart', handleDragStart);
            pill.addEventListener('dragenter', handleDragEnter);
            pill.addEventListener('dragover', handleDragOver);
            pill.addEventListener('dragleave', handleDragLeave);
            pill.addEventListener('drop', handleDrop);
            pill.addEventListener('dragend', handleDragEnd);

            selectedContainer.appendChild(pill);
        });
    }

    function saveState() {
        try {
            var state = {
                tmdbKey: document.getElementById('tmdbKey').value,
                rpdbKey: document.getElementById('rpdbKey').value,
                movieOverride: document.getElementById('movieOverride').value,
                seriesOverride: document.getElementById('seriesOverride').value,
                countries: selectedCountriesList
            };
            localStorage.setItem('nf_top10_config', JSON.stringify(state));
        } catch (e) {
            console.warn('Failed to save state:', e);
        }
    }

    function restoreState() {
        var s = {};
        try {
            var stored = localStorage.getItem('nf_top10_config');
            if (stored) {
                s = JSON.parse(stored);
            }
        } catch (e) {
            console.warn('Failed to restore state from localStorage:', e);
        }

        try {
            if (s.tmdbKey) document.getElementById('tmdbKey').value = s.tmdbKey;
            if (s.rpdbKey) document.getElementById('rpdbKey').value = s.rpdbKey;
            if (s.movieOverride) document.getElementById('movieOverride').value = s.movieOverride;
            if (s.seriesOverride) document.getElementById('seriesOverride').value = s.seriesOverride;
            if (s.countries && s.countries.length > 0) {
                s.countries.forEach(function(c) { addCountry(c); });
            } else {
                addCountry('Global');
            }
        } catch (e) {
            console.warn('Failed to apply restored state:', e);
            addCountry('Global');
        }
    }

    // Toggle password visibility
    function setupPwdToggle(btnId, inputId) {
        var btn = document.getElementById(btnId);
        var input = document.getElementById(inputId);
        if (!btn || !input) return;
        var eyeOpen = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
        var eyeClosed = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
        btn.addEventListener('click', function() {
            if (input.type === 'password') {
                input.type = 'text';
                btn.innerHTML = eyeClosed;
            } else {
                input.type = 'password';
                btn.innerHTML = eyeOpen;
            }
        });
    }

    // Test TMDB key
    async function testTmdbKey() {
        var key = document.getElementById('tmdbKey').value.trim();
        var stat = document.getElementById('keyStatus');
        if (!key) {
            stat.textContent = 'Key is empty';
            stat.className = 'key-status invalid';
            return;
        }
        stat.textContent = 'Testing...';
        stat.className = 'key-status';
        try {
            var r = await fetch('/api/validate-tmdb-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: key })
            });
            var d = await r.json();
            stat.textContent = d.valid ? 'Valid key' : 'Invalid key';
            stat.className = 'key-status ' + (d.valid ? 'valid' : 'invalid');
        } catch (e) {
            stat.textContent = 'Error testing key';
            stat.className = 'key-status invalid';
        }
    }

    // Test RPDB key format
    function testRpdbKey() {
        var key = document.getElementById('rpdbKey').value.trim();
        var stat = document.getElementById('rpdbStatus');
        if (!key) {
            stat.textContent = 'Key is empty';
            stat.className = 'key-status invalid';
            return;
        }
        if (key.length >= 8 && /^[a-zA-Z0-9\\-]+$/.test(key)) {
            stat.textContent = 'Format looks good';
            stat.className = 'key-status valid';
        } else {
            stat.textContent = 'Double check format';
            stat.className = 'key-status invalid';
        }
    }

    // Generate link — SEC-02 FIX: POST to server, get opaque token
    async function generateLink() {
        saveState();
        var tmdbKey = document.getElementById('tmdbKey').value.trim();
        var rpdbKey = document.getElementById('rpdbKey').value.trim();
        if (!tmdbKey) return;

        var loading = document.getElementById('loadingOverlay');
        loading.classList.add('active');

        try {
            var config = {
                tmdbApiKey: tmdbKey,
                country: selectedCountriesList.join(',')
            };
            if (rpdbKey) config.rpdbApiKey = rpdbKey;
            var mo = document.getElementById('movieOverride').value.trim();
            var so = document.getElementById('seriesOverride').value.trim();
            if (mo) config.movieType = mo;
            if (so) config.seriesType = so;

            var r = await fetch('/api/save-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            var d = await r.json();
            if (d.manifestUrl) {
                currentManifestUrl = d.manifestUrl;
                document.getElementById('manifestDisplayUrl').textContent = currentManifestUrl;
                document.getElementById('resultArea').style.display = 'block';
            } else {
                alert('Failed to generate install link. Please try again.');
            }
        } catch (e) {
            alert('Error: ' + e.message);
        } finally {
            loading.classList.remove('active');
        }
    }

    function copyLink() {
        if (!currentManifestUrl) return;
        navigator.clipboard.writeText(currentManifestUrl).then(function() {
            var btn = document.getElementById('copyBtn');
            var toast = document.getElementById('copyToast');
            btn.textContent = 'Copied';
            btn.classList.add('copied');
            toast.classList.add('show');
            setTimeout(function() {
                btn.textContent = 'Copy';
                btn.classList.remove('copied');
                toast.classList.remove('show');
            }, 2500);
        });
    }

    function installDirectly() {
        if (!currentManifestUrl) return;
        window.location.href = currentManifestUrl.replace(/^https?:\\/\\//, 'stremio://');
    }

    function resetForm() {
        if (!confirm('Are you sure you want to completely wipe your configuration?')) return;
        document.getElementById('tmdbKey').value = '';
        document.getElementById('rpdbKey').value = '';
        document.getElementById('movieOverride').value = '';
        document.getElementById('seriesOverride').value = '';
        document.getElementById('keyStatus').textContent = '';
        document.getElementById('rpdbStatus').textContent = '';
        document.getElementById('resultArea').style.display = 'none';
        localStorage.removeItem('nf_top10_config');
        selectedCountriesList = [];
        addCountry('Global');
        searchInput.value = '';
        renderDropdown('');
    }

    // Wire up event listeners (no inline onclick — better practice)
    document.getElementById('testKeyBtn').addEventListener('click', testTmdbKey);
    document.getElementById('testRpdbBtn').addEventListener('click', testRpdbKey);
    document.getElementById('generateBtn').addEventListener('click', generateLink);
    document.getElementById('resetBtn').addEventListener('click', resetForm);
    document.getElementById('copyBtn').addEventListener('click', copyLink);
    document.getElementById('installBtn').addEventListener('click', installDirectly);
    setupPwdToggle('toggleTmdbPwd', 'tmdbKey');
    setupPwdToggle('toggleRpdbPwd', 'rpdbKey');

    // Initialize
    restoreState();
})();
</script>
</body>
</html>`;
}

module.exports = { buildConfigHTML };

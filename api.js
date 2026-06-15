// VieraStudy API Client v13
// ALL data comes from Cloudflare Workers - NO localStorage for data
// Token stored in sessionStorage for persistence across page refreshes

const API_URL = 'https://vierastudy-api.ayhamissa416.workers.dev';

let _cache = {
    flashcards: [],
    todos: [],
    notes: [],
    classes: [],
    events: [],
    tasks: [],
    pomodoroStats: {},
    pomodoroSessions: [],
    pomodoroSettings: {},
    activityLog: [],
    settings: {
        darkMode: false,
        accentColor: '#3b82f6',
        fontSize: 16
    }
};

let _cacheLoaded = false;
let _isDirty = false;
let _saveTimeout = null;
let _maxSaveTimeout = null;
let _lastSyncTime = null;
let _readyResolve;
let _readyPromise = new Promise(resolve => { _readyResolve = resolve; });

const SYNC_DEBOUNCE = 2000;
const SYNC_MAX_DELAY = 8000;

function _emit(name) {
    window.dispatchEvent(new Event(name));
}

class VieraStudyAPI {
    constructor() {
        this.token = sessionStorage.getItem('vierastudy_token');
        this.user = JSON.parse(sessionStorage.getItem('vierastudy_user') || 'null');
    }

    get ready() { return _readyPromise; }

    // ── AUTH ──────────────────────────────────────────────────────────────────

    async register(email, password, firstName, lastName) {
        try {
            const res = await fetch(`${API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, firstName, lastName })
            });
            const data = await res.json();
            if (data.success && data.token) {
                this._setSession(data.token, data.user);
            }
            return data;
        } catch (e) {
            return { error: 'Network error. Please try again.' };
        }
    }

    async login(email, password) {
        try {
            const res = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (data.success && data.token) {
                this._setSession(data.token, data.user);
                await this.loadData();
            }
            return data;
        } catch (e) {
            return { error: 'Network error. Please try again.' };
        }
    }

    async logout() {
        try {
            if (this.token) {
                await this._saveDataNow();
                await fetch(`${API_URL}/logout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` }
                });
            }
        } catch (e) {}
        this._clearSession();
    }

    _setSession(token, user) {
        this.token = token;
        this.user = user;
        sessionStorage.setItem('vierastudy_token', token);
        sessionStorage.setItem('vierastudy_user', JSON.stringify(user));
        _cacheLoaded = false;
    }

    _clearSession() {
        this.token = null;
        this.user = null;
        sessionStorage.removeItem('vierastudy_token');
        sessionStorage.removeItem('vierastudy_user');
        _cache = {
            flashcards: [], todos: [], notes: [], classes: [], events: [],
            tasks: [], pomodoroStats: {}, pomodoroSessions: [], pomodoroSettings: {},
            activityLog: [], settings: { darkMode: false, accentColor: '#3b82f6', fontSize: 16 }
        };
        _cacheLoaded = false;
        _isDirty = false;
    }

    // Skip verifySession on cold start — loadData directly for 1 round-trip instead of 2
    async verifySession() {
        if (!this.token) return null;
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch(`${API_URL}/verify`, {
                headers: { 'Authorization': `Bearer ${this.token}` },
                signal: ctrl.signal
            });
            clearTimeout(t);
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) { this._clearSession(); return null; }
                return this.user || null;
            }
            const data = await res.json();
            if (data.success && data.user) {
                this.user = data.user;
                sessionStorage.setItem('vierastudy_user', JSON.stringify(data.user));
                return data.user;
            }
            return null;
        } catch (e) {
            return this.user || null;
        }
    }

    isLoggedIn() { return !!this.token; }
    getUser() { return this.user; }

    // ── DATA ──────────────────────────────────────────────────────────────────

    async loadData() {
        if (!this.token) return null;
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 8000);
            const res = await fetch(`${API_URL}/data`, {
                headers: { 'Authorization': `Bearer ${this.token}` },
                signal: ctrl.signal
            });
            clearTimeout(t);
            if (!res.ok) return null;
            const data = await res.json();
            _cache = {
                flashcards: data.flashcards || [],
                todos: data.todos || [],
                notes: data.notes || [],
                classes: data.classes || [],
                events: data.events || [],
                tasks: data.tasks || [],
                pomodoroStats: data.pomodoroStats || {},
                pomodoroSessions: data.pomodoroSessions || [],
                pomodoroSettings: data.pomodoroSettings || {},
                activityLog: data.activityLog || [],
                settings: Object.assign(
                    { darkMode: false, accentColor: '#3b82f6', fontSize: 16 },
                    data.settings || {}
                )
            };
            _cacheLoaded = true;
            _isDirty = false;
            _lastSyncTime = new Date().toISOString();

            // Apply persisted settings
            const s = _cache.settings;
            if (s.darkMode) {
                document.body.classList.add('dark-mode');
                localStorage.setItem('studyDeckDarkMode', 'true');
            } else {
                document.body.classList.remove('dark-mode');
                localStorage.setItem('studyDeckDarkMode', 'false');
            }
            if (s.accentColor) {
                document.documentElement.style.setProperty('--accent', s.accentColor);
                localStorage.setItem('vieraAccent', s.accentColor);
            }
            if (s.fontSize) {
                document.documentElement.style.setProperty('--font-size-base', s.fontSize + 'px');
                localStorage.setItem('vieraFontSize', s.fontSize);
            }
            return _cache;
        } catch (e) {
            return null;
        }
    }

    async _saveDataNow() {
        if (!this.token || !_isDirty) return { success: true };
        clearTimeout(_saveTimeout); _saveTimeout = null;
        clearTimeout(_maxSaveTimeout); _maxSaveTimeout = null;
        _emit('viera:saving');
        try {
            const res = await fetch(`${API_URL}/data`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                body: JSON.stringify(_cache)
            });
            const result = await res.json();
            _isDirty = false;
            _lastSyncTime = new Date().toISOString();
            _emit('viera:saved');
            return result;
        } catch (e) {
            _emit('viera:error');
            return { error: 'Network error' };
        }
    }

    scheduleSave() {
        if (!this.token) return;
        _isDirty = true;
        clearTimeout(_saveTimeout);
        _saveTimeout = setTimeout(() => {
            this._saveDataNow();
            clearTimeout(_maxSaveTimeout); _maxSaveTimeout = null;
        }, SYNC_DEBOUNCE);
        if (!_maxSaveTimeout) {
            _maxSaveTimeout = setTimeout(() => {
                clearTimeout(_saveTimeout); _saveTimeout = null;
                this._saveDataNow();
                _maxSaveTimeout = null;
            }, SYNC_MAX_DELAY);
        }
    }

    getSyncTime() { return _lastSyncTime; }
    async syncToCloud() { return this._saveDataNow(); }
    async syncFromCloud() { return this.loadData(); }
    async saveData() { this.scheduleSave(); return { success: true }; }

    // ── EXPORT ────────────────────────────────────────────────────────────────

    exportData() {
        const blob = new Blob([JSON.stringify(_cache, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vierastudy-export.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── GETTERS ───────────────────────────────────────────────────────────────

    getFlashcards() { return _cache.flashcards; }
    getTodos() { return _cache.todos; }
    getNotes() { return _cache.notes; }
    getClasses() { return _cache.classes; }
    getEvents() { return _cache.events; }
    getTasks() { return _cache.tasks; }
    getPomodoroStats() { return _cache.pomodoroStats; }
    getPomodoroSessions() { return _cache.pomodoroSessions; }
    getPomodoroSettings() { return _cache.pomodoroSettings; }
    getActivityLog() { return _cache.activityLog; }
    getSettings() { return _cache.settings; }

    // ── SETTERS ───────────────────────────────────────────────────────────────

    setFlashcards(d) { _cache.flashcards = d; this.scheduleSave(); }
    setTodos(d) { _cache.todos = d; this.scheduleSave(); }
    setNotes(d) { _cache.notes = d; this.scheduleSave(); }
    setClasses(d) { _cache.classes = d; this.scheduleSave(); }
    setEvents(d) { _cache.events = d; this.scheduleSave(); }
    setTasks(d) { _cache.tasks = d; this.scheduleSave(); }
    setPomodoroStats(d) { _cache.pomodoroStats = d; this.scheduleSave(); }
    setPomodoroSessions(d) { _cache.pomodoroSessions = d; this.scheduleSave(); }
    setPomodoroSettings(d) { _cache.pomodoroSettings = d; this.scheduleSave(); }
    setActivityLog(d) { _cache.activityLog = d; this.scheduleSave(); }
    setSettings(d) { _cache.settings = d; this.scheduleSave(); }

    // ── CONVENIENCE ───────────────────────────────────────────────────────────

    addFlashcardDeck(deck) { _cache.flashcards.push(deck); this.scheduleSave(); }
    updateFlashcardDeck(id, deck) {
        const i = _cache.flashcards.findIndex(d => d.id === id);
        if (i !== -1) { _cache.flashcards[i] = { ..._cache.flashcards[i], ...deck }; this.scheduleSave(); }
    }
    deleteFlashcardDeck(id) { _cache.flashcards = _cache.flashcards.filter(d => d.id !== id); this.scheduleSave(); }

    addTodo(t) { _cache.todos.push(t); this.scheduleSave(); }
    updateTodo(id, t) {
        const i = _cache.todos.findIndex(x => x.id === id);
        if (i !== -1) { _cache.todos[i] = { ..._cache.todos[i], ...t }; this.scheduleSave(); }
    }
    deleteTodo(id) { _cache.todos = _cache.todos.filter(t => t.id !== id); this.scheduleSave(); }

    addNote(n) { _cache.notes.push(n); this.scheduleSave(); }
    updateNote(id, n) {
        const i = _cache.notes.findIndex(x => x.id === id);
        if (i !== -1) { _cache.notes[i] = { ..._cache.notes[i], ...n }; this.scheduleSave(); }
    }
    deleteNote(id) { _cache.notes = _cache.notes.filter(n => n.id !== id); this.scheduleSave(); }

    addClass(c) { _cache.classes.push(c); this.scheduleSave(); }
    updateClass(id, c) {
        const i = _cache.classes.findIndex(x => x.id === id);
        if (i !== -1) { _cache.classes[i] = { ..._cache.classes[i], ...c }; this.scheduleSave(); }
    }
    deleteClass(id) { _cache.classes = _cache.classes.filter(c => c.id !== id); this.scheduleSave(); }

    addEvent(e) { _cache.events.push(e); this.scheduleSave(); }
    updateEvent(id, e) {
        const i = _cache.events.findIndex(x => x.id === id);
        if (i !== -1) { _cache.events[i] = { ..._cache.events[i], ...e }; this.scheduleSave(); }
    }
    deleteEvent(id) { _cache.events = _cache.events.filter(e => e.id !== id); this.scheduleSave(); }

    addTask(t) { _cache.tasks.push(t); this.scheduleSave(); }
    updateTask(id, t) {
        const i = _cache.tasks.findIndex(x => x.id === id);
        if (i !== -1) { _cache.tasks[i] = { ..._cache.tasks[i], ...t }; this.scheduleSave(); }
    }
    deleteTask(id) { _cache.tasks = _cache.tasks.filter(t => t.id !== id); this.scheduleSave(); }

    logActivity(icon, color, message) {
        _cache.activityLog.unshift({ id: Date.now(), icon, color, message, timestamp: new Date().toISOString() });
        if (_cache.activityLog.length > 50) _cache.activityLog = _cache.activityLog.slice(0, 50);
        this.scheduleSave();
    }

    setDarkMode(enabled) {
        _cache.settings.darkMode = enabled;
        localStorage.setItem('studyDeckDarkMode', enabled ? 'true' : 'false');
        document.body.classList.toggle('dark-mode', enabled);
        this.scheduleSave();
    }

    setAccentColor(color) {
        _cache.settings.accentColor = color;
        document.documentElement.style.setProperty('--accent', color);
        localStorage.setItem('vieraAccent', color);
        this.scheduleSave();
    }

    setFontSize(px) {
        _cache.settings.fontSize = px;
        document.documentElement.style.setProperty('--font-size-base', px + 'px');
        localStorage.setItem('vieraFontSize', px);
        this.scheduleSave();
    }

    isDarkMode() { return _cache.settings.darkMode; }
}

window.vieraAPI = new VieraStudyAPI();

window.syncData = function() {
    if (window.vieraAPI?.isLoggedIn()) { _isDirty = true; window.vieraAPI._saveDataNow(); }
};

function saveViaBeacon() {
    if (window.vieraAPI?.isLoggedIn() && _isDirty) {
        const token = sessionStorage.getItem('vierastudy_token');
        if (token && navigator.sendBeacon) {
            navigator.sendBeacon(`${API_URL}/data?token=${token}`, new Blob([JSON.stringify(_cache)], { type: 'application/json' }));
            _isDirty = false;
            return true;
        }
    }
    return false;
}

window.addEventListener('beforeunload', saveViaBeacon);
window.addEventListener('pagehide', saveViaBeacon);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveViaBeacon(); });
document.addEventListener('click', e => {
    const link = e.target.closest('a[href]');
    if (link && _isDirty) {
        const href = link.getAttribute('href');
        if (href && !href.startsWith('http') && !href.startsWith('//') && !href.startsWith('mailto:')) saveViaBeacon();
    }
});

// Cold-start optimization: loadData directly (includes implicit session check via 401 response)
(async function initializeSession() {
    if (window.vieraAPI.token) {
        try {
            const data = await window.vieraAPI.loadData();
            if (data) {
                // Refresh user info in background without blocking ready
                window.vieraAPI.verifySession();
                _readyResolve(true);
            } else {
                // Token may be invalid — verify to confirm
                const user = await window.vieraAPI.verifySession();
                _readyResolve(!!user);
            }
        } catch (e) {
            _readyResolve(false);
        }
    } else {
        _readyResolve(false);
    }
})();

console.log('VieraStudy API v13 loaded');

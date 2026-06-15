// VieraStudy API Client v14 - Supabase backend
const SUPABASE_URL = 'https://zagvfumqcnejxneuqcqp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_GBj_QfNq2jGCzSvO-mjfTA_oV4m6blG';

let _supabase = null;
let _cache = {
    flashcards: [], todos: [], notes: [], classes: [], events: [],
    tasks: [], pomodoroStats: {}, pomodoroSessions: [], pomodoroSettings: {},
    activityLog: [], settings: { darkMode: false, accentColor: '#3b82f6', fontSize: 16 }
};
let _isDirty = false;
let _saveTimeout = null;
let _maxSaveTimeout = null;
let _lastSyncTime = null;
let _readyResolve;
let _readyPromise = new Promise(r => { _readyResolve = r; });

const SYNC_DEBOUNCE = 2000;
const SYNC_MAX_DELAY = 8000;

function _emit(name) { window.dispatchEvent(new Event(name)); }

function _loadSDK() {
    return new Promise((resolve, reject) => {
        if (window.supabase) return resolve();
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

function _normalizeUser(sbUser) {
    if (!sbUser) return null;
    const m = sbUser.user_metadata || {};
    return {
        id: sbUser.id,
        email: sbUser.email,
        firstName: m.firstName || m.first_name || sbUser.email.split('@')[0],
        lastName: m.lastName || m.last_name || '',
        isPremium: m.isPremium || false
    };
}

class VieraStudyAPI {
    constructor() { this.user = null; }

    get ready() { return _readyPromise; }

    // ── AUTH ──────────────────────────────────────────────────────────────────

    async register(email, password, firstName, lastName) {
        await _readyPromise;
        if (!_supabase) return { error: 'Service unavailable. Please refresh the page.' };
        try {
            const { data, error } = await _supabase.auth.signUp({
                email, password,
                options: { data: { firstName, lastName } }
            });
            if (error) return { error: error.message };
            if (data.user) {
                this.user = _normalizeUser(data.user);
                await this._initUserData();
            }
            return { success: true, user: this.user };
        } catch (e) {
            return { error: 'Network error. Please try again.' };
        }
    }

    async login(email, password) {
        await _readyPromise;
        if (!_supabase) return { error: 'Service unavailable. Please refresh the page.' };
        try {
            const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
            if (error) return { error: error.message };
            this.user = _normalizeUser(data.user);
            await this.loadData();
            return { success: true, user: this.user };
        } catch (e) {
            console.error('[VieraStudy] Login error:', e);
            return { error: 'Network error. Please try again.' };
        }
    }

    async logout() {
        await this._saveDataNow();
        await _supabase.auth.signOut();
        this.user = null;
        this._resetCache();
    }

    async verifySession() {
        const { data } = await _supabase.auth.getSession();
        if (!data.session) return null;
        this.user = _normalizeUser(data.session.user);
        return this.user;
    }

    isLoggedIn() { return !!this.user; }
    getUser() { return this.user; }

    async updateProfile(firstName, lastName) {
        const { error } = await _supabase.auth.updateUser({ data: { firstName, lastName } });
        if (error) return { error: error.message };
        if (this.user) { this.user.firstName = firstName; this.user.lastName = lastName; }
        return { success: true };
    }

    async changePassword(newPassword) {
        const { error } = await _supabase.auth.updateUser({ password: newPassword });
        if (error) return { error: error.message };
        return { success: true };
    }

    async deleteAccount() {
        await this._clearUserData();
        await _supabase.auth.signOut();
        this.user = null;
        this._resetCache();
        return { success: true };
    }

    async requestPasswordReset(email) {
        const { error } = await _supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/reset-password.html'
        });
        if (error) return { error: error.message };
        return { success: true };
    }

    // ── DATA ──────────────────────────────────────────────────────────────────

    async _initUserData() {
        const { data } = await _supabase.auth.getUser();
        if (!data.user) return;
        await _supabase.from('user_data').upsert(
            { id: data.user.id, data: _cache },
            { onConflict: 'id', ignoreDuplicates: true }
        );
    }

    async loadData() {
        const { data: session } = await _supabase.auth.getSession();
        if (!session.session) return null;
        const { data, error } = await _supabase
            .from('user_data').select('data').eq('id', session.session.user.id).single();
        if (error || !data) return null;

        const d = data.data || {};
        _cache = {
            flashcards: d.flashcards || [],
            todos: d.todos || [],
            notes: d.notes || [],
            classes: d.classes || [],
            events: d.events || [],
            tasks: d.tasks || [],
            pomodoroStats: d.pomodoroStats || {},
            pomodoroSessions: d.pomodoroSessions || [],
            pomodoroSettings: d.pomodoroSettings || {},
            activityLog: d.activityLog || [],
            settings: Object.assign({ darkMode: false, accentColor: '#3b82f6', fontSize: 16 }, d.settings || {})
        };
        _isDirty = false;
        _lastSyncTime = new Date().toISOString();

        const s = _cache.settings;
        document.body.classList.toggle('dark-mode', !!s.darkMode);
        localStorage.setItem('studyDeckDarkMode', s.darkMode ? 'true' : 'false');
        if (s.accentColor) {
            document.documentElement.style.setProperty('--accent', s.accentColor);
            localStorage.setItem('vieraAccent', s.accentColor);
        }
        if (s.fontSize) {
            document.documentElement.style.setProperty('--font-size-base', s.fontSize + 'px');
            localStorage.setItem('vieraFontSize', s.fontSize);
        }
        return _cache;
    }

    async _saveDataNow() {
        if (!_isDirty) return { success: true };
        clearTimeout(_saveTimeout); _saveTimeout = null;
        clearTimeout(_maxSaveTimeout); _maxSaveTimeout = null;
        _emit('viera:saving');
        const { data: session } = await _supabase.auth.getSession();
        if (!session.session) return { error: 'Not logged in' };
        const { error } = await _supabase.from('user_data').upsert(
            { id: session.session.user.id, data: _cache, updated_at: new Date().toISOString() },
            { onConflict: 'id' }
        );
        if (error) { _emit('viera:error'); return { error: error.message }; }
        _isDirty = false;
        _lastSyncTime = new Date().toISOString();
        _emit('viera:saved');
        return { success: true };
    }

    async _clearUserData() {
        const { data: session } = await _supabase.auth.getSession();
        if (!session.session) return;
        this._resetCache();
        await _supabase.from('user_data').upsert(
            { id: session.session.user.id, data: _cache },
            { onConflict: 'id' }
        );
    }

    _resetCache() {
        _cache = {
            flashcards: [], todos: [], notes: [], classes: [], events: [],
            tasks: [], pomodoroStats: {}, pomodoroSessions: [], pomodoroSettings: {},
            activityLog: [], settings: { darkMode: false, accentColor: '#3b82f6', fontSize: 16 }
        };
        _isDirty = false;
    }

    scheduleSave() {
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

    exportData() {
        const blob = new Blob([JSON.stringify(_cache, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'vierastudy-export.json'; a.click();
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

    addFlashcardDeck(d) { _cache.flashcards.push(d); this.scheduleSave(); }
    updateFlashcardDeck(id, d) {
        const i = _cache.flashcards.findIndex(x => x.id === id);
        if (i !== -1) { _cache.flashcards[i] = { ..._cache.flashcards[i], ...d }; this.scheduleSave(); }
    }
    deleteFlashcardDeck(id) { _cache.flashcards = _cache.flashcards.filter(x => x.id !== id); this.scheduleSave(); }

    addTodo(t) { _cache.todos.push(t); this.scheduleSave(); }
    updateTodo(id, t) {
        const i = _cache.todos.findIndex(x => x.id === id);
        if (i !== -1) { _cache.todos[i] = { ..._cache.todos[i], ...t }; this.scheduleSave(); }
    }
    deleteTodo(id) { _cache.todos = _cache.todos.filter(x => x.id !== id); this.scheduleSave(); }

    addNote(n) { _cache.notes.push(n); this.scheduleSave(); }
    updateNote(id, n) {
        const i = _cache.notes.findIndex(x => x.id === id);
        if (i !== -1) { _cache.notes[i] = { ..._cache.notes[i], ...n }; this.scheduleSave(); }
    }
    deleteNote(id) { _cache.notes = _cache.notes.filter(x => x.id !== id); this.scheduleSave(); }

    addClass(c) { _cache.classes.push(c); this.scheduleSave(); }
    updateClass(id, c) {
        const i = _cache.classes.findIndex(x => x.id === id);
        if (i !== -1) { _cache.classes[i] = { ..._cache.classes[i], ...c }; this.scheduleSave(); }
    }
    deleteClass(id) { _cache.classes = _cache.classes.filter(x => x.id !== id); this.scheduleSave(); }

    addEvent(e) { _cache.events.push(e); this.scheduleSave(); }
    updateEvent(id, e) {
        const i = _cache.events.findIndex(x => x.id === id);
        if (i !== -1) { _cache.events[i] = { ..._cache.events[i], ...e }; this.scheduleSave(); }
    }
    deleteEvent(id) { _cache.events = _cache.events.filter(x => x.id !== id); this.scheduleSave(); }

    addTask(t) { _cache.tasks.push(t); this.scheduleSave(); }
    updateTask(id, t) {
        const i = _cache.tasks.findIndex(x => x.id === id);
        if (i !== -1) { _cache.tasks[i] = { ..._cache.tasks[i], ...t }; this.scheduleSave(); }
    }
    deleteTask(id) { _cache.tasks = _cache.tasks.filter(x => x.id !== id); this.scheduleSave(); }

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

    isDarkMode() { return !!_cache.settings.darkMode; }
}

window.vieraAPI = new VieraStudyAPI();

window.syncData = function () {
    if (window.vieraAPI?.isLoggedIn()) { _isDirty = true; window.vieraAPI._saveDataNow(); }
};

function saveBeacon() {
    if (_isDirty && window.vieraAPI?.isLoggedIn()) window.vieraAPI._saveDataNow();
}
window.addEventListener('beforeunload', saveBeacon);
window.addEventListener('pagehide', saveBeacon);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveBeacon(); });

// Boot: load Supabase SDK then restore session
(async function boot() {
    try {
        await _loadSDK();
        _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        const { data } = await _supabase.auth.getSession();
        if (data.session) {
            window.vieraAPI.user = _normalizeUser(data.session.user);
            await window.vieraAPI.loadData();
            _supabase.auth.onAuthStateChange((_event, session) => {
                window.vieraAPI.user = session ? _normalizeUser(session.user) : null;
            });
        }
        _readyResolve(!!data.session);
    } catch (e) {
        console.error('[VieraStudy] Boot error:', e);
        _readyResolve(false);
    }
})();

console.log('VieraStudy API v14 (Supabase) loaded');

// VieraStudy API Client v12 - Clean API-only version
// ALL data comes from Cloudflare Workers - NO localStorage for data
// Token stored in sessionStorage for persistence across page refreshes

const API_URL = 'https://vierastudy-api.ayhamissa416.workers.dev';

// In-memory cache for current session data (loaded from cloud)
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
    settings: { darkMode: false }
};

let _cacheLoaded = false;
let _isDirty = false;
let _saveTimeout = null;
let _maxSaveTimeout = null;
let _readyResolve;
let _readyPromise = new Promise(resolve => { _readyResolve = resolve; });

// Sync timing
const SYNC_DEBOUNCE = 2000;
const SYNC_MAX_DELAY = 8000;

class VieraStudyAPI {
    constructor() {
        // Token and user stored in sessionStorage (survives page refresh, clears on browser close)
        this.token = sessionStorage.getItem('vierastudy_token');
        this.user = JSON.parse(sessionStorage.getItem('vierastudy_user') || 'null');
        console.log('[VieraStudy] Init - logged in:', !!this.token, 'user:', this.user?.firstName);
    }

    get ready() {
        return _readyPromise;
    }

    // ============ AUTHENTICATION ============

    async register(email, password, firstName, lastName) {
        try {
            const response = await fetch(`${API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, firstName, lastName })
            });
            const data = await response.json();
            
            if (data.success && data.token) {
                this.token = data.token;
                this.user = data.user;
                sessionStorage.setItem('vierastudy_token', data.token);
                sessionStorage.setItem('vierastudy_user', JSON.stringify(data.user));
                _cacheLoaded = false;
                console.log('[VieraStudy] Registered:', data.user.firstName);
            }
            return data;
        } catch (error) {
            console.error('Register error:', error);
            return { error: 'Network error. Please try again.' };
        }
    }

    async login(email, password) {
        try {
            const response = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await response.json();
            
            if (data.success && data.token) {
                this.token = data.token;
                this.user = data.user;
                sessionStorage.setItem('vierastudy_token', data.token);
                sessionStorage.setItem('vierastudy_user', JSON.stringify(data.user));
                _cacheLoaded = false;
                console.log('[VieraStudy] Logged in:', data.user.firstName);
                
                // Load data from cloud
                await this.loadData();
            }
            return data;
        } catch (error) {
            console.error('Login error:', error);
            return { error: 'Network error. Please try again.' };
        }
    }

    async logout() {
        try {
            if (this.token) {
                await this._saveDataNow();
                await fetch(`${API_URL}/logout`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.token}`
                    }
                });
            }
        } catch (error) {
            console.error('Logout error:', error);
        }
        
        this._clearSession();
    }

    _clearSession() {
        this.token = null;
        this.user = null;
        sessionStorage.removeItem('vierastudy_token');
        sessionStorage.removeItem('vierastudy_user');
        _cache = {
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
            settings: { darkMode: false }
        };
        _cacheLoaded = false;
        _isDirty = false;
    }

    async verifySession() {
        if (!this.token) return null;
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(`${API_URL}/verify`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${this.token}` },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    console.log('[VieraStudy] Token rejected');
                    this._clearSession();
                    return null;
                }
                // Server error - use cached user if available
                if (this.user) {
                    console.log('[VieraStudy] Server error, using cached user');
                    return this.user;
                }
                return null;
            }
            
            const data = await response.json();
            if (data.success && data.user) {
                this.user = data.user;
                sessionStorage.setItem('vierastudy_user', JSON.stringify(data.user));
                
                if (!_cacheLoaded) {
                    await this.loadData();
                }
                return data.user;
            }
            return null;
        } catch (error) {
            console.error('Verify error:', error);
            // Network error - use cached user if available
            if (this.user) {
                console.log('[VieraStudy] Network error, using cached user');
                return this.user;
            }
            return null;
        }
    }

    isLoggedIn() {
        return !!this.token;
    }

    getUser() {
        return this.user;
    }

    // ============ DATA OPERATIONS ============

    async loadData() {
        if (!this.token) return null;
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            
            const response = await fetch(`${API_URL}/data`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${this.token}` },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                console.error('[VieraStudy] Failed to load data:', response.status);
                return null;
            }
            
            const data = await response.json();
            
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
                settings: data.settings || { darkMode: false }
            };
            _cacheLoaded = true;
            _isDirty = false;
            
            // Apply dark mode and sync to localStorage for instant loading on next visit
            if (_cache.settings.darkMode) {
                document.body.classList.add('dark-mode');
                localStorage.setItem('studyDeckDarkMode', 'true');
            } else {
                document.body.classList.remove('dark-mode');
                localStorage.setItem('studyDeckDarkMode', 'false');
            }
            
            console.log('[VieraStudy] Data loaded from cloud');
            return _cache;
        } catch (error) {
            console.error('Load data error:', error);
            if (error.name === 'AbortError') {
                console.log('[VieraStudy] Data load timed out');
            }
            return null;
        }
    }

    async _saveDataNow() {
        if (!this.token || !_isDirty) return { success: true };
        
        if (_saveTimeout) {
            clearTimeout(_saveTimeout);
            _saveTimeout = null;
        }
        if (_maxSaveTimeout) {
            clearTimeout(_maxSaveTimeout);
            _maxSaveTimeout = null;
        }
        
        try {
            const response = await fetch(`${API_URL}/data`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(_cache)
            });
            const result = await response.json();
            _isDirty = false;
            console.log('[VieraStudy] Data saved to cloud');
            return result;
        } catch (error) {
            console.error('Save data error:', error);
            return { error: 'Network error' };
        }
    }

    async saveData() {
        this.scheduleSave();
        return { success: true };
    }

    scheduleSave() {
        if (!this.token) return;
        
        _isDirty = true;
        
        if (_saveTimeout) {
            clearTimeout(_saveTimeout);
        }
        
        _saveTimeout = setTimeout(() => {
            this._saveDataNow();
            if (_maxSaveTimeout) {
                clearTimeout(_maxSaveTimeout);
                _maxSaveTimeout = null;
            }
        }, SYNC_DEBOUNCE);
        
        if (!_maxSaveTimeout) {
            _maxSaveTimeout = setTimeout(() => {
                if (_saveTimeout) {
                    clearTimeout(_saveTimeout);
                    _saveTimeout = null;
                }
                this._saveDataNow();
                _maxSaveTimeout = null;
            }, SYNC_MAX_DELAY);
        }
    }

    // Backward compatibility
    async syncToCloud() { return await this._saveDataNow(); }
    async syncFromCloud() { return await this.loadData(); }

    // ============ DATA GETTERS ============

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

    // ============ DATA SETTERS ============

    setFlashcards(data) { _cache.flashcards = data; this.scheduleSave(); }
    setTodos(data) { _cache.todos = data; this.scheduleSave(); }
    setNotes(data) { _cache.notes = data; this.scheduleSave(); }
    setClasses(data) { _cache.classes = data; this.scheduleSave(); }
    setEvents(data) { _cache.events = data; this.scheduleSave(); }
    setTasks(data) { _cache.tasks = data; this.scheduleSave(); }
    setPomodoroStats(data) { _cache.pomodoroStats = data; this.scheduleSave(); }
    setPomodoroSessions(data) { _cache.pomodoroSessions = data; this.scheduleSave(); }
    setPomodoroSettings(data) { _cache.pomodoroSettings = data; this.scheduleSave(); }
    setActivityLog(data) { _cache.activityLog = data; this.scheduleSave(); }
    setSettings(data) { _cache.settings = data; this.scheduleSave(); }

    // ============ CONVENIENCE METHODS ============

    addFlashcardDeck(deck) {
        _cache.flashcards.push(deck);
        this.scheduleSave();
    }

    updateFlashcardDeck(id, deck) {
        const index = _cache.flashcards.findIndex(d => d.id === id);
        if (index !== -1) {
            _cache.flashcards[index] = { ..._cache.flashcards[index], ...deck };
            this.scheduleSave();
        }
    }

    deleteFlashcardDeck(id) {
        _cache.flashcards = _cache.flashcards.filter(d => d.id !== id);
        this.scheduleSave();
    }

    addTodo(todo) {
        _cache.todos.push(todo);
        this.scheduleSave();
    }

    updateTodo(id, todo) {
        const index = _cache.todos.findIndex(t => t.id === id);
        if (index !== -1) {
            _cache.todos[index] = { ..._cache.todos[index], ...todo };
            this.scheduleSave();
        }
    }

    deleteTodo(id) {
        _cache.todos = _cache.todos.filter(t => t.id !== id);
        this.scheduleSave();
    }

    addNote(note) {
        _cache.notes.push(note);
        this.scheduleSave();
    }

    updateNote(id, note) {
        const index = _cache.notes.findIndex(n => n.id === id);
        if (index !== -1) {
            _cache.notes[index] = { ..._cache.notes[index], ...note };
            this.scheduleSave();
        }
    }

    deleteNote(id) {
        _cache.notes = _cache.notes.filter(n => n.id !== id);
        this.scheduleSave();
    }

    addClass(classItem) {
        _cache.classes.push(classItem);
        this.scheduleSave();
    }

    updateClass(id, classItem) {
        const index = _cache.classes.findIndex(c => c.id === id);
        if (index !== -1) {
            _cache.classes[index] = { ..._cache.classes[index], ...classItem };
            this.scheduleSave();
        }
    }

    deleteClass(id) {
        _cache.classes = _cache.classes.filter(c => c.id !== id);
        this.scheduleSave();
    }

    addEvent(event) {
        _cache.events.push(event);
        this.scheduleSave();
    }

    deleteEvent(id) {
        _cache.events = _cache.events.filter(e => e.id !== id);
        this.scheduleSave();
    }

    addTask(task) {
        _cache.tasks.push(task);
        this.scheduleSave();
    }

    updateTask(id, task) {
        const index = _cache.tasks.findIndex(t => t.id === id);
        if (index !== -1) {
            _cache.tasks[index] = { ..._cache.tasks[index], ...task };
            this.scheduleSave();
        }
    }

    deleteTask(id) {
        _cache.tasks = _cache.tasks.filter(t => t.id !== id);
        this.scheduleSave();
    }

    logActivity(icon, color, message) {
        _cache.activityLog.unshift({
            id: Date.now(),
            icon,
            color,
            message,
            timestamp: new Date().toISOString()
        });
        if (_cache.activityLog.length > 50) {
            _cache.activityLog = _cache.activityLog.slice(0, 50);
        }
        this.scheduleSave();
    }

    setDarkMode(enabled) {
        _cache.settings.darkMode = enabled;
        // Sync to localStorage for instant loading on next visit
        localStorage.setItem('studyDeckDarkMode', enabled ? 'true' : 'false');
        if (enabled) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
        this.scheduleSave();
    }

    isDarkMode() {
        return _cache.settings.darkMode;
    }
}

// Create global instance
window.vieraAPI = new VieraStudyAPI();

// Global sync function for backward compatibility
window.syncData = function() {
    if (window.vieraAPI && window.vieraAPI.isLoggedIn()) {
        _isDirty = true;
        window.vieraAPI._saveDataNow();
    }
};

// Save via sendBeacon for page unload
function saveViaBeacon() {
    if (window.vieraAPI?.isLoggedIn() && _isDirty) {
        const token = sessionStorage.getItem('vierastudy_token');
        if (token && navigator.sendBeacon) {
            const blob = new Blob([JSON.stringify(_cache)], { type: 'application/json' });
            navigator.sendBeacon(`${API_URL}/data?token=${token}`, blob);
            _isDirty = false;
            return true;
        }
    }
    return false;
}

// Save before page unload
window.addEventListener('beforeunload', saveViaBeacon);
window.addEventListener('pagehide', saveViaBeacon);

// Save when visibility changes (tab switch, minimize)
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
        saveViaBeacon();
    }
});

// Save when clicking internal links
document.addEventListener('click', function(e) {
    const link = e.target.closest('a[href]');
    if (link && _isDirty) {
        const href = link.getAttribute('href');
        if (href && !href.startsWith('http') && !href.startsWith('//') && !href.startsWith('mailto:')) {
            saveViaBeacon();
        }
    }
});

// Auto-initialize on load
(async function initializeSession() {
    if (window.vieraAPI && window.vieraAPI.token) {
        try {
            const user = await window.vieraAPI.verifySession();
            if (user) {
                console.log('[VieraStudy] Session verified');
                _readyResolve(true);
            } else {
                console.log('[VieraStudy] Session invalid');
                _readyResolve(false);
            }
        } catch (error) {
            console.error('[VieraStudy] Session check failed:', error);
            _readyResolve(false);
        }
    } else {
        _readyResolve(false);
    }
})();

console.log('VieraStudy API v12 loaded (API-only, no localStorage)');

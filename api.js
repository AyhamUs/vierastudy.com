// VieraStudy API Client - Cloud Only Storage
// All data stored in Cloudflare Workers KV, only auth token stored locally

const API_URL = 'https://vierastudy-api.ayhamissa416.workers.dev';

// In-memory cache for current session
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
let _saveTimeout = null;
let _readyResolve;
let _readyPromise = new Promise(resolve => { _readyResolve = resolve; });

class VieraStudyAPI {
    constructor() {
        this.token = localStorage.getItem('vierastudy_token');
        this.user = JSON.parse(localStorage.getItem('vierastudy_user') || 'null');
    }

    // Promise that resolves when data is ready
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
                localStorage.setItem('vierastudy_token', data.token);
                localStorage.setItem('vierastudy_user', JSON.stringify(data.user));
                _cacheLoaded = false;
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
                localStorage.setItem('vierastudy_token', data.token);
                localStorage.setItem('vierastudy_user', JSON.stringify(data.user));
                _cacheLoaded = false;
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
                // Save any pending changes first
                await this.saveData();
                
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
        
        // Clear everything
        this.token = null;
        this.user = null;
        localStorage.removeItem('vierastudy_token');
        localStorage.removeItem('vierastudy_user');
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
    }

    async verifySession() {
        if (!this.token) return null;
        
        try {
            const response = await fetch(`${API_URL}/verify`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            
            if (!response.ok) {
                this.token = null;
                this.user = null;
                localStorage.removeItem('vierastudy_token');
                localStorage.removeItem('vierastudy_user');
                return null;
            }
            
            const data = await response.json();
            if (data.success && data.user) {
                this.user = data.user;
                localStorage.setItem('vierastudy_user', JSON.stringify(data.user));
                // Load data from cloud
                if (!_cacheLoaded) {
                    await this.loadData();
                }
                return data.user;
            }
            return null;
        } catch (error) {
            console.error('Verify error:', error);
            return null;
        }
    }

    isLoggedIn() {
        return !!this.token;
    }

    getUser() {
        return this.user;
    }

    // Backward compatibility aliases
    async syncToCloud() { return await this.saveData(); }
    async syncFromCloud() { return await this.loadData(); }

    // ============ DATA OPERATIONS ============

    async loadData() {
        if (!this.token) return null;
        
        try {
            const response = await fetch(`${API_URL}/data`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            
            if (!response.ok) return null;
            const data = await response.json();
            
            // Update cache
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
            
            // Apply dark mode if set
            if (_cache.settings.darkMode) {
                document.body.classList.add('dark-mode');
            } else {
                document.body.classList.remove('dark-mode');
            }
            
            console.log('Data loaded from cloud');
            return _cache;
        } catch (error) {
            console.error('Load data error:', error);
            return null;
        }
    }

    async saveData() {
        if (!this.token) return { error: 'Not logged in' };
        
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
            console.log('Data saved to cloud');
            return result;
        } catch (error) {
            console.error('Save data error:', error);
            return { error: 'Network error' };
        }
    }

    // Debounced save - saves 500ms after last change
    scheduleSave() {
        if (_saveTimeout) clearTimeout(_saveTimeout);
        _saveTimeout = setTimeout(() => {
            this.saveData();
        }, 500);
    }

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

    // ============ DATA SETTERS (auto-save) ============

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
        // Keep only last 50 activities
        if (_cache.activityLog.length > 50) {
            _cache.activityLog = _cache.activityLog.slice(0, 50);
        }
        this.scheduleSave();
    }

    setDarkMode(enabled) {
        _cache.settings.darkMode = enabled;
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
        window.vieraAPI.scheduleSave();
    }
};

// ============ localStorage COMPATIBILITY LAYER ============
// Override localStorage for studyDeck keys to use cloud cache instead
// This allows existing code to work without modification

const _originalGetItem = localStorage.getItem.bind(localStorage);
const _originalSetItem = localStorage.setItem.bind(localStorage);
const _originalRemoveItem = localStorage.removeItem.bind(localStorage);

// Map localStorage keys to cache properties
const _keyMap = {
    'studyDeckFlashcards': 'flashcards',
    'studyDeckTodos': 'todos',
    'studyDeckNotes': 'notes',
    'studyDeckClasses': 'classes',
    'studyDeckEvents': 'events',
    'studyDeckTasks': 'tasks',
    'studyDeckPomodoroStats': 'pomodoroStats',
    'studyDeckPomodoroSessions': 'pomodoroSessions',
    'studyDeckPomodoroSettings': 'pomodoroSettings',
    'studyDeckActivityLog': 'activityLog',
    'studyDeckDarkMode': 'darkMode',
    'studyDeckUserProfile': 'userProfile'
};

localStorage.getItem = function(key) {
    // Handle studyDeck keys from cache
    if (_keyMap[key]) {
        const cacheKey = _keyMap[key];
        
        if (cacheKey === 'darkMode') {
            return _cache.settings.darkMode ? 'true' : 'false';
        }
        
        if (cacheKey === 'userProfile') {
            const user = window.vieraAPI?.user;
            if (user) {
                return JSON.stringify({
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email
                });
            }
            return null;
        }
        
        const value = _cache[cacheKey];
        if (value === undefined || value === null) {
            return null;
        }
        return JSON.stringify(value);
    }
    
    // Pass through to real localStorage
    return _originalGetItem(key);
};

localStorage.setItem = function(key, value) {
    // Handle studyDeck keys - save to cache
    if (_keyMap[key]) {
        const cacheKey = _keyMap[key];
        
        if (cacheKey === 'darkMode') {
            _cache.settings.darkMode = value === 'true';
            if (_cache.settings.darkMode) {
                document.body.classList.add('dark-mode');
            } else {
                document.body.classList.remove('dark-mode');
            }
            if (window.vieraAPI?.isLoggedIn()) {
                window.vieraAPI.scheduleSave();
            }
            return;
        }
        
        if (cacheKey === 'userProfile') {
            // User profile is managed by the API, ignore local sets
            return;
        }
        
        try {
            _cache[cacheKey] = JSON.parse(value);
        } catch (e) {
            _cache[cacheKey] = value;
        }
        
        // Schedule cloud save
        if (window.vieraAPI?.isLoggedIn()) {
            window.vieraAPI.scheduleSave();
        }
        return;
    }
    
    // Pass through to real localStorage
    return _originalSetItem(key, value);
};

localStorage.removeItem = function(key) {
    // Handle studyDeck keys - reset in cache
    if (_keyMap[key]) {
        const cacheKey = _keyMap[key];
        
        if (cacheKey === 'darkMode') {
            _cache.settings.darkMode = false;
            document.body.classList.remove('dark-mode');
        } else if (cacheKey !== 'userProfile') {
            if (Array.isArray(_cache[cacheKey])) {
                _cache[cacheKey] = [];
            } else {
                _cache[cacheKey] = {};
            }
        }
        
        if (window.vieraAPI?.isLoggedIn()) {
            window.vieraAPI.scheduleSave();
        }
        return;
    }
    
    // Pass through to real localStorage
    return _originalRemoveItem(key);
};

// Save data before page unload
window.addEventListener('beforeunload', function() {
    if (window.vieraAPI && window.vieraAPI.isLoggedIn()) {
        // Use sendBeacon for reliable save on page close
        const token = _originalGetItem('vierastudy_token');
        if (token && navigator.sendBeacon) {
            const blob = new Blob([JSON.stringify(_cache)], { type: 'application/json' });
            navigator.sendBeacon(`${API_URL}/data?token=${token}`, blob);
        }
    }
});

// Auto-initialize: verify session and load data on page load
// This runs automatically when api.js loads
(async function initializeSession() {
    if (window.vieraAPI && window.vieraAPI.token) {
        try {
            // Verify the session is still valid
            const user = await window.vieraAPI.verifySession();
            if (user) {
                console.log('Session verified, data loaded from cloud');
                _readyResolve(true);
            } else {
                console.log('Session expired or invalid');
                _readyResolve(false);
                // Redirect to home if not on index page
                if (!window.location.pathname.endsWith('index.html') && 
                    !window.location.pathname.endsWith('index') &&
                    window.location.pathname !== '/') {
                    window.location.href = 'index';
                }
            }
        } catch (error) {
            console.error('Session verification failed:', error);
            _readyResolve(false);
        }
    } else {
        // No token - resolve immediately as not logged in
        _readyResolve(false);
        // Redirect to home if not on index page and not logged in
        if (!window.location.pathname.endsWith('index.html') && 
            !window.location.pathname.endsWith('index') &&
            window.location.pathname !== '/') {
            window.location.href = 'index';
        }
    }
})();

console.log('VieraStudy API v5 loaded (cloud-only storage with localStorage compatibility)');

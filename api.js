// VieraStudy API Client v8 - Optimized for minimal requests
// All data stored in Cloudflare Workers KV, with aggressive caching

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
let _isDirty = false; // Track if there are unsaved changes
let _saveTimeout = null;
let _maxSaveTimeout = null; // Force save after max delay
let _readyResolve;
let _readyPromise = new Promise(resolve => { _readyResolve = resolve; });

// Session verification cache
let _lastVerifyTime = 0;
let _verifyCache = null;
const VERIFY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Data loading cache  
let _lastLoadTime = 0;
const DATA_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Sync timing
const SYNC_DEBOUNCE = 3000; // 3 seconds after last change
const SYNC_MAX_DELAY = 10000; // Maximum 10 seconds before forced sync

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
                _lastVerifyTime = Date.now();
                _verifyCache = data.user;
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
                _lastVerifyTime = Date.now();
                _verifyCache = data.user;
                // Load data from cloud
                await this.loadData(true); // Force load on login
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
                // Save any pending changes first (force immediate save)
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
        _isDirty = false;
        _lastVerifyTime = 0;
        _verifyCache = null;
        _lastLoadTime = 0;
    }

    async verifySession() {
        if (!this.token) return null;
        
        // Use cached verification if still valid
        const now = Date.now();
        if (_verifyCache && (now - _lastVerifyTime) < VERIFY_CACHE_TTL) {
            console.log('Using cached session verification');
            // Still load data if not loaded
            if (!_cacheLoaded) {
                await this.loadData();
            }
            return _verifyCache;
        }
        
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
                _verifyCache = null;
                _lastVerifyTime = 0;
                return null;
            }
            
            const data = await response.json();
            if (data.success && data.user) {
                this.user = data.user;
                localStorage.setItem('vierastudy_user', JSON.stringify(data.user));
                
                // Cache the verification
                _verifyCache = data.user;
                _lastVerifyTime = Date.now();
                
                // Load data from cloud if not already loaded
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
    async syncToCloud() { return await this._saveDataNow(); }
    async syncFromCloud() { return await this.loadData(true); }

    // ============ DATA OPERATIONS ============

    async loadData(forceReload = false) {
        if (!this.token) return null;
        
        // Use cached data if still valid and not forcing reload
        const now = Date.now();
        if (!forceReload && _cacheLoaded && (now - _lastLoadTime) < DATA_CACHE_TTL) {
            console.log('Using cached data (loaded ' + Math.round((now - _lastLoadTime) / 1000) + 's ago)');
            return _cache;
        }
        
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
            _lastLoadTime = Date.now();
            _isDirty = false;
            
            // Sync dark mode from cloud to localStorage (for instant loading on next visit)
            // and apply it to the page
            if (_cache.settings.darkMode) {
                document.body.classList.add('dark-mode');
                _originalSetItem('studyDeckDarkMode', 'true');
            } else {
                document.body.classList.remove('dark-mode');
                _originalSetItem('studyDeckDarkMode', 'false');
            }
            
            console.log('Data loaded from cloud');
            return _cache;
        } catch (error) {
            console.error('Load data error:', error);
            return null;
        }
    }

    // Internal immediate save (used for logout, page unload)
    async _saveDataNow() {
        if (!this.token || !_isDirty) return { success: true, message: 'No changes to save' };
        
        // Clear any pending timeouts
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
            console.log('Data saved to cloud');
            return result;
        } catch (error) {
            console.error('Save data error:', error);
            return { error: 'Network error' };
        }
    }

    // Public save method - schedules a debounced save
    async saveData() {
        this.scheduleSave();
        return { success: true, message: 'Save scheduled' };
    }

    // Debounced save - saves after SYNC_DEBOUNCE ms of no changes
    // Also has a maximum delay of SYNC_MAX_DELAY ms
    scheduleSave() {
        if (!this.token) return;
        
        _isDirty = true;
        
        // Clear existing debounce timer
        if (_saveTimeout) {
            clearTimeout(_saveTimeout);
        }
        
        // Set up debounced save
        _saveTimeout = setTimeout(() => {
            this._saveDataNow();
            if (_maxSaveTimeout) {
                clearTimeout(_maxSaveTimeout);
                _maxSaveTimeout = null;
            }
        }, SYNC_DEBOUNCE);
        
        // Set up max delay timer if not already set
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

// ============ localStorage COMPATIBILITY LAYER ============
// Override localStorage for studyDeck keys to use cloud cache instead
// This allows existing code to work without modification

const _originalGetItem = localStorage.getItem.bind(localStorage);
const _originalSetItem = localStorage.setItem.bind(localStorage);
const _originalRemoveItem = localStorage.removeItem.bind(localStorage);

// Global sync function for backward compatibility
// Forces an immediate save for reliability
window.syncData = function() {
    console.log('syncData() called, isLoggedIn:', window.vieraAPI?.isLoggedIn());
    if (window.vieraAPI && window.vieraAPI.isLoggedIn()) {
        _isDirty = true;
        const token = _originalGetItem('vierastudy_token');
        console.log('Token found:', !!token);
        console.log('Cache to save:', JSON.stringify(_cache).substring(0, 200) + '...');
        if (token) {
            // Use fetch for immediate save (more reliable than sendBeacon)
            fetch(`${API_URL}/data`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(_cache)
            }).then(response => {
                console.log('syncData response status:', response.status);
                return response.json();
            }).then(data => {
                _isDirty = false;
                console.log('Data saved via syncData():', data);
            }).catch(err => {
                console.error('syncData save failed:', err);
            });
        }
    }
};

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
    'studyDeckUserProfile': 'userProfile'
    // Note: studyDeckDarkMode is NOT in this map - it uses real localStorage for instant loading
};

// Apply dark mode immediately on script load (before API verification)
// This prevents the white flash
(function applyDarkModeImmediately() {
    const darkMode = localStorage.getItem('studyDeckDarkMode') === 'true';
    if (darkMode) {
        document.body.classList.add('dark-mode');
    }
    // Also set in cache
    _cache.settings.darkMode = darkMode;
})();

localStorage.getItem = function(key) {
    // Dark mode uses real localStorage for instant loading
    if (key === 'studyDeckDarkMode') {
        return _originalGetItem(key);
    }
    
    // Handle studyDeck keys from cache
    if (_keyMap[key]) {
        const cacheKey = _keyMap[key];
        
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
    // Dark mode: save to both real localStorage AND cache, then sync
    if (key === 'studyDeckDarkMode') {
        _originalSetItem(key, value);
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
    
    // Handle studyDeck keys - save to cache
    if (_keyMap[key]) {
        const cacheKey = _keyMap[key];
        
        if (cacheKey === 'userProfile') {
            // User profile is managed by the API, ignore local sets
            return;
        }
        
        try {
            _cache[cacheKey] = JSON.parse(value);
            console.log(`Cache updated: ${cacheKey}`, _cache[cacheKey].length || Object.keys(_cache[cacheKey]).length, 'items');
        } catch (e) {
            _cache[cacheKey] = value;
        }
        
        // Schedule cloud save (debounced)
        if (window.vieraAPI?.isLoggedIn()) {
            window.vieraAPI.scheduleSave();
        }
        return;
    }
    
    // Pass through to real localStorage
    return _originalSetItem(key, value);
};

localStorage.removeItem = function(key) {
    // Dark mode: remove from both
    if (key === 'studyDeckDarkMode') {
        _originalRemoveItem(key);
        _cache.settings.darkMode = false;
        document.body.classList.remove('dark-mode');
        if (window.vieraAPI?.isLoggedIn()) {
            window.vieraAPI.scheduleSave();
        }
        return;
    }
    
    // Handle studyDeck keys - reset in cache
    if (_keyMap[key]) {
        const cacheKey = _keyMap[key];
        
        if (cacheKey !== 'userProfile') {
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

// Helper function to save via sendBeacon
function saveViaBeacon() {
    if (window.vieraAPI?.isLoggedIn() && _isDirty) {
        const token = _originalGetItem('vierastudy_token');
        if (token && navigator.sendBeacon) {
            const blob = new Blob([JSON.stringify(_cache)], { type: 'application/json' });
            navigator.sendBeacon(`${API_URL}/data?token=${token}`, blob);
            _isDirty = false;
            console.log('Data saved via sendBeacon');
            return true;
        }
    }
    return false;
}

// Save data before page unload
window.addEventListener('beforeunload', function() {
    saveViaBeacon();
});

// Also handle pagehide (more reliable on mobile and some browsers)
window.addEventListener('pagehide', function() {
    saveViaBeacon();
});

// Save when clicking any internal navigation link
document.addEventListener('click', function(e) {
    const link = e.target.closest('a[href]');
    if (link && _isDirty) {
        const href = link.getAttribute('href');
        // Check if it's an internal link (not external)
        if (href && !href.startsWith('http') && !href.startsWith('//') && !href.startsWith('mailto:')) {
            saveViaBeacon();
        }
    }
});

// Also save on visibility change (user switches tabs or minimizes)
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
        saveViaBeacon();
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
                // Clear invalid session to prevent stuck state
                window.vieraAPI.token = null;
                window.vieraAPI.user = null;
                localStorage.removeItem('vierastudy_token');
                localStorage.removeItem('vierastudy_user');
                _readyResolve(false);
                // Redirect to home if not on index page
                if (!window.location.pathname.endsWith('index.html') && 
                    !window.location.pathname.endsWith('index') &&
                    window.location.pathname !== '/') {
                    window.location.href = '/';
                }
            }
        } catch (error) {
            console.error('Session verification failed:', error);
            // Clear invalid session on network failure to prevent stuck state
            window.vieraAPI.token = null;
            window.vieraAPI.user = null;
            localStorage.removeItem('vierastudy_token');
            localStorage.removeItem('vierastudy_user');
            _readyResolve(false);
            // Redirect to home if not on index page
            if (!window.location.pathname.endsWith('index.html') && 
                !window.location.pathname.endsWith('index') &&
                window.location.pathname !== '/') {
                window.location.href = '/';
            }
        }
    } else {
        // No token - resolve immediately as not logged in
        _readyResolve(false);
        // Redirect to home if not on index page and not logged in
        if (!window.location.pathname.endsWith('index.html') && 
            !window.location.pathname.endsWith('index') &&
            window.location.pathname !== '/') {
            window.location.href = '/';
        }
    }
})();

console.log('VieraStudy API v8 loaded (optimized cloud sync - reduced API requests)');

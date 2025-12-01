// VieraStudy API Client
// Connects to Cloudflare Worker backend for authentication and cloud storage

const API_URL = 'https://vierastudy-api.ayhamissa416.workers.dev';

class VieraStudyAPI {
    constructor() {
        this.token = localStorage.getItem('vierastudy_token');
        this.user = JSON.parse(localStorage.getItem('vierastudy_user') || 'null');
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
                
                // Also set legacy profile for compatibility
                localStorage.setItem('studyDeckUserProfile', JSON.stringify({
                    firstName: data.user.firstName,
                    lastName: data.user.lastName,
                    email: data.user.email,
                    userId: data.user.id,
                    createdAt: new Date().toISOString()
                }));
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
                
                // Also set legacy profile for compatibility
                localStorage.setItem('studyDeckUserProfile', JSON.stringify({
                    firstName: data.user.firstName,
                    lastName: data.user.lastName,
                    email: data.user.email,
                    userId: data.user.id,
                    createdAt: new Date().toISOString()
                }));
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
        
        // Clear local storage
        this.token = null;
        this.user = null;
        localStorage.removeItem('vierastudy_token');
        localStorage.removeItem('vierastudy_user');
        localStorage.removeItem('studyDeckUserProfile');
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

    // ============ DATA SYNC ============

    async getData() {
        if (!this.token) return null;
        
        try {
            const response = await fetch(`${API_URL}/data`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            
            if (!response.ok) return null;
            return await response.json();
        } catch (error) {
            console.error('Get data error:', error);
            return null;
        }
    }

    async saveData(data) {
        if (!this.token) return { error: 'Not logged in' };
        
        try {
            const response = await fetch(`${API_URL}/data`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(data)
            });
            return await response.json();
        } catch (error) {
            console.error('Save data error:', error);
            return { error: 'Network error' };
        }
    }

    // ============ SYNC HELPERS ============

    // Get all local data
    getLocalData() {
        return {
            flashcards: JSON.parse(localStorage.getItem('studyDeckFlashcards') || '[]'),
            todos: JSON.parse(localStorage.getItem('studyDeckTodos') || '[]'),
            notes: JSON.parse(localStorage.getItem('studyDeckNotes') || '[]'),
            classes: JSON.parse(localStorage.getItem('studyDeckClasses') || '[]'),
            events: JSON.parse(localStorage.getItem('studyDeckEvents') || '[]'),
            tasks: JSON.parse(localStorage.getItem('studyDeckTasks') || '[]'),
            pomodoroStats: JSON.parse(localStorage.getItem('studyDeckPomodoroStats') || '{}'),
            pomodoroSessions: JSON.parse(localStorage.getItem('studyDeckPomodoroSessions') || '[]'),
            pomodoroSettings: JSON.parse(localStorage.getItem('studyDeckPomodoroSettings') || '{}'),
            activityLog: JSON.parse(localStorage.getItem('studyDeckActivityLog') || '[]'),
            settings: {
                darkMode: localStorage.getItem('studyDeckDarkMode') === 'true'
            },
            lastSync: new Date().toISOString()
        };
    }

    // Save cloud data to local storage
    saveToLocal(data) {
        if (data.flashcards) localStorage.setItem('studyDeckFlashcards', JSON.stringify(data.flashcards));
        if (data.todos) localStorage.setItem('studyDeckTodos', JSON.stringify(data.todos));
        if (data.notes) localStorage.setItem('studyDeckNotes', JSON.stringify(data.notes));
        if (data.classes) localStorage.setItem('studyDeckClasses', JSON.stringify(data.classes));
        if (data.events) localStorage.setItem('studyDeckEvents', JSON.stringify(data.events));
        if (data.tasks) localStorage.setItem('studyDeckTasks', JSON.stringify(data.tasks));
        if (data.pomodoroStats) localStorage.setItem('studyDeckPomodoroStats', JSON.stringify(data.pomodoroStats));
        if (data.pomodoroSessions) localStorage.setItem('studyDeckPomodoroSessions', JSON.stringify(data.pomodoroSessions));
        if (data.pomodoroSettings) localStorage.setItem('studyDeckPomodoroSettings', JSON.stringify(data.pomodoroSettings));
        if (data.activityLog) localStorage.setItem('studyDeckActivityLog', JSON.stringify(data.activityLog));
        if (data.settings && data.settings.darkMode !== undefined) {
            localStorage.setItem('studyDeckDarkMode', data.settings.darkMode.toString());
        }
    }

    // Sync local data to cloud
    async syncToCloud() {
        if (!this.isLoggedIn()) return { error: 'Not logged in' };
        
        const localData = this.getLocalData();
        return await this.saveData(localData);
    }

    // Load data from cloud to local
    async syncFromCloud() {
        if (!this.isLoggedIn()) return null;
        
        const cloudData = await this.getData();
        if (cloudData && !cloudData.error) {
            this.saveToLocal(cloudData);
            return cloudData;
        }
        return null;
    }

    // Full sync - merge local and cloud (cloud wins for conflicts)
    async fullSync() {
        if (!this.isLoggedIn()) return null;
        
        // First, get cloud data
        const cloudData = await this.getData();
        
        if (cloudData && !cloudData.error) {
            // If cloud has data, use it
            if (cloudData.lastSync) {
                this.saveToLocal(cloudData);
                return cloudData;
            }
        }
        
        // If no cloud data, push local to cloud
        const localData = this.getLocalData();
        await this.saveData(localData);
        return localData;
    }

    // Schedule a debounced sync
    scheduleSync() {
        console.log('scheduleSync called, isLoggedIn:', this.isLoggedIn());
        if (this._syncTimeout) clearTimeout(this._syncTimeout);
        this._syncTimeout = setTimeout(async () => {
            if (this.isLoggedIn()) {
                console.log('Syncing to cloud...');
                const result = await this.syncToCloud();
                console.log('Sync result:', result);
            } else {
                console.log('Not logged in, skipping sync');
            }
        }, 2000);
    }
}

// Create global instance
window.vieraAPI = new VieraStudyAPI();

// Auto-sync on page unload (save local changes to cloud)
window.addEventListener('beforeunload', function() {
    if (window.vieraAPI.isLoggedIn()) {
        // Use sendBeacon for reliable sync on page close
        const data = window.vieraAPI.getLocalData();
        const token = localStorage.getItem('vierastudy_token');
        
        if (token && navigator.sendBeacon) {
            const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
            navigator.sendBeacon(`${API_URL}/data?token=${token}`, blob);
        }
    }
});

// Also expose scheduleSync globally for backward compatibility
window.scheduleSync = function() {
    window.vieraAPI.scheduleSync();
};

console.log('VieraStudy API loaded, token exists:', !!localStorage.getItem('vierastudy_token'));

/**
 * Smart Learning - Core JavaScript Utilities
 * Handles authentication, data storage, navigation, and state management
 */

// ============================================
// CONFIGURATION
// ============================================
const APP_CONFIG = {
    appName: 'Smart Learning',
    version: '1.0.0',
    storageKeys: {
        currentUser: 'sl_current_user',
        users: 'sl_users',
        subjects: 'sl_subjects',
        resources: 'sl_resources',
        enrollments: 'sl_enrollments',
        theme: 'theme'
    }
};

// ============================================
// UTILITY FUNCTIONS
// ============================================
const Utils = {
    // Generate unique ID
    generateId: () => {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },

    // Get URL parameter
    getUrlParam: (param) => {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(param);
    },

    // Format date
    formatDate: (date) => {
        return new Date(date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    },

    // Show notification
    showNotification: (message, type = 'info') => {
        const existing = document.querySelector('.notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 16px 24px;
            background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#dc2626' : '#3b82f6'};
            color: white;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(notification);
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    },

    // Validate email
    validateEmail: (email) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    },

    // Validate password
    validatePassword: (password) => {
        return password.length >= 6;
    }
};

// ============================================
// DATA STORAGE
// ============================================
const Storage = {
    // Get data from localStorage
    get: (key) => {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error('Storage get error:', e);
            return null;
        }
    },

    // Set data to localStorage
    set: (key, value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.error('Storage set error:', e);
            return false;
        }
    },

    // Remove data from localStorage
    remove: (key) => {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            console.error('Storage remove error:', e);
            return false;
        }
    },

    // Clear all app data
    clear: () => {
        Object.values(APP_CONFIG.storageKeys).forEach(key => {
            localStorage.removeItem(key);
        });
    }
};

// ============================================
// AUTHENTICATION
// ============================================
const Auth = {
    // Get current user
    getCurrentUser: () => {
        return Storage.get(APP_CONFIG.storageKeys.currentUser);
    },

    // Get all users
    getUsers: () => {
        return Storage.get(APP_CONFIG.storageKeys.users) || [];
    },

    // Save users
    saveUsers: (users) => {
        return Storage.set(APP_CONFIG.storageKeys.users, users);
    },

    // Register new user
    register: (userData) => {
        const users = Auth.getUsers();
        
        // Check if email already exists
        if (users.find(u => u.email === userData.email)) {
            return { success: false, message: 'Email already registered' };
        }

        // Create new user
        const newUser = {
            id: Utils.generateId(),
            ...userData,
            createdAt: new Date().toISOString(),
            profile: {
                name: userData.name || userData.fullName,
                email: userData.email,
                role: userData.role,
                avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${userData.email}`,
                bio: '',
                subjects: [],
                students: 0,
                courses: 0
            }
        };

        users.push(newUser);
        Auth.saveUsers(users);

        // Set current user (without password)
        const { password, ...safeUser } = newUser;
        Storage.set(APP_CONFIG.storageKeys.currentUser, safeUser);

        return { success: true, user: safeUser };
    },

    // Login user
    login: (email, password) => {
        const users = Auth.getUsers();
        const user = users.find(u => u.email === email && u.password === password);

        if (!user) {
            return { success: false, message: 'Invalid email or password' };
        }

        // Set current user (without password)
        const { password: _, ...safeUser } = user;
        Storage.set(APP_CONFIG.storageKeys.currentUser, safeUser);

        return { success: true, user: safeUser };
    },

    // Logout user
    logout: () => {
        Storage.remove(APP_CONFIG.storageKeys.currentUser);
        window.location.href = 'index.html';
    },

    // Update user profile
    updateProfile: (updates) => {
        const currentUser = Auth.getCurrentUser();
        if (!currentUser) return { success: false, message: 'Not logged in' };

        const users = Auth.getUsers();
        const userIndex = users.findIndex(u => u.id === currentUser.id);
        
        if (userIndex === -1) return { success: false, message: 'User not found' };

        // Update user
        users[userIndex] = { ...users[userIndex], ...updates, profile: { ...users[userIndex].profile, ...updates.profile } };
        Auth.saveUsers(users);

        // Update current user
        const { password, ...safeUser } = users[userIndex];
        Storage.set(APP_CONFIG.storageKeys.currentUser, safeUser);

        return { success: true, user: safeUser };
    },

    // Check if user is authenticated
    isAuthenticated: () => {
        return !!Auth.getCurrentUser();
    },

    // Require authentication
    requireAuth: (redirectTo = 'index.html') => {
        if (!Auth.isAuthenticated()) {
            window.location.href = redirectTo;
            return false;
        }
        return true;
    },

    // Check role
    hasRole: (role) => {
        const user = Auth.getCurrentUser();
        return user && user.role === role;
    }
};

// ============================================
// SUBJECTS & RESOURCES
// ============================================
const Subjects = {
    // Get default subjects
    getDefault: () => [
        { id: 'math', name: 'Mathematics', icon: '📐', color: '#3b82f6', description: 'Algebra, Calculus, Geometry and more' },
        { id: 'science', name: 'Science', icon: '🔬', color: '#22c55e', description: 'Physics, Chemistry, Biology' },
        { id: 'english', name: 'English', icon: '📚', color: '#8b5cf6', description: 'Literature, Grammar, Writing' },
        { id: 'history', name: 'History', icon: '🏛️', color: '#f59e0b', description: 'World History, Ancient Civilizations' },
        { id: 'geography', name: 'Geography', icon: '🌍', color: '#06b6d4', description: 'Physical and Human Geography' },
        { id: 'computers', name: 'Computer Science', icon: '💻', color: '#ec4899', description: 'Programming, Algorithms, Web Dev' }
    ],

    // Get all subjects
    getAll: () => {
        let subjects = Storage.get(APP_CONFIG.storageKeys.subjects);
        if (!subjects) {
            subjects = Subjects.getDefault();
            Storage.set(APP_CONFIG.storageKeys.subjects, subjects);
        }
        return subjects;
    },

    // Get subject by ID
    getById: (id) => {
        const subjects = Subjects.getAll();
        return subjects.find(s => s.id === id);
    },

    // Add subject
    add: (subject) => {
        const subjects = Subjects.getAll();
        subjects.push({ id: Utils.generateId(), ...subject });
        Storage.set(APP_CONFIG.storageKeys.subjects, subjects);
        return subjects;
    }
};

// ============================================
// RESOURCES MANAGEMENT
// ============================================
const Resources = {
    // Get default resources
    getDefault: () => ({
        math: {
            videos: [
                { id: 'v1', title: 'Introduction to Algebra', duration: '15:30', url: '#', thumbnail: 'https://picsum.photos/seed/math1/300/200' },
                { id: 'v2', title: 'Linear Equations Explained', duration: '22:45', url: '#', thumbnail: 'https://picsum.photos/seed/math2/300/200' },
                { id: 'v3', title: 'Quadratic Functions', duration: '18:20', url: '#', thumbnail: 'https://picsum.photos/seed/math3/300/200' }
            ],
            notes: [
                { id: 'n1', title: 'Algebra Basics PDF', size: '2.5 MB', url: '#' },
                { id: 'n2', title: 'Equation Solving Guide', size: '1.8 MB', url: '#' }
            ],
            quizzes: [
                { id: 'q1', title: 'Algebra Fundamentals', questions: 10, duration: '15 min' },
                { id: 'q2', title: 'Linear Equations Test', questions: 15, duration: '20 min' }
            ]
        },
        science: {
            videos: [
                { id: 'v1', title: 'Introduction to Physics', duration: '20:00', url: '#', thumbnail: 'https://picsum.photos/seed/sci1/300/200' },
                { id: 'v2', title: 'Chemical Reactions', duration: '25:30', url: '#', thumbnail: 'https://picsum.photos/seed/sci2/300/200' }
            ],
            notes: [
                { id: 'n1', title: 'Physics Fundamentals', size: '3.2 MB', url: '#' }
            ],
            quizzes: []
        },
        english: {
            videos: [
                { id: 'v1', title: 'Grammar Essentials', duration: '18:00', url: '#', thumbnail: 'https://picsum.photos/seed/eng1/300/200' }
            ],
            notes: [
                { id: 'n1', title: 'English Grammar PDF', size: '1.5 MB', url: '#' }
            ],
            quizzes: [
                { id: 'q1', title: 'Grammar Test', questions: 20, duration: '25 min' }
            ]
        },
        history: {
            videos: [
                { id: 'v1', title: 'Ancient Civilizations', duration: '30:00', url: '#', thumbnail: 'https://picsum.photos/seed/his1/300/200' }
            ],
            notes: [
                { id: 'n1', title: 'World History Timeline', size: '4.0 MB', url: '#' }
            ],
            quizzes: []
        },
        geography: {
            videos: [
                { id: 'v1', title: 'World Maps & Continents', duration: '22:00', url: '#', thumbnail: 'https://picsum.photos/seed/geo1/300/200' }
            ],
            notes: [],
            quizzes: []
        },
        computers: {
            videos: [
                { id: 'v1', title: 'Introduction to Programming', duration: '25:00', url: '#', thumbnail: 'https://picsum.photos/seed/cs1/300/200' },
                { id: 'v2', title: 'Web Development Basics', duration: '28:00', url: '#', thumbnail: 'https://picsum.photos/seed/cs2/300/200' }
            ],
            notes: [
                { id: 'n1', title: 'Programming Guide', size: '2.0 MB', url: '#' }
            ],
            quizzes: [
                { id: 'q1', title: 'Programming Basics', questions: 15, duration: '20 min' }
            ]
        }
    }),

    // Get resources for a subject
    getBySubject: (subjectId) => {
        let resources = Storage.get(APP_CONFIG.storageKeys.resources);
        if (!resources) {
            resources = Resources.getDefault();
            Storage.set(APP_CONFIG.storageKeys.resources, resources);
        }
        return resources[subjectId] || { videos: [], notes: [], quizzes: [] };
    }
};

// ============================================
// ENROLLMENTS
// ============================================
const Enrollments = {
    // Get all enrollments
    getAll: () => {
        return Storage.get(APP_CONFIG.storageKeys.enrollments) || [];
    },

    // Enroll in subject
    enroll: (subjectId) => {
        const user = Auth.getCurrentUser();
        if (!user) return { success: false, message: 'Please login first' };

        const enrollments = Enrollments.getAll();
        
        // Check if already enrolled
        if (enrollments.find(e => e.userId === user.id && e.subjectId === subjectId)) {
            return { success: false, message: 'Already enrolled' };
        }

        enrollments.push({
            id: Utils.generateId(),
            userId: user.id,
            subjectId,
            enrolledAt: new Date().toISOString(),
            progress: 0
        });

        Storage.set(APP_CONFIG.storageKeys.enrollments, enrollments);
        return { success: true };
    },

    // Get user enrollments
    getUserEnrollments: () => {
        const user = Auth.getCurrentUser();
        if (!user) return [];

        const enrollments = Enrollments.getAll();
        return enrollments.filter(e => e.userId === user.id);
    },

    // Check if enrolled
    isEnrolled: (subjectId) => {
        const user = Auth.getCurrentUser();
        if (!user) return false;

        const enrollments = Enrollments.getAll();
        return !!enrollments.find(e => e.userId === user.id && e.subjectId === subjectId);
    }
};

// ============================================
// THEME MANAGEMENT
// ============================================
const Theme = {
    // Toggle theme
    toggle: () => {
        const current = document.documentElement.getAttribute('data-theme');
        const newTheme = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem(APP_CONFIG.storageKeys.theme, newTheme);
        return newTheme;
    },

    // Get current theme
    get: () => {
        return localStorage.getItem(APP_CONFIG.storageKeys.theme) || 'light';
    }
};

// ============================================
// UI HELPERS
// ============================================
const UI = {
    // Render user info
    renderUserInfo: (user) => {
        if (!user) return '';
        return `
            <div class="user-info">
                <img src="${user.profile?.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${user.email}`}" 
                     alt="${user.profile?.name || user.name}" class="user-avatar">
                <div class="user-details">
                    <span class="user-name">${user.profile?.name || user.name || user.email}</span>
                    <span class="user-role">${user.role === 'teacher' ? 'Teacher' : 'Learner'}</span>
                </div>
            </div>
        `;
    },

    // Render subjects grid
    renderSubjectsGrid: (subjects, enrolledIds = []) => {
        return subjects.map(subject => {
            const isEnrolled = enrolledIds.includes(subject.id);
            return `
                <div class="subject-card" data-id="${subject.id}">
                    <div class="subject-icon" style="background: ${subject.color}20; color: ${subject.color}">
                        ${subject.icon}
                    </div>
                    <h3>${subject.name}</h3>
                    <p>${subject.description}</p>
                    ${isEnrolled 
                        ? '<span class="enrolled-badge">Enrolled</span>' 
                        : `<button class="enroll-btn" data-subject="${subject.id}">Enroll Now</button>`
                    }
                </div>
            `;
        }).join('');
    },

    // Render resources
    renderResources: (resources) => {
        let html = '';

        // Videos
        if (resources.videos?.length) {
            html += `
                <div class="resource-section">
                    <h3>📹 Videos</h3>
                    <div class="resource-grid">
                        ${resources.videos.map(v => `
                            <div class="resource-item video-item">
                                <img src="${v.thumbnail}" alt="${v.title}">
                                <div class="resource-info">
                                    <h4>${v.title}</h4>
                                    <span class="duration">${v.duration}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Notes
        if (resources.notes?.length) {
            html += `
                <div class="resource-section">
                    <h3>📄 Notes</h3>
                    <div class="resource-list">
                        ${resources.notes.map(n => `
                            <div class="resource-item note-item">
                                <span class="file-icon">📄</span>
                                <div class="resource-info">
                                    <h4>${n.title}</h4>
                                    <span class="size">${n.size}</span>
                                </div>
                                <button class="download-btn">Download</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Quizzes
        if (resources.quizzes?.length) {
            html += `
                <div class="resource-section">
                    <h3>📝 Quizzes</h3>
                    <div class="resource-list">
                        ${resources.quizzes.map(q => `
                            <div class="resource-item quiz-item">
                                <span class="file-icon">📝</span>
                                <div class="resource-info">
                                    <h4>${q.title}</h4>
                                    <span class="meta">${q.questions} questions • ${q.duration}</span>
                                </div>
                                <button class="start-btn">Start Quiz</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        return html || '<p class="no-resources">No resources available yet.</p>';
    }
};

// ============================================
// INITIALIZE APP
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
});

// Export for global use
window.SmartLearning = {
    Utils,
    Storage,
    Auth,
    Subjects,
    Resources,
    Enrollments,
    Theme,
    UI,
    APP_CONFIG
};
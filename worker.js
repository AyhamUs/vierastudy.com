// VieraStudy API Worker - Full Version
// Handles authentication and cloud storage for VieraStudy

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS headers - allow your domain
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Helper: JSON response
    function json(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Helper: Hash password
    async function hashPassword(password) {
      const encoder = new TextEncoder();
      const data = encoder.encode(password + 'vierastudy-secret-salt-2024');
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
    }

    // Helper: Generate token
    function generateToken() {
      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
    }

    // Helper: Get token from request (header or query param for beacon)
    function getToken(request, url) {
      const authHeader = request.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
      }
      // Fallback to query param (for sendBeacon)
      return url.searchParams.get('token');
    }

    // Helper: Verify token and get session
    async function verifyToken(token) {
      if (!token) return null;
      const sessionData = await env.VIERASTUDY_USERS.get(`token:${token}`);
      return sessionData ? JSON.parse(sessionData) : null;
    }

    // Helper: Sanitize input to prevent XSS
    function sanitizeInput(input) {
      if (typeof input !== 'string') return input;
      return input
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;')
        .trim();
    }

    // Helper: Validate email format
    function isValidEmail(email) {
      const emailRegex = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      return emailRegex.test(email) && email.length <= 254;
    }

    // Helper: Validate input lengths
    function validateLengths(fields) {
      const limits = {
        email: 254,
        password: 128,
        firstName: 50,
        lastName: 50,
        name: 100
      };
      
      for (const [field, value] of Object.entries(fields)) {
        if (value && limits[field] && value.length > limits[field]) {
          return { valid: false, field, limit: limits[field] };
        }
      }
      return { valid: true };
    }

    // Helper: Rate limiting check
    async function checkRateLimit(identifier, maxAttempts = 5, windowSeconds = 300) {
      const key = `ratelimit:${identifier}`;
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      
      // Get existing attempts
      const attemptsData = await env.VIERASTUDY_USERS.get(key);
      let attempts = attemptsData ? JSON.parse(attemptsData) : [];
      
      // Filter out attempts outside the time window
      attempts = attempts.filter(timestamp => now - timestamp < windowMs);
      
      // Check if rate limit exceeded
      if (attempts.length >= maxAttempts) {
        const oldestAttempt = Math.min(...attempts);
        const timeUntilReset = Math.ceil((oldestAttempt + windowMs - now) / 1000);
        return { allowed: false, resetIn: timeUntilReset };
      }
      
      // Add current attempt
      attempts.push(now);
      await env.VIERASTUDY_USERS.put(key, JSON.stringify(attempts), {
        expirationTtl: windowSeconds
      });
      
      return { allowed: true, remaining: maxAttempts - attempts.length };
    }

    try {
      // ========== HEALTH CHECK ==========
      if (path === '/' || path === '/health') {
        return json({ status: 'ok', service: 'VieraStudy API', version: '1.0.0' });
      }

      // ========== REGISTER ==========
      if (path === '/register' && request.method === 'POST') {
        const body = await request.json();
        const { email, password, firstName, lastName } = body;
        
        // Basic validation
        if (!email || !password || !firstName) {
          return json({ error: 'Email, password, and first name are required' }, 400);
        }
        
        const emailLower = email.toLowerCase().trim();
        
        // Rate limiting - 5 attempts per 5 minutes per IP
        const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
        const rateLimitCheck = await checkRateLimit(`register:${clientIP}`, 5, 300);
        if (!rateLimitCheck.allowed) {
          return json({ 
            error: 'Too many registration attempts', 
            message: `Please try again in ${rateLimitCheck.resetIn} seconds` 
          }, 429);
        }
        
        // Email validation
        if (!isValidEmail(emailLower)) {
          return json({ error: 'Invalid email format' }, 400);
        }
        
        // Length validation
        const lengthCheck = validateLengths({ 
          email: emailLower, 
          password, 
          firstName, 
          lastName: lastName || '' 
        });
        if (!lengthCheck.valid) {
          return json({ 
            error: `${lengthCheck.field} exceeds maximum length of ${lengthCheck.limit} characters` 
          }, 400);
        }
        
        // Password strength validation
        if (password.length < 8) {
          return json({ error: 'Password must be at least 8 characters' }, 400);
        }
        if (password.length > 128) {
          return json({ error: 'Password is too long (max 128 characters)' }, 400);
        }
        
        // Sanitize inputs to prevent XSS
        const sanitizedFirstName = sanitizeInput(firstName);
        const sanitizedLastName = sanitizeInput(lastName || '');
        
        if (!sanitizedFirstName || sanitizedFirstName.length === 0) {
          return json({ error: 'First name cannot be empty' }, 400);
        }
        
        // Check if user exists
        const existing = await env.VIERASTUDY_USERS.get(`user:${emailLower}`);
        if (existing) {
          return json({ error: 'An account with this email already exists' }, 400);
        }

        // Create session token (30 days expiry)
        const token = generateToken();

        // Create user with token reference
        const userId = crypto.randomUUID();
        const hashedPassword = await hashPassword(password);
        
        const user = {
          id: userId,
          email: emailLower,
          firstName: sanitizedFirstName,
          lastName: sanitizedLastName,
          password: hashedPassword,
          currentToken: token,
          isPremium: false,
          isAdmin: false,
          createdAt: new Date().toISOString()
        };

        // Save user
        await env.VIERASTUDY_USERS.put(`user:${emailLower}`, JSON.stringify(user));
        
        // Save session token
        const session = { 
          userId, 
          email: emailLower, 
          firstName: user.firstName, 
          lastName: user.lastName,
          isPremium: false,
          isAdmin: false
        };
        await env.VIERASTUDY_USERS.put(`token:${token}`, JSON.stringify(session), {
          expirationTtl: 60 * 60 * 24 * 30
        });

        // Initialize empty user data
        const initialData = {
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
          settings: { darkMode: false },
          createdAt: new Date().toISOString(),
          lastSync: new Date().toISOString()
        };
        await env.VIERASTUDY_DATA.put(`data:${userId}`, JSON.stringify(initialData));

        return json({ 
          success: true, 
          token,
          user: { id: userId, email: emailLower, firstName: user.firstName, lastName: user.lastName }
        });
      }

      // ========== LOGIN ==========
      if (path === '/login' && request.method === 'POST') {
        const body = await request.json();
        const { email, password } = body;
        
        if (!email || !password) {
          return json({ error: 'Email and password are required' }, 400);
        }
        
        const emailLower = email.toLowerCase().trim();
        
        // Rate limiting - 10 attempts per 15 minutes per IP
        const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
        const rateLimitCheck = await checkRateLimit(`login:${clientIP}`, 10, 900);
        if (!rateLimitCheck.allowed) {
          return json({ 
            error: 'Too many login attempts', 
            message: `Please try again in ${Math.ceil(rateLimitCheck.resetIn / 60)} minutes` 
          }, 429);
        }
        
        // Email validation
        if (!isValidEmail(emailLower)) {
          return json({ error: 'Invalid email or password' }, 401);
        }
        const userJson = await env.VIERASTUDY_USERS.get(`user:${emailLower}`);
        
        if (!userJson) {
          return json({ error: 'Invalid email or password' }, 401);
        }

        const user = JSON.parse(userJson);
        const hashedPassword = await hashPassword(password);
        
        if (user.password !== hashedPassword) {
          return json({ error: 'Invalid email or password' }, 401);
        }

        // Add isPremium field if it doesn't exist (backward compatibility)
        if (user.isPremium === undefined) {
          user.isPremium = false;
          await env.VIERASTUDY_USERS.put(`user:${emailLower}`, JSON.stringify(user));
        }

        // Add isAdmin field if it doesn't exist (backward compatibility)
        if (user.isAdmin === undefined) {
          user.isAdmin = false;
          await env.VIERASTUDY_USERS.put(`user:${emailLower}`, JSON.stringify(user));
        }

        // Delete old token if exists
        if (user.currentToken) {
          await env.VIERASTUDY_USERS.delete(`token:${user.currentToken}`);
        }

        // Create new session token
        const token = generateToken();
        const session = { 
          userId: user.id, 
          email: user.email, 
          firstName: user.firstName, 
          lastName: user.lastName,
          isPremium: user.isPremium || false,
          isAdmin: user.isAdmin || false
        };
        await env.VIERASTUDY_USERS.put(`token:${token}`, JSON.stringify(session), {
          expirationTtl: 60 * 60 * 24 * 30
        });

        // Store current token in user record for cleanup on next login
        user.currentToken = token;
        await env.VIERASTUDY_USERS.put(`user:${emailLower}`, JSON.stringify(user));

        return json({ 
          success: true, 
          token,
          user: { 
            id: user.id, 
            email: user.email, 
            firstName: user.firstName, 
            lastName: user.lastName,
            isPremium: user.isPremium || false,
            isAdmin: user.isAdmin || false
          }
        });
      }

      // ========== VERIFY SESSION ==========
      if (path === '/verify' && request.method === 'GET') {
        const token = getToken(request, url);
        const session = await verifyToken(token);
        
        if (!session) {
          return json({ error: 'Invalid or expired session' }, 401);
        }

        return json({ success: true, user: session });
      }

      // ========== LOGOUT ==========
      if (path === '/logout' && request.method === 'POST') {
        const token = getToken(request, url);
        if (token) {
          await env.VIERASTUDY_USERS.delete(`token:${token}`);
        }
        return json({ success: true });
      }

      // ========== GET USER DATA ==========
      if (path === '/data' && request.method === 'GET') {
        const token = getToken(request, url);
        const session = await verifyToken(token);
        
        if (!session) {
          return json({ error: 'Unauthorized' }, 401);
        }

        const data = await env.VIERASTUDY_DATA.get(`data:${session.userId}`);
        return json(data ? JSON.parse(data) : {});
      }

      // ========== SAVE USER DATA ==========
      if (path === '/data' && (request.method === 'PUT' || request.method === 'POST')) {
        const token = getToken(request, url);
        const session = await verifyToken(token);
        
        if (!session) {
          return json({ error: 'Unauthorized' }, 401);
        }

        let newData;
        const contentType = request.headers.get('Content-Type') || '';
        
        if (contentType.includes('application/json')) {
          newData = await request.json();
        } else {
          // Handle sendBeacon which sends as text
          const text = await request.text();
          newData = JSON.parse(text);
        }
        
        newData.lastSync = new Date().toISOString();
        await env.VIERASTUDY_DATA.put(`data:${session.userId}`, JSON.stringify(newData));
        
        return json({ success: true, lastSync: newData.lastSync });
      }

      // ========== DELETE ACCOUNT ==========
      if (path === '/account' && request.method === 'DELETE') {
        const token = getToken(request, url);
        const session = await verifyToken(token);
        
        if (!session) {
          return json({ error: 'Unauthorized' }, 401);
        }

        // Delete user data
        await env.VIERASTUDY_DATA.delete(`data:${session.userId}`);
        
        // Delete user account
        await env.VIERASTUDY_USERS.delete(`user:${session.email}`);
        
        // Delete session
        await env.VIERASTUDY_USERS.delete(`token:${token}`);

        return json({ success: true, message: 'Account deleted' });
      }

      // ========== REQUEST PASSWORD RESET ==========
      if (path === '/request-password-reset' && request.method === 'POST') {
        const body = await request.json();
        const { email } = body;
        
        if (!email) {
          return json({ error: 'Email is required' }, 400);
        }
        
        const emailLower = email.toLowerCase().trim();
        
        // Rate limiting - 3 attempts per 15 minutes
        const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
        const rateLimitCheck = await checkRateLimit(`reset:${clientIP}`, 3, 900);
        if (!rateLimitCheck.allowed) {
          return json({ 
            error: 'Too many reset attempts', 
            message: `Please try again in ${Math.ceil(rateLimitCheck.resetIn / 60)} minutes` 
          }, 429);
        }
        
        // Check if user exists
        const userJson = await env.VIERASTUDY_USERS.get(`user:${emailLower}`);
        
        // Don't reveal if user exists for security
        if (!userJson) {
          return json({ 
            success: true, 
            message: 'If an account exists, a reset link has been sent' 
          });
        }
        
        // Generate reset token (expires in 1 hour)
        const resetToken = generateToken();
        const resetData = {
          email: emailLower,
          createdAt: Date.now()
        };
        
        await env.VIERASTUDY_USERS.put(`reset:${resetToken}`, JSON.stringify(resetData), {
          expirationTtl: 3600 // 1 hour
        });
        
        // Send email with Resend API
        try {
          const resetLink = `https://vierastudy.com/reset-password.html?token=${resetToken}`;
          
          const emailResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.RESEND_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: 'VieraStudy <noreply@vierastudy.com>',
              to: emailLower,
              subject: 'Reset Your VieraStudy Password',
              html: `
                <!DOCTYPE html>
                <html>
                <head>
                  <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .button { 
                      display: inline-block; 
                      padding: 12px 24px; 
                      background: #667eea; 
                      color: white; 
                      text-decoration: none; 
                      border-radius: 5px;
                      margin: 20px 0;
                    }
                    .footer { margin-top: 30px; font-size: 12px; color: #666; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <h2>Reset Your Password</h2>
                    <p>You requested to reset your VieraStudy password. Click the button below to set a new password:</p>
                    <a href="${resetLink}" class="button">Reset Password</a>
                    <p>Or copy and paste this link into your browser:</p>
                    <p style="word-break: break-all; color: #667eea;">${resetLink}</p>
                    <p>This link will expire in 1 hour.</p>
                    <p>If you didn't request this reset, you can safely ignore this email.</p>
                    <div class="footer">
                      <p>VieraStudy - Your Study Companion</p>
                    </div>
                  </div>
                </body>
                </html>
              `
            })
          });
          
          if (!emailResponse.ok) {
            console.error('Resend API error:', await emailResponse.text());
            // Don't reveal email sending errors to user
          }
        } catch (error) {
          console.error('Email send error:', error);
          // Don't reveal email sending errors to user
        }
        
        return json({ 
          success: true, 
          message: 'If an account exists, a reset link has been sent' 
        });
      }

      // ========== RESET PASSWORD WITH TOKEN ==========
      if (path === '/reset-password' && request.method === 'POST') {
        const body = await request.json();
        const { token, newPassword } = body;
        
        if (!token || !newPassword) {
          return json({ error: 'Token and new password are required' }, 400);
        }
        
        if (newPassword.length < 8) {
          return json({ error: 'Password must be at least 8 characters' }, 400);
        }
        
        // Get reset token data
        const resetDataJson = await env.VIERASTUDY_USERS.get(`reset:${token}`);
        
        if (!resetDataJson) {
          return json({ error: 'Invalid or expired reset link' }, 401);
        }
        
        const resetData = JSON.parse(resetDataJson);
        const email = resetData.email;
        
        // Get user
        const userJson = await env.VIERASTUDY_USERS.get(`user:${email}`);
        
        if (!userJson) {
          return json({ error: 'User not found' }, 404);
        }
        
        const user = JSON.parse(userJson);
        
        // Update password
        user.password = await hashPassword(newPassword);
        user.updatedAt = new Date().toISOString();
        
        // Invalidate old session token
        if (user.currentToken) {
          await env.VIERASTUDY_USERS.delete(`token:${user.currentToken}`);
          user.currentToken = null;
        }
        
        await env.VIERASTUDY_USERS.put(`user:${email}`, JSON.stringify(user));
        
        // Delete reset token so it can't be reused
        await env.VIERASTUDY_USERS.delete(`reset:${token}`);
        
        return json({ 
          success: true, 
          message: 'Password reset successfully. You can now login with your new password.' 
        });
      }

      // ========== CHANGE PASSWORD ==========
      if (path === '/password' && request.method === 'PUT') {
        const token = getToken(request, url);
        const session = await verifyToken(token);
        
        if (!session) {
          return json({ error: 'Unauthorized' }, 401);
        }

        const { currentPassword, newPassword } = await request.json();
        
        if (!currentPassword || !newPassword) {
          return json({ error: 'Current and new password are required' }, 400);
        }
        
        if (newPassword.length < 6) {
          return json({ error: 'New password must be at least 6 characters' }, 400);
        }

        // Get user
        const userJson = await env.VIERASTUDY_USERS.get(`user:${session.email}`);
        if (!userJson) {
          return json({ error: 'User not found' }, 404);
        }

        const user = JSON.parse(userJson);
        const hashedCurrent = await hashPassword(currentPassword);
        
        if (user.password !== hashedCurrent) {
          return json({ error: 'Current password is incorrect' }, 401);
        }

        // Update password
        user.password = await hashPassword(newPassword);
        user.updatedAt = new Date().toISOString();
        await env.VIERASTUDY_USERS.put(`user:${session.email}`, JSON.stringify(user));

        return json({ success: true, message: 'Password updated' });
      }

      // ========== UPDATE PROFILE ==========
      if (path === '/profile' && request.method === 'PUT') {
        const token = getToken(request, url);
        const session = await verifyToken(token);
        
        if (!session) {
          return json({ error: 'Unauthorized' }, 401);
        }

        const { firstName, lastName } = await request.json();
        
        if (!firstName || !firstName.trim()) {
          return json({ error: 'First name is required' }, 400);
        }

        // Get user
        const userJson = await env.VIERASTUDY_USERS.get(`user:${session.email}`);
        if (!userJson) {
          return json({ error: 'User not found' }, 404);
        }

        const user = JSON.parse(userJson);
        
        // Update user profile
        user.firstName = firstName.trim();
        user.lastName = (lastName || '').trim();
        user.updatedAt = new Date().toISOString();
        await env.VIERASTUDY_USERS.put(`user:${session.email}`, JSON.stringify(user));

        // Update session token with new name
        const updatedSession = {
          userId: session.userId,
          email: session.email,
          firstName: user.firstName,
          lastName: user.lastName
        };
        await env.VIERASTUDY_USERS.put(`token:${token}`, JSON.stringify(updatedSession), {
          expirationTtl: 60 * 60 * 24 * 30
        });

        return json({ 
          success: true, 
          message: 'Profile updated',
          user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName }
        });
      }

      // ========== UPGRADE TO PREMIUM ==========
      if (path === '/upgrade-premium' && request.method === 'POST') {
        const token = getToken(request, url);
        const session = await verifyToken(token);
        
        if (!session) {
          return json({ error: 'Unauthorized' }, 401);
        }

        // Get user
        const userJson = await env.VIERASTUDY_USERS.get(`user:${session.email}`);
        if (!userJson) {
          return json({ error: 'User not found' }, 404);
        }

        const user = JSON.parse(userJson);
        
        // Update to premium
        user.isPremium = true;
        user.premiumSince = new Date().toISOString();
        user.updatedAt = new Date().toISOString();
        await env.VIERASTUDY_USERS.put(`user:${session.email}`, JSON.stringify(user));

        // Update session
        const updatedSession = {
          userId: session.userId,
          email: session.email,
          firstName: session.firstName,
          lastName: session.lastName,
          isPremium: true
        };
        await env.VIERASTUDY_USERS.put(`token:${token}`, JSON.stringify(updatedSession), {
          expirationTtl: 60 * 60 * 24 * 30
        });

        return json({ 
          success: true, 
          message: 'Upgraded to premium',
          user: updatedSession
        });
      }

      // ========== ADMIN: LIST ALL USERS ==========
      if (path === '/admin/users' && request.method === 'GET') {
        const token = getToken(request, url);
        const session = await verifyToken(token);
        
        if (!session || !session.isAdmin) {
          return json({ error: 'Unauthorized - Admin access required' }, 403);
        }

        // List all users (KV doesn't have great list support, so this is basic)
        const usersList = [];
        const list = await env.VIERASTUDY_USERS.list({ prefix: 'user:' });
        
        for (const key of list.keys) {
          const userJson = await env.VIERASTUDY_USERS.get(key.name);
          if (userJson) {
            const user = JSON.parse(userJson);
            usersList.push({
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              isPremium: user.isPremium || false,
              isAdmin: user.isAdmin || false,
              createdAt: user.createdAt
            });
          }
        }
        
        return json({ success: true, users: usersList });
      }

      // ========== ADMIN: CREATE USER ==========
      if (path === '/admin/users' && request.method === 'POST') {
        const token = getToken(request, url);
        const session = await verifyToken(token);
        
        if (!session || !session.isAdmin) {
          return json({ error: 'Unauthorized - Admin access required' }, 403);
        }

        const body = await request.json();
        const { email, password, firstName, lastName, isPremium, isAdmin } = body;
        
        if (!email || !password || !firstName) {
          return json({ error: 'Email, password, and first name are required' }, 400);
        }
        
        const emailLower = email.toLowerCase().trim();
        
        // Check if user exists
        const existing = await env.VIERASTUDY_USERS.get(`user:${emailLower}`);
        if (existing) {
          return json({ error: 'User already exists' }, 400);
        }

        const userId = crypto.randomUUID();
        const hashedPassword = await hashPassword(password);
        const userToken = generateToken();
        
        const user = {
          id: userId,
          email: emailLower,
          firstName: firstName.trim(),
          lastName: (lastName || '').trim(),
          password: hashedPassword,
          currentToken: userToken,
          isPremium: isPremium || false,
          isAdmin: isAdmin || false,
          createdAt: new Date().toISOString()
        };

        await env.VIERASTUDY_USERS.put(`user:${emailLower}`, JSON.stringify(user));
        
        // Initialize empty user data
        const initialData = {
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
          settings: { darkMode: false },
          createdAt: new Date().toISOString(),
          lastSync: new Date().toISOString()
        };
        await env.VIERASTUDY_DATA.put(`data:${userId}`, JSON.stringify(initialData));

        return json({ 
          success: true, 
          message: 'User created',
          user: { id: userId, email: emailLower, firstName: user.firstName, lastName: user.lastName }
        });
      }

      // ========== ADMIN: DELETE USER ==========
      if (path === '/admin/users/delete' && request.method === 'POST') {
        const token = getToken(request, url);
        const session = await verifyToken(token);
        
        if (!session || !session.isAdmin) {
          return json({ error: 'Unauthorized - Admin access required' }, 403);
        }

        const body = await request.json();
        const { email } = body;
        
        if (!email) {
          return json({ error: 'Email is required' }, 400);
        }
        
        const emailLower = email.toLowerCase().trim();
        const userJson = await env.VIERASTUDY_USERS.get(`user:${emailLower}`);
        
        if (!userJson) {
          return json({ error: 'User not found' }, 404);
        }

        const user = JSON.parse(userJson);
        
        // Delete user token if exists
        if (user.currentToken) {
          await env.VIERASTUDY_USERS.delete(`token:${user.currentToken}`);
        }
        
        // Delete user data
        await env.VIERASTUDY_DATA.delete(`data:${user.id}`);
        
        // Delete user account
        await env.VIERASTUDY_USERS.delete(`user:${emailLower}`);

        return json({ success: true, message: 'User deleted' });
      }

      // ========== ADMIN: RESET PASSWORD ==========
      if (path === '/admin/users/reset-password' && request.method === 'POST') {
        const token = getToken(request, url);
        const session = await verifyToken(token);
        
        if (!session || !session.isAdmin) {
          return json({ error: 'Unauthorized - Admin access required' }, 403);
        }

        const body = await request.json();
        const { email, newPassword } = body;
        
        if (!email || !newPassword) {
          return json({ error: 'Email and new password are required' }, 400);
        }
        
        if (newPassword.length < 6) {
          return json({ error: 'Password must be at least 6 characters' }, 400);
        }
        
        const emailLower = email.toLowerCase().trim();
        const userJson = await env.VIERASTUDY_USERS.get(`user:${emailLower}`);
        
        if (!userJson) {
          return json({ error: 'User not found' }, 404);
        }

        const user = JSON.parse(userJson);
        const hashedPassword = await hashPassword(newPassword);
        
        // Delete old token
        if (user.currentToken) {
          await env.VIERASTUDY_USERS.delete(`token:${user.currentToken}`);
        }
        
        // Update password and clear token
        user.password = hashedPassword;
        user.currentToken = null;
        user.updatedAt = new Date().toISOString();
        
        await env.VIERASTUDY_USERS.put(`user:${emailLower}`, JSON.stringify(user));

        return json({ success: true, message: 'Password reset successfully' });
      }

      // ========== ADMIN: UPDATE USER ==========
      if (path === '/admin/users/update' && request.method === 'POST') {
        const token = getToken(request, url);
        const session = await verifyToken(token);
        
        if (!session || !session.isAdmin) {
          return json({ error: 'Unauthorized - Admin access required' }, 403);
        }

        const body = await request.json();
        const { email, isPremium, isAdmin } = body;
        
        if (!email) {
          return json({ error: 'Email is required' }, 400);
        }
        
        const emailLower = email.toLowerCase().trim();
        const userJson = await env.VIERASTUDY_USERS.get(`user:${emailLower}`);
        
        if (!userJson) {
          return json({ error: 'User not found' }, 404);
        }

        const user = JSON.parse(userJson);
        
        if (isPremium !== undefined) {
          user.isPremium = isPremium;
        }
        if (isAdmin !== undefined) {
          user.isAdmin = isAdmin;
        }
        
        user.updatedAt = new Date().toISOString();
        await env.VIERASTUDY_USERS.put(`user:${emailLower}`, JSON.stringify(user));

        // Update active session if exists
        if (user.currentToken) {
          const sessionData = await env.VIERASTUDY_USERS.get(`token:${user.currentToken}`);
          if (sessionData) {
            const existingSession = JSON.parse(sessionData);
            existingSession.isPremium = user.isPremium;
            existingSession.isAdmin = user.isAdmin;
            await env.VIERASTUDY_USERS.put(`token:${user.currentToken}`, JSON.stringify(existingSession), {
              expirationTtl: 60 * 60 * 24 * 30
            });
          }
        }

        return json({ success: true, message: 'User updated' });
      }

      // ========== ADMIN: DELETE USER DATA ==========
      if (path === '/admin/users/delete-data' && request.method === 'POST') {
        const token = getToken(request, url);
        const session = await verifyToken(token);
        
        if (!session || !session.isAdmin) {
          return json({ error: 'Unauthorized - Admin access required' }, 403);
        }

        const body = await request.json();
        const { email } = body;
        
        if (!email) {
          return json({ error: 'Email is required' }, 400);
        }
        
        const emailLower = email.toLowerCase().trim();
        const userJson = await env.VIERASTUDY_USERS.get(`user:${emailLower}`);
        
        if (!userJson) {
          return json({ error: 'User not found' }, 404);
        }

        const user = JSON.parse(userJson);
        
        // Reset user data to empty
        const initialData = {
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
          settings: { darkMode: false },
          createdAt: user.createdAt,
          lastSync: new Date().toISOString()
        };
        await env.VIERASTUDY_DATA.put(`data:${user.id}`, JSON.stringify(initialData));

        return json({ success: true, message: 'User data deleted' });
      }

      // ========== 404 ==========
      return json({ error: 'Endpoint not found', path }, 404);

    } catch (error) {
      console.error('API Error:', error);
      return json({ error: 'Internal server error', message: error.message }, 500);
    }
  }
};
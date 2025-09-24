const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Initialize SQLite Database
const db = new sqlite3.Database('purchasing.db');

// Create tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(50) NOT NULL,
        last_name VARCHAR(50) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK(role IN ('requester', 'approver', 'admin')),
        department VARCHAR(100),
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Vendors table
    db.run(`CREATE TABLE IF NOT EXISTS vendors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_name VARCHAR(100) NOT NULL,
        contact_person VARCHAR(100),
        email VARCHAR(100),
        phone VARCHAR(20),
        address TEXT,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Categories table
    db.run(`CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT 1
    )`);

    // Requisitions table
    db.run(`CREATE TABLE IF NOT EXISTS requisitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requisition_number VARCHAR(20) UNIQUE NOT NULL,
        requester_id INTEGER NOT NULL,
        title VARCHAR(200) NOT NULL,
        justification TEXT,
        total_amount DECIMAL(12,2) DEFAULT 0.00,
        status VARCHAR(20) DEFAULT 'draft' CHECK(status IN ('draft', 'submitted', 'pending', 'approved', 'rejected', 'completed', 'cancelled')),
        urgency VARCHAR(20) DEFAULT 'medium' CHECK(urgency IN ('low', 'medium', 'high', 'critical')),
        requested_delivery_date DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (requester_id) REFERENCES users (id)
    )`);

    // Requisition items table
    db.run(`CREATE TABLE IF NOT EXISTS requisition_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requisition_id INTEGER NOT NULL,
        category_id INTEGER,
        vendor_id INTEGER,
        item_description TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        unit_price DECIMAL(10,2),
        total_price DECIMAL(12,2),
        specifications TEXT,
        part_number VARCHAR(100),
        FOREIGN KEY (requisition_id) REFERENCES requisitions (id),
        FOREIGN KEY (category_id) REFERENCES categories (id),
        FOREIGN KEY (vendor_id) REFERENCES vendors (id)
    )`);

    // Approval workflows table
    db.run(`CREATE TABLE IF NOT EXISTS approval_workflows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requisition_id INTEGER NOT NULL,
        approver_id INTEGER NOT NULL,
        approval_level INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'skipped')),
        comments TEXT,
        decision_date DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (requisition_id) REFERENCES requisitions (id),
        FOREIGN KEY (approver_id) REFERENCES users (id)
    )`);

    // Insert default users
    const saltRounds = 10;
    const defaultPassword = 'password123';
    
    bcrypt.hash(defaultPassword, saltRounds, (err, hash) => {
        if (err) throw err;
        
        const users = [
            ['john_doe', 'john@company.com', hash, 'John', 'Doe', 'requester', 'IT'],
            ['jane_smith', 'jane@company.com', hash, 'Jane', 'Smith', 'approver', 'Management'],
            ['admin_user', 'admin@company.com', hash, 'Admin', 'User', 'admin', 'Administration']
        ];

        const stmt = db.prepare(`INSERT OR IGNORE INTO users 
            (username, email, password_hash, first_name, last_name, role, department) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`);
        
        users.forEach(user => {
            stmt.run(user);
        });
        stmt.finalize();
    });

    // Insert default categories
    const categories = [
        ['Office Supplies', 'General office materials and supplies'],
        ['Technology', 'Computers, software, and IT equipment'],
        ['Furniture', 'Office furniture and fixtures']
    ];

    const catStmt = db.prepare('INSERT OR IGNORE INTO categories (category_name, description) VALUES (?, ?)');
    categories.forEach(cat => {
        catStmt.run(cat);
    });
    catStmt.finalize();

    // Insert default vendors
    const vendors = [
        ['Office Depot', 'Sales Team', 'sales@officedepot.com'],
        ['Apple Store', 'Business Sales', 'business@apple.com'],
        ['Amazon Business', 'Account Manager', 'business@amazon.com']
    ];

    const vendStmt = db.prepare('INSERT OR IGNORE INTO vendors (vendor_name, contact_person, email) VALUES (?, ?, ?)');
    vendors.forEach(vendor => {
        vendStmt.run(vendor);
    });
    vendStmt.finalize();
});

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'Authentication required' });
    }
}

function requireRole(roles) {
    return (req, res, next) => {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        db.get('SELECT role FROM users WHERE id = ?', [req.session.userId], (err, row) => {
            if (err || !row) {
                return res.status(401).json({ error: 'User not found' });
            }
            
            if (roles.includes(row.role)) {
                next();
            } else {
                res.status(403).json({ error: 'Insufficient permissions' });
            }
        });
    };
}

// Routes

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get('SELECT * FROM users WHERE username = ? AND is_active = 1', [username], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        bcrypt.compare(password, user.password_hash, (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Authentication error' });
            }
            
            if (result) {
                req.session.userId = user.id;
                req.session.userRole = user.role;
                res.json({
                    id: user.id,
                    username: user.username,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    role: user.role,
                    department: user.department
                });
            } else {
                res.status(401).json({ error: 'Invalid credentials' });
            }
        });
    });
});

// Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out successfully' });
});

// Get current user
app.get('/api/user', requireAuth, (req, res) => {
    db.get('SELECT id, username, first_name, last_name, role, department FROM users WHERE id = ?', 
        [req.session.userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(user);
    });
});

// Get requisitions
app.get('/api/requisitions', requireAuth, (req, res) => {
    let query = `SELECT r.*, u.first_name, u.last_name 
                 FROM requisitions r 
                 JOIN users u ON r.requester_id = u.id`;
    let params = [];
    
    // Filter based on user role
    if (req.session.userRole !== 'admin') {
        query += ' WHERE r.requester_id = ?';
        params.push(req.session.userId);
    }
    
    query += ' ORDER BY r.created_at DESC';
    
    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Get items for each requisition
        const promises = rows.map(req => {
            return new Promise((resolve, reject) => {
                db.all('SELECT * FROM requisition_items WHERE requisition_id = ?', [req.id], (err, items) => {
                    if (err) reject(err);
                    else resolve({ ...req, items });
                });
            });
        });
        
        Promise.all(promises).then(requisitions => {
            res.json(requisitions);
        }).catch(err => {
            res.status(500).json({ error: 'Error fetching requisition items' });
        });
    });
});

// Get pending requisitions for approval
app.get('/api/requisitions/pending', requireAuth, requireRole(['approver', 'admin']), (req, res) => {
    const query = `SELECT r.*, u.first_name, u.last_name 
                   FROM requisitions r 
                   JOIN users u ON r.requester_id = u.id 
                   WHERE r.status = 'pending' 
                   ORDER BY r.created_at DESC`;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Get items for each requisition
        const promises = rows.map(req => {
            return new Promise((resolve, reject) => {
                db.all('SELECT * FROM requisition_items WHERE requisition_id = ?', [req.id], (err, items) => {
                    if (err) reject(err);
                    else resolve({ ...req, items });
                });
            });
        });
        
        Promise.all(promises).then(requisitions => {
            res.json(requisitions);
        }).catch(err => {
            res.status(500).json({ error: 'Error fetching requisition items' });
        });
    });
});

// Create requisition
app.post('/api/requisitions', requireAuth, requireRole(['requester', 'admin']), (req, res) => {
    const { title, justification, urgency, requestedDeliveryDate, items, status = 'draft' } = req.body;
    
    if (!title || !items || items.length === 0) {
        return res.status(400).json({ error: 'Title and items are required' });
    }
    
    // Calculate total
    const totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    
    // Generate requisition number
    db.get('SELECT COUNT(*) as count FROM requisitions', [], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        const reqNumber = `REQ-${new Date().getFullYear()}-${String(row.count + 1).padStart(3, '0')}`;
        const finalStatus = status === 'submitted' ? 'pending' : status;
        
        db.run(`INSERT INTO requisitions 
                (requisition_number, requester_id, title, justification, total_amount, status, urgency, requested_delivery_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [reqNumber, req.session.userId, title, justification, totalAmount, finalStatus, urgency, requestedDeliveryDate],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }
                
                const requisitionId = this.lastID;
                
                // Insert items
                const stmt = db.prepare(`INSERT INTO requisition_items 
                    (requisition_id, item_description, quantity, unit_price, total_price)
                    VALUES (?, ?, ?, ?, ?)`);
                
                items.forEach(item => {
                    const totalPrice = item.quantity * item.unitPrice;
                    stmt.run([requisitionId, item.description, item.quantity, item.unitPrice, totalPrice]);
                });
                
                stmt.finalize((err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Error saving items' });
                    }
                    
                    res.json({
                        id: requisitionId,
                        requisition_number: reqNumber,
                        message: `Requisition ${finalStatus === 'pending' ? 'submitted for approval' : 'saved as draft'}`
                    });
                });
            });
    });
});

// Update requisition status (approve/reject)
app.put('/api/requisitions/:id/status', requireAuth, requireRole(['approver', 'admin']), (req, res) => {
    const { id } = req.params;
    const { status, comments } = req.body;
    
    if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }
    
    db.run('UPDATE requisitions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [status, id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Requisition not found' });
        }
        
        // Log approval workflow
        db.run(`INSERT INTO approval_workflows 
                (requisition_id, approver_id, approval_level, status, comments, decision_date)
                VALUES (?, ?, 1, ?, ?, CURRENT_TIMESTAMP)`,
            [id, req.session.userId, status, comments]);
        
        res.json({ message: `Requisition ${status} successfully` });
    });
});

// Get categories
app.get('/api/categories', requireAuth, (req, res) => {
    db.all('SELECT * FROM categories WHERE is_active = 1 ORDER BY category_name', [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(rows);
    });
});

// Get vendors
app.get('/api/vendors', requireAuth, (req, res) => {
    db.all('SELECT * FROM vendors WHERE is_active = 1 ORDER BY vendor_name', [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(rows);
    });
});

// Serve the main application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Default login credentials:');
    console.log('- john_doe / password123 (Requester)');
    console.log('- jane_smith / password123 (Approver)');
    console.log('- admin_user / password123 (Admin)');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});
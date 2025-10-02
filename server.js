const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: function(req, file, cb) {
        // Allow common file types
        const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|txt|zip|rar/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname) {
            return cb(null, true);
        } else {
            cb(new Error('Invalid file type. Allowed types: images, PDF, Word, Excel, text, zip'));
        }
    }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Serve static files from public directory, not root
app.use(express.static('public'));
// Serve uploaded files (with authentication check)
app.use('/uploads', requireAuthMiddleware, express.static('uploads'));

const db = new sqlite3.Database('./requisitions.db');

db.serialize(function() {
    // Create tables
    db.run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, is_active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
    
    // Updated requisitions table with cost breakdown fields
    db.run(`CREATE TABLE IF NOT EXISTS requisitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        title TEXT NOT NULL, 
        justification TEXT, 
        urgency TEXT DEFAULT "medium", 
        requested_delivery_date DATE, 
        expected_delivery_date DATE,
        supplier_id INTEGER, 
        manual_supplier TEXT,
        links TEXT, 
        status TEXT DEFAULT "draft", 
        budget_code TEXT, 
        po_number TEXT, 
        envelope_number TEXT, 
        rig_allocation TEXT,
        net_cost REAL,
        vat_amount REAL,
        gross_cost REAL,
        vat_rate REAL DEFAULT 20,
        requester_id INTEGER NOT NULL, 
        approval_notes TEXT,
        rconder_approved_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, requisition_id INTEGER NOT NULL, item_description TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price REAL DEFAULT 0)');
    db.run('CREATE TABLE IF NOT EXISTS suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT NOT NULL, contact_person TEXT, email TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
    
    // Create attachments table
    db.run(`CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requisition_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mimetype TEXT,
        size INTEGER,
        uploaded_by INTEGER,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
        FOREIGN KEY (uploaded_by) REFERENCES users(id)
    )`);
    
    // Add columns if they don't exist (for existing databases)
    db.run('ALTER TABLE requisitions ADD COLUMN approval_notes TEXT', function(err) {});
    db.run('ALTER TABLE requisitions ADD COLUMN rconder_approved_at DATETIME', function(err) {});
    db.run('ALTER TABLE requisitions ADD COLUMN expected_delivery_date DATE', function(err) {});
    db.run('ALTER TABLE requisitions ADD COLUMN manual_supplier TEXT', function(err) {});
    db.run('ALTER TABLE requisitions ADD COLUMN net_cost REAL', function(err) {});
    db.run('ALTER TABLE requisitions ADD COLUMN vat_amount REAL', function(err) {});
    db.run('ALTER TABLE requisitions ADD COLUMN gross_cost REAL', function(err) {});
    db.run('ALTER TABLE requisitions ADD COLUMN vat_rate REAL DEFAULT 20', function(err) {});
    
    const defaultUsers = [
        { username: 'poo', email: 'poo@example.com', password: 'poo', role: 'requester' },
        { username: 'Rconder', email: 'ryan@example.com', password: 'SFXteam2025!', role: 'admin' },
        { username: 'Nhirons', email: 'nathan@example.com', password: 'SFXteam2025!', role: 'approver' }
    ];
    
    defaultUsers.forEach(function(user) {
        bcrypt.hash(user.password, 10, function(err, hash) {
            if (err) return;
            db.run('INSERT OR IGNORE INTO users (username, email, password, role) VALUES (?, ?, ?, ?)', [user.username, user.email, hash, user.role]);
        });
    });
});

function requireAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

function requireAuthMiddleware(req, res, next) {
    if (!req.session.userId) return res.status(401).send('Unauthorized');
    next();
}

function requireRole() {
    var roles = Array.prototype.slice.call(arguments);
    return function(req, res, next) {
        if (roles.indexOf(req.session.userRole) === -1) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        next();
    };
}

app.post('/api/login', function(req, res) {
    const username = req.body.username;
    const password = req.body.password;
    
    db.get('SELECT * FROM users WHERE username = ? AND is_active = 1', [username], function(err, user) {
        if (err || !user) return res.status(401).json({ error: 'Invalid credentials' });
        
        bcrypt.compare(password, user.password, function(err, result) {
            if (result) {
                req.session.userId = user.id;
                req.session.username = user.username;
                req.session.userRole = user.role;
                console.log('User logged in:', user.username, 'ID:', user.id, 'Role:', user.role);
                res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
            } else {
                res.status(401).json({ error: 'Invalid credentials' });
            }
        });
    });
});

app.post('/api/logout', function(req, res) {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/requisitions', requireAuth, function(req, res) {
    const status = req.query.status;
    const search = req.query.search;
    const userId = req.session.userId;
    const userRole = req.session.userRole;
    
    var query = 'SELECT r.*, u.username as requester_name, s.supplier_name, COALESCE(s.supplier_name, r.manual_supplier) as display_supplier, GROUP_CONCAT(i.item_description || " (Qty: " || i.quantity || ", Price: £" || i.unit_price || ")", "; ") as items_summary, SUM(i.quantity * i.unit_price) as total_cost FROM requisitions r LEFT JOIN users u ON r.requester_id = u.id LEFT JOIN suppliers s ON r.supplier_id = s.id LEFT JOIN items i ON r.id = i.requisition_id';
    
    var conditions = [];
    var params = [];
    
    // Only add status condition if status parameter is provided
    if (status) {
        conditions.push('r.status = ?');
        params.push(status);
    }
    // If no status parameter, show all statuses
    
    if (userRole === 'requester') {
        conditions.push('r.requester_id = ?');
        params.push(userId);
    }
    
    if (search && search.trim() !== '') {
        conditions.push('(r.title LIKE ? OR r.justification LIKE ? OR s.supplier_name LIKE ? OR r.manual_supplier LIKE ? OR i.item_description LIKE ? OR r.po_number LIKE ? OR r.budget_code LIKE ?)');
        const searchTerm = '%' + search + '%';
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' GROUP BY r.id ORDER BY r.created_at DESC';
    
    db.all(query, params, function(err, rows) {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(rows || []);
    });
});

app.get('/api/requisitions/:id', requireAuth, function(req, res) {
    const reqId = req.params.id;
    const userId = req.session.userId;
    const userRole = req.session.userRole;
    
    db.get('SELECT r.*, u.username as requester_name FROM requisitions r LEFT JOIN users u ON r.requester_id = u.id WHERE r.id = ?', [reqId], function(err, requisition) {
        if (err || !requisition) {
            return res.status(404).json({ error: 'Requisition not found' });
        }
        
        var canEdit = false;
        
        // Admin and approver can always edit
        if (userRole === 'admin' || userRole === 'approver') {
            canEdit = true;
        } 
        // Requester can only edit their own requisitions that are NOT approved, purchased, or delivered
        else if (userRole === 'requester' && requisition.requester_id === userId) {
            if (requisition.status === 'draft' || requisition.status === 'pending') {
                canEdit = true;
            }
        }
        
        db.all('SELECT * FROM items WHERE requisition_id = ?', [reqId], function(err, items) {
            if (err) items = [];
            
            // Get attachments for this requisition
            db.all('SELECT a.*, u.username as uploaded_by_name FROM attachments a LEFT JOIN users u ON a.uploaded_by = u.id WHERE a.requisition_id = ? ORDER BY a.uploaded_at DESC', 
                [reqId], function(err, attachments) {
                if (err) attachments = [];
                
                requisition.items = items;
                requisition.attachments = attachments;
                requisition.canEdit = canEdit;
                res.json(requisition);
            });
        });
    });
});

// Upload files to requisition
app.post('/api/requisitions/:id/upload', requireAuth, upload.array('files', 5), function(req, res) {
    const reqId = req.params.id;
    const userId = req.session.userId;
    const userRole = req.session.userRole;
    
    // Check if user can edit this requisition
    db.get('SELECT * FROM requisitions WHERE id = ?', [reqId], function(err, requisition) {
        if (err || !requisition) {
            // Delete uploaded files if requisition doesn't exist
            if (req.files) {
                req.files.forEach(file => fs.unlinkSync(file.path));
            }
            return res.status(404).json({ error: 'Requisition not found' });
        }
        
        var canEdit = false;
        if (userRole === 'admin' || userRole === 'approver') {
            canEdit = true;
        } else if (userRole === 'requester' && requisition.requester_id === userId) {
            if (requisition.status === 'draft' || requisition.status === 'pending') {
                canEdit = true;
            }
        }
        
        if (!canEdit) {
            // Delete uploaded files if user can't edit
            if (req.files) {
                req.files.forEach(file => fs.unlinkSync(file.path));
            }
            return res.status(403).json({ error: 'You do not have permission to upload files to this requisition' });
        }
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }
        
        // Save file info to database
        const stmt = db.prepare('INSERT INTO attachments (requisition_id, filename, original_name, mimetype, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)');
        
        req.files.forEach(function(file) {
            stmt.run(reqId, file.filename, file.originalname, file.mimetype, file.size, userId);
        });
        
        stmt.finalize(function() {
            res.json({ 
                success: true, 
                message: req.files.length + ' file(s) uploaded successfully',
                files: req.files.map(f => ({ 
                    filename: f.filename, 
                    originalname: f.originalname,
                    size: f.size
                }))
            });
        });
    });
});

// Delete attachment
app.delete('/api/attachments/:id', requireAuth, function(req, res) {
    const attachmentId = req.params.id;
    const userId = req.session.userId;
    const userRole = req.session.userRole;
    
    // Get attachment details
    db.get('SELECT a.*, r.requester_id FROM attachments a JOIN requisitions r ON a.requisition_id = r.id WHERE a.id = ?', 
        [attachmentId], function(err, attachment) {
        if (err || !attachment) {
            return res.status(404).json({ error: 'Attachment not found' });
        }
        
        // Check permissions
        var canDelete = false;
        if (userRole === 'admin' || userRole === 'approver') {
            canDelete = true;
        } else if (userRole === 'requester' && attachment.requester_id === userId) {
            canDelete = true;
        }
        
        if (!canDelete) {
            return res.status(403).json({ error: 'You do not have permission to delete this attachment' });
        }
        
        // Delete file from filesystem
        const filepath = path.join(__dirname, 'uploads', attachment.filename);
        fs.unlink(filepath, function(err) {
            // Continue even if file doesn't exist on disk
            
            // Delete from database
            db.run('DELETE FROM attachments WHERE id = ?', [attachmentId], function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Failed to delete attachment' });
                }
                res.json({ success: true, message: 'Attachment deleted successfully' });
            });
        });
    });
});

app.post('/api/requisitions', requireAuth, function(req, res) {
    const title = req.body.title;
    const justification = req.body.justification;
    const urgency = req.body.urgency;
    const requestedDeliveryDate = req.body.requestedDeliveryDate;
    const expectedDeliveryDate = req.body.expectedDeliveryDate;
    const supplierId = req.body.supplierId;
    const manualSupplier = req.body.manualSupplier;
    const links = req.body.links;
    const status = req.body.status;
    const items = req.body.items;
    const budgetCode = req.body.budgetCode;
    const poNumber = req.body.poNumber;
    const envelopeNumber = req.body.envelopeNumber;
    const rigAllocation = req.body.rigAllocation;
    const netCost = req.body.netCost;
    const vatAmount = req.body.vatAmount;
    const grossCost = req.body.grossCost;
    const vatRate = req.body.vatRate;
    
    const userId = req.session.userId;
    const userRole = req.session.userRole;
    
    db.run('INSERT INTO requisitions (title, justification, urgency, requested_delivery_date, expected_delivery_date, supplier_id, manual_supplier, links, status, budget_code, po_number, envelope_number, rig_allocation, net_cost, vat_amount, gross_cost, vat_rate, requester_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        title, justification, urgency || 'medium', requestedDeliveryDate,
        (userRole === 'admin' || userRole === 'approver') ? expectedDeliveryDate : null,
        supplierId || null, 
        manualSupplier || null,
        links, status, 
        (userRole === 'admin' || userRole === 'approver') ? budgetCode : null,
        (userRole === 'admin' || userRole === 'approver') ? poNumber : null,
        (userRole === 'admin' || userRole === 'approver') ? envelopeNumber : null,
        rigAllocation || null,
        (userRole === 'admin' || userRole === 'approver') ? netCost : null,
        (userRole === 'admin' || userRole === 'approver') ? vatAmount : null,
        (userRole === 'admin' || userRole === 'approver') ? grossCost : null,
        (userRole === 'admin' || userRole === 'approver') ? vatRate : null,
        userId
    ], function(err) {
        if (err) {
            console.error('Error creating requisition:', err);
            return res.status(500).json({ error: 'Failed to create requisition' });
        }
        
        const reqId = this.lastID;
        
        if (items && items.length > 0) {
            const stmt = db.prepare('INSERT INTO items (requisition_id, item_description, quantity, unit_price) VALUES (?, ?, ?, ?)');
            items.forEach(function(item) {
                stmt.run(reqId, item.description, item.quantity, item.unitPrice || 0);
            });
            stmt.finalize();
        }
        
        res.json({ success: true, message: 'Requisition created successfully', id: reqId });
    });
});

// Update requisition endpoint with stricter permission checks
app.put('/api/requisitions/:id', requireAuth, function(req, res) {
    const reqId = req.params.id;
    const userId = req.session.userId;
    const userRole = req.session.userRole;
    
    db.get('SELECT * FROM requisitions WHERE id = ?', [reqId], function(err, requisition) {
        if (err || !requisition) return res.status(404).json({ error: 'Not found' });
        
        var canEdit = false;
        
        // Admin and approver can always edit
        if (userRole === 'admin' || userRole === 'approver') {
            canEdit = true;
        } 
        // Requester can only edit their own requisitions that are NOT approved, purchased, or delivered
        else if (userRole === 'requester' && requisition.requester_id === userId) {
            // Check if status is draft or pending (not approved, purchased, or delivered)
            if (requisition.status === 'draft' || requisition.status === 'pending') {
                canEdit = true;
            }
        }
        
        if (!canEdit) {
            return res.status(403).json({ error: 'Permission denied. Requesters cannot edit requisitions after approval.' });
        }
        
        // Determine the new status
        var newStatus = req.body.status;
        
        // If admin/approver is editing, preserve the current status unless they explicitly want to change it
        if (userRole === 'admin' || userRole === 'approver') {
            // If no status provided in request, keep the current status
            if (!newStatus || newStatus === requisition.status) {
                newStatus = requisition.status;
            }
            // Admin/approver can set any status they want
        } else {
            // Requesters can only set draft or pending status
            if (newStatus !== 'draft' && newStatus !== 'pending') {
                newStatus = requisition.status; // Keep current status
            }
        }
        
        // Update the requisition
        db.run('UPDATE requisitions SET title=?, justification=?, urgency=?, requested_delivery_date=?, expected_delivery_date=?, supplier_id=?, manual_supplier=?, links=?, status=?, budget_code=?, po_number=?, envelope_number=?, rig_allocation=?, net_cost=?, vat_amount=?, gross_cost=?, vat_rate=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [
            req.body.title, 
            req.body.justification, 
            req.body.urgency || 'medium', 
            req.body.requestedDeliveryDate,
            (userRole === 'admin' || userRole === 'approver') ? req.body.expectedDeliveryDate : requisition.expected_delivery_date,
            req.body.supplierId || null, 
            req.body.manualSupplier || null,
            req.body.links, 
            newStatus,  // Use the determined status
            (userRole === 'admin' || userRole === 'approver') ? req.body.budgetCode : requisition.budget_code,
            (userRole === 'admin' || userRole === 'approver') ? req.body.poNumber : requisition.po_number,
            (userRole === 'admin' || userRole === 'approver') ? req.body.envelopeNumber : requisition.envelope_number,
            req.body.rigAllocation || null,
            (userRole === 'admin' || userRole === 'approver') ? req.body.netCost : requisition.net_cost,
            (userRole === 'admin' || userRole === 'approver') ? req.body.vatAmount : requisition.vat_amount,
            (userRole === 'admin' || userRole === 'approver') ? req.body.grossCost : requisition.gross_cost,
            (userRole === 'admin' || userRole === 'approver') ? req.body.vatRate : requisition.vat_rate,
            reqId
        ], function(err) {
            if (err) return res.status(500).json({ error: 'Update failed' });
            
            // Update items
            db.run('DELETE FROM items WHERE requisition_id = ?', [reqId], function() {
                if (req.body.items && req.body.items.length > 0) {
                    const stmt = db.prepare('INSERT INTO items (requisition_id, item_description, quantity, unit_price) VALUES (?, ?, ?, ?)');
                    req.body.items.forEach(function(item) {
                        stmt.run(reqId, item.description, item.quantity, item.unitPrice || 0);
                    });
                    stmt.finalize();
                }
                res.json({ success: true, message: 'Updated successfully' });
            });
        });
    });
});

// Approve requisition endpoint - FIXED to handle multiple approvers
app.put('/api/requisitions/:id/approve', requireAuth, function(req, res) {
    const reqId = req.params.id;
    const userId = req.session.userId;
    const username = req.session.username;
    const userRole = req.session.userRole;
    const comments = req.body.comments || '';
    
    console.log('Approve attempt - Username:', username, 'User ID:', userId, 'Role:', userRole);
    
    // Check if user has permission to approve
    if (userRole !== 'admin' && userRole !== 'approver') {
        return res.status(403).json({ error: 'Only admins and approvers can approve requisitions' });
    }
    
    db.get('SELECT * FROM requisitions WHERE id = ?', [reqId], function(err, requisition) {
        if (err || !requisition) return res.status(404).json({ error: 'Not found' });
        if (requisition.status !== 'pending') return res.status(400).json({ error: 'Only pending requisitions can be approved' });
        
        const timestamp = new Date().toISOString();
        const readableTime = new Date(timestamp).toLocaleString('en-GB', {
            day: '2-digit',
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        // Parse existing approval notes
        let approvalNotes = [];
        try {
            if (requisition.approval_notes) {
                approvalNotes = JSON.parse(requisition.approval_notes);
            }
        } catch (e) {
            approvalNotes = [];
        }
        
        // Add new approval note with comments if provided
        approvalNotes.push({
            username: username,
            timestamp: timestamp,
            action: 'approved',
            comments: comments
        });
        
        // Check if this is Rconder approving
        if (username === 'Rconder') {
            // Rconder's approval moves to approved status and turns green
            db.run('UPDATE requisitions SET status = ?, rconder_approved_at = ?, approval_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
                ['approved', timestamp, JSON.stringify(approvalNotes), reqId], 
                function(err) {
                    if (err) {
                        console.error('Approval update failed:', err);
                        return res.status(500).json({ error: 'Approval failed' });
                    }
                    console.log('Rconder approval successful - moved to approved');
                    res.json({ 
                        success: true, 
                        message: 'Ryan Conder (Rconder) has fully approved at ' + readableTime + '. Requisition moved to Approved tab and turned green.' 
                    });
                });
        } else {
            // Other approvers just add notes but don't change status
            db.run('UPDATE requisitions SET approval_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
                [JSON.stringify(approvalNotes), reqId], 
                function(err) {
                    if (err) {
                        console.error('Approval update failed:', err);
                        return res.status(500).json({ error: 'Approval failed' });
                    }
                    console.log('Approval note added for', username);
                    var displayName = username;
                    if (username === 'Nhirons') {
                        displayName = 'Nathan Hirons (Nhirons)';
                    }
                    res.json({ 
                        success: true, 
                        message: displayName + ' approved at ' + readableTime + '. Requisition remains in Pending Approval until Ryan Conder (Rconder) approves.' 
                    });
                });
        }
    });
});

// Delete requisition with same permission logic as edit
app.delete('/api/requisitions/:id', requireAuth, function(req, res) {
    const reqId = req.params.id;
    const userId = req.session.userId;
    const userRole = req.session.userRole;
    
    db.get('SELECT * FROM requisitions WHERE id = ?', [reqId], function(err, requisition) {
        if (err || !requisition) return res.status(404).json({ error: 'Not found' });
        
        var canDelete = false;
        
        // Admin and approver can always delete
        if (userRole === 'admin' || userRole === 'approver') {
            canDelete = true;
        } 
        // Requester can only delete their own requisitions that are NOT approved, purchased, or delivered
        else if (userRole === 'requester' && requisition.requester_id === userId) {
            if (requisition.status === 'draft' || requisition.status === 'pending') {
                canDelete = true;
            }
        }
        
        if (!canDelete) {
            return res.status(403).json({ error: 'Permission denied. Requesters cannot delete requisitions after approval.' });
        }
        
        db.run('DELETE FROM requisitions WHERE id = ?', [reqId], function(err) {
            if (err) return res.status(500).json({ error: 'Delete failed' });
            res.json({ success: true, message: 'Deleted successfully' });
        });
    });
});

app.put('/api/requisitions/:id/reject', requireAuth, requireRole('admin', 'approver'), function(req, res) {
    const reqId = req.params.id;
    const username = req.session.username;
    const timestamp = new Date().toISOString();
    
    db.get('SELECT * FROM requisitions WHERE id = ?', [reqId], function(err, requisition) {
        if (err || !requisition) return res.status(404).json({ error: 'Not found' });
        
        // Parse existing approval notes
        let approvalNotes = [];
        try {
            if (requisition.approval_notes) {
                approvalNotes = JSON.parse(requisition.approval_notes);
            }
        } catch (e) {
            approvalNotes = [];
        }
        
        // Add rejection note
        approvalNotes.push({
            username: username,
            timestamp: timestamp,
            action: 'rejected',
            reason: req.body.comments || 'No reason provided'
        });
        
        db.run('UPDATE requisitions SET status = ?, approval_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
            ['draft', JSON.stringify(approvalNotes), reqId], 
            function(err) {
                if (err) return res.status(500).json({ error: 'Reject failed' });
                res.json({ success: true, message: 'Rejected and moved to draft' });
            });
    });
});

app.put('/api/requisitions/:id/change-status', requireAuth, requireRole('admin', 'approver'), function(req, res) {
    const reqId = req.params.id;
    const newStatus = req.body.newStatus;
    
    const validStatuses = ['draft', 'pending', 'approved', 'purchased', 'delivered'];
    if (validStatuses.indexOf(newStatus) === -1) {
        return res.status(400).json({ error: 'Invalid status' });
    }
    
    db.run('UPDATE requisitions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newStatus, reqId], function(err) {
        if (err) return res.status(500).json({ error: 'Status change failed' });
        res.json({ success: true, message: 'Status changed to ' + newStatus });
    });
});

app.get('/api/suppliers', requireAuth, function(req, res) {
    db.all('SELECT * FROM suppliers ORDER BY supplier_name', function(err, rows) {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows || []);
    });
});

app.post('/api/suppliers', requireAuth, requireRole('admin', 'approver'), function(req, res) {
    const supplierName = req.body.supplierName;
    const contactPerson = req.body.contactPerson;
    const email = req.body.email;
    
    if (!supplierName) {
        return res.status(400).json({ error: 'Supplier name is required' });
    }
    
    db.run('INSERT INTO suppliers (supplier_name, contact_person, email) VALUES (?, ?, ?)', 
        [supplierName, contactPerson || null, email || null], 
        function(err) {
            if (err) {
                console.error('Error creating supplier:', err);
                return res.status(500).json({ error: 'Failed to create supplier' });
            }
            res.json({ success: true, message: 'Supplier added successfully', id: this.lastID });
        });
});

app.put('/api/suppliers/:id', requireAuth, requireRole('admin', 'approver'), function(req, res) {
    const supplierId = req.params.id;
    const supplierName = req.body.supplierName;
    const contactPerson = req.body.contactPerson;
    const email = req.body.email;
    
    if (!supplierName) {
        return res.status(400).json({ error: 'Supplier name is required' });
    }
    
    db.run('UPDATE suppliers SET supplier_name = ?, contact_person = ?, email = ? WHERE id = ?',
        [supplierName, contactPerson || null, email || null, supplierId],
        function(err) {
            if (err) {
                console.error('Error updating supplier:', err);
                return res.status(500).json({ error: 'Failed to update supplier' });
            }
            res.json({ success: true, message: 'Supplier updated successfully' });
        });
});

app.delete('/api/suppliers/:id', requireAuth, requireRole('admin', 'approver'), function(req, res) {
    const supplierId = req.params.id;
    
    // Check if supplier is being used in any requisitions
    db.get('SELECT COUNT(*) as count FROM requisitions WHERE supplier_id = ?', [supplierId], function(err, row) {
        if (err) return res.status(500).json({ error: 'Database error' });
        
        if (row.count > 0) {
            return res.status(400).json({ error: 'Cannot delete supplier - it is being used in ' + row.count + ' requisition(s)' });
        }
        
        db.run('DELETE FROM suppliers WHERE id = ?', [supplierId], function(err) {
            if (err) {
                console.error('Error deleting supplier:', err);
                return res.status(500).json({ error: 'Failed to delete supplier' });
            }
            res.json({ success: true, message: 'Supplier deleted successfully' });
        });
    });
});

app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/app.js', function(req, res) {
    res.sendFile(path.join(__dirname, 'app.js'));
});

// Export requisitions to Excel
app.get('/api/export/requisitions', requireAuth, function(req, res) {
    const xlsx = require('xlsx');
    
    // Get all requisitions with full details - including manual_supplier and cost breakdown
    db.all(`
        SELECT 
            r.*,
            u.username as requester_name,
            s.supplier_name,
            s.contact_person as supplier_contact,
            s.email as supplier_email,
            COALESCE(s.supplier_name, r.manual_supplier) as display_supplier
        FROM requisitions r
        LEFT JOIN users u ON r.requester_id = u.id
        LEFT JOIN suppliers s ON r.supplier_id = s.id
        ORDER BY r.created_at DESC
    `, [], function(err, requisitions) {
        if (err) {
            console.error('Export error:', err);
            return res.status(500).json({ error: 'Export failed' });
        }
        
        // Get all items for all requisitions
        db.all('SELECT * FROM items ORDER BY requisition_id', [], function(err, allItems) {
            if (err) allItems = [];
            
            // Process data for Excel
            const excelData = [];
            
            requisitions.forEach(function(req) {
                // Parse approval notes
                let approvalHistory = '';
                try {
                    if (req.approval_notes) {
                        const notes = JSON.parse(req.approval_notes);
                        approvalHistory = notes.map(n => {
                            const time = new Date(n.timestamp).toLocaleString();
                            let text = n.username + ' ' + n.action + ' at ' + time;
                            if (n.comments) text += ' (' + n.comments + ')';
                            return text;
                        }).join('; ');
                    }
                } catch (e) {
                    approvalHistory = '';
                }
                
                // Get items for this requisition (for listing, not cost calculation)
                const reqItems = allItems.filter(item => item.requisition_id === req.id);
                const itemsList = reqItems.map(item => 
                    item.item_description + ' (Qty: ' + item.quantity + ', Unit Price: £' + item.unit_price + ')'
                ).join('; ');
                
                // Format dates
                const createdDate = new Date(req.created_at).toLocaleDateString();
                const requestedDeliveryDate = req.requested_delivery_date ? new Date(req.requested_delivery_date).toLocaleDateString() : '';
                const expectedDeliveryDate = req.expected_delivery_date ? new Date(req.expected_delivery_date).toLocaleDateString() : '';
                
                // Use admin-entered costs ONLY (Net/VAT/Gross)
                const netCost = req.net_cost ? parseFloat(req.net_cost).toFixed(2) : '';
                const vatAmount = req.vat_amount ? parseFloat(req.vat_amount).toFixed(2) : '';
                const grossCost = req.gross_cost ? parseFloat(req.gross_cost).toFixed(2) : '';
                const vatRate = req.vat_rate || '';
                
                excelData.push({
                    'ID': req.id,
                    'Date Created': createdDate,
                    'Status': req.status ? req.status.toUpperCase() : '',
                    'Title': req.title || '',
                    'Requester': req.requester_name || '',
                    'Supplier': req.display_supplier || '',
                    'Supplier Contact': req.supplier_contact || '',
                    'Supplier Email': req.supplier_email || '',
                    'Items': itemsList,
                    'Net Cost (£)': netCost,
                    'VAT Rate (%)': vatRate,
                    'VAT Amount (£)': vatAmount,
                    'Gross Cost (£)': grossCost,
                    'Urgency': req.urgency || '',
                    'Requested Delivery': requestedDeliveryDate,
                    'Expected Delivery': expectedDeliveryDate,
                    'Rig Allocation': req.rig_allocation || '',
                    'Justification': req.justification || '',
                    'PO Number': req.po_number || '',
                    'Budget Code': req.budget_code || '',
                    'Envelope Number': req.envelope_number || '',
                    'Links': req.links || '',
                    'Approval History': approvalHistory
                });
            });
            
            // Create workbook
            const wb = xlsx.utils.book_new();
            const ws = xlsx.utils.json_to_sheet(excelData);
            
            // Auto-size columns
            const maxWidth = 50;
            const wscols = [
                {wch: 6},  // ID
                {wch: 12}, // Date Created
                {wch: 10}, // Status
                {wch: 25}, // Title
                {wch: 15}, // Requester
                {wch: 20}, // Supplier
                {wch: 20}, // Supplier Contact
                {wch: 25}, // Supplier Email
                {wch: maxWidth}, // Items
                {wch: 12}, // Net Cost
                {wch: 10}, // VAT Rate
                {wch: 12}, // VAT Amount
                {wch: 12}, // Gross Cost
                {wch: 10}, // Urgency
                {wch: 15}, // Requested Delivery
                {wch: 15}, // Expected Delivery
                {wch: 15}, // Rig Allocation
                {wch: 30}, // Justification
                {wch: 15}, // PO Number
                {wch: 15}, // Budget Code
                {wch: 15}, // Envelope Number
                {wch: 30}, // Links
                {wch: maxWidth} // Approval History
            ];
            ws['!cols'] = wscols;
            
            xlsx.utils.book_append_sheet(wb, ws, 'Requisitions');
            
            // Generate Excel file
            const excelBuffer = xlsx.write(wb, { bookType: 'xlsx', type: 'buffer' });
            
            // Send file
            const filename = 'requisitions_' + new Date().toISOString().split('T')[0] + '.xlsx';
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename=' + filename);
            res.send(excelBuffer);
        });
    });
});

// User management endpoints
app.get('/api/users', requireAuth, requireRole('admin'), function(req, res) {
    db.all('SELECT id, username, email, role, is_active, created_at FROM users ORDER BY username', function(err, rows) {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows || []);
    });
});

app.post('/api/users', requireAuth, requireRole('admin'), function(req, res) {
    const username = req.body.username;
    const email = req.body.email;
    const password = req.body.password;
    const role = req.body.role;
    
    if (!username || !email || !password || !role) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    
    bcrypt.hash(password, 10, function(err, hash) {
        if (err) return res.status(500).json({ error: 'Failed to hash password' });
        
        db.run('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
            [username, email, hash, role],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Username or email already exists' });
                    }
                    return res.status(500).json({ error: 'Failed to create user' });
                }
                res.json({ success: true, message: 'User created successfully', id: this.lastID });
            });
    });
});

app.put('/api/users/:id', requireAuth, requireRole('admin'), function(req, res) {
    const userId = req.params.id;
    const username = req.body.username;
    const email = req.body.email;
    const role = req.body.role;
    const isActive = req.body.isActive;
    const password = req.body.password;
    
    // Don't allow admin to deactivate themselves
    if (userId == req.session.userId && isActive === false) {
        return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }
    
    if (password) {
        // If password is provided, hash it and update everything
        bcrypt.hash(password, 10, function(err, hash) {
            if (err) return res.status(500).json({ error: 'Failed to hash password' });
            
            db.run('UPDATE users SET username = ?, email = ?, role = ?, is_active = ?, password = ? WHERE id = ?',
                [username, email, role, isActive ? 1 : 0, hash, userId],
                function(err) {
                    if (err) return res.status(500).json({ error: 'Failed to update user' });
                    res.json({ success: true, message: 'User updated successfully' });
                });
        });
    } else {
        // Update without changing password
        db.run('UPDATE users SET username = ?, email = ?, role = ?, is_active = ? WHERE id = ?',
            [username, email, role, isActive ? 1 : 0, userId],
            function(err) {
                if (err) return res.status(500).json({ error: 'Failed to update user' });
                res.json({ success: true, message: 'User updated successfully' });
            });
    }
});

app.delete('/api/users/:id', requireAuth, requireRole('admin'), function(req, res) {
    const userId = req.params.id;
    
    // Don't allow admin to delete themselves
    if (userId == req.session.userId) {
        return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    
    // Check if user has requisitions
    db.get('SELECT COUNT(*) as count FROM requisitions WHERE requester_id = ?', [userId], function(err, row) {
        if (err) return res.status(500).json({ error: 'Database error' });
        
        if (row.count > 0) {
            return res.status(400).json({ error: 'Cannot delete user - they have ' + row.count + ' requisition(s)' });
        }
        
        db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
            if (err) return res.status(500).json({ error: 'Failed to delete user' });
            res.json({ success: true, message: 'User deleted successfully' });
        });
    });
});

// Generate invite link
app.post('/api/users/invite', requireAuth, requireRole('admin'), function(req, res) {
    const email = req.body.email;
    const role = req.body.role;
    
    // In a real system, you'd send an email. For now, we'll return a signup link
    const inviteToken = crypto.randomBytes(32).toString('hex');
    
    // Store invite in database (you'd need to create an invites table in production)
    // For now, we'll just return the link
    const inviteLink = 'http://localhost:3000/signup?token=' + inviteToken + '&email=' + encodeURIComponent(email) + '&role=' + role;
    
    res.json({ 
        success: true, 
        message: 'Invite link generated', 
        link: inviteLink,
        note: 'Send this link to ' + email + ' to allow them to create their account'
    });
});

app.listen(PORT, function() {
    console.log('Server running on http://localhost:3000');
    console.log('Accounts: poo/poo, Rconder/SFXteam2025!, Nhirons/SFXteam2025!');
});

process.on('SIGINT', function() {
    console.log('\nShutting down...');
    db.close(function() {
        process.exit(0);
    });
});

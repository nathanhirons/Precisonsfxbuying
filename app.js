var currentUser = null;
var currentTab = 'draft';
var editingReqId = null;
var editingReqStatus = null; // Store the current status of the requisition being edited
var viewOnlyMode = false; // Track if we're in view-only mode

function doLogin() {
    var username = document.getElementById('username').value;
    var password = document.getElementById('password').value;

    fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
        if (result.error) {
            alert(result.error);
        } else {
            currentUser = result.user;
            console.log('Logged in user:', currentUser);
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('mainApp').classList.remove('hidden');
            document.getElementById('welcomeMsg').textContent = 'Welcome, ' + currentUser.username + ' (' + currentUser.role + ')';
            
            if (currentUser.role === 'admin') {
                document.getElementById('usersTab').classList.remove('hidden');
                document.getElementById('adminFields').classList.remove('hidden');
                document.getElementById('expectedDeliveryField').style.display = 'block';
            } else if (currentUser.role === 'approver') {
                document.getElementById('adminFields').classList.remove('hidden');
                document.getElementById('expectedDeliveryField').style.display = 'block';
            }
            
            loadOrders('draft');
            loadSuppliers();
        }
    });
}

function doLogout() {
    fetch('/api/logout', { method: 'POST' })
        .then(function() {
            currentUser = null;
            location.reload();
        });
}

function exportToExcel() {
    // Get the button that was clicked
    var button = document.querySelector('button[onclick="exportToExcel()"]');
    if (!button) return;
    
    // Show loading message
    var originalText = button.textContent;
    button.textContent = 'Generating Excel...';
    button.disabled = true;
    
    fetch('/api/export/requisitions')
        .then(function(response) {
            if (!response.ok) {
                throw new Error('Export failed');
            }
            return response.blob();
        })
        .then(function(blob) {
            // Create download link
            var url = window.URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            var date = new Date().toISOString().split('T')[0];
            a.download = 'precision_sfx_requisitions_' + date + '.xlsx';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            // Reset button
            button.textContent = originalText;
            button.disabled = false;
        })
        .catch(function(error) {
            alert('Failed to export requisitions: ' + error.message);
            button.textContent = originalText;
            button.disabled = false;
        });
}

function showTab(tabName, element) {
    document.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.nav-tab').forEach(function(t) { t.classList.remove('active'); });
    
    document.getElementById(tabName).classList.add('active');
    if (element) element.classList.add('active');
    
    currentTab = tabName;
    
    if (['draft', 'pending', 'approved', 'purchased', 'delivered'].indexOf(tabName) !== -1) {
        loadOrders(tabName);
    } else if (tabName === 'suppliers') {
        loadSuppliersList();
    } else if (tabName === 'users') {
        loadUsersList();
    }
}

function loadOrders(status) {
    var searchInput = document.getElementById('search' + status.charAt(0).toUpperCase() + status.slice(1));
    var searchTerm = searchInput ? searchInput.value : '';
    
    // If status is 'draft', don't send status parameter to get all requisitions
    var url = '/api/requisitions?';
    if (status !== 'draft') {
        url += 'status=' + status + '&';
    }
    url += 'search=' + encodeURIComponent(searchTerm);
    
    fetch(url)
        .then(function(r) { return r.json(); })
        .then(function(reqs) {
            var listDiv = document.getElementById(status + 'List');
            if (reqs.length === 0) {
                listDiv.innerHTML = '<p>No requisitions found.</p>';
                return;
            }
            
            listDiv.innerHTML = reqs.map(function(req) {
                // Check if fully approved by Rconder
                var isFullyApproved = req.rconder_approved_at;
                var approvedClass = isFullyApproved ? 'approved-full' : '';
                
                // Parse and display approval notes - show on ALL statuses, not just pending
                var approvalInfo = '';
                var approvalNotes = [];
                try {
                    if (req.approval_notes) {
                        approvalNotes = JSON.parse(req.approval_notes);
                    }
                } catch (e) {
                    approvalNotes = [];
                }
                
                if (approvalNotes.length > 0) {
                    approvalInfo = '<div class="approval-info"><strong>Approval History:</strong><br>';
                    approvalNotes.forEach(function(note) {
                        var timestamp = new Date(note.timestamp).toLocaleString('en-GB', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        if (note.action === 'approved') {
                            approvalInfo += '<span class="checkmark">✔</span> <strong>' + note.username + '</strong> approved at ' + timestamp;
                            if (note.comments) {
                                approvalInfo += ' - Comments: "' + note.comments + '"';
                            }
                            approvalInfo += '<br>';
                        } else if (note.action === 'rejected') {
                            approvalInfo += '<span style="color: #e74c3c;">✖</span> <strong>' + note.username + '</strong> rejected at ' + timestamp;
                            if (note.reason) {
                                approvalInfo += ' - Reason: "' + note.reason + '"';
                            }
                            approvalInfo += '<br>';
                        }
                    });
                    
                    // Show if still waiting for Rconder (only in pending status)
                    if (status === 'pending' && !req.rconder_approved_at) {
                        approvalInfo += '<span style="color: #f39c12;">⏳</span> <strong>Awaiting Ryan Conder (Rconder) final approval</strong>';
                    }
                    approvalInfo += '</div>';
                }
                
                var statusSelect = '';
                if (['admin', 'approver'].indexOf(currentUser.role) !== -1 && status !== 'draft') {
                    statusSelect = '<select id="statusSelect' + req.id + '" onchange="changeStatus(' + req.id + ')" style="padding:6px;border-radius:4px;border:1px solid #ddd;margin-top:10px">';
                    statusSelect += '<option value="">Change Status...</option>';
                    if (status !== 'pending') statusSelect += '<option value="pending">Pending</option>';
                    if (status !== 'approved') statusSelect += '<option value="approved">Approved</option>';
                    if (status !== 'purchased') statusSelect += '<option value="purchased">Purchased</option>';
                    if (status !== 'delivered') statusSelect += '<option value="delivered">Delivered</option>';
                    statusSelect += '</select>';
                }
                
                var actions = '<div class="requisition-actions">';
                
                var canEditReq = (['admin', 'approver'].indexOf(currentUser.role) !== -1) || 
                                  (currentUser.role === 'requester' && req.requester_id === currentUser.id && 
                                   req.status !== 'approved' && req.status !== 'purchased' && req.status !== 'delivered');
                
                // Check if requester should view in read-only mode
                var isRequesterViewOnly = currentUser.role === 'requester' && 
                                         req.requester_id === currentUser.id &&
                                         (req.status === 'approved' || req.status === 'purchased' || req.status === 'delivered');
                
                if (canEditReq) {
                    actions += '<button class="btn btn-primary btn-small" onclick="editRequisition(' + req.id + ')">Edit</button>';
                } else if (isRequesterViewOnly) {
                    // Add View button for requesters to see their approved/purchased/delivered requisitions
                    actions += '<button class="btn btn-primary btn-small" onclick="viewRequisition(' + req.id + ')">View Details</button>';
                }
                
                if (status === 'pending' && ['admin', 'approver'].indexOf(currentUser.role) !== -1) {
                    actions += '<button class="btn btn-success btn-small" onclick="approveRequisition(' + req.id + ')">Approve</button>';
                    actions += '<button class="btn btn-warning btn-small" onclick="rejectRequisition(' + req.id + ')">Reject</button>';
                }
                
                var canDeleteReq = (['admin', 'approver'].indexOf(currentUser.role) !== -1) || 
                                    (currentUser.role === 'requester' && req.requester_id === currentUser.id && 
                                     req.status !== 'approved' && req.status !== 'purchased' && req.status !== 'delivered');
                
                if (canDeleteReq) {
                    actions += '<button class="btn btn-danger btn-small" onclick="deleteRequisition(' + req.id + ')">Delete</button>';
                }
                
                if (statusSelect) {
                    actions += statusSelect;
                }
                
                actions += '</div>';
                
                // Display cost - use gross if available, otherwise use calculated total
                var displayCost = req.gross_cost || req.total_cost || 0;
                var costLabel = req.gross_cost ? 'Gross Cost' : 'Total Cost';
                
                return '<div class="requisition-item ' + approvedClass + '">' +
                    '<h3>' + req.title + '<span class="status-badge status-' + req.status + '">' + req.status.toUpperCase() + '</span></h3>' +
                    '<div class="requisition-details">' +
                    '<div><strong>Requester</strong>' + (req.requester_name || 'N/A') + '</div>' +
                    '<div><strong>Supplier</strong>' + (req.display_supplier || req.supplier_name || req.manual_supplier || 'N/A') + '</div>' +
                    '<div><strong>Urgency</strong>' + (req.urgency || 'N/A') + '</div>' +
                    '<div><strong>' + costLabel + '</strong>£' + displayCost.toFixed(2) + '</div>' +
                    (req.net_cost ? '<div><strong>Net Cost</strong>£' + parseFloat(req.net_cost).toFixed(2) + '</div>' : '') +
                    (req.vat_amount ? '<div><strong>VAT</strong>£' + parseFloat(req.vat_amount).toFixed(2) + '</div>' : '') +
                    '<div><strong>Requested Delivery</strong>' + (req.requested_delivery_date || 'N/A') + '</div>' +
                    (req.expected_delivery_date ? '<div style="background:#e8f5e9;padding:3px;border-radius:3px;"><strong>Expected Delivery</strong>' + req.expected_delivery_date + '</div>' : '') +
                    '<div><strong>Rig Allocation</strong>' + (req.rig_allocation || 'N/A') + '</div>' +
                    '<div><strong>PO Number</strong>' + (req.po_number || 'N/A') + '</div>' +
                    '<div><strong>Budget Code</strong>' + (req.budget_code || 'N/A') + '</div>' +
                    '<div><strong>Created</strong>' + new Date(req.created_at).toLocaleDateString() + '</div>' +
                    '</div>' +
                    '<div style="margin-top:10px"><strong>Items:</strong> ' + (req.items_summary || 'No items') + '</div>' +
                    (req.justification ? '<div style="margin-top:10px"><strong>Justification:</strong> ' + req.justification + '</div>' : '') +
                    approvalInfo +
                    actions +
                    '</div>';
            }).join('');
        });
}

function searchRequisitions(status) {
    loadOrders(status);
}

// New function to view requisition in read-only mode
function viewRequisition(id) {
    fetch('/api/requisitions/' + id)
        .then(function(r) { return r.json(); })
        .then(function(req) {
            viewOnlyMode = true;
            editingReqId = id;
            editingReqStatus = req.status;
            
            // Store the current tab before switching to create/edit tab
            var previousTab = currentTab;
            
            document.getElementById('formTitle').textContent = 'View Requisition (Read-Only)';
            
            // Populate all fields
            document.getElementById('title').value = req.title || '';
            document.getElementById('justification').value = req.justification || '';
            document.getElementById('urgency').value = req.urgency || 'medium';
            document.getElementById('requestedDeliveryDate').value = req.requested_delivery_date || '';
            document.getElementById('supplierId').value = req.supplier_id || '';
            document.getElementById('manualSupplier').value = req.manual_supplier || '';
            document.getElementById('rigAllocation').value = req.rig_allocation || '';
            document.getElementById('links').value = req.links || '';
            
            // Show expected delivery date if set
            var expectedDeliveryField = document.getElementById('expectedDeliveryField');
            var expectedDeliveryInput = document.getElementById('expectedDeliveryDate');
            
            if (req.expected_delivery_date) {
                expectedDeliveryField.style.display = 'block';
                expectedDeliveryInput.value = req.expected_delivery_date;
            }
            
            // Show admin fields with values if they exist
            if (req.budget_code || req.po_number || req.envelope_number || req.net_cost || req.gross_cost) {
                document.getElementById('adminFields').classList.remove('hidden');
                document.getElementById('budgetCode').value = req.budget_code || '';
                document.getElementById('poNumber').value = req.po_number || '';
                document.getElementById('envelopeNumber').value = req.envelope_number || '';
                document.getElementById('netCost').value = req.net_cost || '';
                document.getElementById('vatRate').value = req.vat_rate || 20;
                document.getElementById('vatAmount').value = req.vat_amount || '';
                document.getElementById('grossCost').value = req.gross_cost || '';
            }
            
            // Set all form fields to read-only
            setFormReadOnly(true);
            
            // Display items in read-only mode
            var itemsList = document.getElementById('itemsList');
            itemsList.innerHTML = '';
            if (req.items && req.items.length > 0) {
                req.items.forEach(function(item) { 
                    addItemReadOnly(item); 
                });
            }
            
            // Display existing attachments (viewable)
            displayExistingAttachments(req.attachments || [], true);
            
            // Hide all action buttons
            document.querySelectorAll('#create .btn').forEach(function(btn) {
                btn.style.display = 'none';
            });
            
            // Show only a "Back" button
            var backBtn = document.getElementById('backFromView');
            if (!backBtn) {
                backBtn = document.createElement('button');
                backBtn.id = 'backFromView';
                backBtn.className = 'btn btn-primary';
                backBtn.textContent = 'Back';
                backBtn.onclick = function() {
                    viewOnlyMode = false;
                    resetForm();
                    showTab(previousTab, document.querySelectorAll('.nav-tab')[getTabIndex(previousTab)]);
                };
                document.querySelector('#create form').appendChild(backBtn);
            } else {
                backBtn.style.display = 'inline-block';
            }
            
            // Store the previous tab to return to on back
            backBtn.setAttribute('data-previous-tab', previousTab);
            
            showTab('create', document.querySelectorAll('.nav-tab')[5]);
        });
}

function editRequisition(id) {
    fetch('/api/requisitions/' + id)
        .then(function(r) { return r.json(); })
        .then(function(req) {
            if (!req.canEdit) {
                alert('You do not have permission to edit this requisition');
                return;
            }
            
            viewOnlyMode = false;
            editingReqId = id;
            editingReqStatus = req.status; // Store the current status
            // Store the current tab before switching to create/edit tab
            var previousTab = currentTab;
            
            // Make sure form is editable
            setFormReadOnly(false);
            
            document.getElementById('formTitle').textContent = 'Edit Requisition';
            document.getElementById('title').value = req.title || '';
            document.getElementById('justification').value = req.justification || '';
            document.getElementById('urgency').value = req.urgency || 'medium';
            document.getElementById('requestedDeliveryDate').value = req.requested_delivery_date || '';
            document.getElementById('supplierId').value = req.supplier_id || '';
            document.getElementById('manualSupplier').value = req.manual_supplier || '';
            document.getElementById('rigAllocation').value = req.rig_allocation || '';
            document.getElementById('links').value = req.links || '';
            
            // Show expected delivery date for all users (read-only for requesters)
            var expectedDeliveryField = document.getElementById('expectedDeliveryField');
            var expectedDeliveryInput = document.getElementById('expectedDeliveryDate');
            
            if (req.expected_delivery_date) {
                expectedDeliveryField.style.display = 'block';
                expectedDeliveryInput.value = req.expected_delivery_date;
            }
            
            // Make field editable only for admin/approver
            if (['admin', 'approver'].indexOf(currentUser.role) !== -1) {
                expectedDeliveryInput.readOnly = false;
                expectedDeliveryField.style.display = 'block';
                document.getElementById('budgetCode').value = req.budget_code || '';
                document.getElementById('poNumber').value = req.po_number || '';
                document.getElementById('envelopeNumber').value = req.envelope_number || '';
                
                // Cost breakdown fields
                document.getElementById('netCost').value = req.net_cost || '';
                document.getElementById('vatRate').value = req.vat_rate || 20;
                document.getElementById('vatAmount').value = req.vat_amount || '';
                document.getElementById('grossCost').value = req.gross_cost || '';
            } else {
                expectedDeliveryInput.readOnly = true;
                if (!req.expected_delivery_date) {
                    expectedDeliveryField.style.display = 'none';
                }
            }
            
            var itemsList = document.getElementById('itemsList');
            itemsList.innerHTML = '';
            if (req.items && req.items.length > 0) {
                req.items.forEach(function(item) { addItem(item); });
            } else {
                addItem();
            }
            
            // Display existing attachments
            displayExistingAttachments(req.attachments || [], false);
            
            // Show action buttons
            document.querySelectorAll('#create .btn').forEach(function(btn) {
                if (btn.id !== 'backFromView') {
                    btn.style.display = 'inline-block';
                }
            });
            
            // Hide back button if it exists
            var backBtn = document.getElementById('backFromView');
            if (backBtn) {
                backBtn.style.display = 'none';
            }
            
            document.getElementById('cancelEdit').classList.remove('hidden');
            
            // Store the previous tab to return to on cancel
            document.getElementById('cancelEdit').setAttribute('data-previous-tab', previousTab);
            
            showTab('create', document.querySelectorAll('.nav-tab')[5]);
        });
}

function setFormReadOnly(readOnly) {
    // Set all input fields to read-only
    document.querySelectorAll('#requisitionForm input, #requisitionForm select, #requisitionForm textarea').forEach(function(field) {
        field.readOnly = readOnly;
        field.disabled = readOnly;
        if (readOnly) {
            field.style.backgroundColor = '#f5f5f5';
            field.style.cursor = 'not-allowed';
        } else {
            field.style.backgroundColor = '';
            field.style.cursor = '';
        }
    });
    
    // Hide file input button in read-only mode
    var fileInputBtn = document.querySelector('button[onclick*="fileInput"]');
    if (fileInputBtn) {
        fileInputBtn.style.display = readOnly ? 'none' : 'inline-block';
    }
}

function addItemReadOnly(item) {
    var itemsList = document.getElementById('itemsList');
    var itemDiv = document.createElement('div');
    itemDiv.className = 'form-group';
    itemDiv.style.padding = '15px';
    itemDiv.style.background = '#f8f9fa';
    itemDiv.style.borderRadius = '5px';
    itemDiv.style.marginBottom = '10px';
    itemDiv.innerHTML = 
        '<label>Description</label>' +
        '<input type="text" class="item-desc" value="' + (item.item_description || '') + '" readonly style="background-color: #f5f5f5; cursor: not-allowed;">' +
        '<label>Quantity</label>' +
        '<input type="number" class="item-qty" value="' + (item.quantity || 1) + '" readonly style="background-color: #f5f5f5; cursor: not-allowed;">' +
        '<label>Unit Price (£)</label>' +
        '<input type="number" class="item-price" value="' + (item.unit_price || 0) + '" readonly style="background-color: #f5f5f5; cursor: not-allowed;">';
    itemsList.appendChild(itemDiv);
}

function displayExistingAttachments(attachments, viewOnly) {
    var existingFilesDiv = document.getElementById('existingFiles');
    if (!attachments || attachments.length === 0) {
        existingFilesDiv.innerHTML = '';
        return;
    }
    
    var html = '<strong>Attachments:</strong><br>';
    attachments.forEach(function(file) {
        var fileSize = (file.size / 1024).toFixed(2) + ' KB';
        if (file.size > 1024 * 1024) {
            fileSize = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
        }
        html += '<div style="margin: 5px 0; padding: 5px; background: #f0f0f0; border-radius: 3px;">';
        html += '<a href="/uploads/' + file.filename + '" target="_blank">' + file.original_name + '</a>';
        html += ' (' + fileSize + ') - Uploaded by ' + (file.uploaded_by_name || 'Unknown');
        
        // Only show delete button if not in view-only mode
        if (!viewOnly) {
            html += ' <button class="btn btn-danger btn-small" onclick="deleteAttachment(' + file.id + ', \'' + file.original_name + '\')">Delete</button>';
        }
        
        html += '</div>';
    });
    existingFilesDiv.innerHTML = html;
}

function getTabIndex(tabName) {
    var tabIndexMap = {
        'draft': 0,
        'pending': 1,
        'approved': 2,
        'purchased': 3,
        'delivered': 4,
        'create': 5,
        'suppliers': 6,
        'users': 7
    };
    return tabIndexMap[tabName] || 0;
}

function deleteAttachment(attachmentId, filename) {
    if (!confirm('Are you sure you want to delete ' + filename + '?')) return;
    
    fetch('/api/attachments/' + attachmentId, { method: 'DELETE' })
        .then(function(r) { return r.json(); })
        .then(function(result) {
            if (result.error) {
                alert(result.error);
            } else {
                alert('Attachment deleted successfully');
                // Refresh the requisition to update attachment list
                if (editingReqId) {
                    editRequisition(editingReqId);
                }
            }
        });
}

function deleteRequisition(id) {
    if (!confirm('Are you sure you want to delete this requisition?')) return;
    
    fetch('/api/requisitions/' + id, { method: 'DELETE' })
        .then(function(r) { return r.json(); })
        .then(function(result) {
            if (result.error) {
                alert(result.error);
            } else {
                alert(result.message);
                loadOrders(currentTab);
            }
        });
}

function approveRequisition(id) {
    var comments = prompt('Optional comments for approval:');
    fetch('/api/requisitions/' + id + '/approve', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments: comments })
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
        if (result.error) {
            alert(result.error);
        } else {
            alert(result.message);
            loadOrders(currentTab);
        }
    });
}

function rejectRequisition(id) {
    var reason = prompt('Rejection reason:');
    if (!reason) return;
    
    fetch('/api/requisitions/' + id + '/reject', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments: reason })
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
        alert(result.message);
        loadOrders(currentTab);
    });
}

function changeStatus(id) {
    var selectElement = document.getElementById('statusSelect' + id);
    var newStatus = selectElement.value;
    
    if (!newStatus) return;
    if (!confirm('Change status to ' + newStatus + '?')) return;
    
    fetch('/api/requisitions/' + id + '/change-status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus: newStatus })
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
        alert(result.message);
        showTab(newStatus, document.querySelector('.nav-tab'));
        loadOrders(newStatus);
    });
}

function loadSuppliers() {
    fetch('/api/suppliers')
        .then(function(r) { return r.json(); })
        .then(function(suppliers) {
            var select = document.getElementById('supplierId');
            select.innerHTML = '<option value="">Select Supplier</option>';
            suppliers.forEach(function(s) {
                select.innerHTML += '<option value="' + s.id + '">' + s.supplier_name + '</option>';
            });
        });
}

function loadSuppliersList() {
    fetch('/api/suppliers')
        .then(function(r) { return r.json(); })
        .then(function(suppliers) {
            var div = document.getElementById('suppliersList');
            if (suppliers.length === 0) {
                div.innerHTML = '<p>No suppliers found.</p>';
                return;
            }
            
            var canEdit = currentUser && (currentUser.role === 'admin' || currentUser.role === 'approver');
            
            div.innerHTML = '<table><tr><th>Name</th><th>Contact</th><th>Email</th>' + 
                (canEdit ? '<th>Actions</th>' : '') + '</tr>' +
                suppliers.map(function(s) {
                    return '<tr>' +
                        '<td>' + s.supplier_name + '</td>' +
                        '<td>' + (s.contact_person || '') + '</td>' +
                        '<td>' + (s.email || '') + '</td>' +
                        (canEdit ? '<td>' +
                            '<button class="btn btn-primary btn-small" onclick="editSupplier(' + s.id + ', \'' + 
                                s.supplier_name.replace(/'/g, "\\'") + '\', \'' + 
                                (s.contact_person || '').replace(/'/g, "\\'") + '\', \'' + 
                                (s.email || '').replace(/'/g, "\\'") + '\')">Edit</button>' +
                            '<button class="btn btn-danger btn-small" onclick="deleteSupplier(' + s.id + ')">Delete</button>' +
                        '</td>' : '') +
                    '</tr>';
                }).join('') +
                '</table>';
        });
}

function editSupplier(id, name, contact, email) {
    var newName = prompt('Supplier Name:', name);
    if (newName === null) return;
    
    var newContact = prompt('Contact Person:', contact);
    var newEmail = prompt('Email:', email);
    
    fetch('/api/suppliers/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            supplierName: newName,
            contactPerson: newContact,
            email: newEmail
        })
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
        if (result.error) {
            alert(result.error);
        } else {
            alert(result.message);
            loadSuppliers(); // Reload dropdown
            loadSuppliersList(); // Reload list
        }
    });
}

function deleteSupplier(id) {
    if (!confirm('Are you sure you want to delete this supplier?')) return;
    
    fetch('/api/suppliers/' + id, { method: 'DELETE' })
        .then(function(r) { return r.json(); })
        .then(function(result) {
            if (result.error) {
                alert(result.error);
            } else {
                alert(result.message);
                loadSuppliers(); // Reload dropdown
                loadSuppliersList(); // Reload list
            }
        });
}

function addItem(item) {
    item = item || {};
    var itemsList = document.getElementById('itemsList');
    var itemDiv = document.createElement('div');
    itemDiv.className = 'form-group';
    itemDiv.style.padding = '15px';
    itemDiv.style.background = '#f8f9fa';
    itemDiv.style.borderRadius = '5px';
    itemDiv.style.marginBottom = '10px';
    itemDiv.innerHTML = 
        '<label>Description</label>' +
        '<input type="text" class="item-desc" value="' + (item.item_description || '') + '" required>' +
        '<label>Quantity</label>' +
        '<input type="number" class="item-qty" value="' + (item.quantity || 1) + '" min="1" required>' +
        '<label>Unit Price (£)</label>' +
        '<input type="number" class="item-price" value="' + (item.unit_price || 0) + '" step="0.01">' +
        '<button type="button" class="btn btn-small btn-danger" onclick="this.parentElement.remove()" style="margin-top:10px">Remove Item</button>';
    itemsList.appendChild(itemDiv);
}

function saveRequisition(status) {
    if (!currentUser) {
        alert('Please login first');
        return;
    }

    var items = [];
    document.querySelectorAll('#itemsList > div').forEach(function(div) {
        var desc = div.querySelector('.item-desc').value;
        var qty = parseInt(div.querySelector('.item-qty').value);
        var price = parseFloat(div.querySelector('.item-price').value) || 0;
        if (desc && qty) {
            items.push({ description: desc, quantity: qty, unitPrice: price });
        }
    });

    if (items.length === 0) {
        alert('Please add at least one item');
        return;
    }

    // For admins/approvers editing existing requisitions, preserve the current status
    var finalStatus = status;
    if (editingReqId && (currentUser.role === 'admin' || currentUser.role === 'approver')) {
        // Don't change the status when admin/approver edits
        // The server will preserve the existing status
        finalStatus = null; // Let server decide based on current status
    }

    var data = {
        title: document.getElementById('title').value,
        justification: document.getElementById('justification').value,
        urgency: document.getElementById('urgency').value,
        requestedDeliveryDate: document.getElementById('requestedDeliveryDate').value,
        supplierId: document.getElementById('supplierId').value,
        manualSupplier: document.getElementById('manualSupplier').value,
        rigAllocation: document.getElementById('rigAllocation').value,
        links: document.getElementById('links').value,
        status: finalStatus,
        items: items
    };
    
    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'approver')) {
        data.budgetCode = document.getElementById('budgetCode').value;
        data.poNumber = document.getElementById('poNumber').value;
        data.envelopeNumber = document.getElementById('envelopeNumber').value;
        data.expectedDeliveryDate = document.getElementById('expectedDeliveryDate').value;
        data.netCost = document.getElementById('netCost').value;
        data.vatRate = document.getElementById('vatRate').value || 20;
        data.vatAmount = document.getElementById('vatAmount').value;
        data.grossCost = document.getElementById('grossCost').value;
    }

    var url = editingReqId ? '/api/requisitions/' + editingReqId : '/api/requisitions';
    var method = editingReqId ? 'PUT' : 'POST';

    fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
        if (result.error) {
            alert(result.error);
        } else {
            // Upload files if any were selected
            var fileInput = document.getElementById('fileInput');
            var requisitionId = editingReqId || result.id;
            
            if (fileInput && fileInput.files.length > 0) {
                uploadFiles(requisitionId, function() {
                    alert(result.message + ' Files uploaded successfully.');
                    finalizeSave(status);
                });
            } else {
                alert(result.message);
                finalizeSave(status);
            }
        }
    });
}

function uploadFiles(requisitionId, callback) {
    var fileInput = document.getElementById('fileInput');
    if (!fileInput || fileInput.files.length === 0) {
        if (callback) callback();
        return;
    }
    
    var formData = new FormData();
    for (var i = 0; i < fileInput.files.length; i++) {
        formData.append('files', fileInput.files[i]);
    }
    
    fetch('/api/requisitions/' + requisitionId + '/upload', {
        method: 'POST',
        body: formData
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
        if (result.error) {
            alert('File upload error: ' + result.error);
        }
        if (callback) callback();
    })
    .catch(function(error) {
        alert('File upload failed: ' + error.message);
        if (callback) callback();
    });
}

function finalizeSave(status) {
    editingReqId = null;
    viewOnlyMode = false;
    resetForm();
    document.getElementById('cancelEdit').classList.add('hidden');
    var targetStatus = status === 'pending' ? 'pending' : 'draft';
    showTab(targetStatus, document.querySelector('.nav-tab'));
}

function resetForm() {
    document.getElementById('requisitionForm').reset();
    document.getElementById('itemsList').innerHTML = '';
    document.getElementById('formTitle').textContent = 'Create Requisition';
    document.getElementById('existingFiles').innerHTML = '';
    editingReqId = null;
    viewOnlyMode = false;
    setFormReadOnly(false);
    
    // Show action buttons
    document.querySelectorAll('#create .btn').forEach(function(btn) {
        if (btn.id !== 'backFromView') {
            btn.style.display = 'inline-block';
        }
    });
    
    // Hide back button
    var backBtn = document.getElementById('backFromView');
    if (backBtn) {
        backBtn.style.display = 'none';
    }
    
    addItem();
}

function cancelEdit() {
    editingReqId = null;
    viewOnlyMode = false;
    resetForm();
    var cancelBtn = document.getElementById('cancelEdit');
    cancelBtn.classList.add('hidden');
    
    // Get the previous tab from the data attribute or default to draft
    var previousTab = cancelBtn.getAttribute('data-previous-tab') || 'draft';
    
    // Find the correct nav-tab element for the previous tab
    var navTabs = document.querySelectorAll('.nav-tab');
    var targetTabElement = navTabs[0]; // default to first tab
    
    if (getTabIndex(previousTab) !== undefined) {
        targetTabElement = navTabs[getTabIndex(previousTab)];
    }
    
    showTab(previousTab, targetTabElement);
}

document.addEventListener('DOMContentLoaded', function() {
    addItem();
    
    document.getElementById('username').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') doLogin();
    });
    document.getElementById('password').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') doLogin();
    });
    
    var supplierForm = document.getElementById('supplierForm');
    if (supplierForm) {
        supplierForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            var supplierName = document.getElementById('supplierName').value;
            var contactPerson = document.getElementById('contactPerson').value;
            var supplierEmail = document.getElementById('supplierEmail').value;
            
            fetch('/api/suppliers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    supplierName: supplierName,
                    contactPerson: contactPerson,
                    email: supplierEmail
                })
            })
            .then(function(r) { return r.json(); })
            .then(function(result) {
                if (result.error) {
                    alert(result.error);
                } else {
                    alert(result.message);
                    document.getElementById('supplierForm').reset();
                    loadSuppliers(); // Reload the supplier dropdown
                    loadSuppliersList(); // Reload the suppliers list
                }
            });
        });
    }
    
    var inviteForm = document.getElementById('inviteForm');
    if (inviteForm) {
        inviteForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            var email = document.getElementById('inviteEmail').value;
            var role = document.getElementById('inviteRole').value;
            
            // Generate invite link
            fetch('/api/users/invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email, role: role })
            })
            .then(function(r) { return r.json(); })
            .then(function(result) {
                if (result.error) {
                    alert(result.error);
                } else {
                    // Show the invite link in a prompt so user can copy it
                    prompt('Copy this invite link and send it to ' + email + ':', result.link);
                    document.getElementById('inviteForm').reset();
                    loadUsersList();
                }
            });
        });
    }
    
    // Handle file input changes
    var fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            var fileList = document.getElementById('fileList');
            var fileCount = document.getElementById('fileCount');
            
            if (e.target.files.length > 0) {
                fileCount.textContent = e.target.files.length + ' file(s) selected';
                var fileNames = [];
                for (var i = 0; i < e.target.files.length; i++) {
                    fileNames.push(e.target.files[i].name);
                }
                fileList.innerHTML = '<small>Selected: ' + fileNames.join(', ') + '</small>';
            } else {
                fileCount.textContent = '';
                fileList.innerHTML = '';
            }
        });
    }
});

function loadUsersList() {
    fetch('/api/users')
        .then(function(r) { return r.json(); })
        .then(function(users) {
            var div = document.getElementById('usersList');
            if (!div) return;
            
            if (users.length === 0) {
                div.innerHTML = '<p>No users found.</p>';
                return;
            }
            
            div.innerHTML = '<table><tr><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr>' +
                users.map(function(u) {
                    var isCurrentUser = currentUser && u.id === currentUser.id;
                    return '<tr>' +
                        '<td>' + u.username + (isCurrentUser ? ' (You)' : '') + '</td>' +
                        '<td>' + u.email + '</td>' +
                        '<td>' + u.role + '</td>' +
                        '<td>' + (u.is_active ? 'Active' : 'Inactive') + '</td>' +
                        '<td>' + new Date(u.created_at).toLocaleDateString() + '</td>' +
                        '<td>' +
                            '<button class="btn btn-primary btn-small" onclick="editUser(' + u.id + ', \'' + 
                                u.username.replace(/'/g, "\\'") + '\', \'' + 
                                u.email.replace(/'/g, "\\'") + '\', \'' + 
                                u.role + '\', ' + u.is_active + ')">Edit</button>' +
                            (isCurrentUser ? '' : '<button class="btn btn-danger btn-small" onclick="deleteUser(' + u.id + ')">Delete</button>') +
                        '</td>' +
                    '</tr>';
                }).join('') +
                '</table>';
        });
}

function editUser(id, username, email, role, isActive) {
    var newUsername = prompt('Username:', username);
    if (newUsername === null) return;
    
    var newEmail = prompt('Email:', email);
    if (newEmail === null) return;
    
    var newRole = prompt('Role (requester/approver/admin):', role);
    if (newRole === null) return;
    
    var newPassword = prompt('New Password (leave blank to keep current):');
    
    var newIsActive = confirm('Should this user be active? (OK = Active, Cancel = Inactive)');
    
    fetch('/api/users/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: newUsername,
            email: newEmail,
            role: newRole,
            isActive: newIsActive,
            password: newPassword || null
        })
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
        if (result.error) {
            alert(result.error);
        } else {
            alert(result.message);
            loadUsersList();
        }
    });
}

function deleteUser(id) {
    if (!confirm('Are you sure you want to delete this user?')) return;
    
    fetch('/api/users/' + id, { method: 'DELETE' })
        .then(function(r) { return r.json(); })
        .then(function(result) {
            if (result.error) {
                alert(result.error);
            } else {
                alert(result.message);
                loadUsersList();
            }
        });
}

function addUser() {
    var username = prompt('Username:');
    if (!username) return;
    
    var email = prompt('Email:');
    if (!email) return;
    
    var password = prompt('Password:');
    if (!password) return;
    
    var role = prompt('Role (requester/approver/admin):');
    if (!role) return;
    
    fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: username,
            email: email,
            password: password,
            role: role
        })
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
        if (result.error) {
            alert(result.error);
        } else {
            alert(result.message);
            loadUsersList();
        }
    });
}
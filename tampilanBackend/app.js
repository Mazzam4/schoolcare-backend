/* ========================================
   SchoolCare Admin Panel — Application Logic
   ======================================== */

// Global State
let adminKey = sessionStorage.getItem('adminKey') || '';
let currentData = {
    users: [],
    orgs: [],
    reports: []
};
let charts = {};
let selectedOrgIdUsers = null;
let selectedOrgIdReports = null;
let selectedOrgIdOrgs = null;

const API_BASE = '/api/admin';

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app');
const loader = document.getElementById('page-loader');

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    if (adminKey) {
        showApp();
    } else {
        showLogin();
    }
    setupNavigation();
    setupModals();
});

// ==================== AUTH ====================
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = document.getElementById('admin-key').value.trim();
    const btn = document.getElementById('login-btn');
    const err = document.getElementById('login-error');
    
    btn.disabled = true;
    btn.textContent = 'Memeriksa...';
    err.classList.remove('show');
    
    // Test the key by fetching stats
    try {
        const res = await fetch(`${API_BASE}/stats`, {
            headers: { 'x-admin-key': key }
        });
        
        if (res.ok) {
            adminKey = key;
            sessionStorage.setItem('adminKey', key);
            showApp();
        } else {
            throw new Error('Key Invalid');
        }
    } catch (error) {
        err.classList.add('show');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Masuk ke Sistem';
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    adminKey = '';
    sessionStorage.removeItem('adminKey');
    showLogin();
});

function showLogin() {
    loginScreen.style.display = 'flex';
    appScreen.classList.remove('active');
    document.getElementById('admin-key').value = '';
}

function showApp() {
    loginScreen.style.display = 'none';
    appScreen.classList.add('active');
    loadPage('overview'); // Default page
}

// ==================== NAVIGATION ====================
function setupNavigation() {
    const links = document.querySelectorAll('.sidebar-link');
    links.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const pageId = link.getAttribute('data-page');
            
            // Update active link
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            // Update title
            document.getElementById('topbar-title').textContent = link.textContent.trim();
            
            loadPage(pageId);
            
            // Close sidebar on mobile
            if (window.innerWidth <= 833) {
                document.getElementById('sidebar').classList.remove('open');
            }
        });
    });

    // Mobile sidebar toggle
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
    });
}

async function loadPage(pageId) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    
    // Show loader
    loader.style.display = 'flex';
    
    try {
        if (pageId === 'overview') await loadOverview();
        else if (pageId === 'users') await loadUsers();
        else if (pageId === 'organizations') await loadOrgs();
        else if (pageId === 'reports') await loadReports();
        
        // Show page
        document.getElementById(`page-${pageId}`).classList.add('active');
    } catch (error) {
        console.error(error);
        if (error.message === 'Unauthorized') showLogin();
        else showToast(error.message, 'error');
    } finally {
        loader.style.display = 'none';
    }
}

// ==================== API HELPERS ====================
async function apiFetch(endpoint, options = {}) {
    if (!adminKey) throw new Error('Unauthorized');
    
    const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'x-admin-key': adminKey,
            ...(options.headers || {})
        }
    });
    
    if (res.status === 401 || res.status === 403) throw new Error('Unauthorized');
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP Error ${res.status}`);
    }
    return res.json();
}

// ==================== OVERVIEW PAGE ====================
async function loadOverview() {
    const data = await apiFetch('/stats');
    
    document.getElementById('stat-users').textContent = data.totalUsers;
    document.getElementById('stat-orgs').textContent = data.totalOrgs;
    document.getElementById('stat-reports').textContent = data.totalReports;
    document.getElementById('stat-today').textContent = data.reportsToday;
    
    renderCharts(data);
}

function renderCharts(data) {
    // Line/Bar Chart: Reports by Date (last 7 days)
    const ctxMain = document.getElementById('mainChart').getContext('2d');
    if (charts.main) charts.main.destroy();
    
    const dates = Object.keys(data.reportsByDate || {}).reverse();
    const counts = dates.map(d => data.reportsByDate[d]);
    
    charts.main = new Chart(ctxMain, {
        type: 'bar',
        data: {
            labels: dates,
            datasets: [{
                label: 'Jumlah Laporan',
                data: counts,
                backgroundColor: 'rgba(0, 102, 204, 0.8)',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });

    // Pie Chart: Status Distribution
    const ctxPie = document.getElementById('pieChart').getContext('2d');
    if (charts.pie) charts.pie.destroy();
    
    charts.pie = new Chart(ctxPie, {
        type: 'doughnut',
        data: {
            labels: ['Dilaporkan', 'Proses', 'Selesai'],
            datasets: [{
                data: [
                    data.statusBreakdown?.Dilaporkan || 0,
                    data.statusBreakdown?.Proses || 0,
                    data.statusBreakdown?.Selesai || 0
                ],
                backgroundColor: ['#8e8e93', '#ff9f0a', '#30d158'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%'
        }
    });
}

// ==================== API ORGS HELPER ====================
async function ensureOrgsLoaded() {
    if (currentData.orgs.length === 0) {
        const data = await apiFetch('/organizations');
        currentData.orgs = data.organizations;
    }
}

function renderOrgsReportSelector() {
    const select = document.getElementById('orgs-report-selector');
    if (!select) return;

    select.innerHTML = `
        <option value="">Semua Sekolah</option>
        ${currentData.orgs.map(o => `<option value="${o.id}">${o.name}</option>`).join('')}
    `;

    if (selectedOrgIdOrgs) {
        select.value = selectedOrgIdOrgs;
    }
}

function getLast7Days() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        days.push(new Date(date));
    }
    return days;
}

function formatDateKey(date) {
    return new Date(date).toISOString().slice(0, 10);
}

function renderOrgsReportDetails() {
    const container = document.getElementById('orgs-report-data');
    if (!container) return;

    if (!selectedOrgIdOrgs) {
        container.style.display = 'none';
        return;
    }

    const orgReports = currentData.reports.filter(r => r.organizationId == selectedOrgIdOrgs);
    const total = orgReports.length;
    const countDilaporkan = orgReports.filter(r => r.status === 'Dilaporkan').length;
    const countProses = orgReports.filter(r => r.status === 'Proses').length;
    const countSelesai = orgReports.filter(r => r.status === 'Selesai').length;

    document.getElementById('org-report-total').textContent = total;
    document.getElementById('org-report-dilaporkan').textContent = countDilaporkan;
    document.getElementById('org-report-proses').textContent = countProses;
    document.getElementById('org-report-selesai').textContent = countSelesai;

    const dates = getLast7Days();
    const labels = dates.map(d => d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }));
    const dailyCounts = dates.map(day => {
        const key = formatDateKey(day);
        return orgReports.filter(r => formatDateKey(r.createdAt) === key).length;
    });

    const ctxMain = document.getElementById('orgMainChart').getContext('2d');
    if (charts.orgMain) charts.orgMain.destroy();
    charts.orgMain = new Chart(ctxMain, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Laporan per Hari',
                data: dailyCounts,
                backgroundColor: 'rgba(0, 102, 204, 0.8)',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });

    const ctxPie = document.getElementById('orgPieChart').getContext('2d');
    if (charts.orgPie) charts.orgPie.destroy();
    charts.orgPie = new Chart(ctxPie, {
        type: 'doughnut',
        data: {
            labels: ['Dilaporkan', 'Proses', 'Selesai'],
            datasets: [{
                data: [countDilaporkan, countProses, countSelesai],
                backgroundColor: ['#8e8e93', '#ff9f0a', '#30d158'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%'
        }
    });

    container.style.display = 'block';
}

function setupOrgsPageSelectors() {
    const select = document.getElementById('orgs-report-selector');
    if (!select) return;

    select.onchange = () => {
        selectedOrgIdOrgs = select.value ? parseInt(select.value, 10) : null;
        renderOrgsReportDetails();
    };
}

function renderOrgGrid(containerId, tab) {
    const grid = document.getElementById(containerId);
    if (!grid) return;
    
    grid.innerHTML = currentData.orgs.map(o => `
        <div class="org-card" onclick="selectOrgForTab(${o.id}, '${tab}')">
            <div>
                <div class="org-card-header">
                    <div class="org-card-icon">${o.name.charAt(0).toUpperCase()}</div>
                    <div class="org-card-title">${o.name}</div>
                </div>
                <div class="org-card-desc">${o.description || 'Tidak ada deskripsi sekolah.'}</div>
            </div>
            <div class="org-card-footer">
                <div class="org-card-stats">
                    <div class="org-card-stat">
                        <span>👥</span>
                        <strong>${o._count?.users ?? 0}</strong> Member
                    </div>
                    <div class="org-card-stat">
                        <span>📋</span>
                        <strong>${o._count?.reports ?? 0}</strong> Laporan
                    </div>
                </div>
                <div class="org-card-arrow">&rarr;</div>
            </div>
        </div>
    `).join('');
}

window.selectOrgForTab = (orgId, tab) => {
    const org = currentData.orgs.find(o => o.id === orgId);
    if (!org) return;
    
    if (tab === 'users') {
        selectedOrgIdUsers = orgId;
        document.getElementById('current-org-name-users').textContent = org.name;
        document.getElementById('users-org-selector').style.display = 'none';
        document.getElementById('users-content').style.display = 'block';
        filterUsers();
    } else if (tab === 'reports') {
        selectedOrgIdReports = orgId;
        document.getElementById('current-org-name-reports').textContent = org.name;
        document.getElementById('reports-org-selector').style.display = 'none';
        document.getElementById('reports-content').style.display = 'block';
        filterReports();
    }
};

// Setup Back Button Listeners
document.addEventListener('DOMContentLoaded', () => {
    const btnBackUsers = document.getElementById('btn-back-org-users');
    if (btnBackUsers) {
        btnBackUsers.onclick = () => {
            selectedOrgIdUsers = null;
            document.getElementById('users-org-selector').style.display = 'block';
            document.getElementById('users-content').style.display = 'none';
            // Re-render grid to make sure stats are updated
            renderOrgGrid('users-org-grid', 'users');
        };
    }
    
    const btnBackReports = document.getElementById('btn-back-org-reports');
    if (btnBackReports) {
        btnBackReports.onclick = () => {
            selectedOrgIdReports = null;
            document.getElementById('reports-org-selector').style.display = 'block';
            document.getElementById('reports-content').style.display = 'none';
            // Re-render grid to make sure stats are updated
            renderOrgGrid('reports-org-grid', 'reports');
        };
    }
});

// ==================== USERS PAGE ====================
async function loadUsers() {
    await ensureOrgsLoaded();
    
    // Fetch users
    const data = await apiFetch('/users');
    currentData.users = data.users;
    
    // Render selectors
    if (!selectedOrgIdUsers) {
        document.getElementById('users-org-selector').style.display = 'block';
        document.getElementById('users-content').style.display = 'none';
        renderOrgGrid('users-org-grid', 'users');
    } else {
        document.getElementById('users-org-selector').style.display = 'none';
        document.getElementById('users-content').style.display = 'block';
        filterUsers();
    }
    
    // Setup Search & Filter
    document.getElementById('search-users').oninput = filterUsers;
    document.getElementById('filter-users-role').onclick = (e) => {
        const btn = e.target.closest('button');
        if(btn) {
            document.querySelectorAll('#filter-users-role .filter-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterUsers();
        }
    };
}

function filterUsers() {
    if (!selectedOrgIdUsers) return;
    const q = document.getElementById('search-users').value.toLowerCase();
    const role = document.querySelector('#filter-users-role .active').getAttribute('data-val');
    
    // Filter by organization first
    const orgUsers = currentData.users.filter(u => u.organizationId == selectedOrgIdUsers);
    
    // Calculate and update counts
    const countAll = orgUsers.length;
    const countGuru = orgUsers.filter(u => u.role.toLowerCase() === 'guru').length;
    const countSiswa = orgUsers.filter(u => u.role.toLowerCase() === 'siswa').length;
    
    document.querySelector('#filter-users-role [data-val="all"] .count').textContent = `(${countAll})`;
    document.querySelector('#filter-users-role [data-val="guru"] .count').textContent = `(${countGuru})`;
    document.querySelector('#filter-users-role [data-val="siswa"] .count').textContent = `(${countSiswa})`;

    // Apply search and role filters
    const filtered = orgUsers.filter(u => {
        const matchSearch = u.firstName.toLowerCase().includes(q) || 
                            u.lastName.toLowerCase().includes(q) || 
                            u.email.toLowerCase().includes(q);
        const matchRole = role === 'all' || u.role.toLowerCase() === role;
        return matchSearch && matchRole;
    });
    renderUsers(filtered);
}

function renderUsers(users) {
    const tbody = document.getElementById('tbody-users');
    if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Tidak ada user ditemukan.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = users.map(u => `
        <tr>
            <td>#${u.id}</td>
            <td><strong>${u.firstName} ${u.lastName}</strong></td>
            <td class="t-muted">${u.email}</td>
            <td><span class="badge badge-${u.role.toLowerCase()}">${u.role}</span></td>
            <td>${u.organization ? u.organization.name : '<span class="t-muted">Belum ada</span>'}</td>
            <td>
                <div class="table-actions">
                    <button class="btn-icon btn-sm" onclick="openEditUser(${u.id})" title="Edit">&#9998;</button>
                    <button class="btn-icon btn-sm" onclick="deleteUser(${u.id})" title="Hapus" style="color:var(--danger)">&#128465;</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// ==================== ORGS PAGE ====================
async function loadOrgs() {
    await ensureOrgsLoaded();
    if (currentData.reports.length === 0) {
        const reportData = await apiFetch('/reports');
        currentData.reports = reportData.reports;
    }

    renderOrgsReportSelector();
    setupOrgsPageSelectors();
    renderOrgsReportDetails();

    const searchInput = document.getElementById('search-orgs');
    searchInput.oninput = () => {
        const q = searchInput.value.toLowerCase();
        const filtered = currentData.orgs.filter(o => o.name.toLowerCase().includes(q));
        renderOrgs(filtered);
    };

    renderOrgs(currentData.orgs);
}

function renderOrgs(orgs) {
    const tbody = document.getElementById('tbody-orgs');
    if (orgs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Tidak ada organisasi.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = orgs.map(o => `
        <tr>
            <td>#${o.id}</td>
            <td><strong>${o.name}</strong></td>
            <td class="t-muted">${o.description || '-'}</td>
            <td>${o._count.users}</td>
            <td>${o._count.reports}</td>
            <td>
                <button class="btn-icon btn-sm" onclick="deleteOrg(${o.id})" title="Hapus" style="color:var(--danger)">&#128465;</button>
            </td>
        </tr>
    `).join('');
}

// ==================== REPORTS PAGE ====================
async function loadReports() {
    await ensureOrgsLoaded();

    const data = await apiFetch('/reports');
    currentData.reports = data.reports;
    
    // Render selectors
    if (!selectedOrgIdReports) {
        document.getElementById('reports-org-selector').style.display = 'block';
        document.getElementById('reports-content').style.display = 'none';
        renderOrgGrid('reports-org-grid', 'reports');
    } else {
        document.getElementById('reports-org-selector').style.display = 'none';
        document.getElementById('reports-content').style.display = 'block';
        filterReports();
    }

    document.getElementById('search-reports').oninput = filterReports;
    document.getElementById('filter-reports-status').onclick = (e) => {
        const btn = e.target.closest('button');
        if(btn) {
            document.querySelectorAll('#filter-reports-status .filter-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterReports();
        }
    };
}

function filterReports() {
    if (!selectedOrgIdReports) return;
    const q = document.getElementById('search-reports').value.toLowerCase();
    const status = document.querySelector('#filter-reports-status .active').getAttribute('data-val');
    
    // Filter by organization first
    const orgReports = currentData.reports.filter(r => r.organizationId == selectedOrgIdReports);
    
    // Calculate and update counts
    const countAll = orgReports.length;
    const countDilaporkan = orgReports.filter(r => r.status === 'Dilaporkan').length;
    const countProses = orgReports.filter(r => r.status === 'Proses').length;
    const countSelesai = orgReports.filter(r => r.status === 'Selesai').length;
    
    document.querySelector('#filter-reports-status [data-val="all"] .count').textContent = `(${countAll})`;
    document.querySelector('#filter-reports-status [data-val="Dilaporkan"] .count').textContent = `(${countDilaporkan})`;
    document.querySelector('#filter-reports-status [data-val="Proses"] .count').textContent = `(${countProses})`;
    document.querySelector('#filter-reports-status [data-val="Selesai"] .count').textContent = `(${countSelesai})`;

    // Apply search and status filters
    const filtered = orgReports.filter(r => {
        const matchSearch = r.description.toLowerCase().includes(q) || r.location.toLowerCase().includes(q);
        const matchStatus = status === 'all' || r.status === status;
        return matchSearch && matchStatus;
    });
    renderReports(filtered);
}

function renderReports(reports) {
    const tbody = document.getElementById('tbody-reports');
    if (reports.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="table-empty">Tidak ada laporan.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = reports.map(r => {
        const date = new Date(r.createdAt).toLocaleDateString('id-ID', {day:'numeric', month:'short', year:'numeric'});
        const statusClass = r.status.toLowerCase().replace(' ', '');
        return `
            <tr style="cursor:pointer" onclick="toggleReportDetail(this, ${r.id})">
                <td style="text-align: center;">
                    <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </td>
                <td>#${r.id}</td>
                <td>${date}</td>
                <td>${r.category}</td>
                <td>${r.location}</td>
                <td class="t-muted">${r.organizationId}</td>
                <td><span class="badge badge-${statusClass}">${r.status}</span></td>
                <td>
                    <button class="btn-icon btn-sm" onclick="event.stopPropagation(); deleteReport(${r.id})" title="Hapus" style="color:var(--danger)">&#128465;</button>
                </td>
            </tr>
        `;
    }).join('');
}

// ==================== MODALS & ACTIONS ====================
function setupModals() {
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.onclick = () => {
            const id = btn.getAttribute('data-close');
            document.getElementById(id).classList.remove('show');
        };
    });
}

// User Actions
window.openEditUser = (id) => {
    const u = currentData.users.find(x => x.id === id);
    if (!u) return;
    
    document.getElementById('edit-user-id').value = u.id;
    document.getElementById('edit-user-fname').value = u.firstName;
    document.getElementById('edit-user-lname').value = u.lastName;
    document.getElementById('edit-user-role').value = u.role.toLowerCase();
    document.getElementById('edit-user-org').value = u.organizationId || '';
    
    document.getElementById('modal-user').classList.add('show');
};

document.getElementById('btn-save-user').onclick = async () => {
    const id = document.getElementById('edit-user-id').value;
    const data = {
        firstName: document.getElementById('edit-user-fname').value,
        lastName: document.getElementById('edit-user-lname').value,
        role: document.getElementById('edit-user-role').value,
        organizationId: parseInt(document.getElementById('edit-user-org').value) || null
    };
    
    try {
        await apiFetch(`/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
        showToast('User berhasil diupdate', 'success');
        document.getElementById('modal-user').classList.remove('show');
        loadUsers();
    } catch (err) {
        showToast(err.message, 'error');
    }
};

window.deleteUser = async (id) => {
    if(!confirm(`Yakin ingin menghapus User #${id}? Aksi ini tidak dapat dibatalkan.`)) return;
    try {
        await apiFetch(`/users/${id}`, { method: 'DELETE' });
        showToast('User dihapus', 'success');
        loadUsers();
    } catch (err) {
        showToast(err.message, 'error');
    }
};

// Org Actions
window.deleteOrg = async (id) => {
    if(!confirm(`Yakin ingin menghapus Organisasi #${id}? Semua user dan laporan terkait juga akan terhapus!`)) return;
    try {
        await apiFetch(`/organizations/${id}`, { method: 'DELETE' });
        showToast('Organisasi dihapus', 'success');
        loadOrgs();
    } catch (err) {
        showToast(err.message, 'error');
    }
};

// Report Actions
window.toggleReportDetail = (rowEl, id) => {
    // Find if next sibling is detail row
    const nextRow = rowEl.nextElementSibling;
    const isExpanded = nextRow && nextRow.classList.contains('report-detail-row');
    
    // Collapse any open details first
    document.querySelectorAll('.report-detail-row').forEach(el => el.remove());
    document.querySelectorAll('#tbody-reports tr').forEach(el => el.classList.remove('expanded'));
    
    if (isExpanded) {
        return; // Just toggle closed
    }
    
    // Expand this one
    rowEl.classList.add('expanded');
    const r = currentData.reports.find(x => x.id === id);
    if (!r) return;
    
    const dateStr = new Date(r.createdAt).toLocaleString('id-ID');
    const photoSrc = r.photoBase64 
        ? (r.photoBase64.startsWith('data:') ? r.photoBase64 : `data:image/jpeg;base64,${r.photoBase64}`)
        : '';
        
    const detailHtml = `
        <tr class="report-detail-row">
            <td colspan="8">
                <div class="report-dropdown-detail">
                    <div class="report-dropdown-grid">
                        ${photoSrc ? `
                        <div class="report-dropdown-photo-container">
                            <img class="report-dropdown-photo" src="${photoSrc}" alt="Foto Laporan">
                        </div>` : `
                        <div class="report-dropdown-photo-container no-photo">
                            <span>Tidak ada foto</span>
                        </div>`}
                        <div class="report-dropdown-info">
                            <div class="detail-row">
                                <div class="detail-label">Tanggal</div>
                                <div class="detail-value">${dateStr}</div>
                            </div>
                            <div class="detail-row">
                                <div class="detail-label">Pelapor</div>
                                <div class="detail-value">${r.author ? `${r.author.firstName} ${r.author.lastName}` : 'Siswa/Guru'} (ID: ${r.authorId})</div>
                            </div>
                            <div class="detail-row">
                                <div class="detail-label">Kategori</div>
                                <div class="detail-value">${r.type} - ${r.category}</div>
                            </div>
                            <div class="detail-row">
                                <div class="detail-label">Lokasi</div>
                                <div class="detail-value">${r.location}</div>
                            </div>
                            <div class="detail-row">
                                <div class="detail-label">Koordinat</div>
                                <div class="detail-value">${r.latitude ? `${r.latitude}, ${r.longitude}` : 'Tidak ada koordinat'}</div>
                            </div>
                            <div class="detail-row" style="flex-direction: column; gap: 4px;">
                                <div class="detail-label">Deskripsi</div>
                                <div class="detail-value" style="background: var(--canvas-parchment); padding: 12px; border-radius: var(--r-sm); margin-top: 4px;">${r.description || '-'}</div>
                            </div>
                            
                            <hr style="border: 0; border-top: 1px solid var(--hairline); margin: 16px 0;">
                            
                            <div class="form-group" style="display: flex; gap: var(--sp-sm); align-items: flex-end; margin-bottom: 0;">
                                <div style="flex: 1;">
                                    <label class="form-label">Update Status Laporan</label>
                                    <select id="dropdown-report-status-${r.id}" class="form-select">
                                        <option value="Dilaporkan" ${r.status === 'Dilaporkan' ? 'selected' : ''}>Dilaporkan</option>
                                        <option value="Proses" ${r.status === 'Proses' ? 'selected' : ''}>Proses</option>
                                        <option value="Selesai" ${r.status === 'Selesai' ? 'selected' : ''}>Selesai</option>
                                    </select>
                                </div>
                                <button class="btn-primary" style="width: auto; height: 38px;" onclick="saveReportStatusFromDropdown(${r.id})">
                                    Simpan Status
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </td>
        </tr>
    `;
    
    rowEl.insertAdjacentHTML('afterend', detailHtml);
};

window.saveReportStatusFromDropdown = async (id) => {
    const statusSelect = document.getElementById(`dropdown-report-status-${id}`);
    if (!statusSelect) return;
    const status = statusSelect.value;
    try {
        await apiFetch(`/reports/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ status })
        });
        showToast('Status laporan diupdate', 'success');
        
        // Update local data status
        const report = currentData.reports.find(x => x.id === id);
        if (report) report.status = status;
        
        // Re-render and collapse
        filterReports();
    } catch (err) {
        showToast(err.message, 'error');
    }
};

window.deleteReport = async (id) => {
    if(!confirm(`Yakin ingin menghapus Laporan #${id}?`)) return;
    try {
        await apiFetch(`/reports/${id}`, { method: 'DELETE' });
        showToast('Laporan dihapus', 'success');
        loadReports();
    } catch (err) {
        showToast(err.message, 'error');
    }
};

// ==================== TOAST ====================
function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    
    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

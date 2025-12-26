// Telo Dashboard - Modern UI (Updated Version)
let supabaseClient = null;
let currentUser = null;
let chartInstance = null;

// Supabase Configuration
const SUPABASE_URL = 'https://shwvdqauqnvtodmismjv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNod3ZkcWF1cW52dG9kbWlzbWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcxMzg2NzMsImV4cCI6MjA2MjcxNDY3M30.cF-PfTTY-IPnwqpCklmOIGSIFEgs9kLTQtH63Qm23xU';

// Initialize Supabase client
function initSupabase() {
    if (!supabaseClient) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return supabaseClient;
}

// DOM Elements
const el = (id) => document.getElementById(id);

// Safe element value getter
const getElValue = (id, defaultValue = '') => {
    const element = el(id);
    return element ? element.value : defaultValue;
};

// Show/Hide Loading
function setLoading(show) {
    const overlay = el('loadingOverlay');
    if (show) {
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }
}

// Format numbers with commas
function formatNumber(num) {
    return new Intl.NumberFormat('ko-KR').format(num || 0);
}

// Format date to Korean format
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

// Login Function
async function login() {
    try {
        const email = getElValue('email', '').trim();
        const password = getElValue('password', '');
        
        if (!email || !password) {
            throw new Error('이메일과 비밀번호를 입력하세요.');
        }
        
        setLoading(true);
        const client = initSupabase();
        
        const { data, error } = await client.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) throw error;
        
        currentUser = data.user;
        localStorage.setItem('userEmail', email);
        
        // Show dashboard
        el('loginScreen').classList.add('hidden');
        el('dashboard').classList.remove('hidden');
        el('currentUser').textContent = email;
        
        // Load initial data
        await loadOverview();
        
    } catch (error) {
        el('loginError').textContent = error.message || '로그인 실패';
    } finally {
        setLoading(false);
    }
}

// Logout Function
async function logout() {
    try {
        const client = initSupabase();
        await client.auth.signOut();
        
        currentUser = null;
        el('loginScreen').classList.remove('hidden');
        el('dashboard').classList.add('hidden');
        el('loginError').textContent = '';
        
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// Check existing session
async function checkSession() {
    try {
        const client = initSupabase();
        const { data } = await client.auth.getSession();
        
        if (data && data.session) {
            currentUser = data.session.user;
            el('loginScreen').classList.add('hidden');
            el('dashboard').classList.remove('hidden');
            el('currentUser').textContent = currentUser.email;
            
            await loadOverview();
        }
    } catch (error) {
        console.error('Session check error:', error);
    }
}

// Load Overview Data
async function loadOverview() {
    try {
        setLoading(true);
        const client = initSupabase();
        
        console.log('[Overview] Loading monthly statistics...');
        
        // Get monthly statistics for summary
        const { data: monthlyData, error: monthlyError } = await client
            .from('vw_device_stats_monthly_kst')
            .select('*');
            
        console.log('[Overview] Monthly data:', monthlyData);
        console.log('[Overview] Monthly error:', monthlyError);
            
        if (monthlyError) {
            console.error('Monthly data error:', monthlyError);
            throw monthlyError;
        }
        
        // Calculate totals
        const totalUsers = monthlyData ? [...new Set(monthlyData.map(d => d.email))].length : 0;
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();
        
        const monthTotal = monthlyData ? monthlyData
            .filter(d => d.month === currentMonth && d.year === currentYear)
            .reduce((acc, row) => ({
                invites: acc.invites + (row.invite_success || 0),
                inviteFailed: acc.inviteFailed + (row.invite_failed || 0),
                contacts: acc.contacts + (row.contact_success || 0)
            }), { invites: 0, inviteFailed: 0, contacts: 0 }) : { invites: 0, inviteFailed: 0, contacts: 0 };
        
        // Get today's active users from login history
        const today = new Date().toISOString().split('T')[0];
        console.log('[Overview] Today date:', today);
        
        const { data: todayData, error: todayError } = await client
            .from('vw_login_history_kst')
            .select('email')
            .eq('action', 'login')
            .gte('created_at_kst', `${today} 00:00:00`)
            .lte('created_at_kst', `${today} 23:59:59`);
        
        console.log('[Overview] Today data:', todayData);
        console.log('[Overview] Today error:', todayError);
            
        const todayActive = new Set(todayData?.map(d => d.email) || []).size;
        
        // Update stats cards
        el('totalUsers').textContent = formatNumber(totalUsers);
        el('todayActive').textContent = formatNumber(todayActive);
        el('monthInvites').textContent = formatNumber(monthTotal.invites);
        el('monthContacts').textContent = formatNumber(monthTotal.contacts);
        el('monthInviteFailed').textContent = formatNumber(monthTotal.inviteFailed);
        
        // Load chart data
        await loadActivityChart();
        
        // Load top users
        loadTopUsers(monthlyData);
        
    } catch (error) {
        console.error('Overview load error:', error);
    } finally {
        setLoading(false);
    }
}

// Load Activity Chart (Last 7 days)
async function loadActivityChart() {
    try {
        const client = initSupabase();
        
        // Get last 7 days
        const dates = [];
        const today = new Date();
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            dates.push(date.toISOString().split('T')[0]);
        }
        
        // Get daily stats for last 7 days
        const { data } = await client
            .from('vw_device_stats_daily_kst')
            .select('day_kst, dm_count, invite_success, contact_success')
            .in('day_kst', dates);
            
        // Aggregate by date
        const chartData = dates.map(date => {
            const dayData = (data || []).filter(d => d.day_kst === date);
            return {
                date,
                dm: dayData.reduce((sum, d) => sum + (d.dm_count || 0), 0),
                invites: dayData.reduce((sum, d) => sum + (d.invite_success || 0), 0),
                contacts: dayData.reduce((sum, d) => sum + (d.contact_success || 0), 0)
            };
        });
        
        // Destroy existing chart
        if (chartInstance) {
            chartInstance.destroy();
        }
        
        // Create new chart
        const ctx = el('activityChart').getContext('2d');
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartData.map(d => {
                    const date = new Date(d.date);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                }),
                datasets: [
                    {
                        label: 'DM 전송',
                        data: chartData.map(d => d.dm),
                        borderColor: '#8b5cf6',
                        backgroundColor: 'rgba(139, 92, 246, 0.1)',
                        tension: 0.4
                    },
                    {
                        label: '초대 성공',
                        data: chartData.map(d => d.invites),
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        tension: 0.4
                    },
                    {
                        label: '연락처 성공',
                        data: chartData.map(d => d.contacts),
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#9ca3af',
                            padding: 15,
                            font: { size: 12 }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: '#2d3748',
                            drawBorder: false
                        },
                        ticks: { color: '#9ca3af' }
                    },
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: { color: '#9ca3af' }
                    }
                }
            }
        });
        
    } catch (error) {
        console.error('Chart load error:', error);
    }
}

// Load Top Users
function loadTopUsers(monthlyData) {
    if (!monthlyData) return;
    
    // Aggregate by email
    const userTotals = {};
    monthlyData.forEach(row => {
        if (!userTotals[row.email]) {
            userTotals[row.email] = 0;
        }
        userTotals[row.email] += (row.invite_success || 0);
    });
    
    // Sort and get top 5
    const topUsers = Object.entries(userTotals)
        .map(([email, total]) => ({ email, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);
        
    const container = el('topUsersList');
    container.innerHTML = topUsers.map((user, index) => `
        <div class="top-user-item">
            <div class="top-user-info">
                <div class="top-user-rank">${index + 1}</div>
                <div class="top-user-email">${user.email}</div>
            </div>
            <div class="top-user-score">${formatNumber(user.total)}</div>
        </div>
    `).join('');
}

// Load Monthly Stats
async function loadMonthlyStats() {
    try {
        setLoading(true);
        const client = initSupabase();
        
        const year = getElValue('monthlyYear', '2025');
        const search = getElValue('monthlySearch', '').toLowerCase();
        
        let query = client
            .from('vw_device_stats_monthly_kst')
            .select('*')
            .eq('year', parseInt(year))
            .order('month', { ascending: false });
            
        if (search) {
            query = query.ilike('email', `%${search}%`);
        }
        
        const { data, error } = await query;
        
        if (error) throw error;
        
        const container = el('monthlyGrid');
        
        if (!data || data.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;">데이터가 없습니다</div>';
            return;
        }
        
        container.innerHTML = data.map(row => `
            <div class="data-card">
                <div class="data-card-header">
                    <div class="data-card-title">${row.email}</div>
                    <div class="data-card-badge">${row.year}-${String(row.month).padStart(2, '0')}</div>
                </div>
                <div class="data-card-stats">
                    <div class="data-stat">
                        <span class="data-stat-label">DM 전송</span>
                        <span class="data-stat-value">${formatNumber(row.dm_count)}</span>
                    </div>
                    <div class="data-stat">
                        <span class="data-stat-label">초대 성공</span>
                        <span class="data-stat-value">${formatNumber(row.invite_success)}</span>
                    </div>
                    <div class="data-stat">
                        <span class="data-stat-label">초대 실패</span>
                        <span class="data-stat-value">${formatNumber(row.invite_failed)}</span>
                    </div>
                    <div class="data-stat">
                        <span class="data-stat-label">연락처 처리</span>
                        <span class="data-stat-value">${formatNumber(row.contact_total)}</span>
                    </div>
                    <div class="data-stat">
                        <span class="data-stat-label">링크 수</span>
                        <span class="data-stat-value">${formatNumber(row.link_count || 0)}</span>
                    </div>
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Monthly stats error:', error);
        const container = el('monthlyGrid');
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;">데이터 로드 실패</div>';
  } finally {
        setLoading(false);
    }
}

// Load Daily Stats
async function loadDailyStats() {
    try {
        setLoading(true);
        const client = initSupabase();
        
        const startDate = getElValue('dailyDateStart', '');
        const endDate = getElValue('dailyDateEnd', '');
        const search = getElValue('dailySearch', '').toLowerCase();
        
        let query = client
      .from('vw_device_stats_daily_kst')
            .select('*')
            .order('day_kst', { ascending: false })
            .limit(100);
            
        if (startDate) {
            query = query.gte('day_kst', startDate);
        }
        if (endDate) {
            query = query.lte('day_kst', endDate);
        }
        if (search) {
            query = query.ilike('email', `%${search}%`);
        }
        
        const { data, error } = await query;
    if (error) throw error;
        
        const tbody = el('dailyTableBody');
        
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#6b7280;">데이터가 없습니다</td></tr>';
            return;
        }
        
        tbody.innerHTML = data.map(row => `
            <tr>
                <td>${row.day_kst || '-'}</td>
                <td>${row.email || '-'}</td>
                <td>${formatNumber(row.dm_count || 0)}</td>
                <td>${formatNumber(row.invite_success || 0)}</td>
                <td>${formatNumber(row.invite_failed || 0)}</td>
                <td>${formatNumber(row.contact_total || 0)}</td>
                <td>${formatNumber(row.contact_success || 0)}</td>
                <td>${formatNumber(row.link_count || 0)}</td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('Daily stats error:', error);
        const tbody = el('dailyTableBody');
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#ef4444;">데이터 로드 실패</td></tr>';
  } finally {
        setLoading(false);
    }
}

// Load Activity Log (Login History)
async function loadActivityLog() {
    try {
        setLoading(true);
        const client = initSupabase();
        
        const search = getElValue('activitySearch', '').toLowerCase();
        const action = getElValue('activityAction', '');
        const startDate = getElValue('activityDateStart', '');
        const endDate = getElValue('activityDateEnd', '');
        
        
        let query = client
            .from('vw_login_history_kst')
            .select('email, action, created_at_kst_str, ip_address, created_at_kst')
            .order('created_at_kst', { ascending: false })
            .limit(100);
            
        if (search) {
            query = query.ilike('email', `%${search}%`);
        }
        if (action) {
            query = query.eq('action', action);
        }
        if (startDate) {
            query = query.gte('created_at_kst_str', startDate);
        }
        if (endDate) {
            query = query.lte('created_at_kst_str', endDate + ' 23:59:59');
        }
        
        const { data, error } = await query;
        
        
        if (error) throw error;
        
        const container = el('activityTimeline');
        
        if (!data || data.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;">활동 기록이 없습니다</div>';
            return;
        }
        
        // Group by date
        const groupedData = {};
        data.forEach(item => {
            const date = item.created_at_kst_str.split(' ')[0];
            if (!groupedData[date]) {
                groupedData[date] = [];
            }
            groupedData[date].push(item);
        });
        
        // Render with date dividers
        let html = '';
        Object.entries(groupedData).forEach(([date, items]) => {
            html += `<div class="date-divider">${date}</div>`;
            html += items.map(item => `
                <div class="activity-item">
                    <div class="activity-icon ${item.action}">
                        ${item.action === 'login' ? '→' : '←'}
                    </div>
                    <div class="activity-content">
                        <div class="activity-user">${item.email}</div>
                        <div class="activity-details">
                            ${item.action === 'login' ? '로그인' : '로그아웃'} 
                            ${item.ip_address ? `• IP: ${item.ip_address}` : ''}
                        </div>
                        <div class="activity-time">${item.created_at_kst_str.split(' ')[1]}</div>
                    </div>
                </div>
            `).join('');
        });
        
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Activity log error:', error);
        const container = el('activityTimeline');
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;">데이터 로드 실패</div>';
    } finally {
        setLoading(false);
    }
}

// Tab Navigation
function setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', async () => {
            const targetTab = tab.dataset.tab;
            
            // Update active states
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            el(targetTab).classList.add('active');
            
            // Load tab data
            switch (targetTab) {
                case 'overview':
                    await loadOverview();
                    break;
                case 'monthly':
                    await loadMonthlyStats();
                    break;
                case 'daily':
                    await loadDailyStats();
                    updateDailyHeaderOrientation();
                    break;
                case 'activity':
                    await loadActivityLog();
                    break;
                case 'links':
                    await loadUserLinks();
                    break;
            }
        });
    });
}

// Daily table headers: verticalize on mobile only
function updateDailyHeaderOrientation() {
    const isMobile = window.innerWidth <= 768 || /Mobi|Android/i.test(navigator.userAgent);
    const headers = document.querySelectorAll('#daily table.data-table thead th');
    if (!headers || headers.length === 0) return;

    headers.forEach((th, index) => {
        // Keep first two columns (날짜, 이메일) horizontal
        if (index < 2) {
            if (th.dataset.originalText) {
                th.textContent = th.dataset.originalText;
                th.classList.remove('vertical');
            }
            return;
        }

        const original = th.dataset.originalText || th.textContent.trim();
        th.dataset.originalText = original;

        if (isMobile) {
            const verticalHtml = original
                .replace(/\s+/g, '')
                .split('')
                .map((ch) => `<span>${ch}</span>`) // one char per line
                .join('');
            th.innerHTML = `<span class="vh">${verticalHtml}</span>`;
            th.classList.add('vertical');
        } else {
            th.textContent = original;
            th.classList.remove('vertical');
        }
    });
}

// Re-apply on resize/orientation change
window.addEventListener('resize', () => {
    updateDailyHeaderOrientation();
});

// Load User Links (새 링크 탭)
async function loadUserLinks() {
    try {
        setLoading(true);
        const client = initSupabase();
        
        const monthFilter = getElValue('linksMonth', '');
        const emailFilter = getElValue('linksEmailFilter', '').toLowerCase();
        
        // 월별 링크 그룹 조회
        let query = client
            .from('user_invite_links')
            .select('*')
            .order('first_used_at', { ascending: false });
            
        if (emailFilter) {
            query = query.ilike('email', `%${emailFilter}%`);
        }
        
        if (monthFilter) {
            // date input에서 받은 날짜를 월 단위로 처리
            const date = new Date(monthFilter);
            const year = date.getFullYear();
            const month = date.getMonth() + 1;
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const endDate = new Date(year, month, 0).toISOString().split('T')[0];
            query = query.gte('first_used_at', startDate).lte('first_used_at', endDate);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        
        const container = el('linksContainer');
        
        if (!data || data.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;">링크 데이터가 없습니다</div>';
            return;
        }
        
        // 월별/사용자별로 그룹화
        const grouped = {};
        data.forEach(link => {
            const date = new Date(link.first_used_at);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            
            if (!grouped[monthKey]) {
                grouped[monthKey] = {};
            }
            if (!grouped[monthKey][link.email]) {
                grouped[monthKey][link.email] = [];
            }
            grouped[monthKey][link.email].push(link);
        });
        
        // HTML 생성
        let html = '';
        Object.entries(grouped)
            .sort((a, b) => b[0].localeCompare(a[0])) // 최신 월부터
            .forEach(([month, users]) => {
                const totalLinks = Object.values(users).flat().length;
                const [year, monthNum] = month.split('-');
                const monthName = new Date(year, parseInt(monthNum) - 1).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });
                
                html += `
                    <div class="link-month-group">
                        <div class="link-month-header">
                            <span class="link-month-title">📅 ${monthName}</span>
                            <span class="link-month-count">${totalLinks}개</span>
                        </div>
                        <div class="link-users">
                `;
                
                Object.entries(users)
                    .sort((a, b) => a[0].localeCompare(b[0])) // 이메일 알파벳순
                    .forEach(([email, links]) => {
                        const userId = email.replace(/[@.]/g, '_');
                        html += `
                            <div class="link-user-card" data-user="${userId}">
                                <div class="link-user-header" onclick="toggleLinkCard(this)">
                                    <span class="link-user-email">${email}</span>
                                    <div class="link-user-stats">
                                        <span class="link-count-badge">${links.length}개 링크</span>
                                        <svg class="link-expand-icon" viewBox="0 0 20 20" fill="none">
                                            <path d="M7 10l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                        </svg>
                                    </div>
                                </div>
                                <div class="link-user-details">
                                    <div class="link-list">
                                        ${links.sort((a, b) => a.group_name.localeCompare(b.group_name))
                                            .map(link => `
                                                <div class="link-item">
                                                    <a href="${link.invite_link}" target="_blank" class="link-url">${link.invite_link}</a>
                                                    <span class="link-title">${link.group_name}</span>
                                                </div>
                                            `).join('')}
                                    </div>
                                </div>
                            </div>
                        `;
                    });
                
                html += `
                        </div>
                    </div>
                `;
            });
        
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Links error:', error);
        const container = el('linksContainer');
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;">링크 데이터 로드 실패</div>';
    } finally {
        setLoading(false);
    }
}

// 링크 카드 토글
function toggleLinkCard(header) {
    const card = header.parentElement;
    card.classList.toggle('expanded');
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Check saved email
    const savedEmail = localStorage.getItem('userEmail');
    const emailEl = el('email');
    if (savedEmail && emailEl) {
        emailEl.value = savedEmail;
    }
    
    // Setup event listeners (with null checks)
    const addEvent = (id, event, handler) => {
        const element = el(id);
        if (element) {
            element.addEventListener(event, handler);
        }
    };
    
    addEvent('btnLogin', 'click', login);
    addEvent('btnLogout', 'click', logout);
    addEvent('btnDailyApply', 'click', loadDailyStats);
    addEvent('btnActivityRefresh', 'click', loadActivityLog);
    
    // Enter key for login
    addEvent('password', 'keypress', (e) => {
        if (e.key === 'Enter') login();
    });
    
    // Filter change events
    addEvent('monthlyYear', 'change', loadMonthlyStats);
    addEvent('monthlySearch', 'input', debounce(loadMonthlyStats, 500));
    addEvent('dailySearch', 'input', debounce(loadDailyStats, 500));
    addEvent('activitySearch', 'input', debounce(loadActivityLog, 500));
    addEvent('activityAction', 'change', loadActivityLog);
    addEvent('activityDateStart', 'change', loadActivityLog);
    addEvent('activityDateEnd', 'change', loadActivityLog);
    
    // Links tab events
    addEvent('linksSearchBtn', 'click', loadUserLinks);
    addEvent('linksMonth', 'change', loadUserLinks);
    addEvent('linksEmailFilter', 'input', debounce(loadUserLinks, 500));
    
    // Set default dates for all date inputs
    const today = new Date();
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);
    
    const todayStr = today.toISOString().split('T')[0];
    const lastWeekStr = lastWeek.toISOString().split('T')[0];
    
    // Daily stats dates
    const dailyEndEl = el('dailyDateEnd');
    const dailyStartEl = el('dailyDateStart');
    if (dailyEndEl) dailyEndEl.value = todayStr;
    if (dailyStartEl) dailyStartEl.value = lastWeekStr;
    
    // Activity log dates (today only by default)
    const activityEndEl = el('activityDateEnd');
    const activityStartEl = el('activityDateStart');
    if (activityEndEl) activityEndEl.value = todayStr;
    if (activityStartEl) activityStartEl.value = todayStr;
    
    // Setup tabs
    setupTabs();
    // Ensure daily header orientation on first render (in case daily is default visible)
    updateDailyHeaderOrientation();
    
    // Setup mobile scroll guide
    setupMobileScrollGuide();
    
    // Check existing session
    await checkSession();
});

// Mobile Scroll Guide
function setupMobileScrollGuide() {
    // Check if mobile
    const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;
    if (!isMobile) return;
    
    const guide = el('mobileScrollGuide');
    if (!guide) return;
    
    // Show guide when activity or daily tab is clicked
    const activityTabBtn = document.querySelector('[data-tab="activity"]');
    const dailyTabBtn = document.querySelector('[data-tab="daily"]');
    
    const showGuide = () => {
        setTimeout(() => {
            guide.classList.remove('hidden');
            
            // Auto hide after animation
            setTimeout(() => {
                guide.classList.add('hidden');
            }, 2500);
        }, 300);
    };
    
    if (activityTabBtn) {
        activityTabBtn.addEventListener('click', showGuide);
    }
    if (dailyTabBtn) {
        dailyTabBtn.addEventListener('click', showGuide);
    }
    
    // Track scroll on cards with better detection
    const cards = document.querySelectorAll('.data-card, .stat-card, .chart-card, table');
    let focusedElement = null;
    let touchCount = 0;
    
    cards.forEach(element => {
        // Touch start event
        element.addEventListener('touchstart', (e) => {
            touchCount++;
            
            // Show guide if switching focus and haven't shown too many times
            if (focusedElement && focusedElement !== element && touchCount > 2) {
                const currentShowCount = parseInt(localStorage.getItem('scrollGuideCount') || '0');
                if (currentShowCount < 5) {
                    guide.classList.remove('hidden');
                    setTimeout(() => {
                        guide.classList.add('hidden');
                    }, 2500);
                    localStorage.setItem('scrollGuideCount', String(currentShowCount + 1));
                }
                touchCount = 0;
            }
            focusedElement = element;
        }, { passive: true });
        
        // Tables are handled by CSS .table-container
    });
    
    // Hide guide immediately on guide touch
    guide.addEventListener('touchstart', () => {
        guide.classList.add('hidden');
    }, { passive: true });
}

// Utility: Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
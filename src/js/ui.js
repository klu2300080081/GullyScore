import { getActiveRole, getCurrentUser, getCurrentPlayer } from "./auth.js";
import { MatchEngine } from "./engine.js";
import { 
  getAllDocs, getDocById, saveDoc, deleteDocById, 
  listenToDoc, listenToCollection, listenToQuery, 
  createAdminRequest, approveAdminRequest, rejectAdminRequest,
  createGuestClaim, approveGuestClaim, rejectGuestClaim,
  listenToUserNotifications, markNotificationAsRead, recalculateStats,
  sendNotification
} from "./firebase-service.js";
import { makePlayer, makeTeam, makeMatch, makeTournament } from "./models.js";

// Global UI manager state
let activeUnsubs = [];
let currentLiveMatchEngine = null;
let currentLiveMatchUnsub = null;
let undoTimerInterval = null;
let globalNotifUnsub = null;

function getInningsDuration(inn) {
  if (!inn || !inn.startTime) return 0;
  const end = inn.endTime || Date.now();
  let duration = end - inn.startTime - (inn.pausedDuration || 0);
  if (inn.isPaused && !inn.endTime && inn.lastPauseTime) {
    duration -= (Date.now() - inn.lastPauseTime);
  }
  return Math.max(0, duration);
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "0s";
  const totalSecs = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  
  const parts = [];
  if (hrs > 0) parts.push(`${hrs}h`);
  if (mins > 0 || hrs > 0) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

// Helper to clear active listeners when switching pages
function cleanupListeners() {
  while (activeUnsubs.length) {
    const unsub = activeUnsubs.pop();
    if (typeof unsub === "function") unsub();
  }
}

export class UI {
  constructor() {
    this.toastStack = document.getElementById("toastStack");
  }

  init() {
    // Handle view titles/subtitles and back buttons
    document.querySelectorAll(".close-modal-btn").forEach(btn => {
      btn.addEventListener("click", () => this.closeModal());
    });

    document.getElementById("notif-bell-btn").addEventListener("click", () => {
      window.location.hash = "#/profile";
      setTimeout(() => {
        const tabBtn = document.querySelector('[data-profile-tab="notifications"]');
        if (tabBtn) tabBtn.click();
      }, 100);
    });
  }

  showLoader() {
    // Simply visual loading log, could display an overlay
    console.log("Loading started...");
  }

  hideLoader() {
    console.log("Loading completed.");
  }

  // Toast System
  toast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span>${message}</span>
      <button class="toast-close">&times;</button>
    `;
    this.toastStack.appendChild(toast);
    
    // Auto remove after 4 seconds
    const timeout = setTimeout(() => toast.remove(), 4000);
    
    toast.querySelector(".toast-close").addEventListener("click", () => {
      clearTimeout(timeout);
      toast.remove();
    });
  }

  // Modal System
  openModal(title, bodyHtml) {
    const backdrop = document.getElementById("modalBackdrop");
    const generalModal = document.getElementById("general-modal");
    
    document.getElementById("modalTitle").textContent = title;
    document.getElementById("modalBody").innerHTML = bodyHtml;
    
    backdrop.removeAttribute("hidden");
    generalModal.style.display = "flex";
  }

  closeModal() {
    const backdrop = document.getElementById("modalBackdrop");
    backdrop.setAttribute("hidden", "");
    
    // Hide all child modals
    document.getElementById("general-modal").style.display = "none";
    document.getElementById("openers-modal").style.display = "none";
    document.getElementById("bowler-modal").style.display = "none";
    document.getElementById("wicket-modal").style.display = "none";
    document.getElementById("claim-guest-modal").style.display = "none";
    document.getElementById("transition-modal").style.display = "none";
  }

  // Dynamic show views
  showSection(sectionId, title, subtitle) {
    cleanupListeners();
    this.closeModal();

    // Reset view visibility
    document.querySelectorAll(".view-section").forEach(sec => {
      sec.style.display = "none";
    });
    const activeSec = document.getElementById(sectionId);
    if (activeSec) activeSec.style.display = "block";

    // Set page header
    document.getElementById("view-title").textContent = title;
    document.getElementById("view-subtitle").textContent = subtitle;

    // Scroll to top
    document.querySelector(".main").scrollTop = 0;
    
    // Update player context banner display
    const playerBanner = document.getElementById("player-banner");
    if (getActiveRole() === "player") {
      playerBanner.style.display = "flex";
    } else {
      playerBanner.style.display = "none";
    }

    // Dynamic header action button
    const actionBtn = document.getElementById("header-action-btn");
    actionBtn.style.display = "none"; // hide by default
    actionBtn.replaceWith(actionBtn.cloneNode(true)); // remove old listeners

    const newActionBtn = document.getElementById("header-action-btn");
    
    const role = getActiveRole();
    if (sectionId === "view-dashboard" && role !== "player") {
      newActionBtn.textContent = "New Match";
      newActionBtn.style.display = "block";
      newActionBtn.addEventListener("click", () => this.triggerCreateMatchFlow());
    } else if (sectionId === "view-tournaments" && role !== "player") {
      newActionBtn.textContent = "New Tournament";
      newActionBtn.style.display = "block";
      newActionBtn.addEventListener("click", () => this.triggerAddTournamentModal());
    } else if (sectionId === "view-teams") {
      newActionBtn.textContent = "New Team";
      newActionBtn.style.display = "block";
      newActionBtn.addEventListener("click", () => this.triggerAddTeamModal());
    } else if (sectionId === "view-players" && role !== "player") {
      newActionBtn.textContent = "Add Player";
      newActionBtn.style.display = "block";
      newActionBtn.addEventListener("click", () => this.triggerAddPlayerModal());
    }
  }

  // Auth State Transitions
  onLogin(user) {
    // Populate Sidebar profile area
    document.getElementById("sidebar-user-avatar").textContent = String(user.name || "P").substring(0,1).toUpperCase();
    document.getElementById("sidebar-user-name").textContent = user.name;
    document.getElementById("sidebar-user-role").textContent = getActiveRole();

    this.renderSidebar();
    
    // Realtime notification badge sync
    if (globalNotifUnsub) {
      globalNotifUnsub();
      globalNotifUnsub = null;
    }
    
    globalNotifUnsub = listenToUserNotifications(user.id, (notifications) => {
      const unreadCount = notifications.filter(n => !n.read).length;
      const badge = document.getElementById("notif-count");
      const sidebarBadge = document.getElementById("sidebar-notif-badge");

      if (unreadCount > 0) {
        badge.textContent = unreadCount;
        badge.style.display = "grid";
        if (sidebarBadge) {
          sidebarBadge.textContent = unreadCount;
          sidebarBadge.style.display = "inline-block";
        }
      } else {
        badge.style.display = "none";
        if (sidebarBadge) sidebarBadge.style.display = "none";
      }
    });
  }

  onLogout() {
    cleanupListeners();
    if (globalNotifUnsub) {
      globalNotifUnsub();
      globalNotifUnsub = null;
    }
    document.getElementById("sidebar-user-name").textContent = "Signed Out";
    document.getElementById("sidebar-user-role").textContent = "";
  }

  renderSidebar() {
    const role = getActiveRole();
    const nav = document.getElementById("sidebar-nav");
    const mobileNav = document.getElementById("mobile-nav");
    
    let html = `
      <button class="nav-item active" data-view="about" onclick="window.location.hash='#/about'">
        <span>ℹ️</span> About
      </button>
      <button class="nav-item" data-view="dashboard" onclick="window.location.hash='#/dashboard'">
        <span>📊</span> Dashboard
      </button>
      <button class="nav-item" data-view="tournaments" onclick="window.location.hash='#/tournaments'">
        <span>🏆</span> Tournaments
      </button>
      <button class="nav-item" data-view="teams" onclick="window.location.hash='#/teams'">
        <span>👥</span> Teams
      </button>
      <button class="nav-item" data-view="players" onclick="window.location.hash='#/players'">
        <span>🏏</span> Players
      </button>
    `;

    if (role === "superadmin") {
      html += `
        <button class="nav-item" data-view="admins" onclick="window.location.hash='#/admins'">
          <span>🛡️</span> Admins
        </button>
      `;
    }

    html += `
      <button class="nav-item" data-view="match" onclick="window.location.hash='#/matches'">
        <span>🔴</span> Live Match
      </button>
      <button class="nav-item" data-view="profile" onclick="window.location.hash='#/profile'">
        <span>👤</span> Profile <span class="notif-badge" id="sidebar-notif-badge" style="display: none;">0</span>
      </button>
    `;

    if (nav) nav.innerHTML = html;

    if (mobileNav) {
      mobileNav.innerHTML = `
        <a href="#/dashboard" class="mobile-nav-item" data-mobview="dashboard">
          <span class="mobile-nav-icon">📊</span>
          <span>Dashboard</span>
        </a>
        <a href="#/tournaments" class="mobile-nav-item" data-mobview="tournaments">
          <span class="mobile-nav-icon">🏆</span>
          <span>Tournaments</span>
        </a>
        <a href="#/matches" class="mobile-nav-item" data-mobview="match">
          <span class="mobile-nav-icon">🔴</span>
          <span>Matches</span>
        </a>
        <a href="#/profile" class="mobile-nav-item" data-mobview="profile">
          <span class="mobile-nav-icon">👤</span>
          <span>Profile</span>
        </a>
        <a href="#/about" class="mobile-nav-item" data-mobview="about">
          <span class="mobile-nav-icon">ℹ️</span>
          <span>About</span>
        </a>
      `;
    }
  }

  // --- VIEW 0: ABOUT ---
  showAbout() {
    this.showSection("view-about", "About Gully Score", "How the application works — roles, permissions, and getting started.");
    const role = getActiveRole();

    const roleCards = {
      superadmin: {
        icon: "👑",
        label: "Super Admin",
        color: "#f59e0b",
        abilities: [
          "Full control over the entire platform",
          "Promote or demote any user to/from Admin",
          "View and manage all tournaments, teams, players, and matches",
          "Cannot be demoted by anyone — only by another Super Admin",
        ]
      },
      admin: {
        icon: "🛡️",
        label: "Admin",
        color: "#6366f1",
        abilities: [
          "Create and manage tournaments you own",
          "Create matches only under your own tournaments",
          "Score and host live matches you created",
          "Cannot edit or create matches under another admin's tournament",
          "Add and manage players and teams",
        ]
      },
      player: {
        icon: "🏏",
        label: "Player",
        color: "#10b981",
        abilities: [
          "View all tournaments, teams, players, and match scores",
          "Track your personal stats via your Profile page",
          "Request Admin access from your Profile page",
          "Claim your guest player profile if added by an admin",
        ]
      }
    };

    const myCard = roleCards[role] || roleCards.player;

    const html = `
      <div class="about-page">

        <!-- Hero Banner -->
        <div class="about-hero">
          <div class="about-hero-icon">🏏</div>
          <h1 class="about-hero-title">Welcome to Gully Score</h1>
          <p class="about-hero-sub">A real-time gully cricket scoring platform with full tournament management, live scoring, and player tracking.</p>
        </div>

        <!-- Your Role Card -->
        <div class="about-role-banner" style="--role-color: ${myCard.color}">
          <div class="about-role-icon">${myCard.icon}</div>
          <div class="about-role-info">
            <div class="about-role-label">Your Role</div>
            <div class="about-role-name">${myCard.label}</div>
          </div>
        </div>

        <div class="about-role-abilities">
          <h3>What you can do</h3>
          <ul class="about-abilities-list">
            ${myCard.abilities.map(a => `<li><span class="ability-check">✓</span>${a}</li>`).join("")}
          </ul>
        </div>

        <!-- How It Works Section -->
        <div class="about-section-title">How The App Works</div>

        <div class="about-flow-grid">
          <div class="about-flow-card">
            <div class="flow-step">1</div>
            <div class="flow-icon">📝</div>
            <h4>Sign Up</h4>
            <p>Anyone can register. New accounts are created as <strong>Players</strong> by default.</p>
          </div>
          <div class="about-flow-card">
            <div class="flow-step">2</div>
            <div class="flow-icon">🙋</div>
            <h4>Request Admin</h4>
            <p>Players can request Admin access via their <strong>Profile page</strong>. The Super Admin reviews and approves requests.</p>
          </div>
          <div class="about-flow-card">
            <div class="flow-step">3</div>
            <div class="flow-icon">🏆</div>
            <h4>Create Tournament</h4>
            <p>Approved Admins can create tournaments and add teams. Only the tournament's <strong>creator</strong> can edit it or schedule matches under it.</p>
          </div>
          <div class="about-flow-card">
            <div class="flow-step">4</div>
            <div class="flow-icon">🎯</div>
            <h4>Host a Match</h4>
            <p>The Admin who created the tournament selects two teams and starts a match. They control all live scoring in real-time.</p>
          </div>
          <div class="about-flow-card">
            <div class="flow-step">5</div>
            <div class="flow-icon">📊</div>
            <h4>View Stats</h4>
            <p>All players, admins, and the public can view live scorecards, standings, and player statistics across tournaments.</p>
          </div>
          <div class="about-flow-card">
            <div class="flow-step">6</div>
            <div class="flow-icon">👑</div>
            <h4>Super Admin</h4>
            <p>The Super Admin manages all user roles and has full oversight of the platform. Credentials are set manually in Firebase.</p>
          </div>
        </div>

        <!-- Permissions Matrix -->
        <div class="about-section-title">Permissions Summary</div>
        <div class="about-permissions-table-wrap">
          <table class="about-permissions-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>🏏 Player</th>
                <th>🛡️ Admin</th>
                <th>👑 Super Admin</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>View tournaments, teams, players</td><td class="perm-yes">✓</td><td class="perm-yes">✓</td><td class="perm-yes">✓</td></tr>
              <tr><td>Create a tournament</td><td class="perm-no">✗</td><td class="perm-yes">✓</td><td class="perm-yes">✓</td></tr>
              <tr><td>Edit own tournament</td><td class="perm-no">✗</td><td class="perm-yes">✓ (own only)</td><td class="perm-yes">✓</td></tr>
              <tr><td>Edit another admin's tournament</td><td class="perm-no">✗</td><td class="perm-no">✗</td><td class="perm-yes">✓</td></tr>
              <tr><td>Create a match</td><td class="perm-no">✗</td><td class="perm-yes">✓ (own tournament)</td><td class="perm-yes">✓</td></tr>
              <tr><td>Host / score a live match</td><td class="perm-no">✗</td><td class="perm-yes">✓ (own match)</td><td class="perm-yes">✓</td></tr>
              <tr><td>Add / manage players</td><td class="perm-no">✗</td><td class="perm-yes">✓</td><td class="perm-yes">✓</td></tr>
              <tr><td>Add / manage teams</td><td class="perm-no">✗</td><td class="perm-yes">✓</td><td class="perm-yes">✓</td></tr>
              <tr><td>Approve admin requests</td><td class="perm-no">✗</td><td class="perm-no">✗</td><td class="perm-yes">✓</td></tr>
              <tr><td>Promote / demote admins</td><td class="perm-no">✗</td><td class="perm-no">✗</td><td class="perm-yes">✓</td></tr>
              <tr><td>Request admin access</td><td class="perm-yes">✓</td><td class="perm-no">—</td><td class="perm-no">—</td></tr>
            </tbody>
          </table>
        </div>

        ${role === "player" ? `
        <div class="about-cta-box">
          <div class="about-cta-icon">🚀</div>
          <div>
            <strong>Want to host tournaments?</strong>
            <p>Go to your <a href="#/profile" class="about-link">Profile page</a> and request Admin access. The Super Admin will review your request.</p>
          </div>
        </div>` : ""}

      </div>
    `;

    document.getElementById("about-content").innerHTML = html;
  }

  // --- VIEW 1: DASHBOARD ---
  async showDashboard() {
    this.showSection("view-dashboard", "Dashboard", "Overview of matches, teams, and tournament stats.");

    const role = getActiveRole();
    const grid = document.getElementById("dashboard-stats-grid");
    
    grid.innerHTML = `<div class="loading-state">Loading metrics...</div>`;

    if (role === "superadmin") {
      const unsub = listenToCollection("users", async (users) => {
        const players = await getAllDocs("players");
        const teams = await getAllDocs("teams");
        const matches = await getAllDocs("matches");
        const tournaments = await getAllDocs("tournaments");
        const admins = users.filter(u => u.role === "admin" || u.role === "superadmin");

        grid.innerHTML = `
          <div class="bento-card">
            <span class="card-label">Tournaments</span>
            <div class="card-value">${tournaments.length}</div>
            <span class="card-subtext">Total leagues created</span>
            <span class="card-icon">🏆</span>
          </div>
          <div class="bento-card">
            <span class="card-label">Teams</span>
            <div class="card-value">${teams.length}</div>
            <span class="card-subtext">Active cricket clubs</span>
            <span class="card-icon">👥</span>
          </div>
          <div class="bento-card">
            <span class="card-label">Players</span>
            <div class="card-value">${players.length}</div>
            <span class="card-subtext">Self-registered + guests</span>
            <span class="card-icon">🏏</span>
          </div>
          <div class="bento-card">
            <span class="card-label">Admins</span>
            <div class="card-value">${admins.length}</div>
            <span class="card-subtext">Authorized officials</span>
            <span class="card-icon">🛡️</span>
          </div>
          <div class="bento-card">
            <span class="card-label">Matches</span>
            <div class="card-value">${matches.length}</div>
            <span class="card-subtext">Conducted match events</span>
            <span class="card-icon">🔴</span>
          </div>
        `;
      });
      activeUnsubs.push(unsub);

    } else if (role === "admin") {
      // Find matches conducted by this admin, tournaments created by this admin, and players added by this admin.
      const unsub = listenToCollection("tournaments", async (tournaments) => {
        const matches = await getAllDocs("matches");
        const players = await getAllDocs("players");
        
        const myTournaments = tournaments.filter(t => t.createdByAdminId === getCurrentUser().id);
        const myMatches = matches.filter(m => m.umpireId === getCurrentUser().id);
        const myPlayers = players.filter(p => p.createdByAdminId === getCurrentUser().id);

        grid.innerHTML = `
          <div class="bento-card">
            <span class="card-label">My Tournaments</span>
            <div class="card-value">${myTournaments.length}</div>
            <span class="card-subtext">Tournaments created by you</span>
            <span class="card-icon">🏆</span>
          </div>
          <div class="bento-card">
            <span class="card-label">Matches Umpired</span>
            <div class="card-value">${myMatches.length}</div>
            <span class="card-subtext">Conducted matches</span>
            <span class="card-icon">🔴</span>
          </div>
          <div class="bento-card">
            <span class="card-label">Players Added</span>
            <div class="card-value">${myPlayers.length}</div>
            <span class="card-subtext">Guests & players registered</span>
            <span class="card-icon">🏏</span>
          </div>
        `;
      });
      activeUnsubs.push(unsub);

    } else {
      // Player Role Dashboard
      const playerProfile = getCurrentPlayer() || makePlayer({ name: getCurrentUser().name, email: getCurrentUser().email });
      const winPct = playerProfile.matchesPlayed > 0 ? ((playerProfile.matchesWon / playerProfile.matchesPlayed) * 100).toFixed(1) : 0;
      
      grid.innerHTML = `
        <div class="bento-card">
          <span class="card-label">Matches</span>
          <div class="card-value">${playerProfile.matchesPlayed || 0}</div>
          <span class="card-subtext">Wins: ${playerProfile.matchesWon || 0} (${winPct}%)</span>
          <span class="card-icon">🏃</span>
        </div>
        <div class="bento-card">
          <span class="card-label">Runs Scored</span>
          <div class="card-value">${playerProfile.totalRuns || 0}</div>
          <span class="card-subtext">Strike Rate: ${playerProfile.strikeRate || 0}</span>
          <span class="card-icon">🏏</span>
        </div>
        <div class="bento-card">
          <span class="card-label">Wickets</span>
          <div class="card-value">${playerProfile.totalWickets || 0}</div>
          <span class="card-subtext">Economy: ${playerProfile.economy || 0}</span>
          <span class="card-icon">⚾</span>
        </div>
        <div class="bento-card">
          <span class="card-label">Awards</span>
          <div class="card-value">${playerProfile.mvpCount || 0}</div>
          <span class="card-subtext">Match MVPs won</span>
          <span class="card-icon">🏅</span>
        </div>
      `;
    }

    // Populate active matches & ongoing tournaments in dashboard
    const matchesUnsub = listenToCollection("matches", (matches) => {
      const active = matches.filter(m => m.status === "live");
      const container = document.getElementById("dashboard-live-matches");
      
      if (active.length === 0) {
        container.innerHTML = `<div class="empty-state">No live matches currently.</div>`;
      } else {
        container.innerHTML = active.map(m => `
          <div class="team-card" onclick="window.location.hash='#/match/${m.id}'">
            <div class="card-header-row">
              <span class="status-tag live">LIVE</span>
              <strong>Overs: ${m.settings?.totalOvers || 6}</strong>
            </div>
            <strong>Match: ${m.id.substring(0, 6)}</strong>
            <span>Click to watch scorecard real-time</span>
          </div>
        `).join("");
      }
    });
    activeUnsubs.push(matchesUnsub);

    const tournamentsUnsub = listenToCollection("tournaments", (tournaments) => {
      const active = tournaments.filter(t => t.status === "ongoing");
      const container = document.getElementById("dashboard-ongoing-tournaments");
      
      if (active.length === 0) {
        container.innerHTML = `<div class="empty-state">No ongoing tournaments.</div>`;
      } else {
        container.innerHTML = active.map(t => `
          <div class="tournament-card" onclick="window.location.hash='#/tournament/${t.id}'">
            <div class="card-header-row">
              <strong>${t.tournamentName}</strong>
              <span class="status-tag live">ONGOING</span>
            </div>
            <span>Format: ${t.structure || "None"} | Location: ${t.location || "Local"}</span>
          </div>
        `).join("");
      }
    });
    activeUnsubs.push(tournamentsUnsub);
  }

  // --- VIEW 2: TOURNAMENTS LIST ---
  showTournaments() {
    this.showSection("view-tournaments", "Tournaments", "Manage and participate in Gully tournaments.");
    
    const role = getActiveRole();
    const addBtn = document.getElementById("add-tournament-btn");
    addBtn.style.display = role !== "player" ? "block" : "none";
    addBtn.onclick = () => this.triggerAddTournamentModal();

    const searchInput = document.getElementById("tournament-search");
    
    const unsub = listenToCollection("tournaments", (tournaments) => {
      const renderList = (filterText = "") => {
        const container = document.getElementById("tournaments-list-container");
        const filtered = tournaments.filter(t => 
          t.tournamentName.toLowerCase().includes(filterText.toLowerCase())
        );

        if (filtered.length === 0) {
          container.innerHTML = `<div class="empty-state">No tournaments found.</div>`;
          return;
        }

        const userId = getCurrentUser() ? getCurrentUser().id : null;
        container.innerHTML = filtered.map(t => {
          const statusBadge = t.status === "completed" 
            ? `<span class="status-tag completed">COMPLETED</span>` 
            : `<span class="status-tag live">ONGOING</span>`;
          
          const isOwner = role !== "player" && t.createdByAdminId === userId;
          const ownerBadge = isOwner
            ? `<span class="status-tag" style="background:rgba(99,102,241,0.15);color:var(--accent);border:1px solid rgba(99,102,241,0.3);font-size:10px;padding:2px 8px;">✏️ Your Tournament</span>`
            : (role === "admin" ? `<span class="status-tag" style="background:transparent;color:var(--muted);border:1px solid var(--border);font-size:10px;padding:2px 8px;">👁️ View Only</span>` : "");

          return `
            <div class="tournament-card" onclick="window.location.hash='#/tournament/${t.id}'">
              <div class="card-header-row">
                <h3 class="card-title">${t.tournamentName}</h3>
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${statusBadge}${ownerBadge}</div>
              </div>
              <p>${t.description || "No description provided."}</p>
              <div class="card-header-row margin-top-small">
                <span>📍 ${t.location}</span>
                <span>📅 ${t.startDate} to ${t.endDate}</span>
              </div>
            </div>
          `;
        }).join("");

      };

      renderList();
      searchInput.oninput = (e) => renderList(e.target.value);
    });
    activeUnsubs.push(unsub);
  }

  async triggerAddTournamentModal() {
    const teams = await getAllDocs("teams");
    let teamsCheckboxes = teams.map(t => `
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <input type="checkbox" name="tournament-teams" value="${t.id}">
        <span>${t.name}</span>
      </label>
    `).join("");

    if (teams.length === 0) {
      teamsCheckboxes = `<p class="empty-state">No teams created yet. Create a team first.</p>`;
    }

    const html = `
      <form id="add-tournament-form" class="standard-form">
        <div class="form-group">
          <label for="t-name">Tournament Name</label>
          <input type="text" id="t-name" required placeholder="Gully Premier League">
        </div>
        <div class="form-group">
          <label for="t-desc">Description</label>
          <textarea id="t-desc" placeholder="Details about scoring rules..."></textarea>
        </div>
        <div class="form-group">
          <label for="t-loc">Location</label>
          <input type="text" id="t-loc" required placeholder="Street 4 Park">
        </div>
        <div class="form-group">
          <label for="t-start">Start Date</label>
          <input type="date" id="t-start" required>
        </div>
        <div class="form-group">
          <label for="t-end">End Date</label>
          <input type="date" id="t-end" required>
        </div>
        <div class="form-group">
          <label for="t-struct">Tournament Structure</label>
          <select id="t-struct">
            <option value="None">None</option>
            <option value="T20">T20 Dropdown</option>
            <option value="Knockout">Knockout Bracket</option>
            <option value="ICC-style">ICC-style Group</option>
          </select>
        </div>
        <div class="form-group">
          <label>Select Playing Teams</label>
          <div style="max-height: 120px; overflow-y: auto; padding: 10px; background: var(--panel-2); border-radius: var(--radius-sm);">
            ${teamsCheckboxes}
          </div>
        </div>
        <button type="submit" class="primary-btn">Create Tournament</button>
      </form>
    `;

    this.openModal("Create Tournament", html);

    document.getElementById("add-tournament-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("t-name").value;
      const description = document.getElementById("t-desc").value;
      const location = document.getElementById("t-loc").value;
      const startDate = document.getElementById("t-start").value;
      const endDate = document.getElementById("t-end").value;
      const structure = document.getElementById("t-struct").value;

      const checkedTeams = Array.from(document.querySelectorAll('input[name="tournament-teams"]:checked')).map(el => el.value);

      try {
        const tournamentDoc = makeTournament({ name, description, location, startDate, endDate, structure, createdByAdminId: getCurrentUser().id });
        tournamentDoc.teamIds = checkedTeams;
        
        await saveDoc("tournaments", tournamentDoc);
        this.toast("Tournament created successfully!", "success");
        this.closeModal();
      } catch (err) {
        this.toast(err.message, "danger");
      }
    });
  }

  // --- VIEW 3: TOURNAMENT DETAIL ---
  showTournamentDetail(id) {
    this.showSection("view-tournament-detail", "Tournament Detail", "Standings, matches, and aggregate stats.");

    document.getElementById("td-back-btn").onclick = () => window.location.hash = "#/tournaments";

    // Setup tabs toggling inside tournament detail
    const tabBtns = document.querySelectorAll("#view-tournament-detail .sub-tab-btn");
    tabBtns.forEach(btn => {
      btn.replaceWith(btn.cloneNode(true)); // remove old listeners
    });

    const newTabBtns = document.querySelectorAll("#view-tournament-detail .sub-tab-btn");
    newTabBtns.forEach(btn => {
      btn.addEventListener("click", (e) => {
        newTabBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        document.querySelectorAll(".tournament-tab-content").forEach(c => c.style.display = "none");
        const target = document.getElementById(`td-tab-${btn.getAttribute("data-tab")}`);
        if (target) target.style.display = "block";
      });
    });

    // Real-time listener for the Tournament doc
    const unsubTournament = listenToDoc("tournaments", id, async (t) => {
      if (!t) {
        document.getElementById("td-name").textContent = "Tournament Not Found";
        return;
      }

      // Display Info
      document.getElementById("td-name").textContent = t.tournamentName;
      document.getElementById("td-meta").textContent = `📍 ${t.location} | 📅 ${t.startDate} to ${t.endDate} | Format: ${t.structure}`;

      // End Tournament button logic
      const adminActions = document.getElementById("td-admin-actions");
      adminActions.innerHTML = ""; // clear
      
      const role = getActiveRole();
      const isCreator = t.createdByAdminId === getCurrentUser().id;
      
      if (t.status === "ongoing" && (role === "superadmin" || (role === "admin" && isCreator))) {
        const endBtn = document.createElement("button");
        endBtn.className = "primary-btn";
        endBtn.textContent = "End Tournament";
        
        // Disable if any match is live
        const matches = await getAllDocs("matches");
        const tMatches = matches.filter(m => m.tournamentId === t.id);
        const hasLive = tMatches.some(m => m.status === "live");
        if (hasLive) {
          endBtn.disabled = true;
          endBtn.style.opacity = 0.5;
          endBtn.title = "Cannot end tournament while matches are live.";
        }

        endBtn.onclick = () => this.confirmEndTournament(t, tMatches);
        adminActions.appendChild(endBtn);
      }

      // 1. Standings calculations (Points Table)
      const allTeams = await getAllDocs("teams");
      const tournamentTeams = allTeams.filter(team => t.teamIds.includes(team.id));
      
      this.renderTournamentStandings(t, tournamentTeams);

      // 2. Matches subtab
      const matches = await getAllDocs("matches");
      const tMatches = matches.filter(m => m.tournamentId === t.id);
      this.renderTournamentMatches(t, tMatches, allTeams);

      // 3. Stats subtab
      this.renderTournamentStats(t, tournamentTeams, tMatches);
    });
    activeUnsubs.push(unsubTournament);
  }

  renderTournamentStandings(tournament, teams) {
    const body = document.getElementById("td-standings-body");
    
    // Standings recalculator locally
    const standings = teams.map(team => {
      return {
        id: team.id,
        name: team.name,
        played: team.matchesPlayed || 0,
        won: team.matchesWon || 0,
        lost: team.matchesLost || 0,
        tied: team.matchesTied || 0,
        nrr: team.netRunRate || 0,
        pts: (team.matchesWon || 0) * 2 + (team.matchesTied || 0) * 1
      };
    });

    // Sort by: Points DESC -> NRR DESC -> Name
    standings.sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.nrr !== a.nrr) return b.nrr - a.nrr;
      return a.name.localeCompare(b.name);
    });

    if (standings.length === 0) {
      body.innerHTML = `<tr><td colspan="8" class="empty-state">No teams joined yet.</td></tr>`;
      return;
    }

    body.innerHTML = standings.map((s, idx) => {
      let championIcon = "";
      if (tournament.status === "completed") {
        if (tournament.champion === s.id) championIcon = "🏆 <span style='font-size:11px;color:var(--accent)'>Champion</span>";
        else if (tournament.runnerUp === s.id) championIcon = "🥈 <span style='font-size:11px;color:var(--muted)'>Runner-up</span>";
      }
      return `
        <tr>
          <td><strong>${idx + 1}</strong></td>
          <td><a href="#/team/${s.id}"><strong>${s.name}</strong></a> ${championIcon}</td>
          <td>${s.played}</td>
          <td>${s.won}</td>
          <td>${s.lost}</td>
          <td>${s.tied}</td>
          <td>${s.nrr > 0 ? "+" + s.nrr : s.nrr}</td>
          <td><strong>${s.pts}</strong></td>
        </tr>
      `;
    }).join("");
  }

  renderTournamentMatches(tournament, matches, allTeams = []) {
    const container = document.getElementById("td-matches-container");
    const createBtn = document.getElementById("td-create-match-btn");

    const role = getActiveRole();
    const isCreator = tournament.createdByAdminId === getCurrentUser().id;

    if (tournament.status === "ongoing" && (role === "superadmin" || (role === "admin" && isCreator))) {
      createBtn.style.display = "block";
      createBtn.onclick = () => this.triggerCreateMatchFlow(tournament.id);
    } else {
      createBtn.style.display = "none";
    }

    if (matches.length === 0) {
      container.innerHTML = `<p class="empty-state">No matches played in this tournament yet.</p>`;
      return;
    }

    // Sort matches: newest first
    matches.sort((a,b) => b.createdAt.localeCompare(a.createdAt));

    const teamMap = {};
    allTeams.forEach(t => { teamMap[t.id] = t.name; });

    container.innerHTML = matches.map(m => {
      let statusTag = `<span class="status-tag setup">Setup</span>`;
      if (m.status === "live") statusTag = `<span class="status-tag live">LIVE</span>`;
      else if (m.status === "completed") statusTag = `<span class="status-tag completed">Completed</span>`;

      const tNameA = teamMap[m.teamAId] || m.teamAId.substring(5, 10).toUpperCase();
      const tNameB = teamMap[m.teamBId] || m.teamBId.substring(5, 10).toUpperCase();

      let matchFours = m.totalFours || 0;
      let matchSixes = m.totalSixes || 0;
      if (m.status !== "completed" && m.innings) {
        m.innings.forEach(inn => {
          (inn.balls || []).forEach(b => {
            if (b.event === "4" || b.event.endsWith("+4")) matchFours++;
            if (b.event === "6" || b.event.endsWith("+6")) matchSixes++;
          });
        });
      }

      return `
        <div class="match-card" onclick="window.location.hash='#/match/${m.id}'">
          <div class="card-header-row">
            ${statusTag}
            <span>📅 ${m.createdAt ? new Date(m.createdAt).toLocaleDateString() : ""}</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin:10px 0;">
            <strong>${tNameA}</strong> 
            <span>VS</span> 
            <strong>${tNameB}</strong>
          </div>
          <p style="font-size:12px;color:var(--muted);margin-bottom:4px;">${m.result || "No scores recorded yet."}</p>
          <div style="font-size:11px;color:var(--muted);display:flex;gap:12px;border-top:1px dashed var(--border);padding-top:6px;margin-top:6px;">
            <span>Boundaries: Fours: <strong>${matchFours}</strong> | Sixes: <strong>${matchSixes}</strong></span>
          </div>
        </div>
      `;
    }).join("");
  }

  async renderTournamentStats(tournament, teams, matches) {
    const container = document.getElementById("td-stats-container");
    
    if (matches.length === 0) {
      container.innerHTML = `<p class="empty-state">Aggregate stats will compute once matches complete.</p>`;
      return;
    }

    // Aggregate stats calculation
    let totalRuns = 0;
    let totalWickets = 0;
    let totalFours = 0;
    let totalSixes = 0;

    matches.forEach(m => {
      totalRuns += (m.totalRuns || 0);
      totalWickets += (m.totalWickets || 0);
      totalFours += (m.totalFours || 0);
      totalSixes += (m.totalSixes || 0);
    });

    // Aggregate player stats across all matches in this tournament
    const playerStats = {}; // playerId -> { id, name, runs, balls, fours, sixes, wickets, dotBalls }

    matches.forEach(m => {
      if (!m.innings) return;
      m.innings.forEach(inn => {
        // Batting
        Object.entries(inn.batting || {}).forEach(([pid, rec]) => {
          if (rec.status !== "yet to bat") {
            playerStats[pid] ||= { id: pid, name: "", runs: 0, balls: 0, fours: 0, sixes: 0, wickets: 0, dotBalls: 0 };
            playerStats[pid].runs += rec.runs || 0;
            playerStats[pid].balls += rec.balls || 0;
            playerStats[pid].fours += rec.fours || 0;
            playerStats[pid].sixes += rec.sixes || 0;
          }
        });
        // Bowling
        Object.entries(inn.bowling || {}).forEach(([pid, rec]) => {
          playerStats[pid] ||= { id: pid, name: "", runs: 0, balls: 0, fours: 0, sixes: 0, wickets: 0, dotBalls: 0 };
          playerStats[pid].wickets += rec.wickets || 0;
          playerStats[pid].dotBalls += rec.dotBalls || 0;
        });
      });
    });

    // Fetch player names to resolve IDs
    const allPlayers = await getAllDocs("players");
    const playerMap = {};
    allPlayers.forEach(p => { playerMap[p.id] = p.name; });

    Object.keys(playerStats).forEach(pid => {
      playerStats[pid].name = playerMap[pid] || `Player ${pid.substring(0, 5)}`;
    });

    const playersList = Object.values(playerStats);

    // Calculate Man of the Series (MOTS)
    let motsPlayer = null;
    if (tournament.status === "completed" && tournament.manOfTheSeries) {
      motsPlayer = playerStats[tournament.manOfTheSeries] || null;
      if (!motsPlayer) {
        const p = await getDocById("players", tournament.manOfTheSeries);
        if (p) {
          motsPlayer = {
            id: p.id,
            name: p.name,
            runs: p.runs || 0,
            balls: p.ballsFaced || 0,
            fours: p.fours || 0,
            sixes: p.sixes || 0,
            wickets: p.wickets || 0,
            dotBalls: p.dotBalls || 0
          };
        }
      }
    }
    
    // If dynamic calculation or fallback
    if (!motsPlayer && playersList.length > 0) {
      let maxPoints = -1;
      playersList.forEach(p => {
        const points = p.runs * 1 + p.fours * 1 + p.sixes * 2 + p.wickets * 25 + p.dotBalls * 1;
        if (points > maxPoints) {
          maxPoints = points;
          motsPlayer = p;
        }
      });
    }

    let motsHtml = "";
    if (motsPlayer) {
      const sr = motsPlayer.balls > 0 ? ((motsPlayer.runs / motsPlayer.balls) * 100).toFixed(1) : "0.0";
      motsHtml = `
        <div class="bento-card" style="grid-column: span 3; background: linear-gradient(135deg, var(--brand), var(--brand-2)); color: white; border: none; box-shadow: var(--shadow);">
          <span class="card-label" style="color: rgba(255,255,255,0.85); font-weight: 600;">🏅 Man of the Series</span>
          <div class="card-value" style="font-size: 1.8rem; margin: 10px 0; font-weight: 800; color: #fff;">${motsPlayer.name}</div>
          <div class="table-container" style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 10px; margin-top: 10px; border: 1px solid rgba(255,255,255,0.1);">
            <table style="width: 100%; border-collapse: collapse; text-align: center; color: white;">
              <thead>
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.2); font-size: 12px; color: rgba(255, 255, 255, 0.8);">
                  <th style="padding: 6px;">Runs</th>
                  <th style="padding: 6px;">Strike Rate</th>
                  <th style="padding: 6px;">Wickets</th>
                  <th style="padding: 6px;">Fours</th>
                  <th style="padding: 6px;">Sixes</th>
                </tr>
              </thead>
              <tbody>
                <tr style="font-weight: bold; font-size: 16px;">
                  <td style="padding: 8px;">${motsPlayer.runs}</td>
                  <td style="padding: 8px;">${sr}</td>
                  <td style="padding: 8px;">${motsPlayer.wickets}</td>
                  <td style="padding: 8px;">${motsPlayer.fours}</td>
                  <td style="padding: 8px;">${motsPlayer.sixes}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else {
      motsHtml = `
        <div class="bento-card" style="grid-column: span 3;">
          <span class="card-label">🏅 Man of the Series</span>
          <div class="card-value" style="font-size: 1.3rem; margin-top: 10px; color: var(--muted);">TBD (No stats recorded)</div>
        </div>
      `;
    }

    // Top 5 lists
    const topRuns = [...playersList].sort((a,b) => b.runs - a.runs).slice(0, 5);
    const topWickets = [...playersList].sort((a,b) => b.wickets - a.wickets).slice(0, 5);
    const topFours = [...playersList].sort((a,b) => b.fours - a.fours).slice(0, 5);
    const topSixes = [...playersList].sort((a,b) => b.sixes - a.sixes).slice(0, 5);
    const topDots = [...playersList].sort((a,b) => b.dotBalls - a.dotBalls).slice(0, 5);

    const renderLeaderTableHtml = (title, list, metricKey, metricLabel) => {
      let rows = list.map((p, idx) => `
        <tr style="border-bottom: 1px solid var(--border);">
          <td style="padding: 8px 12px; text-align: left; font-weight: 500;">${idx + 1}. <a href="#/player/${p.id}"><strong>${p.name}</strong></a></td>
          <td style="padding: 8px 12px; text-align: right; font-weight: 700; color: var(--accent);">${p[metricKey]}</td>
        </tr>
      `).join("");
      
      if (list.length === 0) {
        rows = `<tr><td colspan="2" class="empty-state" style="padding:15px;">No records</td></tr>`;
      }

      return `
        <div class="bento-card" style="padding: 15px; border-radius: 12px; background: var(--panel); border: 1px solid var(--border); box-shadow: var(--shadow-sm);">
          <h4 style="margin: 0 0 12px 0; font-size: 1.05rem; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 6px;">${title}</h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead>
              <tr style="color: var(--muted); font-size: 11px; text-transform: uppercase;">
                <th style="padding: 4px 12px; text-align: left;">Player</th>
                <th style="padding: 4px 12px; text-align: right;">${metricLabel}</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      `;
    };

    let championName = "Pending End";
    let runnerUpName = "Pending End";

    if (tournament.status === "completed") {
      const champ = teams.find(t => t.id === tournament.champion);
      const runner = teams.find(t => t.id === tournament.runnerUp);
      
      championName = champ ? champ.name : "N/A";
      runnerUpName = runner ? runner.name : "N/A";
    }

    container.innerHTML = `
      <div class="bento-grid">
        <div class="bento-card">
          <span class="card-label">Champion</span>
          <div class="card-value">${championName}</div>
          <span class="card-icon">🏆</span>
        </div>
        <div class="bento-card">
          <span class="card-label">Runner-Up</span>
          <div class="card-value">${runnerUpName}</div>
          <span class="card-icon">🥈</span>
        </div>
        
        <!-- Man of the Series Block -->
        ${motsHtml}
      </div>
      <div class="bento-grid-mini" style="margin-top: 20px;">
        <div class="bento-card">
          <span class="card-label">Total Runs Scored</span>
          <div class="card-value">${totalRuns}</div>
          <span class="card-subtext">Avg. Match runs: ${(totalRuns / matches.length).toFixed(0)}</span>
        </div>
        <div class="bento-card">
          <span class="card-label">Total Wickets Fallen</span>
          <div class="card-value">${totalWickets}</div>
          <span class="card-subtext">Fours: ${totalFours} | Sixes: ${totalSixes}</span>
        </div>
      </div>

      <!-- Leaderboards Block -->
      <h3 style="margin-top: 30px; margin-bottom: 15px; font-size: 1.25rem; color: var(--accent);">🏆 Tournament Leaderboards (Top 5 Players)</h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px; margin-top: 15px;">
        ${renderLeaderTableHtml("Most Runs", topRuns, "runs", "Runs")}
        ${renderLeaderTableHtml("Most Wickets", topWickets, "wickets", "Wkts")}
        ${renderLeaderTableHtml("Most Fours", topFours, "fours", "4s")}
        ${renderLeaderTableHtml("Most Sixes", topSixes, "sixes", "6s")}
        ${renderLeaderTableHtml("Most Dot Balls", topDots, "dotBalls", "Dots")}
      </div>
    `;
  }

  async confirmEndTournament(tournament, matches) {
    if (matches.length === 0) {
      this.toast("Cannot end a tournament without matches.", "warning");
      return;
    }

    const confirmHtml = `
      <div class="text-center">
        <p style="margin-bottom: 20px;">Are you sure you want to end this tournament? The current table-top team will be declared Champion. This action cannot be undone.</p>
        <div style="display:flex;gap:12px;">
          <button id="confirm-end-t-btn" class="primary-btn full-width">End Tournament &rarr;</button>
          <button id="cancel-end-t-btn" class="secondary-btn full-width">Cancel</button>
        </div>
      </div>
    `;

    this.openModal("Confirm End Tournament", confirmHtml);

    document.getElementById("cancel-end-t-btn").onclick = () => this.closeModal();

    document.getElementById("confirm-end-t-btn").onclick = async () => {
      this.showLoader();
      try {
        const allTeams = await getAllDocs("teams");
        const tTeams = allTeams.filter(team => tournament.teamIds.includes(team.id));
        
        // Rank teams
        const standings = tTeams.map(t => {
          return {
            id: t.id,
            name: t.name,
            nrr: t.netRunRate || 0,
            pts: (t.matchesWon || 0) * 2 + (t.matchesTied || 0) * 1
          };
        });
        standings.sort((a, b) => {
          if (b.pts !== a.pts) return b.pts - a.pts;
          if (b.nrr !== a.nrr) return b.nrr - a.nrr;
          return 0;
        });

        const champId = standings[0] ? standings[0].id : null;
        const runnerId = standings[1] ? standings[1].id : null;

        // Man of Series Calculation: player from champion team with highest combined MVP Bat/Bowl awards
        let manOfTheSeries = null;
        if (champId) {
          const champTeam = tTeams.find(team => team.id === champId);
          if (champTeam && champTeam.playerIds && champTeam.playerIds.length) {
            const playersList = [];
            for (const pid of champTeam.playerIds) {
              const p = await getDocById("players", pid);
              if (p) playersList.push(p);
            }
            playersList.sort((a,b) => (b.mvpCount || 0) - (a.mvpCount || 0));
            manOfTheSeries = playersList[0] ? playersList[0].id : null;
          }
        }

        tournament.status = "completed";
        tournament.champion = champId;
        tournament.runnerUp = runnerId;
        tournament.manOfTheSeries = manOfTheSeries;
        
        await saveDoc("tournaments", tournament);
        this.toast("Tournament successfully completed!", "success");
        this.closeModal();
      } catch (err) {
        this.toast(err.message, "danger");
      } finally {
        this.hideLoader();
      }
    };
  }

  // --- VIEW 4: TEAMS ---
  showTeams() {
    this.showSection("view-teams", "Teams", "Create and view cricket teams.");

    const searchInput = document.getElementById("team-search");
    
    // Add/Create Team trigger (restricted to admin/superadmin)
    const role = getActiveRole();
    const addBtn = document.getElementById("add-team-btn");
    if (role === "admin" || role === "superadmin") {
      addBtn.style.display = "block";
      addBtn.onclick = () => this.triggerAddTeamModal();
    } else {
      addBtn.style.display = "none";
    }

    const unsub = listenToCollection("teams", (teams) => {
      const renderList = (filterText = "") => {
        const container = document.getElementById("teams-list-container");
        const filtered = teams.filter(t => t.name.toLowerCase().includes(filterText.toLowerCase()));

        if (filtered.length === 0) {
          container.innerHTML = `<div class="empty-state">No teams found.</div>`;
          return;
        }

        container.innerHTML = filtered.map(t => {
          return `
            <div class="team-card" onclick="window.location.hash='#/team/${t.id}'">
              <h3 class="card-title">${t.name}</h3>
              <p>Squad Count: ${t.playerIds ? t.playerIds.length : 0} players</p>
              <div class="card-header-row margin-top-small">
                <span>Wins: ${t.matchesWon || 0}</span>
                <span>Losses: ${t.matchesLost || 0}</span>
              </div>
            </div>
          `;
        }).join("");
      };

      renderList();
      searchInput.oninput = (e) => renderList(e.target.value);
    });
    activeUnsubs.push(unsub);
  }

  async triggerAddTeamModal() {
    const players = await getAllDocs("players");
    
    const playersCheckboxes = players.map(p => `
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <input type="checkbox" name="team-players" value="${p.id}">
        <span>${p.name} ${p.isGuest ? "(Guest)" : ""}</span>
      </label>
    `).join("");

    const captainOptions = players.map(p => `
      <option value="${p.id}">${p.name}</option>
    `).join("");

    const html = `
      <form id="add-team-form" class="standard-form">
        <div class="form-group">
          <label for="team-name-input">Team Name</label>
          <input type="text" id="team-name-input" required placeholder="Lane Legends">
        </div>
        <div class="form-group">
          <label for="team-captain-select">Captain</label>
          <select id="team-captain-select" required>
            <option value="">Select Captain...</option>
            ${captainOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Select Team Squad Members</label>
          <div style="max-height: 150px; overflow-y: auto; padding: 10px; background: var(--panel-2); border-radius: var(--radius-sm);">
            ${playersCheckboxes}
          </div>
        </div>
        <button type="submit" class="primary-btn">Create Team</button>
      </form>
    `;

    this.openModal("Create Team", html);

    // Sync captain selection into squad checkbox automatically
    document.getElementById("team-captain-select").addEventListener("change", (e) => {
      const capId = e.target.value;
      const chk = document.querySelector(`input[name="team-players"][value="${capId}"]`);
      if (chk) chk.checked = true;
    });

    document.getElementById("add-team-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("team-name-input").value;
      const captainId = document.getElementById("team-captain-select").value;
      const squadIds = Array.from(document.querySelectorAll('input[name="team-players"]:checked')).map(el => el.value);

      if (!squadIds.includes(captainId)) {
        this.toast("Captain must be a squad member.", "warning");
        return;
      }

      this.showLoader();
      try {
        const allTeams = await getAllDocs("teams");
        const exists = allTeams.some(t => t.name && t.name.trim().toLowerCase() === name.trim().toLowerCase());
        if (exists) {
          this.toast("A team with this name already exists.", "warning");
          this.hideLoader();
          return;
        }

        const teamDoc = makeTeam({ name, playerIds: squadIds, captainId, createdByAdminId: getCurrentUser().id });
        await saveDoc("teams", teamDoc);
        
        // Update player model refs
        for (const pid of squadIds) {
          const player = await getDocById("players", pid);
          if (player) {
            player.teamIds = [...new Set([...(player.teamIds || []), teamDoc.id])];
            await saveDoc("players", player);
            if (player.userId && pid !== captainId) {
              await sendNotification(player.userId, `You have been added to team: ${name}!`, "team_added", `#/team/${teamDoc.id}`);
            }
          }
        }

        // Notify captain
        const captain = await getDocById("players", captainId);
        if (captain && captain.userId) {
          await sendNotification(captain.userId, `You have been appointed Captain of team: ${name}!`, "claim_approved", `#/team/${teamDoc.id}`);
        }

        await recalculateStats();
        this.toast("Team created successfully!", "success");
        this.closeModal();
      } catch (err) {
        this.toast(err.message, "danger");
      } finally {
        this.hideLoader();
      }
    });
  }

  async triggerEditTeamModal(team) {
    const players = await getAllDocs("players");
    
    const playersCheckboxes = players.map(p => {
      const isChecked = (team.playerIds || []).includes(p.id) ? "checked" : "";
      return `
        <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <input type="checkbox" name="team-players" value="${p.id}" ${isChecked}>
          <span>${p.name} ${p.isGuest ? "(Guest)" : ""}</span>
        </label>
      `;
    }).join("");

    const captainOptions = players.map(p => {
      const isSelected = p.id === team.captainId ? "selected" : "";
      return `
        <option value="${p.id}" ${isSelected}>${p.name}</option>
      `;
    }).join("");

    const html = `
      <form id="edit-team-form" class="standard-form">
        <div class="form-group">
          <label for="team-name-input">Team Name</label>
          <input type="text" id="team-name-input" required value="${team.name}" placeholder="Lane Legends">
        </div>
        <div class="form-group">
          <label for="team-captain-select">Captain</label>
          <select id="team-captain-select" required>
            <option value="">Select Captain...</option>
            ${captainOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Select Team Squad Members</label>
          <div style="max-height: 150px; overflow-y: auto; padding: 10px; background: var(--panel-2); border-radius: var(--radius-sm);">
            ${playersCheckboxes}
          </div>
        </div>
        <button type="submit" class="primary-btn">Save Changes</button>
      </form>
    `;

    this.openModal(`Edit Team: ${team.name}`, html);

    // Sync captain selection into squad checkbox automatically
    document.getElementById("team-captain-select").addEventListener("change", (e) => {
      const capId = e.target.value;
      const chk = document.querySelector(`input[name="team-players"][value="${capId}"]`);
      if (chk) chk.checked = true;
    });

    document.getElementById("edit-team-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("team-name-input").value;
      const captainId = document.getElementById("team-captain-select").value;
      const squadIds = Array.from(document.querySelectorAll('input[name="team-players"]:checked')).map(el => el.value);

      if (!squadIds.includes(captainId)) {
        this.toast("Captain must be a squad member.", "warning");
        return;
      }

      this.showLoader();
      try {
        // Uniqueness check: check other teams (excluding this one)
        const allTeams = await getAllDocs("teams");
        const exists = allTeams.some(t => t.id !== team.id && t.name && t.name.trim().toLowerCase() === name.trim().toLowerCase());
        if (exists) {
          this.toast("A team with this name already exists.", "warning");
          this.hideLoader();
          return;
        }

        const oldSquadIds = team.playerIds || [];
        const addedPlayers = squadIds.filter(id => !oldSquadIds.includes(id));
        const removedPlayers = oldSquadIds.filter(id => !squadIds.includes(id));

        // Add team.id to added players
        for (const pid of addedPlayers) {
          const p = await getDocById("players", pid);
          if (p) {
            p.teamIds = [...new Set([...(p.teamIds || []), team.id])];
            await saveDoc("players", p);
            if (p.userId && pid !== captainId) {
              await sendNotification(p.userId, `You have been added to team: ${name}!`, "team_added", `#/team/${team.id}`);
            }
          }
        }

        // Remove team.id from removed players
        for (const pid of removedPlayers) {
          const p = await getDocById("players", pid);
          if (p) {
            p.teamIds = (p.teamIds || []).filter(tid => tid !== team.id);
            await saveDoc("players", p);
          }
        }

        // Handle captain change history
        const oldCaptainId = team.captainId;
        if (oldCaptainId !== captainId) {
          const history = team.captainHistory || [];
          if (history.length > 0) {
            history[history.length - 1].toDate = new Date().toISOString();
          }
          history.push({
            captainId: captainId,
            fromDate: new Date().toISOString()
          });
          team.captainHistory = history;

          // Notify new captain
          const captainPlayer = await getDocById("players", captainId);
          if (captainPlayer && captainPlayer.userId) {
            await sendNotification(captainPlayer.userId, `You have been appointed Captain of team: ${name}!`, "claim_approved", `#/team/${team.id}`);
          }
        }

        // Save updated team doc
        team.name = name;
        team.captainId = captainId;
        team.playerIds = squadIds;

        await saveDoc("teams", team);
        await recalculateStats();
        
        this.toast("Team updated successfully!", "success");
        this.closeModal();
      } catch (err) {
        this.toast(err.message, "danger");
      } finally {
        this.hideLoader();
      }
    });
  }

  async triggerDeleteTeam(team) {
    if (!confirm(`Are you sure you want to delete team "${team.name}"? This action cannot be undone.`)) {
      return;
    }

    this.showLoader();
    try {
      const squadIds = team.playerIds || [];
      // Clean team references from player profiles
      for (const pid of squadIds) {
        const p = await getDocById("players", pid);
        if (p) {
          p.teamIds = (p.teamIds || []).filter(tid => tid !== team.id);
          await saveDoc("players", p);
        }
      }

      await deleteDocById("teams", team.id);
      await recalculateStats();
      
      this.toast("Team deleted successfully!", "success");
      this.closeModal();
      window.location.hash = "#/teams";
    } catch (err) {
      this.toast(err.message, "danger");
    } finally {
      this.hideLoader();
    }
  }

  // --- VIEW 5: TEAM DETAIL ---
  showTeamDetail(id) {
    this.showSection("view-team-detail", "Team Detail", "Squad member list and win performance.");
    
    document.getElementById("team-back-btn").onclick = () => window.location.hash = "#/teams";

    const unsub = listenToDoc("teams", id, async (team) => {
      if (!team) {
        document.getElementById("team-detail-name").textContent = "Team Not Found";
        return;
      }

      document.getElementById("team-detail-name").textContent = team.name;

      // Captain Display
      const captain = await getDocById("players", team.captainId);
      const capLink = document.getElementById("team-detail-captain");
      if (captain) {
        capLink.textContent = captain.name;
        capLink.href = `#/player/${captain.id}`;
      } else {
        capLink.textContent = "Unknown";
      }

      // Creator Display
      const creatorLink = document.getElementById("team-detail-creator");
      if (team.createdByAdminId) {
        const creatorUser = await getDocById("users", team.createdByAdminId);
        creatorLink.textContent = creatorUser ? creatorUser.name : "System Admin";
        creatorLink.href = creatorUser ? `#/player/${creatorUser.playerId || ''}` : "#";
      } else {
        creatorLink.textContent = "N/A";
      }

      // Render Edit/Delete Admin buttons (restricted to superadmin only)
      const role = getActiveRole();
      const adminActions = document.getElementById("team-admin-actions");
      if (role === "superadmin") {
        adminActions.style.display = "flex";
        document.getElementById("btn-edit-team").onclick = () => this.triggerEditTeamModal(team);
        document.getElementById("btn-delete-team").onclick = () => this.triggerDeleteTeam(team);
      } else {
        adminActions.style.display = "none";
      }

      // Squad listing
      const tbody = document.getElementById("team-players-body");
      if (!team.playerIds || team.playerIds.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="empty-state">No members in squad.</td></tr>`;
      } else {
        const squad = [];
        for (const pid of team.playerIds) {
          const p = await getDocById("players", pid);
          if (p) squad.push(p);
        }

        tbody.innerHTML = squad.map(p => {
          const role = p.id === team.captainId ? "<strong>Captain</strong>" : "Player";
          return `
            <tr>
              <td><a href="#/player/${p.id}"><strong>${p.name}</strong></a> ${p.isGuest ? "(Guest)" : ""}</td>
              <td>${role}</td>
              <td>${p.matchesPlayed || 0}</td>
            </tr>
          `;
        }).join("");
      }

      // Bento stats
      const winPct = team.matchesPlayed > 0 ? ((team.matchesWon / team.matchesPlayed) * 100).toFixed(1) : 0;
      document.getElementById("team-stats-grid").innerHTML = `
        <div class="bento-card">
          <span class="card-label">Matches</span>
          <div class="card-value">${team.matchesPlayed || 0}</div>
          <span class="card-subtext">Played</span>
        </div>
        <div class="bento-card">
          <span class="card-label">Win Ratio</span>
          <div class="card-value">${winPct}%</div>
          <span class="card-subtext">Won: ${team.matchesWon || 0} | Lost: ${team.matchesLost || 0}</span>
        </div>
      `;

      // Captain History
      const capHistoryList = document.getElementById("team-captain-history");
      if (!team.captainHistory || team.captainHistory.length === 0) {
        capHistoryList.innerHTML = `<li class="empty-state">No captain changes recorded.</li>`;
      } else {
        const items = [];
        for (const h of team.captainHistory) {
          const cPlayer = await getDocById("players", h.captainId);
          const name = cPlayer ? cPlayer.name : "Unknown";
          const date = new Date(h.fromDate).toLocaleDateString();
          items.push(`<li><strong>${name}</strong> (Assigned: ${date})</li>`);
        }
        capHistoryList.innerHTML = items.join("");
      }
    });
    activeUnsubs.push(unsub);
  }

  // --- VIEW 6: PLAYERS LIST ---
  showPlayers() {
    this.showSection("view-players", "Players", "Cricket player profiles, rankings, and stats.");

    const role = getActiveRole();
    const addBtn = document.getElementById("add-player-btn");
    addBtn.style.display = role !== "player" ? "block" : "none";
    addBtn.onclick = () => this.triggerAddPlayerModal();

    const searchInput = document.getElementById("player-search");

    const unsub = listenToCollection("players", (players) => {
      const renderList = (filterText = "") => {
        const tbody = document.getElementById("players-list-body");
        const filtered = players.filter(p => {
          if (!p || !p.name) return false;
          return p.name.toLowerCase().includes(filterText.toLowerCase());
        });

        if (filtered.length === 0) {
          tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No players found.</td></tr>`;
          return;
        }

        tbody.innerHTML = filtered.map(p => {
          const pid = p.id || "";
          const pName = p.name || "Unknown Player";
          return `
            <tr onclick="window.location.hash='#/player/${pid}'" style="cursor:pointer;">
              <td><code>${pid.substring(0, 8)}</code></td>
              <td><strong>${pName}</strong> ${p.isGuest ? "<span class='status-tag setup' style='font-size:10px;margin-left:6px;'>Guest</span>" : ""}</td>
              <td>${p.teamIds && p.teamIds.length ? `In ${p.teamIds.length} team(s)` : "None"}</td>
              <td>${p.matchesAsUmpire || 0}</td>
              <td>${p.teamsCreatedCount || 0}</td>
            </tr>
          `;
        }).join("");
      };

      renderList();
      searchInput.oninput = (e) => renderList(e.target.value);
    });
    activeUnsubs.push(unsub);
  }

  triggerAddPlayerModal() {
    const html = `
      <form id="add-player-form" class="standard-form">
        <div class="form-group">
          <label style="flex-direction:row; gap:8px;">
            <input type="checkbox" id="p-guest">
            <strong>Register as Guest Player (No Email/Mobile)</strong>
          </label>
        </div>
        <div class="form-group">
          <label for="p-name">Full Name</label>
          <input type="text" id="p-name" required placeholder="Virat Kohli">
        </div>
        <div class="form-group" id="p-email-group">
          <label for="p-email">Email Address</label>
          <input type="email" id="p-email" required placeholder="virat@cricket.com">
        </div>
        <div class="form-group" id="p-mobile-group">
          <label for="p-mobile">Mobile Number</label>
          <input type="tel" id="p-mobile" required placeholder="9000100010">
        </div>
        <div class="form-group">
          <label for="p-gender">Gender</label>
          <select id="p-gender" required>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <button type="submit" class="primary-btn">Create Player</button>
      </form>
    `;

    this.openModal("Add Player", html);

    const guestToggle = document.getElementById("p-guest");
    const emailGroup = document.getElementById("p-email-group");
    const mobileGroup = document.getElementById("p-mobile-group");
    const emailInput = document.getElementById("p-email");
    const mobileInput = document.getElementById("p-mobile");

    guestToggle.addEventListener("change", (e) => {
      const isGuest = e.target.checked;
      if (isGuest) {
        emailGroup.style.display = "none";
        mobileGroup.style.display = "none";
        emailInput.removeAttribute("required");
        mobileInput.removeAttribute("required");
      } else {
        emailGroup.style.display = "flex";
        mobileGroup.style.display = "flex";
        emailInput.setAttribute("required", "true");
        mobileInput.setAttribute("required", "true");
      }
    });

    document.getElementById("add-player-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const isGuest = guestToggle.checked;
      const name = document.getElementById("p-name").value;
      const email = isGuest ? "" : emailInput.value;
      const mobile = isGuest ? "" : mobileInput.value;
      const gender = document.getElementById("p-gender").value;

      this.showLoader();
      try {
        const playerDoc = makePlayer({ name, email, mobile, gender, isGuest, createdByAdminId: getCurrentUser().id });
        await saveDoc("players", playerDoc);
        this.toast(`Player profile for ${name} created.`, "success");
        this.closeModal();
      } catch (err) {
        this.toast(err.message, "danger");
      } finally {
        this.hideLoader();
      }
    });
  }

  // --- VIEW 7: PLAYER DETAIL ---
  showPlayerDetail(id) {
    this.showSection("view-player-detail", "Player Detail", "Performance records and career milestones.");
    
    document.getElementById("player-back-btn").onclick = () => window.location.hash = "#/players";

    // Subtabs toggling inside player detail
    const tabBtns = document.querySelectorAll("#view-player-detail .sub-tab-btn");
    tabBtns.forEach(btn => {
      btn.replaceWith(btn.cloneNode(true));
    });
    
    const newBtns = document.querySelectorAll("#view-player-detail .sub-tab-btn");
    newBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        newBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        
        document.querySelectorAll(".player-tab-content").forEach(c => c.style.display = "none");
        const target = document.getElementById(`pd-tab-${btn.getAttribute("data-player-tab")}`);
        if (target) target.style.display = "block";
      });
    });

    const unsub = listenToDoc("players", id, async (p) => {
      if (!p) {
        document.getElementById("pd-name").textContent = "Player Not Found";
        return;
      }

      document.getElementById("pd-name").textContent = p.name;
      document.getElementById("pd-sub").textContent = `ID: ${p.id} | Gender: ${p.gender}`;

      // Guest player status tag
      const claimStatusTag = document.getElementById("pd-claim-status");
      if (p.isGuest) {
        claimStatusTag.style.display = "block";
        if (p.claimedBy) {
          const claimant = await getDocById("players", p.claimedBy);
          claimStatusTag.innerHTML = `<span class="status-tag completed">Claimed by ${claimant ? claimant.name : 'another player'}</span>`;
        } else {
          claimStatusTag.innerHTML = `<span class="status-tag setup">Unclaimed Guest Score</span>`;
        }
      } else {
        claimStatusTag.style.display = "none";
      }

      // Stats Grid
      const winPct = p.matchesPlayed > 0 ? ((p.matchesWon / p.matchesPlayed) * 100).toFixed(1) : 0;
      document.getElementById("player-stats-grid").innerHTML = `
        <div class="bento-card">
          <span class="card-label">Career Matches</span>
          <div class="card-value">${p.matchesPlayed || 0}</div>
          <span class="card-subtext">Wins: ${p.matchesWon || 0} (${winPct}%)</span>
        </div>
        <div class="bento-card">
          <span class="card-label">Runs</span>
          <div class="card-value">${p.totalRuns || 0}</div>
          <span class="card-subtext">Highest: ${p.highestScore || 0} | SR: ${p.strikeRate || 0}</span>
        </div>
        <div class="bento-card">
          <span class="card-label">Wickets</span>
          <div class="card-value">${p.totalWickets || 0}</div>
          <span class="card-subtext">Best: ${p.bestBowling || '-'} | Econ: ${p.economy || 0}</span>
        </div>
        <div class="bento-card">
          <span class="card-label">Fours / Sixes</span>
          <div class="card-value">${p.totalFours || 0} / ${p.totalSixes || 0}</div>
          <span class="card-subtext">Boundaries logged</span>
        </div>
      `;

      // Matches History table
      const matches = await getAllDocs("matches");
      const playerMatches = matches.filter(m => {
        if (m.status !== "completed") return false;
        
        let playedInMatch = false;
        m.innings.forEach(inn => {
          if (inn.batting && inn.batting[p.id]) playedInMatch = true;
          if (inn.bowling && inn.bowling[p.id]) playedInMatch = true;
        });
        return playedInMatch;
      });

      const pdMatchesBody = document.getElementById("pd-matches-body");
      if (playerMatches.length === 0) {
        pdMatchesBody.innerHTML = `<tr><td colspan="7" class="empty-state">No match history found.</td></tr>`;
      } else {
        pdMatchesBody.innerHTML = playerMatches.map(m => {
          let runs = 0, balls = 0, wickets = 0, runsConceded = 0;
          let mvp = [];
          
          m.innings.forEach(inn => {
            if (inn.batting && inn.batting[p.id]) {
              runs += inn.batting[p.id].runs || 0;
              balls += inn.batting[p.id].balls || 0;
            }
            if (inn.bowling && inn.bowling[p.id]) {
              wickets += inn.bowling[p.id].wickets || 0;
              runsConceded += inn.bowling[p.id].runsConceded || 0;
            }
          });

          if (m.mvpBatsmanId === p.id) mvp.push("🎖️ MVP Bat");
          if (m.mvpBowlerId === p.id) mvp.push("🎖️ MVP Bowl");

          return `
            <tr>
              <td><a href="#/match/${m.id}"><strong>${m.id.substring(0, 6)}</strong></a></td>
              <td>${runs}</td>
              <td>${balls}</td>
              <td>${wickets}</td>
              <td>${runsConceded}</td>
              <td>${mvp.join(", ") || "-"}</td>
              <td><span class="status-tag completed">${m.result}</span></td>
            </tr>
          `;
        }).join("");
      }

      // Teams Created
      const teams = await getAllDocs("teams");
      const createdTeams = teams.filter(t => t.createdByAdminId === p.userId || t.createdByAdminId === p.id);
      
      const pdTeamsList = document.getElementById("pd-teams-created-list");
      if (createdTeams.length === 0) {
        pdTeamsList.innerHTML = `<li class="empty-state">Has not created any teams.</li>`;
      } else {
        pdTeamsList.innerHTML = createdTeams.map(t => `
          <li><a href="#/team/${t.id}"><strong>${t.name}</strong></a> (Squad: ${t.playerIds.length} players)</li>
        `).join("");
      }
    });
    activeUnsubs.push(unsub);
  }

  // --- VIEW 8: ADMIN MANAGEMENT PANEL (Super Admin only) ---
  showAdmins() {
    this.showSection("view-admins", "Admin Management", "Manage credentials, role promotions, and requests.");

    // Subtabs toggling inside admin panel
    const tabBtns = document.querySelectorAll("#view-admins .sub-tab-btn");
    tabBtns.forEach(btn => {
      btn.replaceWith(btn.cloneNode(true));
    });
    
    const newBtns = document.querySelectorAll("#view-admins .sub-tab-btn");
    newBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        newBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        
        document.querySelectorAll(".admin-tab-content").forEach(c => c.style.display = "none");
        const target = document.getElementById(`ad-tab-${btn.getAttribute("data-admin-tab")}`);
        if (target) target.style.display = "block";
      });
    });

    // Load Admin lists
    const unsubUsers = listenToCollection("users", async (users) => {
      const admins = users.filter(u => u.role === "admin");
      
      const tbody = document.getElementById("admin-list-body");
      if (admins.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No promoted admins.</td></tr>`;
      } else {
        tbody.innerHTML = admins.map(ad => `
          <tr>
            <td><a href="#/admin/${ad.id}"><strong>${ad.name}</strong></a></td>
            <td>${ad.email}</td>
            <td>${ad.mobile || 'N/A'}</td>
            <td>
              <button class="ghost-btn" style="color:var(--danger)" onclick="window.ui.demoteAdmin('${ad.id}')">Demote</button>
            </td>
          </tr>
        `).join("");
      }

      // Promote selectors
      const players = await getAllDocs("players");
      const nonAdminPlayers = players.filter(p => {
        if (p.isGuest) return false;
        const u = users.find(usr => usr.authUid === p.userId);
        return u && u.role === "player";
      });

      const select = document.getElementById("admin-select-player");
      select.innerHTML = `<option value="">Select Player...</option>` + nonAdminPlayers.map(p => `
        <option value="${p.id}">${p.name} (${p.email})</option>
      `).join("");
    });
    activeUnsubs.push(unsubUsers);

    // Promote Submit
    document.getElementById("add-admin-form").onsubmit = async (e) => {
      e.preventDefault();
      const pid = document.getElementById("admin-select-player").value;
      if (!pid) return;

      this.showLoader();
      try {
        const player = await getDocById("players", pid);
        if (player && player.userId) {
          const user = await getDocById("users", player.userId);
          if (user) {
            user.role = "admin";
            await saveDoc("users", user);
            await sendNotification(player.userId, "You have been promoted to Admin by the Super Admin! Please sign in again or refresh to see your tools.", "admin_request_approved", "#/profile");
            this.toast(`Promoted ${player.name} to Admin!`, "success");
          }
        }
      } catch (err) {
        this.toast(err.message, "danger");
      } finally {
        this.hideLoader();
      }
    };

    // Load requests
    const unsubRequests = listenToCollection("adminRequests", async (requests) => {
      const pending = requests.filter(r => r.status === "pending");
      
      const reqTbody = document.getElementById("admin-requests-body");
      if (pending.length === 0) {
        reqTbody.innerHTML = `<tr><td colspan="4" class="empty-state">No pending requests.</td></tr>`;
      } else {
        const items = [];
        for (const req of pending) {
          const pProfile = await getDocById("players", req.playerId);
          if (pProfile) {
            items.push(`
              <tr>
                <td><strong>${pProfile.name}</strong></td>
                <td>${pProfile.email}</td>
                <td>${pProfile.mobile}</td>
                <td>
                  <button class="primary-btn btn-small" onclick="window.ui.approveReq('${req.id}')">Approve</button>
                  <button class="secondary-btn btn-small" onclick="window.ui.rejectReq('${req.id}')">Reject</button>
                </td>
              </tr>
            `);
          }
        }
        reqTbody.innerHTML = items.join("");
      }
    });
    activeUnsubs.push(unsubRequests);
  }

  async demoteAdmin(userId) {
    this.showLoader();
    try {
      const u = await getDocById("users", userId);
      if (u) {
        if (u.role === "superadmin") {
          throw new Error("Cannot demote a Super Admin.");
        }
        u.role = "player";
        await saveDoc("users", u);
        this.toast("Admin demoted to Player.", "info");
      }
    } catch (err) {
      this.toast(err.message, "danger");
    } finally {
      this.hideLoader();
    }
  }

  async approveReq(id) {
    this.showLoader();
    try {
      await approveAdminRequest(id);
      this.toast("Request approved successfully.", "success");
    } catch (err) {
      this.toast(err.message, "danger");
    } finally {
      this.hideLoader();
    }
  }

  async rejectReq(id) {
    this.showLoader();
    try {
      await rejectAdminRequest(id);
      this.toast("Request rejected.", "info");
    } catch (err) {
      this.toast(err.message, "danger");
    } finally {
      this.hideLoader();
    }
  }

  // --- VIEW 9: ADMIN DETAIL ---
  showAdminDetail(id) {
    this.showSection("view-admin-detail", "Admin Detail", "Conducted Tournaments and Matches history.");
    
    document.getElementById("ad-detail-back-btn").onclick = () => window.location.hash = "#/admins";

    const unsub = listenToDoc("users", id, async (u) => {
      if (!u) {
        document.getElementById("ad-detail-name").textContent = "Admin Not Found";
        return;
      }

      document.getElementById("ad-detail-name").textContent = u.name;
      document.getElementById("ad-detail-email").textContent = u.email;

      // Tournaments created
      const tournaments = await getAllDocs("tournaments");
      const adminTournaments = tournaments.filter(t => t.createdByAdminId === u.authUid);
      
      const tournamentsDiv = document.getElementById("ad-detail-tournaments");
      if (adminTournaments.length === 0) {
        tournamentsDiv.innerHTML = `<div class="empty-state">No tournaments created.</div>`;
      } else {
        tournamentsDiv.innerHTML = adminTournaments.map(t => `
          <div class="tournament-card" onclick="window.location.hash='#/tournament/${t.id}'">
            <strong>${t.tournamentName}</strong>
            <span>📍 ${t.location}</span>
          </div>
        `).join("");
      }

      // Matches Conducted
      const matches = await getAllDocs("matches");
      const adminMatches = matches.filter(m => m.umpireId === u.authUid);
      
      const matchesDiv = document.getElementById("ad-detail-matches");
      if (adminMatches.length === 0) {
        matchesDiv.innerHTML = `<div class="empty-state">No matches conducted.</div>`;
      } else {
        matchesDiv.innerHTML = adminMatches.map(m => `
          <div class="match-card" onclick="window.location.hash='#/match/${m.id}'">
            <strong>Match ID: ${m.id.substring(0, 6)}</strong>
            <span>Result: ${m.result || 'Ongoing'}</span>
          </div>
        `).join("");
      }
    });
    activeUnsubs.push(unsub);
  }

  // --- VIEW 10: MATCHES LIST ---
  showMatches() {
    this.showSection("view-live-match-list", "Live Match Center", "Watch and track local cricket scorecards.");

    // Subtabs inside matches list
    const tabBtns = document.querySelectorAll("#view-live-match-list .sub-tab-btn");
    tabBtns.forEach(btn => {
      btn.replaceWith(btn.cloneNode(true));
    });
    
    const newBtns = document.querySelectorAll("#view-live-match-list .sub-tab-btn");
    newBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        newBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        
        const tab = btn.getAttribute("data-match-list-tab");
        if (tab === "live") {
          document.getElementById("match-list-live-panel").style.display = "block";
          document.getElementById("match-list-completed-panel").style.display = "none";
        } else {
          document.getElementById("match-list-live-panel").style.display = "none";
          document.getElementById("match-list-completed-panel").style.display = "block";
        }
      });
    });

    const unsub = listenToCollection("matches", async (matches) => {
      const teams = await getAllDocs("teams");
      const teamMap = {};
      teams.forEach(t => { teamMap[t.id] = t.name; });

      const live = matches.filter(m => m.status === "live" || m.status === "setup");
      const completed = matches.filter(m => m.status === "completed");

      const liveGrid = document.getElementById("live-matches-grid-container");
      const completedGrid = document.getElementById("completed-matches-grid-container");

      if (live.length === 0) {
        liveGrid.innerHTML = `<div class="empty-state">No live matches currently.</div>`;
      } else {
        liveGrid.innerHTML = live.map(m => {
          const tNameA = teamMap[m.teamAId] || m.teamAId.substring(5, 10).toUpperCase();
          const tNameB = teamMap[m.teamBId] || m.teamBId.substring(5, 10).toUpperCase();
          return `
            <div class="match-card" onclick="window.location.hash='#/match/${m.id}'">
              <div class="card-header-row">
                <span class="status-tag ${m.status === 'live' ? 'live' : 'setup'}">${m.status.toUpperCase()}</span>
                <span>Overs limit: ${m.settings?.totalOvers || 6}</span>
              </div>
              <strong>${tNameA} VS ${tNameB}</strong>
              <span>Umpired by: User ID ${m.umpireId ? m.umpireId.substring(0, 6) : "N/A"}</span>
            </div>
          `;
        }).join("");
      }

      if (completed.length === 0) {
        completedGrid.innerHTML = `<div class="empty-state">No completed matches.</div>`;
      } else {
        completedGrid.innerHTML = completed.map(m => {
          const tNameA = teamMap[m.teamAId] || m.teamAId.substring(5, 10).toUpperCase();
          const tNameB = teamMap[m.teamBId] || m.teamBId.substring(5, 10).toUpperCase();
          const winnerName = m.winnerTeamId ? (teamMap[m.winnerTeamId] || m.winnerTeamId.substring(5, 10).toUpperCase()) : 'Tie';
          return `
            <div class="match-card" onclick="window.location.hash='#/match/${m.id}'">
              <div class="card-header-row">
                <span class="status-tag completed">COMPLETED</span>
                <strong>Winner: ${winnerName}</strong>
              </div>
              <strong>${tNameA} VS ${tNameB}</strong>
              <p>${m.result}</p>
            </div>
          `;
        }).join("");
      }
    });
    activeUnsubs.push(unsub);
  }

  async triggerCreateMatchFlow(tid = "") {
    const role = getActiveRole();
    const userId = getCurrentUser() ? getCurrentUser().id : null;

    let tSelect = "";
    if (tid === "") {
      const allTournaments = await getAllDocs("tournaments");
      // Admins can only create matches under their OWN tournaments. Superadmin sees all.
      const tournaments = role === "superadmin"
        ? allTournaments.filter(t => t.status === "ongoing")
        : allTournaments.filter(t => t.status === "ongoing" && t.createdByAdminId === userId);

      if (tournaments.length === 0) {
        this.toast("You have no active tournaments. Create a tournament first.", "warning");
        return;
      }

      tSelect = `
        <div class="form-group">
          <label for="m-tournament-select">Select Tournament</label>
          <select id="m-tournament-select" required>
            <option value="">Select Tournament...</option>
            ${tournaments.map(t => `<option value="${t.id}">${t.tournamentName}</option>`).join("")}
          </select>
        </div>
      `;
    }

    const html = `
      <form id="create-match-form" class="standard-form">
        ${tSelect}
        <div class="form-group">
          <label for="m-team-a">Team A (Batting/Bowling Choice)</label>
          <select id="m-team-a" required>
            <option value="">Select Team A...</option>
          </select>
        </div>
        <div class="form-group">
          <label for="m-team-b">Team B</label>
          <select id="m-team-b" required>
            <option value="">Select Team B...</option>
          </select>
        </div>
        
        <div id="common-player-warning" style="display: none; padding: 10px; background: rgba(245, 158, 11, 0.15); border: 1px solid var(--accent); border-radius: 8px; color: var(--accent); margin: 12px 0; font-size: 0.88rem;"></div>

        <div class="form-group">
          <label for="m-overs">Overs Limit</label>
          <input type="number" id="m-overs" min="1" max="20" required value="6">
        </div>
        <div class="form-group">
          <label for="m-toss-winner">Toss Winner</label>
          <select id="m-toss-winner" required>
            <option value="A">Team A</option>
            <option value="B">Team B</option>
          </select>
        </div>
        <div class="form-group">
          <label for="m-toss-choice">Toss Choice</label>
          <select id="m-toss-choice" required>
            <option value="Bat">Bat</option>
            <option value="Bowl">Bowl</option>
          </select>
        </div>

        <h4 style="margin-top: 20px; margin-bottom: 10px; border-bottom: 1px solid var(--border); padding-bottom: 6px;">Match Rules & Settings</h4>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label for="m-bowler-limit">Bowler Over Limit</label>
            <input type="number" id="m-bowler-limit" min="1" max="10" required value="2">
          </div>
          
          <div class="form-group">
            <label for="m-baby-overs">Allow Baby Overs</label>
            <select id="m-baby-overs">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;">
          <div class="form-group">
            <label for="m-extras">Extras Enabled (WD/NB)</label>
            <select id="m-extras">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          
          <div class="form-group">
            <label for="m-byes">Byes/Leg Byes</label>
            <select id="m-byes">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;">
          <div class="form-group">
            <label for="m-single-batting">Single Batting Mode</label>
            <select id="m-single-batting">
              <option value="false">No (Pairs)</option>
              <option value="true">Yes (Individual)</option>
            </select>
          </div>
          
          <div class="form-group">
            <label for="m-lms">Last Man Standing</label>
            <select id="m-lms">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
        </div>

        <div class="form-group" style="margin-top: 8px; margin-bottom: 20px;">
          <label for="m-consecutive-overs">Allow Consecutive Overs</label>
          <select id="m-consecutive-overs">
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </div>

        <button type="submit" class="primary-btn">Create Match</button>
      </form>
    `;

    this.openModal("Create Match", html);

    // Common player detection & dynamic bowler limit listeners
    const checkCommonPlayers = async () => {
      const teamAId = document.getElementById("m-team-a").value;
      const teamBId = document.getElementById("m-team-b").value;
      const totalOvers = Number(document.getElementById("m-overs").value) || 6;
      const warnDiv = document.getElementById("common-player-warning");
      if (warnDiv) warnDiv.style.display = "none";

      if (teamAId) {
        const teamA = await getDocById("teams", teamAId);
        const squadA = teamA ? (teamA.playerIds || []) : [];
        
        // Calculate default bowler limit: ((players in each team)/overs)*2 (rounded up, min 1)
        const bowlerLimitInput = document.getElementById("m-bowler-limit");
        if (bowlerLimitInput) {
          const playersCount = squadA.length || 11;
          const defaultLimit = Math.max(1, Math.ceil((playersCount / totalOvers) * 2));
          bowlerLimitInput.value = defaultLimit;
        }

        if (teamBId) {
          const teamB = await getDocById("teams", teamBId);
          const squadB = teamB ? (teamB.playerIds || []) : [];
          const common = squadA.filter(pid => squadB.includes(pid));
          if (common.length > 0 && warnDiv) {
            const player = await getDocById("players", common[0]);
            warnDiv.innerHTML = `⚠️ Warning: <strong>${player ? player.name : 'A player'}</strong> belongs to both teams. Only 1 common player is allowed!`;
            warnDiv.style.display = "block";
          }
        }
      }
    };

    document.getElementById("m-team-a").addEventListener("change", checkCommonPlayers);
    document.getElementById("m-team-b").addEventListener("change", checkCommonPlayers);
    document.getElementById("m-overs").addEventListener("input", checkCommonPlayers);

    // If tournament ID was preselected, load teams for it immediately
    if (tid !== "") {
      const t = await getDocById("tournaments", tid);
      this.populateMatchTeamsDropdown(t.teamIds);
    } else {
      document.getElementById("m-tournament-select").addEventListener("change", async (e) => {
        const selectedTid = e.target.value;
        if (!selectedTid) return;
        const t = await getDocById("tournaments", selectedTid);
        this.populateMatchTeamsDropdown(t.teamIds);
      });
    }

    document.getElementById("create-match-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const targetTid = tid || document.getElementById("m-tournament-select").value;
      const teamAId = document.getElementById("m-team-a").value;
      const teamBId = document.getElementById("m-team-b").value;
      const totalOvers = Number(document.getElementById("m-overs").value);
      
      const tossWinner = document.getElementById("m-toss-winner").value;
      const tossWinnerId = tossWinner === "A" ? teamAId : teamBId;
      const tossChoice = document.getElementById("m-toss-choice").value;

      if (teamAId === teamBId) {
        this.toast("Teams A and B must be different.", "warning");
        return;
      }

      // Check common players and ask confirmation
      const teamA = await getDocById("teams", teamAId);
      const teamB = await getDocById("teams", teamBId);
      const squadA = teamA ? (teamA.playerIds || []) : [];
      const squadB = teamB ? (teamB.playerIds || []) : [];
      const common = squadA.filter(pid => squadB.includes(pid));
      if (common.length > 0) {
        const player = await getDocById("players", common[0]);
        const proceed = window.confirm(`A common player (${player ? player.name : 'Player'}) exists in both teams. Do you want to proceed?`);
        if (!proceed) return;
      }

      // Ownership guard: Verify admin owns this tournament
      if (getActiveRole() === "admin") {
        const tournament = await getDocById("tournaments", targetTid);
        if (!tournament || tournament.createdByAdminId !== getCurrentUser().id) {
          this.toast("Access denied: You can only create matches under your own tournaments.", "danger");
          return;
        }
      }

      this.showLoader();
      try {
        const settings = {
          totalOvers,
          bowlerOverLimit: Number(document.getElementById("m-bowler-limit").value),
          allowBabyOvers: document.getElementById("m-baby-overs").value === "true",
          extrasEnabled: document.getElementById("m-extras").value === "true",
          byesEnabled: document.getElementById("m-byes").value === "true",
          singleBattingMode: document.getElementById("m-single-batting").value === "true",
          lastManStanding: document.getElementById("m-lms").value === "true",
          allowConsecutiveOvers: document.getElementById("m-consecutive-overs").value === "true",
        };

        const matchDoc = makeMatch({
          tournamentId: targetTid,
          teamAId,
          teamBId,
          settings,
          umpireId: getCurrentUser().id
        });

        matchDoc.tossWinnerId = tossWinnerId;
        matchDoc.tossChoice = tossChoice;

        await saveDoc("matches", matchDoc);
        this.toast("Match created successfully!", "success");
        this.closeModal();

        // Redirect directly to the match scoring interface
        window.location.hash = `#/match/${matchDoc.id}`;
      } catch (err) {
        this.toast(err.message, "danger");
      } finally {
        this.hideLoader();
      }
    });
  }


  async populateMatchTeamsDropdown(teamIds) {
    const teamA = document.getElementById("m-team-a");
    const teamB = document.getElementById("m-team-b");
    
    if (!teamIds || teamIds.length === 0) {
      teamA.innerHTML = `<option value="">No teams in this tournament</option>`;
      teamB.innerHTML = `<option value="">No teams in this tournament</option>`;
      return;
    }

    const options = [];
    for (const id of teamIds) {
      const team = await getDocById("teams", id);
      if (team) {
        options.push(`<option value="${team.id}">${team.name}</option>`);
      }
    }
    
    teamA.innerHTML = `<option value="">Select Team A...</option>` + options.join("");
    teamB.innerHTML = `<option value="">Select Team B...</option>` + options.join("");
  }

  // --- VIEW 11: SCORING / MATCH BOARD ---
  showMatchDetail(id) {
    this.showSection("view-live-match", "Live Match Center", "Track cricket statistics ball-by-ball.");

    // Remove old listeners from sub-tab buttons inside scoring view
    const tabBtns = document.querySelectorAll("#view-live-match .sub-tab-btn");
    tabBtns.forEach(btn => {
      btn.replaceWith(btn.cloneNode(true));
    });
    
    const newBtns = document.querySelectorAll("#view-live-match .sub-tab-btn");
    newBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        newBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        
        document.querySelectorAll(".scoring-tab-content").forEach(c => c.style.display = "none");
        const target = document.getElementById(`match-tab-${btn.getAttribute("data-scoring-tab")}`);
        if (target) target.style.display = "block";
      });
    });

    // Clean old listeners
    if (currentLiveMatchUnsub) {
      currentLiveMatchUnsub();
      currentLiveMatchUnsub = null;
    }
    clearInterval(undoTimerInterval);

    // Setup realtime listener for this match
    currentLiveMatchUnsub = listenToDoc("matches", id, async (match) => {
      if (!match) {
        document.getElementById("score-status-text").textContent = "Match Not Found";
        return;
      }

      // Load teams and players needed by engine
      const teamA = await getDocById("teams", match.teamAId);
      const teamB = await getDocById("teams", match.teamBId);
      
      const allPlayers = await getAllDocs("players");

      const tLink = document.getElementById("msh-tournament-link");
      if (match.tournamentId) {
        const tournament = await getDocById("tournaments", match.tournamentId);
        tLink.textContent = tournament ? `🏆 ${tournament.tournamentName}` : "🏆 Back to Tournament";
        tLink.href = `#/tournament/${match.tournamentId}`;
      } else {
        tLink.textContent = "Back to Matches List";
        tLink.href = "#/matches";
      }

      // Initialize engine
      const engine = new MatchEngine(match, [teamA, teamB], allPlayers);
      currentLiveMatchEngine = engine;

      // Update basic headers
      const currentInn = engine.currentInnings();
      const battingTeam = engine.team(currentInn.battingTeamId);
      const bowlingTeam = engine.team(currentInn.bowlingTeamId);

      document.getElementById("score-batting-team-name").textContent = battingTeam ? battingTeam.name : "Batting Team";
      document.getElementById("score-bowling-team-name").textContent = bowlingTeam ? bowlingTeam.name : "Bowling Team";

      const summary = engine.scoreSummary(currentInn);
      document.getElementById("score-runs-wickets").textContent = summary.score;
      document.getElementById("score-overs").textContent = `Overs: ${summary.overs}`;
      
      // Target display
      if (currentInn.target) {
        document.getElementById("score-innings-info").textContent = `Innings 2 | Target: ${currentInn.target} (Need ${summary.need} in ${engine.inningsBallsRemaining()} balls)`;
      } else {
        document.getElementById("score-innings-info").textContent = `Innings 1 | Batting`;
      }

      if (currentInn && currentInn.isPaused) {
        document.getElementById("score-status-text").textContent = "🚨 Match Paused";
        document.getElementById("score-status-text").style.color = "var(--danger)";
      } else {
        document.getElementById("score-status-text").textContent = match.status === "completed" ? `Match Ended: ${match.result}` : `Scorer Note: ${engine.notice || 'Scoring in progress'}`;
        document.getElementById("score-status-text").style.color = "";
      }

      // Calculate boundaries in this match so far
      let matchFours = 0;
      let matchSixes = 0;
      match.innings.forEach(inn => {
        (inn.balls || []).forEach(b => {
          if (b.event === "4" || b.event.endsWith("+4")) matchFours++;
          if (b.event === "6" || b.event.endsWith("+6")) matchSixes++;
        });
      });
      const foursEl = document.getElementById("match-fours-count");
      const sixesEl = document.getElementById("match-sixes-count");
      if (foursEl) foursEl.textContent = matchFours;
      if (sixesEl) sixesEl.textContent = matchSixes;

      // Scorer Control vs Viewer Mode
      const isUmpire = match.umpireId === getCurrentUser().id || getActiveRole() === "superadmin";
      const controls = document.getElementById("scorer-controls");
      const viewerMsg = document.getElementById("viewer-message");

      if (isUmpire && match.status !== "completed") {
        controls.style.display = "block";
        viewerMsg.style.display = "none";
        this.renderScorerControls(engine);
      } else {
        controls.style.display = "none";
        viewerMsg.style.display = "block";
        if (match.status === "completed") {
          viewerMsg.innerHTML = `<div class="text-center" style="padding:20px;"><h3>Match Completed</h3><p>Result: <strong>${match.result}</strong></p></div>`;
        }
      }

      // Full Scorecard rendering
      this.renderFullScorecard(engine);

      // Match Stats rendering
      this.renderMatchStats(engine);

      // Openers Sequence Popup checking
      if (isUmpire && match.status === "setup") {
        this.promptOpenersSelection(engine);
      } else if (isUmpire && match.status === "live") {
        // Start of innings openers check (both striker and non-striker are null at start)
        const isStartOfInnings = !currentInn.strikerId && !currentInn.nonStrikerId;
        const needsOpeners = isStartOfInnings || (match.settings.singleBattingMode && !currentInn.strikerId && currentInn.legalBallsTotal === 0);

        if (match.inningsIndex === 1 && match.innings[0].active === false && match.innings[1].balls.length === 0 && !currentInn.strikerId) {
          this.promptInningsTransition(engine);
        } else if (needsOpeners) {
          this.promptOpenersSelection(engine);
        } else if (!currentInn.strikerId) {
          // Mid-innings wicket fall - select next batsman
          const battingCount = engine.teamPlayers(currentInn.battingTeamId).length;
          const allOut = match.settings.singleBattingMode || match.settings.lastManStanding
            ? !currentInn.strikerId && !Object.values(currentInn.batting).some((rec) => rec.status === "yet to bat")
            : currentInn.wickets >= Math.max(0, battingCount - 1);
          
          if (!allOut && currentInn.legalBallsTotal < engine.inningsBallsLimit()) {
            this.promptBatsmanSelection(engine);
          }
        } else if (!currentInn.currentBowlerId) {
          this.promptBowlerSelection(engine);
        }
      }
    });
    activeUnsubs.push(currentLiveMatchUnsub);
  }

  async togglePauseMatch(engine) {
    const currentInn = engine.currentInnings();
    if (!currentInn.startTime) {
      this.toast("Innings has not started yet. Record at least one ball to start the match timer, then pause if needed.", "warning");
      return;
    }
    
    if (currentInn.isPaused) {
      // Resume
      currentInn.isPaused = false;
      if (currentInn.lastPauseTime) {
        currentInn.pausedDuration = (currentInn.pausedDuration || 0) + (Date.now() - currentInn.lastPauseTime);
      }
      currentInn.lastPauseTime = null;
      this.toast("Match Resumed", "success");
    } else {
      // Pause
      currentInn.isPaused = true;
      currentInn.lastPauseTime = Date.now();
      this.toast("Match Paused", "info");
    }
    
    this.showLoader();
    try {
      await saveDoc("matches", engine.match);
      this.renderScorerControls(engine);
      this.renderMatchStats(engine);
    } catch (err) {
      this.toast(err.message, "danger");
    } finally {
      this.hideLoader();
    }
  }

  renderScorerControls(engine) {
    const currentInn = engine.currentInnings();
    const isPaused = currentInn.isPaused || false;

    // Pause button wiring
    const pauseBtn = document.getElementById("pause-match-btn");
    if (pauseBtn) {
      if (isPaused) {
        pauseBtn.textContent = "Resume Match";
        pauseBtn.style.background = "var(--success)";
      } else {
        pauseBtn.textContent = "Pause Match";
        pauseBtn.style.background = "var(--danger)";
      }
      pauseBtn.onclick = () => this.togglePauseMatch(engine);
    }
    
    // Striker Info
    const striker = engine.player(currentInn.strikerId);
    const strikerRec = currentInn.batting[currentInn.strikerId];
    document.getElementById("striker-name").textContent = striker ? striker.name : "-";
    document.getElementById("striker-stats").textContent = strikerRec ? `${strikerRec.runs} (${strikerRec.balls})` : "0 (0)";

    // Non-striker Info
    const nonStriker = engine.player(currentInn.nonStrikerId);
    const nonStrikerRec = currentInn.batting[currentInn.nonStrikerId];
    const nsRow = document.getElementById("nonstriker-row");
    if (engine.match.settings.singleBattingMode) {
      nsRow.style.display = "none";
    } else {
      nsRow.style.display = "flex";
      document.getElementById("nonstriker-name").textContent = nonStriker ? nonStriker.name : "-";
      document.getElementById("nonstriker-stats").textContent = nonStrikerRec ? `${nonStrikerRec.runs} (${nonStrikerRec.balls})` : "0 (0)";
    }

    // Bowler Info
    const bowler = engine.player(currentInn.currentBowlerId);
    const bowlerRec = currentInn.bowling[currentInn.currentBowlerId];
    document.getElementById("bowler-name").textContent = bowler ? bowler.name : "-";
    if (bowlerRec) {
      const bowlerEcon = bowlerRec.legalBalls > 0 ? ((bowlerRec.runsConceded / bowlerRec.legalBalls) * 6).toFixed(2) : "0.00";
      const bowlerOvers = `${Math.floor(bowlerRec.legalBalls / 6)}.${bowlerRec.legalBalls % 6}`;
      document.getElementById("bowler-stats").textContent = `${bowlerRec.wickets}-${bowlerRec.runsConceded} (${bowlerOvers}) Econ: ${bowlerEcon}`;
    } else {
      document.getElementById("bowler-stats").textContent = "0-0 (0.0)";
    }

    // Over ball tracker
    const dotsDiv = document.getElementById("over-ball-dots");
    if (currentInn.currentOver && currentInn.currentOver.totalBalls > 0) {
      // Find balls logged in this over
      const currentOverNum = currentInn.currentOver.inningsOverNumber;
      const overBalls = currentInn.balls.filter(b => {
        return b.innings === currentInn.inningsNumber;
      }).slice(-currentInn.currentOver.totalBalls);

      dotsDiv.innerHTML = overBalls.map(b => {
        let cls = "ball-dot";
        if (b.event === "4" || b.event === "6") cls += " run-boundary";
        else if (b.event === "W" || b.event.startsWith("RO")) cls += " wicket";
        else if (b.event.startsWith("WD") || b.event.startsWith("NB")) cls += " extra";
        return `<div class="${cls}">${b.event}</div>`;
      }).join("");
    } else {
      dotsDiv.innerHTML = `<span>No balls bowled in this over.</span>`;
    }

    // Wire Scorer Action Buttons
    const matrixGrid = document.querySelector(".matrix-grid");
    matrixGrid.replaceWith(matrixGrid.cloneNode(true)); // reset listeners
    
    document.querySelectorAll(".matrix-btn").forEach(btn => {
      const event = btn.getAttribute("data-event");
      if (!event) return; // Ignore Rotate, Undo, and Declare Tie

      if (isPaused) {
        btn.setAttribute("disabled", "true");
        btn.style.opacity = "0.5";
        btn.style.pointerEvents = "none";
      } else {
        btn.removeAttribute("disabled");
        btn.style.opacity = "";
        btn.style.pointerEvents = "";
        
        btn.addEventListener("click", async (e) => {
          if (event === "W") {
            this.promptWicketModal(engine);
            return;
          }

          try {
            // Optimistic local update for instant UI feedback
            engine.applyEvent(event);
            this.renderScorerControls(engine);
            this.renderFullScorecard(engine);
            this.renderMatchStats(engine);

            // Save in the background
            saveDoc("matches", engine.match).then(async () => {
              if (engine.match.status === "completed") {
                this.showLoader();
                await recalculateStats();
                this.hideLoader();
                this.toast("Match completed!", "success");
              }
            }).catch(err => {
              this.toast("Sync failed: " + err.message, "danger");
            });
          } catch (err) {
            this.toast(err.message, "danger");
          }
        });
      }
    });

    // Manual rotates (Optimistic)
    const rotateBtn = document.getElementById("rotate-strike-btn");
    if (isPaused) {
      rotateBtn.setAttribute("disabled", "true");
      rotateBtn.style.opacity = "0.5";
      rotateBtn.style.pointerEvents = "none";
    } else {
      rotateBtn.removeAttribute("disabled");
      rotateBtn.style.opacity = "";
      rotateBtn.style.pointerEvents = "";
      rotateBtn.onclick = () => {
        try {
          engine.rotateStrike(true);
          this.renderScorerControls(engine);
          saveDoc("matches", engine.match).catch(err => {
            this.toast("Sync failed: " + err.message, "danger");
          });
        } catch (err) {
          this.toast(err.message, "danger");
        }
      };
    }

    // Declare Tie Button wiring
    const declareTieBtn = document.getElementById("declare-tie-btn");
    if (declareTieBtn) {
      if (isPaused) {
        declareTieBtn.setAttribute("disabled", "true");
        declareTieBtn.style.opacity = "0.5";
        declareTieBtn.style.pointerEvents = "none";
      } else {
        declareTieBtn.removeAttribute("disabled");
        declareTieBtn.style.opacity = "";
        declareTieBtn.style.pointerEvents = "";
        declareTieBtn.onclick = async () => {
          const confirm = window.confirm("Are you sure you want to end this match as a Tie? This will complete the match and recalculate player stats.");
          if (!confirm) return;

          this.showLoader();
          try {
            engine.declareTie();
            this.renderScorerControls(engine);
            this.renderFullScorecard(engine);
            this.renderMatchStats(engine);

            await saveDoc("matches", engine.match);
            await recalculateStats();
            this.toast("Match declared as a Tie!", "success");
          } catch (err) {
            this.toast(err.message, "danger");
          } finally {
            this.hideLoader();
          }
        };
      }
    }

    // Change Batsman/Bowler
    const changeBatBtn = document.getElementById("change-batsmen-btn");
    const changeBowlBtn = document.getElementById("change-bowler-btn");
    if (isPaused) {
      changeBatBtn.setAttribute("disabled", "true");
      changeBowlBtn.setAttribute("disabled", "true");
    } else {
      changeBatBtn.removeAttribute("disabled");
      changeBowlBtn.removeAttribute("disabled");
      changeBatBtn.onclick = () => this.promptBatsmanSelection(engine, true);
      changeBowlBtn.onclick = () => this.promptBowlerSelection(engine, true);
    }

    // 60-Second Undo Timer Setup
    const undoBtn = document.getElementById("undo-ball-btn");
    clearInterval(undoTimerInterval);

    if (isPaused) {
      undoBtn.setAttribute("disabled", "true");
      undoBtn.style.opacity = "0.5";
      undoBtn.style.pointerEvents = "none";
    } else {
      undoBtn.style.opacity = "";
      undoBtn.style.pointerEvents = "";

      if (currentInn.balls && currentInn.balls.length > 0) {
        const lastBall = currentInn.balls[currentInn.balls.length - 1];
        const timeElapsed = (Date.now() - new Date(lastBall.timestamp).getTime()) / 1000;
        
        if (timeElapsed < 60) {
          undoBtn.removeAttribute("disabled");
          const updateTimer = () => {
            const rem = Math.ceil(60 - ((Date.now() - new Date(lastBall.timestamp).getTime()) / 1000));
            if (rem <= 0) {
              undoBtn.setAttribute("disabled", "true");
              undoBtn.textContent = "Undo (60s)";
              clearInterval(undoTimerInterval);
            } else {
              undoBtn.textContent = `Undo (${rem}s)`;
            }
          };
          updateTimer();
          undoTimerInterval = setInterval(updateTimer, 1000);
        } else {
          undoBtn.setAttribute("disabled", "true");
          undoBtn.textContent = "Undo (60s)";
        }
      } else {
        undoBtn.setAttribute("disabled", "true");
      }

      undoBtn.onclick = () => {
        try {
          engine.undo();
          this.renderScorerControls(engine);
          this.renderFullScorecard(engine);
          this.renderMatchStats(engine);
          saveDoc("matches", engine.match).catch(err => {
            this.toast("Sync failed: " + err.message, "danger");
          });
          this.toast("Last ball undone.", "info");
        } catch (err) {
          this.toast(err.message, "danger");
        }
      };
    }
  }

  renderFullScorecard(engine) {
    const wrapper = document.querySelector("#match-tab-scorecard .scorecard-wrapper");
    if (!wrapper) return;

    if (!engine.match.innings || engine.match.innings.length === 0) {
      wrapper.innerHTML = `<div class="empty-state">No innings started yet.</div>`;
      return;
    }

    const formatOvers = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;
    
    const hasInn2 = engine.match.innings.length > 1;
    this.currentScorecardTab = this.currentScorecardTab || 1;
    if (this.currentScorecardTab === 2 && !hasInn2) {
      this.currentScorecardTab = 1;
    }

    const renderSingleInningsHtml = (inn, idx) => {
      const battingTeam = engine.team(inn.battingTeamId);
      const bowlingTeam = engine.team(inn.bowlingTeamId);
      const battingTeamName = battingTeam ? battingTeam.name : `Team A`;
      const bowlingTeamName = bowlingTeam ? bowlingTeam.name : `Team B`;

      const batRecords = Object.values(inn.batting);
      const bowlRecords = Object.values(inn.bowling);

      let battingRows = "";
      if (batRecords.length === 0) {
        battingRows = `<tr><td colspan="7" class="empty-state">No batting records.</td></tr>`;
      } else {
        battingRows = batRecords.map(rec => {
          const player = engine.player(rec.playerId);
          const name = player ? player.name : "Unknown Player";
          
          let outInfo = "yet to bat";
          if (rec.status === "batting") outInfo = "<span class='status-tag live'>Batting</span>";
          else if (rec.status === "not out") outInfo = "not out";
          else if (rec.status === "retired") outInfo = "retired";
          else if (rec.status === "out" && rec.dismissalInfo) {
            const cause = rec.dismissalInfo.cause;
            const bowler = engine.player(rec.dismissalInfo.bowlerId);
            const fielder = engine.player(rec.dismissalInfo.fielderId);
            
            if (cause === "Bowled") outInfo = `b ${bowler ? bowler.name : 'Bowler'}`;
            else if (cause === "Caught") outInfo = `c ${fielder ? fielder.name : 'Fielder'} b ${bowler ? bowler.name : 'Bowler'}`;
            else if (cause === "LBW") outInfo = `lbw b ${bowler ? bowler.name : 'Bowler'}`;
            else if (cause.startsWith("Run Out")) outInfo = `run out (${fielder ? fielder.name : 'Fielder'})`;
            else if (cause === "Stumped") outInfo = `st ${fielder ? fielder.name : 'Fielder'} b ${bowler ? bowler.name : 'Bowler'}`;
            else outInfo = cause;
          }

          const sr = rec.balls > 0 ? ((rec.runs / rec.balls) * 100).toFixed(1) : "0.0";
          return `
            <tr>
              <td><a href="#/player/${rec.playerId}"><strong>${name}</strong></a></td>
              <td>${outInfo}</td>
              <td><strong>${rec.runs}</strong></td>
              <td>${rec.balls}</td>
              <td>${rec.fours}</td>
              <td>${rec.sixes}</td>
              <td>${sr}</td>
            </tr>
          `;
        }).join("");
      }

      let bowlingRows = "";
      if (bowlRecords.length === 0) {
        bowlingRows = `<tr><td colspan="6" class="empty-state">No bowling records.</td></tr>`;
      } else {
        bowlingRows = bowlRecords.map(rec => {
          const player = engine.player(rec.playerId);
          const name = player ? player.name : "Unknown Player";
          const overs = `${Math.floor(rec.legalBalls / 6)}.${rec.legalBalls % 6}`;
          const econ = rec.legalBalls > 0 ? ((rec.runsConceded / rec.legalBalls) * 6).toFixed(2) : "0.00";
          return `
            <tr>
              <td><a href="#/player/${rec.playerId}"><strong>${name}</strong></a></td>
              <td>${overs}</td>
              <td>${rec.maidens || 0}</td>
              <td>${rec.runsConceded}</td>
              <td><strong>${rec.wickets}</strong></td>
              <td>${econ}</td>
            </tr>
          `;
        }).join("");
      }

      return `
        <div class="scorecard-innings-section" style="margin-bottom: 30px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--border); padding-bottom: 12px; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;">
            <h2 style="margin: 0; font-size: 1.35rem; color: var(--accent);">${battingTeamName} Innings</h2>
            <div style="font-weight: 700; font-size: 1.15rem; background: var(--panel-2); padding: 4px 12px; border-radius: 8px;">
              ${inn.totalRuns}/${inn.wickets} <span style="font-size: 0.9rem; font-weight: normal; color: var(--muted);">(${formatOvers(inn.legalBallsTotal)} Ov)</span>
            </div>
          </div>
          
          <div class="scorecard-section">
            <h3 style="margin-top: 0; margin-bottom: 10px; font-size: 1.05rem;">Batting</h3>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Batsman</th>
                    <th>Dismissal</th>
                    <th>Runs</th>
                    <th>Balls</th>
                    <th>4s</th>
                    <th>6s</th>
                    <th>SR</th>
                  </tr>
                </thead>
                <tbody>
                  ${battingRows}
                </tbody>
              </table>
            </div>
            <div style="margin-top: 10px; text-align: right; font-size: 0.9rem; color: var(--muted); font-weight: 500;">
              Extras: <strong>${inn.extras || 0}</strong>
            </div>
          </div>

          <div class="scorecard-section" style="margin-top: 25px;">
            <h3 style="margin-top: 0; margin-bottom: 10px; font-size: 1.05rem;">${bowlingTeamName} Bowling</h3>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Bowler</th>
                    <th>Overs</th>
                    <th>Maidens</th>
                    <th>Runs</th>
                    <th>Wickets</th>
                    <th>Econ</th>
                  </tr>
                </thead>
                <tbody>
                  ${bowlingRows}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    };

    let tabHtml = `
      <div class="sub-tabs" style="margin-bottom: 20px; display: flex; gap: 8px;">
        <button class="sub-tab-btn ${this.currentScorecardTab === 1 ? 'active' : ''}" id="sc-btn-inn1" style="flex: 1; padding: 10px;">1st Innings</button>
        <button class="sub-tab-btn ${this.currentScorecardTab === 2 ? 'active' : ''}" id="sc-btn-inn2" style="flex: 1; padding: 10px; ${hasInn2 ? '' : 'opacity: 0.5; cursor: not-allowed;'}" ${hasInn2 ? '' : 'disabled'}>2nd Innings</button>
      </div>
      <div class="scorecard-innings-container" id="scorecard-inn1-container" style="display: ${this.currentScorecardTab === 1 ? 'block' : 'none'};">
        ${renderSingleInningsHtml(engine.match.innings[0], 0)}
      </div>
      <div class="scorecard-innings-container" id="scorecard-inn2-container" style="display: ${this.currentScorecardTab === 2 ? 'block' : 'none'};">
        ${hasInn2 ? renderSingleInningsHtml(engine.match.innings[1], 1) : '<div class="empty-state">Second innings has not started yet.</div>'}
      </div>
    `;

    wrapper.innerHTML = tabHtml;

    // Attach subtab click events
    const btn1 = document.getElementById("sc-btn-inn1");
    const btn2 = document.getElementById("sc-btn-inn2");
    const container1 = document.getElementById("scorecard-inn1-container");
    const container2 = document.getElementById("scorecard-inn2-container");

    if (btn1) {
      btn1.onclick = () => {
        this.currentScorecardTab = 1;
        btn1.classList.add("active");
        if (btn2) btn2.classList.remove("active");
        if (container1) container1.style.display = "block";
        if (container2) container2.style.display = "none";
      };
    }

    if (btn2 && hasInn2) {
      btn2.onclick = () => {
        this.currentScorecardTab = 2;
        btn2.classList.add("active");
        if (btn1) btn1.classList.remove("active");
        if (container1) container1.style.display = "none";
        if (container2) container2.style.display = "block";
      };
    }
  }

  renderMatchStats(engine) {
    const panel = document.getElementById("match-stats-panel");
    const m = engine.match;

    // 1. Duration Calculation
    const inn1 = m.innings[0];
    const inn2 = m.innings[1];

    const dur1 = inn1 ? getInningsDuration(inn1) : 0;
    const dur2 = inn2 ? getInningsDuration(inn2) : 0;
    const totalDur = dur1 + dur2;

    const dur1Str = inn1 ? formatDuration(dur1) : "N/A";
    const dur2Str = inn2 ? formatDuration(dur2) : "N/A";
    const totalDurStr = formatDuration(totalDur);

    // 2. Aggregate Player Stats for Match Leaders & MOTM
    const matchPlayerStats = {}; // playerId -> { id, name, runs, balls, fours, sixes, wickets, dotBalls }

    m.innings.forEach(inn => {
      // Batting
      Object.entries(inn.batting || {}).forEach(([pid, rec]) => {
        if (rec.status !== "yet to bat") {
          const player = engine.player(pid);
          matchPlayerStats[pid] ||= { id: pid, name: player ? player.name : `Player ${pid.substring(0,5)}`, runs: 0, balls: 0, fours: 0, sixes: 0, wickets: 0, dotBalls: 0 };
          matchPlayerStats[pid].runs += rec.runs || 0;
          matchPlayerStats[pid].balls += rec.balls || 0;
          matchPlayerStats[pid].fours += rec.fours || 0;
          matchPlayerStats[pid].sixes += rec.sixes || 0;
        }
      });
      // Bowling
      Object.entries(inn.bowling || {}).forEach(([pid, rec]) => {
        const player = engine.player(pid);
        matchPlayerStats[pid] ||= { id: pid, name: player ? player.name : `Player ${pid.substring(0,5)}`, runs: 0, balls: 0, fours: 0, sixes: 0, wickets: 0, dotBalls: 0 };
        matchPlayerStats[pid].wickets += rec.wickets || 0;
        matchPlayerStats[pid].dotBalls += rec.dotBalls || 0;
      });
    });

    // Calculate Leaders
    let runsLeader = { name: "N/A", value: 0 };
    let wicketsLeader = { name: "N/A", value: 0 };
    let foursLeader = { name: "N/A", value: 0 };
    let sixesLeader = { name: "N/A", value: 0 };
    let dotBallsLeader = { name: "N/A", value: 0 };

    Object.values(matchPlayerStats).forEach(p => {
      if (p.runs > runsLeader.value) runsLeader = { name: p.name, value: p.runs };
      if (p.wickets > wicketsLeader.value) wicketsLeader = { name: p.name, value: p.wickets };
      if (p.fours > foursLeader.value) foursLeader = { name: p.name, value: p.fours };
      if (p.sixes > sixesLeader.value) sixesLeader = { name: p.name, value: p.sixes };
      if (p.dotBalls > dotBallsLeader.value) dotBallsLeader = { name: p.name, value: p.dotBalls };
    });

    // Calculate Man of the Match (MOTM) Player
    let motmPlayer = null;
    let maxPoints = -1;
    
    Object.values(matchPlayerStats).forEach(p => {
      const points = p.runs * 1 + p.fours * 1 + p.sixes * 2 + p.wickets * 25 + p.dotBalls * 1;
      if (points > maxPoints && points > 0) {
        maxPoints = points;
        motmPlayer = p;
      }
    });

    // MOTM Table Block
    let motmHtml = "";
    if (motmPlayer) {
      const sr = motmPlayer.balls > 0 ? ((motmPlayer.runs / motmPlayer.balls) * 100).toFixed(1) : "0.0";
      motmHtml = `
        <div class="bento-card" style="grid-column: span 3; background: linear-gradient(135deg, var(--brand), var(--brand-2)); color: white; border: none; box-shadow: var(--shadow);">
          <span class="card-label" style="color: rgba(255,255,255,0.85); font-weight: 600;">🏅 Man of the Match</span>
          <div class="card-value" style="font-size: 1.8rem; margin: 10px 0; font-weight: 800; color: #fff;">${motmPlayer.name}</div>
          <div class="table-container" style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 10px; margin-top: 10px; border: 1px solid rgba(255,255,255,0.1);">
            <table style="width: 100%; border-collapse: collapse; text-align: center; color: white;">
              <thead>
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.2); font-size: 12px; color: rgba(255, 255, 255, 0.8);">
                  <th style="padding: 6px;">Runs</th>
                  <th style="padding: 6px;">Strike Rate</th>
                  <th style="padding: 6px;">Wickets</th>
                  <th style="padding: 6px;">Fours</th>
                  <th style="padding: 6px;">Sixes</th>
                </tr>
              </thead>
              <tbody>
                <tr style="font-weight: bold; font-size: 16px;">
                  <td style="padding: 8px;">${motmPlayer.runs}</td>
                  <td style="padding: 8px;">${sr}</td>
                  <td style="padding: 8px;">${motmPlayer.wickets}</td>
                  <td style="padding: 8px;">${motmPlayer.fours}</td>
                  <td style="padding: 8px;">${motmPlayer.sixes}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else {
      motmHtml = `
        <div class="bento-card" style="grid-column: span 3;">
          <span class="card-label">🏅 Man of the Match</span>
          <div class="card-value" style="font-size: 1.3rem; margin-top: 10px; color: var(--muted);">TBD (No stats recorded)</div>
        </div>
      `;
    }

    const winnerTeam = engine.team(m.winnerTeamId);
    let matchWinnerName = "Ongoing";
    if (m.status === "completed") {
      matchWinnerName = winnerTeam ? winnerTeam.name : "Match Tied";
    }

    panel.innerHTML = `
      <div class="bento-grid">
        <div class="bento-card">
          <span class="card-label">Match Winner</span>
          <div class="card-value">${matchWinnerName}</div>
          <span class="card-icon">🏆</span>
        </div>
        <div class="bento-card">
          <span class="card-label">MVP Batsman</span>
          <div class="card-value">${engine.player(m.mvpBatsmanId)?.name || 'N/A'}</div>
          <span class="card-icon">🏏</span>
        </div>
        <div class="bento-card mvp-bowler-card">
          <span class="card-label">MVP Bowler</span>
          <div class="card-value">${engine.player(m.mvpBowlerId)?.name || 'N/A'}</div>
          <span class="card-icon">⚾</span>
        </div>
        
        <!-- Man of the Match Block -->
        ${motmHtml}
      </div>

      <!-- Time Taken Block -->
      <h3 style="margin-top:25px; margin-bottom:15px; font-size:1.2rem; color:var(--accent);">⏱️ Time Taken</h3>
      <div class="bento-grid-mini">
        <div class="bento-card">
          <span class="card-label">1st Innings Time</span>
          <div class="card-value">${dur1Str}</div>
        </div>
        <div class="bento-card">
          <span class="card-label">2nd Innings Time</span>
          <div class="card-value">${dur2Str}</div>
        </div>
        <div class="bento-card">
          <span class="card-label">Total Time Completed</span>
          <div class="card-value">${totalDurStr}</div>
        </div>
      </div>

      <!-- Match Leaders Block -->
      <h3 style="margin-top:25px; margin-bottom:15px; font-size:1.2rem; color:var(--accent);">⭐ Match Leaders</h3>
      <div class="bento-grid-mini" style="grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));">
        <div class="bento-card">
          <span class="card-label">Most Runs</span>
          <div class="card-value" style="font-size: 1.25rem;">${runsLeader.name}</div>
          <span class="card-subtext">${runsLeader.value} Runs</span>
        </div>
        <div class="bento-card">
          <span class="card-label">Most Wickets</span>
          <div class="card-value" style="font-size: 1.25rem;">${wicketsLeader.name}</div>
          <span class="card-subtext">${wicketsLeader.value} Wickets</span>
        </div>
        <div class="bento-card">
          <span class="card-label">Most 4s</span>
          <div class="card-value" style="font-size: 1.25rem;">${foursLeader.name}</div>
          <span class="card-subtext">${foursLeader.value} Fours</span>
        </div>
        <div class="bento-card">
          <span class="card-label">Most 6s</span>
          <div class="card-value" style="font-size: 1.25rem;">${sixesLeader.name}</div>
          <span class="card-subtext">${sixesLeader.value} Sixes</span>
        </div>
        <div class="bento-card">
          <span class="card-label">Most Dot Balls</span>
          <div class="card-value" style="font-size: 1.25rem;">${dotBallsLeader.name}</div>
          <span class="card-subtext">${dotBallsLeader.value} Dots</span>
        </div>
      </div>
      
      <div class="bento-grid-mini" style="margin-top: 20px;">
        <div class="bento-card">
          <span class="card-label">Total Match Runs</span>
          <div class="card-value">${m.totalRuns || 0}</div>
        </div>
        <div class="bento-card">
          <span class="card-label">Total Boundaries</span>
          <div class="card-value">${(m.totalFours || 0) + (m.totalSixes || 0)}</div>
          <span class="card-subtext">Fours: ${m.totalFours || 0} | Sixes: ${m.totalSixes || 0}</span>
        </div>
      </div>
    `;
  }

  // --- POPUPS & SEQUENTIAL FORMS ---

  async promptOpenersSelection(engine, forceSelect = false) {
    const currentInn = engine.currentInnings();
    if (currentInn.strikerId && !forceSelect) return;

    const squad = engine.teamPlayers(currentInn.battingTeamId);
    const eligible = squad.filter(p => {
      const rec = currentInn.batting[p.id];
      if (!rec) return true;
      return rec.status === "yet to bat" || rec.status === "retired" || p.id === currentInn.strikerId || p.id === currentInn.nonStrikerId;
    });
    const options = eligible.map(p => `<option value="${p.id}">${p.name}</option>`).join("");

    const strikerSelect = document.getElementById("openers-striker");
    const nonStrikerSelect = document.getElementById("openers-nonstriker");
    const nonStrikerGroup = document.getElementById("non-striker-group");

    strikerSelect.innerHTML = `<option value="">Choose Striker...</option>` + options;
    
    if (engine.match.settings.singleBattingMode) {
      nonStrikerGroup.style.display = "none";
      nonStrikerSelect.removeAttribute("required");
    } else {
      nonStrikerGroup.style.display = "block";
      nonStrikerSelect.setAttribute("required", "true");
      nonStrikerSelect.innerHTML = `<option value="">Choose Non-Striker...</option>` + options;
    }

    const backdrop = document.getElementById("modalBackdrop");
    const openersModal = document.getElementById("openers-modal");
    
    backdrop.removeAttribute("hidden");
    openersModal.style.display = "block";

    document.getElementById("openers-form").onsubmit = async (e) => {
      e.preventDefault();
      const strikerId = strikerSelect.value;
      const nonStrikerId = engine.match.settings.singleBattingMode ? null : nonStrikerSelect.value;

      if (!engine.match.settings.singleBattingMode && strikerId === nonStrikerId) {
        this.toast("Striker and Non-Striker must be different players.", "warning");
        return;
      }

      this.showLoader();
      try {
        engine.setBatsmen(strikerId, nonStrikerId);
        
        // Save state immediately
        await saveDoc("matches", engine.match);
        this.toast("Openers selected.", "success");
        this.closeModal();

        // Chain immediately to select bowler!
        setTimeout(() => this.promptBowlerSelection(engine), 200);
      } catch (err) {
        this.toast(err.message, "danger");
      } finally {
        this.hideLoader();
      }
    };
  }

  async promptBowlerSelection(engine, forceSelect = false) {
    const currentInn = engine.currentInnings();
    if (currentInn.currentBowlerId && !forceSelect) return;

    const squad = engine.teamPlayers(currentInn.bowlingTeamId);
    const activeStriker = currentInn.strikerId;
    const activeNonStriker = currentInn.nonStrikerId;
    
    // Bowler cannot be striker/non-striker batting currently (common players exception handled)
    const eligible = squad.filter(p => p.id !== activeStriker && p.id !== activeNonStriker);
    const options = eligible.map(p => `<option value="${p.id}">${p.name}</option>`).join("");

    const bowlerSelect = document.getElementById("bowler-select");
    bowlerSelect.innerHTML = `<option value="">Choose Bowler...</option>` + options;

    const spellSelect = document.getElementById("bowler-spell");
    const spells = engine.availableSpellTypes();
    spellSelect.innerHTML = spells.map((s, idx) => `
      <option value="${idx}">${s.label} (${s.balls} balls)</option>
    `).join("");

    const backdrop = document.getElementById("modalBackdrop");
    const bowlerModal = document.getElementById("bowler-modal");
    
    backdrop.removeAttribute("hidden");
    bowlerModal.style.display = "block";

    document.getElementById("bowler-form").onsubmit = async (e) => {
      e.preventDefault();
      const bowlerId = bowlerSelect.value;
      const spellIndex = Number(spellSelect.value);
      const chosenSpell = spells[spellIndex];

      this.showLoader();
      try {
        engine.setBowlerSpell(bowlerId, chosenSpell.balls, chosenSpell.isBaby);
        
        await saveDoc("matches", engine.match);
        this.toast("Bowler selected. Start bowling!", "success");
        this.closeModal();
      } catch (err) {
        this.toast(err.message, "danger");
      } finally {
        this.hideLoader();
      }
    };
  }

  async promptBatsmanSelection(engine, isManualChange = false) {
    const currentInn = engine.currentInnings();
    const available = engine.availableBatsmen();

    if (available.length === 0) {
      if (isManualChange) {
        this.toast("No other batsmen available to bring to the crease.", "warning");
      }
      return;
    }

    const striker = engine.player(currentInn.strikerId);
    const nonStriker = engine.player(currentInn.nonStrikerId);

    let selectHtml = "";
    if (isManualChange) {
      let targetOptions = `<option value="striker">Striker (${striker ? striker.name : 'Striker'})</option>`;
      if (!engine.match.settings.singleBattingMode && nonStriker) {
        targetOptions += `<option value="nonStriker">Non-Striker (${nonStriker.name})</option>`;
      }

      selectHtml = `
        <form id="next-batsman-form" class="standard-form">
          <div class="form-group">
            <label for="change-target-select">Select Position to Change</label>
            <select id="change-target-select" required>
              ${targetOptions}
            </select>
          </div>
          <div class="form-group">
            <label for="next-batsman-select">Select New Batsman</label>
            <select id="next-batsman-select" required>
              <option value="">Select Batsman...</option>
              ${available.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
            </select>
          </div>
          <button type="submit" class="primary-btn">Change Batsman</button>
        </form>
      `;
    } else {
      selectHtml = `
        <form id="next-batsman-form" class="standard-form">
          <div class="form-group">
            <label for="next-batsman-select">Select Next Batsman</label>
            <select id="next-batsman-select" required>
              <option value="">Select Batsman...</option>
              ${available.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
            </select>
          </div>
          <button type="submit" class="primary-btn">Bring to Crease</button>
        </form>
      `;
    }

    this.openModal(isManualChange ? "Change Batsman" : "Batsman Wicket Fall", selectHtml);

    document.getElementById("next-batsman-form").onsubmit = async (e) => {
      e.preventDefault();
      const pid = document.getElementById("next-batsman-select").value;

      this.showLoader();
      try {
        if (isManualChange) {
          const targetKey = document.getElementById("change-target-select").value;
          const oldPid = targetKey === "striker" ? currentInn.strikerId : currentInn.nonStrikerId;
          
          if (oldPid) {
            currentInn.batting[oldPid].status = "yet to bat";
          }
          
          if (targetKey === "striker") {
            currentInn.strikerId = pid;
          } else {
            currentInn.nonStrikerId = pid;
          }
          currentInn.batting[pid].status = "batting";
        } else {
          const emptyKey = !currentInn.strikerId ? "strikerId" : "nonStrikerId";
          currentInn[emptyKey] = pid;
          currentInn.batting[pid].status = "batting";
        }

        // Manage partnership updates if both batsmen are set
        if (currentInn.strikerId && currentInn.nonStrikerId) {
          const newPair = [currentInn.strikerId, currentInn.nonStrikerId].sort();
          currentInn.currentPartnership = {
            playerIds: newPair,
            runs: 0,
            balls: 0
          };
        } else {
          currentInn.currentPartnership = null;
        }

        await saveDoc("matches", engine.match);
        this.toast(isManualChange ? "Batsman changed successfully." : "New batsman is at the crease.", "success");
        this.closeModal();
      } catch (err) {
        this.toast(err.message, "danger");
      } finally {
        this.hideLoader();
      }
    };
  }

  async promptWicketModal(engine) {
    const currentInn = engine.currentInnings();
    const striker = engine.player(currentInn.strikerId);
    const nonStriker = engine.player(currentInn.nonStrikerId);

    const batSelect = document.getElementById("wicket-batsman");
    let batOptions = `<option value="striker">${striker ? striker.name : 'Striker'}</option>`;
    if (nonStriker) {
      batOptions += `<option value="nonStriker">${nonStriker.name} (Non-Striker)</option>`;
    }
    batSelect.innerHTML = batOptions;

    // Fielder lists (from fielding squad)
    const fieldingSquad = engine.teamPlayers(currentInn.bowlingTeamId);
    const fielderSelect = document.getElementById("wicket-fielder");
    
    const populateFielders = (excludeBowler = false) => {
      const eligibleFielders = excludeBowler 
        ? fieldingSquad.filter(f => f.id !== currentInn.currentBowlerId)
        : fieldingSquad;
        
      fielderSelect.innerHTML = `<option value="">Select Fielder...</option>` + eligibleFielders.map(f => `
        <option value="${f.id}">${f.name}</option>
      `).join("");
    };

    const typeSelect = document.getElementById("wicket-type");
    const fielderGroup = document.getElementById("wicket-fielder-group");

    populateFielders(typeSelect.value === "Stumped");

    typeSelect.addEventListener("change", (e) => {
      const type = e.target.value;
      if (type === "Caught" || type.startsWith("Run Out") || type === "Stumped") {
        fielderGroup.style.display = "flex";
        populateFielders(type === "Stumped");
      } else {
        fielderGroup.style.display = "none";
      }
    });

    const backdrop = document.getElementById("modalBackdrop");
    const wicketModal = document.getElementById("wicket-modal");
    
    backdrop.removeAttribute("hidden");
    wicketModal.style.display = "block";

    document.getElementById("wicket-form").onsubmit = async (e) => {
      e.preventDefault();
      const batKey = batSelect.value; // 'striker' or 'nonStriker'
      const cause = typeSelect.value;
      const fielderId = fielderSelect.value;

      this.showLoader();
      try {
        const dInfo = {
          cause,
          bowlerId: currentInn.currentBowlerId,
          fielderId
        };

        // Determine runout end vs standard wicket
        let event = "W";
        if (cause.startsWith("Run Out")) {
          event = batKey === "striker" ? "RO-S+0" : "RO-NS+0";
        }

        // Optimistic Wicket Local Update
        engine.applyEvent(event, dInfo);
        this.renderScorerControls(engine);
        this.renderFullScorecard(engine);
        this.renderMatchStats(engine);
        this.closeModal();

        saveDoc("matches", engine.match).then(async () => {
          if (engine.match.status === "completed") {
            this.showLoader();
            await recalculateStats();
            this.hideLoader();
            this.toast("Match Complete!", "success");
          }
        }).catch(err => {
          this.toast("Sync failed: " + err.message, "danger");
        });
        
        this.toast("Wicket recorded.", "success");
      } catch (err) {
        this.toast(err.message, "danger");
      }
    };
  }

  promptInningsTransition(engine) {
    const backdrop = document.getElementById("modalBackdrop");
    const transModal = document.getElementById("transition-modal");
    
    const firstInn = engine.match.innings[0];
    const secondInn = engine.match.innings[1];
    const target = firstInn.totalRuns + 1;
    const battingTeam = engine.team(secondInn.battingTeamId);

    document.getElementById("transition-message").innerHTML = `
      Innings 1 is complete!<br>
      Score: <strong>${firstInn.totalRuns}/${firstInn.wickets}</strong><br>
      Team <strong>${battingTeam ? battingTeam.name : 'B'}</strong> needs <strong>${target}</strong> runs in ${engine.match.settings.totalOvers} overs to win.
    `;

    backdrop.removeAttribute("hidden");
    transModal.style.display = "block";

    document.getElementById("transition-next-btn").onclick = () => {
      this.closeModal();
      // Directly trigger opener selector for Innings 2!
      setTimeout(() => this.promptOpenersSelection(engine, true), 200);
    };
  }

  // --- VIEW 12: USER PROFILE / NOTIFICATIONS ---
  showProfile() {
    this.showSection("view-profile", "My Profile", "Stats overview and claim tools.");

    const p = getCurrentPlayer();
    const u = getCurrentUser();

    // Load static details
    document.getElementById("prof-avatar").textContent = (u.name || "P").substring(0,1).toUpperCase();
    document.getElementById("prof-name").textContent = u.name;
    document.getElementById("prof-role").textContent = getActiveRole();
    
    document.getElementById("prof-id").textContent = p ? p.id : "No Player profile linked";
    document.getElementById("prof-email").textContent = u.email;
    document.getElementById("prof-mobile").textContent = u.mobile || "N/A";
    document.getElementById("prof-gender").textContent = u.gender;

    // Render Stats bento inside Profile
    const statsGrid = document.getElementById("prof-stats-grid");
    if (!p) {
      statsGrid.innerHTML = `<p class="empty-state">Stats not compiled. Register as player.</p>`;
    } else {
      const winPct = p.matchesPlayed > 0 ? ((p.matchesWon / p.matchesPlayed) * 100).toFixed(1) : 0;
      statsGrid.innerHTML = `
        <div class="bento-card">
          <span class="card-label">Matches</span>
          <div class="card-value">${p.matchesPlayed || 0}</div>
          <span class="card-subtext">Win Ratio: ${winPct}%</span>
        </div>
        <div class="bento-card">
          <span class="card-label">Runs</span>
          <div class="card-value">${p.totalRuns || 0}</div>
          <span class="card-subtext">Avg: ${p.matchesPlayed > 0 ? (p.totalRuns / p.matchesPlayed).toFixed(1) : 0}</span>
        </div>
        <div class="bento-card">
          <span class="card-label">Wickets</span>
          <div class="card-value">${p.totalWickets || 0}</div>
          <span class="card-subtext">Economy: ${p.economy || 0}</span>
        </div>
      `;
    }

    // Role-dependent Actions
    const actionArea = document.getElementById("prof-action-area");
    actionArea.innerHTML = ""; // clear

    if (u.role === "player") {
      const reqBtn = document.createElement("button");
      reqBtn.className = "primary-btn full-width";
      reqBtn.textContent = "Request Admin Role";
      reqBtn.onclick = () => this.requestAdminRole();
      actionArea.appendChild(reqBtn);
    }

    if (p) {
      const claimBtn = document.createElement("button");
      claimBtn.className = "secondary-btn full-width margin-top-small";
      claimBtn.textContent = "Claim Guest Scores";
      claimBtn.onclick = () => this.triggerClaimGuestModal();
      actionArea.appendChild(claimBtn);
    }

    // Setup Tabs inside Profile
    const profileTabBtns = document.querySelectorAll("#view-profile .sub-tab-btn");
    profileTabBtns.forEach(btn => {
      btn.replaceWith(btn.cloneNode(true));
    });

    const newProfileTabBtns = document.querySelectorAll("#view-profile .sub-tab-btn");
    newProfileTabBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        newProfileTabBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        const tab = btn.getAttribute("data-profile-tab");
        if (tab === "matches") {
          document.getElementById("prof-tab-matches").style.display = "block";
          document.getElementById("prof-tab-notifications").style.display = "none";
        } else {
          document.getElementById("prof-tab-matches").style.display = "none";
          document.getElementById("prof-tab-notifications").style.display = "block";
          this.markAllNotificationsRead();
        }
      });
    });

    // Populate matches history tab in Profile
    this.renderProfileMatchHistory();

    // Populate Realtime Notifications list
    const notifList = document.getElementById("prof-notifications-list");
    const unsubNotif = listenToUserNotifications(u.id, (list) => {
      if (list.length === 0) {
        notifList.innerHTML = `<li class="empty-state">No notifications.</li>`;
        return;
      }

      notifList.innerHTML = list.map(n => {
        let actionButtons = "";
        
        // If it's a claim request received by Admin
        if (n.type === "claim_request" && !n.read) {
          // Extract claim ID if we can or scan claims
          actionButtons = `
            <div class="notif-actions margin-top-small">
              <button class="primary-btn notif-btn-sm" onclick="window.ui.resolveClaimRequest('${n.id}', true)">Approve</button>
              <button class="secondary-btn notif-btn-sm" onclick="window.ui.resolveClaimRequest('${n.id}', false)">Reject</button>
            </div>
          `;
        }

        const unreadDot = !n.read ? `<span style="color:var(--brand);margin-right:6px;">●</span>` : "";

        return `
          <li class="notif-item ${!n.read ? 'unread' : ''}">
            <div class="notif-message">
              ${unreadDot} ${n.message}
            </div>
            <span style="font-size:11px;color:var(--muted);">${new Date(n.createdAt).toLocaleString()}</span>
            ${actionButtons}
          </li>
        `;
      }).join("");
    });
    activeUnsubs.push(unsubNotif);
  }

  async renderProfileMatchHistory() {
    const tbody = document.getElementById("prof-matches-body");
    if (!getCurrentPlayer()) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No player stats.</td></tr>`;
      return;
    }

    const matches = await getAllDocs("matches");
    const playerMatches = matches.filter(m => {
      if (m.status !== "completed") return false;
      let played = false;
      m.innings.forEach(inn => {
        if (inn.batting && inn.batting[getCurrentPlayer().id]) played = true;
        if (inn.bowling && inn.bowling[getCurrentPlayer().id]) played = true;
      });
      return played;
    });

    if (playerMatches.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No match history found.</td></tr>`;
      return;
    }

    tbody.innerHTML = playerMatches.map(m => {
      let runs = 0, balls = 0, wickets = 0, runsConceded = 0;
      m.innings.forEach(inn => {
        if (inn.batting && inn.batting[getCurrentPlayer().id]) {
          runs = inn.batting[getCurrentPlayer().id].runs || 0;
          balls = inn.batting[getCurrentPlayer().id].balls || 0;
        }
        if (inn.bowling && inn.bowling[getCurrentPlayer().id]) {
          wickets = inn.bowling[getCurrentPlayer().id].wickets || 0;
          runsConceded = inn.bowling[getCurrentPlayer().id].runsConceded || 0;
        }
      });

      return `
        <tr>
          <td><a href="#/match/${m.id}"><strong>${m.id.substring(0,6)}</strong></a></td>
          <td>${runs}</td>
          <td>${balls}</td>
          <td>${wickets}</td>
          <td>${runsConceded}</td>
          <td><span class="status-tag completed">${m.result}</span></td>
        </tr>
      `;
    }).join("");
  }

  async markAllNotificationsRead() {
    const u = getCurrentUser();
    const notifs = await getAllDocs(`users/${u.id}/notifications`);
    const unread = notifs.filter(n => !n.read);
    
    for (const n of unread) {
      await markNotificationAsRead(u.id, n.id);
    }
  }

  async requestAdminRole() {
    this.showLoader();
    try {
      await createAdminRequest(getCurrentPlayer().id);
      this.toast("Request sent to Super Admin.", "success");
    } catch (err) {
      this.toast(err.message, "danger");
    } finally {
      this.hideLoader();
    }
  }



  triggerClaimGuestModal() {
    const backdrop = document.getElementById("modalBackdrop");
    const claimModal = document.getElementById("claim-guest-modal");
    
    backdrop.removeAttribute("hidden");
    claimModal.style.display = "block";

    const searchInput = document.getElementById("guest-search-input");
    const resultsContainer = document.getElementById("guest-search-results");

    searchInput.value = "";
    resultsContainer.innerHTML = `<p class="empty-state">Start typing to search unclaimed guests...</p>`;

    searchInput.oninput = async (e) => {
      const queryText = e.target.value.trim().toLowerCase();
      if (queryText.length === 0) {
        resultsContainer.innerHTML = `<p class="empty-state">Start typing to search unclaimed guests...</p>`;
        return;
      }

      // Search guest players
      const players = await getAllDocs("players");
      const unclaimedGuests = players.filter(p => p.isGuest && !p.claimedBy && p.name.toLowerCase().includes(queryText));

      if (unclaimedGuests.length === 0) {
        resultsContainer.innerHTML = `<p class="empty-state">No unclaimed guest players match "${queryText}".</p>`;
        return;
      }

      resultsContainer.innerHTML = unclaimedGuests.map(g => `
        <div class="guest-row">
          <span>${g.name} (Gender: ${g.gender})</span>
          <button class="primary-btn btn-small" onclick="window.ui.claimGuest('${g.id}', '${g.createdByAdminId}')">Claim Score</button>
        </div>
      `).join("");
    };
  }

  async claimGuest(guestId, adminId) {
    this.showLoader();
    try {
      await createGuestClaim(guestId, getCurrentPlayer().id, adminId);
      this.toast("Claim request submitted successfully to admin.", "success");
      this.closeModal();
    } catch (err) {
      this.toast(err.message, "danger");
    } finally {
      this.hideLoader();
    }
  }

  async resolveClaimRequest(notifId, approve) {
    this.showLoader();
    try {
      // Find the pending claim in guestClaims
      const claims = await getAllDocs("guestClaims");
      // Find a pending claim for this admin which matches guest claims
      const pendingClaim = claims.find(c => c.adminId === getCurrentUser().id && c.status === "pending");
      
      if (!pendingClaim) {
        throw new Error("Pending claim details not found.");
      }

      if (approve) {
        await approveGuestClaim(pendingClaim.id);
        await recalculateStats();
        this.toast("Guest score claim request APPROVED.", "success");
      } else {
        await rejectGuestClaim(pendingClaim.id);
        this.toast("Guest score claim request REJECTED.", "info");
      }

      // Mark notification as read
      await markNotificationAsRead(getCurrentUser().id, notifId);
    } catch (err) {
      this.toast(err.message, "danger");
    } finally {
      this.hideLoader();
    }
  }
}

export const ui = new UI();
window.ui = ui; // Expose on window for easy HTML inline onclick handlers

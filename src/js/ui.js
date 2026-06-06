import { DEFAULT_SETTINGS, makeMatch, makePlayer, makeTeam, makeTournament } from "./models.js";
import { saveDoc, deleteDocById, schemaReference } from "./firebase-service.js";
import { store } from "./storage.js";
import { MatchEngine, oversStr } from "./engine.js";

const $ = (selector) => document.querySelector(selector);

const SCORE_EVENTS = [
  { label: "0", event: "0" },
  { label: "1", event: "1" },
  { label: "2", event: "2" },
  { label: "3", event: "3" },
  { label: "4", event: "4" },
  { label: "6", event: "6" },
  { label: "WD", event: "WD" },
  { label: "NB", event: "NB" },
  { label: "Wicket", event: "W" },
  { label: "WD + Runs", prompt: "WD" },
  { label: "NB + Runs", prompt: "NB" },
  { label: "Dead Ball", event: "DB" },
  { label: "Bye", prompt: "BYE" },
  { label: "LB", prompt: "LB" },
  { label: "Custom Runs", prompt: "CUSTOM" },
];

const MATCH_ACTIONS = [
  { label: "Retired", event: "RETIRED" },
  { label: "Strike Rotate", event: "ROTATE" },
  { label: "Undo", event: "UNDO" },
  { label: "Retire Bowler", event: "RETIRE_BOWLER" },
];

export class UI {
  constructor() {
    this.currentView = "dashboard";
    this.engine = null;
    this.selectedMatchId = localStorage.getItem("gully-selected-match-id") || null;
    this.liveTab = "batting";
    this.modal = $("#modalBackdrop");
    this.modalTitle = $("#modalTitle");
    this.modalBody = $("#modalBody");
    this.viewedInningsIndex = 0;
    this.isShowingTransitionModal = false;
    this.selectedTournamentId = localStorage.getItem("gully-selected-tournament-id") || null;
    this.tournamentSubTab = "matches";
  }

  init() {
    store.seedIfEmpty();
    this.bindShell();
    this.render();
  }

  bindShell() {
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => this.switchView(btn.dataset.view));
    });
    $("#themeToggle").addEventListener("click", () => this.toggleTheme());
    $("#newMatchBtn").addEventListener("click", () => this.openMatchWizard());
    $("#fabNewMatch").addEventListener("click", () => this.openMatchWizard());
    $("#modalClose").addEventListener("click", () => this.closeModal());
    this.modal.addEventListener("click", (event) => {
      if (event.target === this.modal) this.closeModal();
    });
  }

  switchView(view) {
    this.currentView = view;
    document.querySelectorAll(".nav-item").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.view === view));
    document.querySelectorAll(".view").forEach((section) => section.classList.toggle("is-active", section.id === `${view}View`));
    const labels = {
      dashboard: ["Dashboard", "Create teams, start a match, and score every gully rule."],
      tournaments: ["Tournaments", "Manage tournaments, track points tables, matches, and view statistics."],
      teams: ["Teams", "Manage rosters, common players, transfers, and team details."],
      players: ["Players", "Create reusable players who can belong to multiple teams."],
      match: ["Live Match", "Score ball by ball with baby overs, custom extras, run-outs, and undo."],
      history: ["History", "Resume, duplicate, delete, or inspect stored matches."],
      settings: ["Settings", "Firebase schema, configuration, and deployment checklist."],
    };
    $("#viewTitle").textContent = labels[view] ? labels[view][0] : view;
    $("#viewSubtitle").textContent = labels[view] ? labels[view][1] : "";
    this.render();
  }

  toggleTheme() {
    const dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("gully-theme", dark ? "dark" : "light");
  }

  render() {
    this.renderDashboard();
    this.renderTournaments();
    this.renderTeams();
    this.renderPlayers();
    this.renderMatch();
    this.renderHistory();
    this.renderSettings();
  }

  renderDashboard() {
    const matches = store.all("matches");
    const completed = matches.filter((m) => m.status === "completed");
    const highest = Math.max(0, ...matches.flatMap((m) => m.innings || []).map((i) => i.totalRuns || 0));
    $("#dashboardView").innerHTML = `
      <div class="grid stats">
        ${this.stat("Total Matches", matches.length)}
        ${this.stat("Completed", completed.length)}
        ${this.stat("Highest Score", highest)}
        ${this.stat("Players", store.all("players").length)}
      </div>
      <div class="section-head"><h2>Quick Start</h2><button class="primary-btn" data-action="new-match">Create Match</button></div>
      <div class="grid two">
        <div class="card"><h3>Live Scoring</h3><p>Large scoring controls, recent balls, bowler figures, run rates, target, and automatic innings transitions.</p></div>
        <div class="card"><h3>Gully Rules</h3><p>Single batting mode, baby overs, independent bowler spells, legal-ball bowler limits, byes, extras, retired, dead ball, and undo.</p></div>
      </div>
    `;
    $("#dashboardView [data-action='new-match']").addEventListener("click", () => this.openMatchWizard());
  }

  stat(label, value) {
    return `<div class="card stat"><span>${label}</span><strong>${value}</strong></div>`;
  }

  renderPlayers() {
    const players = store.all("players");
    $("#playersView").innerHTML = `
      <div class="section-head"><h2>Players</h2><button class="primary-btn" data-action="add-player">Add Player</button></div>
      <div class="list" style="margin-top: 16px;">
        ${players.map((p) => `
          <div class="row player-row" data-player-id="${p.id}" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border);">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-weight: 600; font-size: 15px;">${p.name}</span>
              ${p.isCommonPlayer ? '<span class="pill" style="background: var(--accent); color: #1f2937; font-size: 10px; padding: 2px 6px;">Common</span>' : ''}
            </div>
            <div style="display: flex; gap: 6px; align-items: center;" onclick="event.stopPropagation();">
              <button class="secondary-btn small-btn" style="padding: 4px 8px; font-size: 11px;" data-edit-player="${p.id}">Edit</button>
              <button class="danger-btn small-btn" style="padding: 4px 8px; font-size: 11px;" data-delete-player="${p.id}">Delete</button>
            </div>
          </div>
        `).join("") || `<div class="empty">No players yet.</div>`}
      </div>
    `;
    $("#playersView [data-action='add-player']").addEventListener("click", () => this.openPlayerForm());
    document.querySelectorAll(".player-row").forEach(row => {
      row.addEventListener("click", () => {
        this.openPlayerDetailsModal(row.dataset.playerId);
      });
    });
    document.querySelectorAll("[data-edit-player]").forEach((btn) => btn.addEventListener("click", () => {
      this.openPlayerForm(btn.dataset.editPlayer);
    }));
    document.querySelectorAll("[data-delete-player]").forEach((btn) => btn.addEventListener("click", async () => {
      if (confirm("Are you sure you want to delete this player?")) {
        await deleteDocById("players", btn.dataset.deletePlayer);
        await this.rebuildAllStats();
        this.render();
      }
    }));
  }

  openPlayerDetailsModal(playerId) {
    const player = store.get("players", playerId);
    if (!player) return;
    
    const histories = store.all("player_match_history").filter(h => h.playerId === player.id);
    const teamIds = [...new Set(histories.map(h => h.teamId))];
    const teamNames = teamIds.map(tId => store.get("teams", tId)?.name).filter(Boolean);
    const teamsPlayedText = teamNames.join(", ") || "None";

    this.openModal(`Player Profile - ${player.name}`, `
      <div style="padding: 10px 0;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px;">
          <h2 style="margin: 0; color: var(--brand);">${player.name}</h2>
          ${player.isCommonPlayer ? '<span class="pill" style="background: var(--accent); color: #1f2937;">Common Player</span>' : ''}
        </div>
        
        <div style="margin-bottom: 20px; font-size: 14px; line-height: 1.6; color: var(--muted); border-bottom: 1px solid var(--border); padding-bottom: 12px;">
          <div><strong>Mobile:</strong> ${player.mobile || "N/A"}</div>
          <div><strong>Email:</strong> ${player.email || "N/A"}</div>
          <div><strong>Teams Played For:</strong> ${teamsPlayedText}</div>
        </div>

        <h3 style="margin-bottom: 12px;">Statistics</h3>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; font-size: 13px;">
          <div class="card" style="padding: 10px; margin: 0; background: var(--panel-2);"><strong>Regular Matches:</strong> ${player.matchesPlayed || 0}</div>
          <div class="card" style="padding: 10px; margin: 0; background: var(--panel-2);"><strong>Regular Wins:</strong> ${player.matchesWon || 0}</div>
          <div class="card" style="padding: 10px; margin: 0; background: var(--panel-2);"><strong>Common Matches:</strong> ${player.commonMatchesPlayed || 0}</div>
          <div class="card" style="padding: 10px; margin: 0; background: var(--panel-2);"><strong>Total Runs:</strong> ${player.totalRuns || 0}</div>
          <div class="card" style="padding: 10px; margin: 0; background: var(--panel-2);"><strong>Strike Rate:</strong> ${player.strikeRate || 0}</div>
          <div class="card" style="padding: 10px; margin: 0; background: var(--panel-2);"><strong>4s / 6s:</strong> ${player.totalFours || 0} / ${player.totalSixes || 0}</div>
          <div class="card" style="padding: 10px; margin: 0; background: var(--panel-2);"><strong>50s / 100s:</strong> ${player.totalFifties || 0} / ${player.totalCenturies || 0}</div>
          <div class="card" style="padding: 10px; margin: 0; background: var(--panel-2);"><strong>Wickets Taken:</strong> ${player.totalWickets || 0}</div>
          <div class="card" style="padding: 10px; margin: 0; background: var(--panel-2);"><strong>Economy:</strong> ${player.economy || 0}</div>
          <div class="card" style="padding: 10px; margin: 0; background: var(--panel-2);"><strong>Best Bowling:</strong> ${player.bestBowling || "-"}</div>
        </div>
        
        <div class="wizard-actions" style="margin-top: 24px;">
          <button class="secondary-btn" id="closeDetailsModalBtn" style="width: 100%;">Close</button>
        </div>
      </div>
    `);
    
    $("#closeDetailsModalBtn").addEventListener("click", () => this.closeModal());
  }

  renderTeams() {
    const teams = store.all("teams");
    const players = store.all("players");
    const matches = store.all("matches");
    $("#teamsView").innerHTML = `
      <div class="section-head"><h2>Teams</h2><button class="primary-btn" data-action="add-team">Create Team</button></div>
      <div class="grid two">${teams.map((t) => {
        const roster = t.playerIds.map((id) => players.find((p) => p.id === id)?.name).filter(Boolean);
        
        let teamFours = 0;
        let teamSixes = 0;
        let teamWickets = 0;
        
        matches.filter(m => m.status === "completed" && (m.teamAId === t.id || m.teamBId === t.id)).forEach(m => {
          const batInn = m.innings.find(inn => inn.battingTeamId === t.id);
          const bowlInn = m.innings.find(inn => inn.bowlingTeamId === t.id);
          
          if (batInn) {
            batInn.balls.forEach(b => {
              if (b.event === "4" || b.event.endsWith("+4")) teamFours++;
              if (b.event === "6" || b.event.endsWith("+6")) teamSixes++;
            });
          }
          if (bowlInn) {
            teamWickets += bowlInn.wickets || 0;
          }
        });

        const captain = players.find(p => p.id === t.captainId);
        const captainText = captain ? `Captain: ${captain.name}` : "No Captain selected";

        return `<div class="card">
          <div class="section-head" style="margin:0 0 12px"><h3>${t.name}</h3><span class="pill">${roster.length} players</span></div>
          <p style="margin-bottom: 4px; font-weight: 500; font-size: 13px; color: var(--brand);">${captainText}</p>
          <p style="margin-bottom: 10px;">${roster.join(", ") || "No players selected"}</p>
          <div class="meta" style="font-size: 12px; color: var(--muted); margin-bottom: 12px;">
            <strong>Stats:</strong> Fours: ${teamFours} | Sixes: ${teamSixes} | Wickets Taken: ${teamWickets}
          </div>
          <div class="wizard-actions">
            <button class="secondary-btn small-btn" data-edit-team="${t.id}">Edit</button>
            <button class="danger-btn small-btn" data-delete-team="${t.id}">Delete</button>
          </div>
        </div>`;
      }).join("") || `<div class="empty">No teams yet.</div>`}</div>
    `;
    $("#teamsView [data-action='add-team']").addEventListener("click", () => this.openTeamForm());
    document.querySelectorAll("[data-edit-team]").forEach((btn) => btn.addEventListener("click", () => this.openTeamForm(btn.dataset.editTeam)));
    document.querySelectorAll("[data-delete-team]").forEach((btn) => btn.addEventListener("click", async () => {
      await deleteDocById("teams", btn.dataset.deleteTeam);
      this.render();
    }));
  }

  renderMatch() {
    const matches = store.all("matches");
    const active = matches.find((m) => m.id === this.selectedMatchId)
      || matches.find((m) => m.status === "live")
      || matches[0];
    if (!active) {
      $("#matchView").innerHTML = `<div class="empty">No match yet. Start one from New Match.</div>`;
      return;
    }
    this.selectedMatchId = active.id;
    localStorage.setItem("gully-selected-match-id", active.id);
    this.engine = new MatchEngine(active, store.all("teams"), store.all("players"));

    // Ensure viewedInningsIndex is within range and matches the active innings if just loaded
    if (this.viewedInningsIndex === undefined || this.viewedInningsIndex >= active.innings.length) {
      this.viewedInningsIndex = active.inningsIndex || 0;
    }

    const inn = active.innings[this.viewedInningsIndex];
    const activeInn = active.innings[active.inningsIndex];
    if (!inn || !activeInn) {
      $("#matchView").innerHTML = `<div class="empty">No active innings details found. Start or select a match.</div>`;
      return;
    }
    const summary = this.engine.scoreSummary(inn);
    const battingTeam = this.engine.team(inn.battingTeamId);
    const bowlingTeam = this.engine.team(inn.bowlingTeamId);
    const bowler = this.engine.player(inn.currentBowlerId);
    const needsBatsmen = !activeInn.strikerId || (!this.engine.match.settings.singleBattingMode && !activeInn.nonStrikerId && this.engine.availableBatsmen().length);

    const isCompleted = active.status === "completed";
    const isViewingActiveInnings = this.viewedInningsIndex === active.inningsIndex;

    const creStrikerRec = inn.batting[inn.strikerId];
    const creNonStrikerRec = inn.batting[inn.nonStrikerId];
    const creStrikerScore = creStrikerRec ? ` ${creStrikerRec.runs} (${creStrikerRec.balls})` : "";
    const creNonStrikerScore = creNonStrikerRec ? ` ${creNonStrikerRec.runs} (${creNonStrikerRec.balls})` : "";

    const partnershipRow = inn.currentPartnership
      ? `<div class="row"><span>Partnership</span><strong>${inn.currentPartnership.runs} runs (${inn.currentPartnership.balls} balls)</strong></div>`
      : "";

    let targetSection = "";
    if (inn.inningsNumber === 2) {
      const remainingBalls = this.engine.inningsBallsRemaining(inn);
      const reqRuns = Math.max(0, inn.target - inn.totalRuns);
      targetSection = `
        <div class="target-info" style="margin-top: 12px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-size: 13px; opacity: 0.95; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.25);">
          <div><strong>Target:</strong> ${inn.target}</div>
          <div><strong>Runs Required:</strong> ${reqRuns}</div>
          <div><strong>Balls Left:</strong> ${remainingBalls}</div>
        </div>
      `;
    }

    const scoringHtml = !isCompleted && isViewingActiveInnings ? `
      <div class="section-head"><h2>Score Ball</h2><span class="pill">${this.engine.inningsBallsRemaining()} legal balls left</span></div>
      <div class="score-actions compact">${SCORE_EVENTS.map((item) => `<button class="score-btn ${this.eventClass(item.event || item.prompt)}" ${item.event ? `data-event="${item.event}"` : `data-prompt-event="${item.prompt}"`}>${item.label}</button>`).join("")}</div>
      <div class="section-head"><h2>Match Actions</h2></div>
      <div class="score-actions actions">${MATCH_ACTIONS.map((item) => `<button class="score-btn ${this.eventClass(item.event)}" data-event="${item.event}">${item.label}</button>`).join("")}</div>
    ` : `
      <div style="margin-top: 20px; padding: 16px; background: var(--panel-2); border-radius: 8px; text-align: center; color: var(--muted); font-size: 14px;">
        ${isCompleted ? "Match is completed. Switch to History to see final results." : "Scoring is disabled. Switch back to the active 2nd Innings tab to resume scoring."}
      </div>
    `;

    $("#matchView").innerHTML = `
      <div class="live-tabs" role="tablist" aria-label="Select Innings to View" style="margin-bottom: 12px;">
        <button class="${this.viewedInningsIndex === 0 ? "is-active" : ""}" data-view-innings="0">1st Innings</button>
        <button class="${this.viewedInningsIndex === 1 ? "is-active" : ""}" ${active.innings.length < 2 ? "disabled" : ""} data-view-innings="1">2nd Innings</button>
      </div>

      <div class="score-hero">
        <div>
          <p>${battingTeam?.name || "Batting"} vs ${bowlingTeam?.name || "Bowling"} (${this.viewedInningsIndex === 0 ? "1st" : "2nd"} Innings)</p>
          <div class="scoreline">${summary.score}</div>
          <div class="meta">${summary.overs} ov | Innings ${inn.inningsNumber} | CRR ${summary.crr}${inn.target ? ` | Target ${inn.target} | Need ${summary.need} | RRR ${summary.rrr}` : ""}</div>
          ${targetSection}
        </div>
        <div>
          <span class="pill">${active.status}</span>
          ${!isCompleted && isViewingActiveInnings ? `<div class="meta" style="margin-top:12px">Bowler spell: ${inn.currentBowlerBallsRemaining} ball(s) left</div>` : ""}
        </div>
      </div>
      <div class="grid two" style="margin-top:16px">
        <div class="card">
          <h3>Crease</h3>
          <div class="row"><span>Striker</span><strong>${this.engine.player(inn.strikerId)?.name || "-"}${creStrikerScore}</strong></div>
          ${active.settings.singleBattingMode ? "" : `<div class="row"><span>Non-Striker</span><strong>${this.engine.player(inn.nonStrikerId)?.name || "-"}${creNonStrikerScore}</strong></div>`}
          <div class="row"><span>Bowler</span><strong>${this.engine.player(inn.currentBowlerId)?.name || "-"}</strong></div>
          ${partnershipRow}
          ${!isCompleted && isViewingActiveInnings ? `
          <div class="wizard-actions">
            <button class="secondary-btn" data-action="select-batsmen">${needsBatsmen ? "Select Batsman" : "Change Batsmen"}</button>
            <button class="secondary-btn" data-action="select-bowler">Select Bowler</button>
          </div>
          ` : ""}
        </div>
        <div class="card">
          <h3>Recent Balls</h3>
          <div class="recent-balls">${summary.recent.map((b) => `<span class="ball-chip">${b.event}</span>`).join("") || `<p>No balls yet.</p>`}</div>
        </div>
      </div>
      ${scoringHtml}
      <div class="live-tabs" role="tablist" aria-label="Live match details">
        <button class="${this.liveTab === "batting" ? "is-active" : ""}" data-live-tab="batting">Batting Scorecard</button>
        <button class="${this.liveTab === "bowling" ? "is-active" : ""}" data-live-tab="bowling">Bowling Scorecard</button>
        <button class="${this.liveTab === "contribution" ? "is-active" : ""}" data-live-tab="contribution">Contribution</button>
        <button class="${this.liveTab === "log" ? "is-active" : ""}" data-live-tab="log">Ball Log</button>
      </div>
      <div class="tab-panel ${this.liveTab === "batting" ? "is-active" : ""}">
        ${this.scorecardTable("Batting", this.battingRows(inn))}
        ${this.fowSection(inn)}
      </div>
      <div class="tab-panel ${this.liveTab === "bowling" ? "is-active" : ""}">${this.scorecardTable("Bowling", this.bowlingRows(inn))}</div>
      <div class="tab-panel ${this.liveTab === "contribution" ? "is-active" : ""}">
        <div class="card" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 15px; padding: 20px; min-height: 320px;">
          <h3>Runs Contribution - ${this.viewedInningsIndex === 0 ? "1st" : "2nd"} Innings</h3>
          <canvas id="contributionCanvas" width="260" height="260" style="max-width: 100%; height: auto;"></canvas>
          <div id="contributionLegend" style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 10px; font-size: 13px; color: var(--muted); line-height: 1.6;"></div>
        </div>
      </div>
      <div class="tab-panel ${this.liveTab === "log" ? "is-active" : ""}">${this.ballLogCompact(inn)}</div>
    `;

    document.querySelectorAll("[data-view-innings]").forEach((btn) => btn.addEventListener("click", () => {
      this.viewedInningsIndex = Number(btn.dataset.viewInnings);
      this.renderMatch();
    }));

    const selectBatsmenBtn = $("#matchView [data-action='select-batsmen']");
    if (selectBatsmenBtn) {
      selectBatsmenBtn.addEventListener("click", () => this.openBatsmenModal());
    }

    const selectBowlerBtn = $("#matchView [data-action='select-bowler']");
    if (selectBowlerBtn) {
      selectBowlerBtn.addEventListener("click", () => this.openBowlerModal());
    }

    document.querySelectorAll("[data-live-tab]").forEach((btn) => btn.addEventListener("click", () => {
      this.liveTab = btn.dataset.liveTab;
      this.renderMatch();
    }));
    document.querySelectorAll("[data-prompt-event]").forEach((btn) => btn.addEventListener("click", () => this.promptRunEvent(btn.dataset.promptEvent)));
    document.querySelectorAll("[data-event]").forEach((btn) => btn.addEventListener("click", async () => this.applyScoringEvent(btn.dataset.event)));

    if (this.liveTab === "contribution") {
      this.drawContributionChart(inn);
    }

    if (needsBatsmen && active.status === "live" && !this.isShowingTransitionModal) {
      setTimeout(() => this.openBatsmenModal(), 0);
    }
  }

  async applyScoringEvent(eventName) {
    if (eventName === "W") {
      this.openWicketModal();
      return;
    }
    try {
      const notice = this.engine.applyEvent(eventName);
      await saveDoc("matches", this.engine.match);
      if (notice) this.toast(notice);
      this.render();
      if (notice === "Start Second Innings") {
        this.isShowingTransitionModal = true;
        this.openFirstInningsCompleteModal();
      } else if (this.engine.match.status === "completed") {
        await this.rebuildAllStats();
        this.openMatchWinnerModal();
      } else if (notice === "Select Next Batsman") {
        this.openBatsmenModal();
      }
    } catch (error) {
      this.toast(error.message, "danger");
    }
  }

  async applyScoringEventWithDetails(eventName, dismissalInfo) {
    try {
      const notice = this.engine.applyEvent(eventName, dismissalInfo);
      await saveDoc("matches", this.engine.match);
      if (notice) this.toast(notice);
      this.closeModal();
      this.render();
      if (notice === "Start Second Innings") {
        this.isShowingTransitionModal = true;
        this.openFirstInningsCompleteModal();
      } else if (this.engine.match.status === "completed") {
        await this.rebuildAllStats();
        this.openMatchWinnerModal();
      } else if (notice === "Select Next Batsman") {
        this.openBatsmenModal();
      }
    } catch (error) {
      this.toast(error.message, "danger");
    }
  }

  openWicketModal() {
    const innings = this.engine.currentInnings();
    const bowlingTeamPlayers = this.engine.teamPlayers(innings.bowlingTeamId);
    const eligibleFieldingPlayers = bowlingTeamPlayers.filter(p => p.id !== innings.strikerId && p.id !== innings.nonStrikerId);
    const currentBowlerId = innings.currentBowlerId;

    this.openModal("Record Wicket", `
      <form id="wicketDetailsForm" class="form-grid">
        <label class="field full">Wicket Cause
          <select name="cause" id="wicketCauseSelect" required>
            <option value="Bowled">Bowled</option>
            <option value="Caught">Caught</option>
            <option value="Stumped">Stumped</option>
            <option value="Run Out">Run Out</option>
            <option value="Self Out">Self Out</option>
          </select>
        </label>
        
        <label class="field full" id="fielderSelectLabel" style="display:none;">
          <span id="fielderTitle">Fielder</span>
          <select name="fielderId">
            <option value="">Select Fielder</option>
            ${eligibleFieldingPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
          </select>
        </label>
        
        <div id="runOutFields" class="field full" style="display:none; grid-template-columns: 1fr 1fr; gap: 10px;">
          <label>Batsman Out
            <select name="runOutBatsman">
              <option value="striker">Striker (${this.engine.player(innings.strikerId)?.name || "Striker"})</option>
              <option value="nonStriker">Non-Striker (${this.engine.player(innings.nonStrikerId)?.name || "Non-Striker"})</option>
            </select>
          </label>
          <label>Completed Runs
            <select name="completedRuns">
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
            </select>
          </label>
        </div>
        
        <div class="wizard-actions field full">
          <button class="primary-btn">Record Wicket</button>
        </div>
      </form>
    `);

    const causeSelect = $("#wicketCauseSelect");
    const fielderSelectLabel = $("#fielderSelectLabel");
    const fielderTitle = $("#fielderTitle");
    const fielderDropdown = fielderSelectLabel.querySelector("select");
    const runOutFields = $("#runOutFields");

    causeSelect.addEventListener("change", () => {
      const cause = causeSelect.value;
      if (cause === "Caught") {
        fielderSelectLabel.style.display = "block";
        fielderTitle.textContent = "Catcher";
        fielderDropdown.required = true;
        runOutFields.style.display = "none";
      } else if (cause === "Stumped") {
        fielderSelectLabel.style.display = "block";
        fielderTitle.textContent = "Keeper";
        fielderDropdown.required = true;
        runOutFields.style.display = "none";
      } else if (cause === "Run Out") {
        fielderSelectLabel.style.display = "block";
        fielderTitle.textContent = "Fielder hitting wicket";
        fielderDropdown.required = true;
        runOutFields.style.display = "grid";
      } else {
        fielderSelectLabel.style.display = "none";
        fielderTitle.textContent = "Fielder";
        fielderDropdown.required = false;
        runOutFields.style.display = "none";
      }
    });

    $("#wicketDetailsForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const cause = fd.get("cause");
      const bowlerId = currentBowlerId;
      const fielderId = fd.get("fielderId") || "";

      let eventName = "W";
      if (cause === "Run Out") {
        const outWho = fd.get("runOutBatsman") === "striker" ? "S" : "NS";
        const runs = fd.get("completedRuns");
        eventName = `RO-${outWho}+${runs}`;
      }

      await this.applyScoringEventWithDetails(eventName, {
        cause,
        bowlerId,
        fielderId
      });
    });
  }

  openFirstInningsCompleteModal() {
    const match = this.engine.match;
    const inn1 = match.innings[0];
    const team1Name = store.get("teams", inn1.battingTeamId)?.name || "Batting Team";
    const overs = oversStr(inn1.legalBallsTotal);
    const target = inn1.totalRuns + 1;
    const oversLimit = match.settings.totalOvers;
    const rrr = (target / oversLimit).toFixed(2);
    
    this.openModal("Innings Complete", `
      <div style="text-align: center; padding: 10px 0;">
        <div style="font-size: 48px; margin-bottom: 10px;">🏏</div>
        <h3 style="color: var(--muted); margin-bottom: 8px;">1st Innings Complete</h3>
        <h2 style="margin-bottom: 16px; font-size: 28px;">${team1Name}</h2>
        <div style="font-size: 36px; font-weight: 800; color: var(--brand); margin-bottom: 20px;">
          ${inn1.totalRuns}/${inn1.wickets} <span style="font-size: 18px; font-weight: 500; color: var(--muted);">in ${overs} overs</span>
        </div>
        <div style="margin-bottom: 24px; padding: 16px; background: var(--panel-2); border-radius: 8px; font-size: 16px;">
          <strong>Target:</strong> <span style="color: var(--brand-2); font-weight: 800;">${target} runs</span> in ${oversLimit} overs
          <div style="font-size: 13px; color: var(--muted); margin-top: 6px;">Required Run Rate: ${rrr}</div>
        </div>
        <button class="primary-btn" id="startSecondInningsBtn" style="width: 100%;">Start 2nd Innings</button>
      </div>
    `);
    
    $("#startSecondInningsBtn").addEventListener("click", () => {
      this.isShowingTransitionModal = false;
      this.closeModal();
      this.openBatsmenModal();
    });
  }

  openMatchWinnerModal() {
    const match = this.engine.match;
    const inn1 = match.innings[0];
    const inn2 = match.innings[1];
    const resultText = match.result || "Match Tied";
    const mvpBat = match.mvpBatsmanId ? store.get("players", match.mvpBatsmanId) : null;
    const mvpBowl = match.mvpBowlerId ? store.get("players", match.mvpBowlerId) : null;
    const hrPlayer = match.highestRunsPlayerId ? store.get("players", match.highestRunsPlayerId) : null;
    const hwPlayer = match.highestWicketsPlayerId ? store.get("players", match.highestWicketsPlayerId) : null;

    let mvpBatStats = "";
    if (mvpBat) {
      let bestRec = null;
      match.innings.forEach(inn => {
        if (match.winnerTeamId && inn.battingTeamId !== match.winnerTeamId) return;
        const rec = inn.batting[match.mvpBatsmanId];
        if (rec && rec.balls > 0) {
          if (!bestRec || rec.runs > bestRec.runs || (rec.runs === bestRec.runs && (rec.runs / rec.balls) > (bestRec.runs / bestRec.balls))) {
            bestRec = rec;
          }
        }
      });
      if (bestRec) {
        mvpBatStats = `${bestRec.runs} runs (${bestRec.balls} balls)`;
      }
    }

    let mvpBowlStats = "";
    if (mvpBowl) {
      let bestRec = null;
      match.innings.forEach(inn => {
        if (match.winnerTeamId && inn.bowlingTeamId !== match.winnerTeamId) return;
        const rec = inn.bowling[match.mvpBowlerId];
        if (rec && rec.legalBalls > 0) {
          if (!bestRec || rec.wickets > bestRec.wickets || (rec.wickets === bestRec.wickets && rec.runsConceded < bestRec.runsConceded)) {
            bestRec = rec;
          }
        }
      });
      if (bestRec) {
        mvpBowlStats = `${bestRec.wickets} wkts, ${bestRec.runsConceded} runs (${oversStr(bestRec.legalBalls)} ov)`;
      }
    }

    let hrStats = "";
    if (hrPlayer) {
      let bestRec = null;
      match.innings.forEach(inn => {
        const rec = inn.batting[match.highestRunsPlayerId];
        if (rec && rec.balls > 0) {
          if (!bestRec || rec.runs > bestRec.runs || (rec.runs === bestRec.runs && (rec.runs / rec.balls) > (bestRec.runs / bestRec.balls))) {
            bestRec = rec;
          }
        }
      });
      if (bestRec) {
        hrStats = `${bestRec.runs} runs (${bestRec.balls} balls)`;
      }
    }

    let hwStats = "";
    if (hwPlayer) {
      let bestRec = null;
      match.innings.forEach(inn => {
        const rec = inn.bowling[match.highestWicketsPlayerId];
        if (rec && rec.legalBalls > 0) {
          if (!bestRec || rec.wickets > bestRec.wickets || (rec.wickets === bestRec.wickets && rec.runsConceded < bestRec.runsConceded)) {
            bestRec = rec;
          }
        }
      });
      if (bestRec) {
        hwStats = `${bestRec.wickets} wkts, ${bestRec.runsConceded} runs (${oversStr(bestRec.legalBalls)} ov)`;
      }
    }
    
    this.openModal("Match Complete!", `
      <div style="text-align: center; padding: 10px 0;">
        <div style="font-size: 48px; margin-bottom: 10px;">🏆</div>
        <h2 style="margin-bottom: 20px; color: var(--brand); font-size: 24px;">${resultText}</h2>
        <div style="margin-bottom: 24px; padding: 16px; background: var(--panel-2); border-radius: 8px; text-align: left;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span>1st Innings (${store.get("teams", inn1.battingTeamId)?.name}):</span>
            <strong>${inn1.totalRuns}/${inn1.wickets} (${oversStr(inn1.legalBallsTotal)} ov)</strong>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span>2nd Innings (${store.get("teams", inn2.battingTeamId)?.name}):</span>
            <strong>${inn2.totalRuns}/${inn2.wickets} (${oversStr(inn2.legalBallsTotal)} ov)</strong>
          </div>
          ${mvpBat ? `
          <div style="border-top: 1px solid rgba(255,255,255,0.15); margin-top: 12px; padding-top: 12px;">
            <strong>🏆 MVP Batsman:</strong> ${mvpBat.name} (${mvpBatStats})
          </div>` : ""}
          ${mvpBowl ? `
          <div style="${mvpBat ? "" : "border-top: 1px solid rgba(255,255,255,0.15); margin-top: 12px; padding-top: 12px;"}">
            <strong>☝️ MVP Bowler:</strong> ${mvpBowl.name} (${mvpBowlStats})
          </div>` : ""}
          ${hrPlayer ? `
          <div style="border-top: 1px solid rgba(255,255,255,0.15); margin-top: 12px; padding-top: 12px;">
            <strong>🏏 Highest Runs:</strong> ${hrPlayer.name} (${hrStats})
          </div>` : ""}
          ${hwPlayer ? `
          <div style="border-top: 1px solid rgba(255,255,255,0.15); margin-top: 12px; padding-top: 12px;">
            <strong>🎯 Highest Wickets:</strong> ${hwPlayer.name} (${hwStats})
          </div>` : ""}
        </div>
        <button class="primary-btn" id="winnerModalHistoryBtn" style="width: 100%;">Go to History</button>
      </div>
    `);
    
    $("#winnerModalHistoryBtn").addEventListener("click", () => {
      this.closeModal();
      this.switchView("history");
    });
  }

  promptRunEvent(prefix) {
    const label = prefix === "CUSTOM" ? "custom runs" : `${prefix} runs`;
    this.openModal(`Enter ${label}`, `
      <form id="runPromptForm" class="form-grid">
        <label class="field full">Runs<input name="runs" type="number" min="0" max="99" value="1" required></label>
        <div class="wizard-actions field full"><button class="primary-btn">Apply</button></div>
      </form>
    `);
    $("#runPromptForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const runs = Math.max(0, Number(new FormData(event.target).get("runs")));
      this.closeModal();
      await this.applyScoringEvent(`${prefix}+${runs}`);
    });
  }

  eventClass(event) {
    if (["4", "6", "NB", "WD", "CUSTOM"].includes(event)) return "primary-event";
    if (event === "W") return "danger-event";
    if (["UNDO", "RETIRED", "ROTATE", "DB", "BYE", "LB"].includes(event)) return "warn-event";
    return "";
  }

  fowSection(innings) {
    if (!innings.wicketsFallen || innings.wicketsFallen.length === 0) {
      return "";
    }
    const players = store.all("players");
    const rows = innings.wicketsFallen.map(w => {
      const batsman = players.find(p => p.id === w.batsmanId)?.name || "Unknown";
      const bowler = players.find(p => p.id === w.bowlerId)?.name || "Unknown";
      const fielder = players.find(p => p.id === w.fielderId)?.name || "Unknown";
      
      let causeText = "";
      switch (w.cause) {
        case "Bowled": causeText = `bowled - ${bowler}`; break;
        case "Caught": causeText = `catch - ${fielder}, bowl- ${bowler}`; break;
        case "Stumped": causeText = `stump - ${fielder}, bowl- ${bowler}`; break;
        case "Run Out": causeText = `run out - ${fielder}, bowl- ${bowler}`; break;
        case "Self Out": causeText = `self out`; break;
        default: causeText = `out`; break;
      }
      
      return `
        <div class="log-line" style="padding: 8px 12px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; font-size: 13px;">
          <strong>Wkt ${w.wicketNumber}: ${batsman}</strong>
          <span style="color: var(--muted);">${causeText} (Over: ${w.overNumber}.${w.ballInOver})</span>
        </div>
      `;
    }).join("");

    return `
      <div class="card" style="margin-top: 16px;">
        <h3 style="margin-bottom: 12px;">Fall of Wickets</h3>
        <div class="fow-list" style="display: flex; flex-direction: column;">
          ${rows}
        </div>
      </div>
    `;
  }

  formatDismissal(dismissal) {
    if (!dismissal) return "out";
    const players = store.all("players");
    const bowler = players.find(p => p.id === dismissal.bowlerId)?.name || "Unknown";
    const fielder = players.find(p => p.id === dismissal.fielderId)?.name || "Unknown";
    switch (dismissal.cause) {
      case "Bowled": return `bowled - ${bowler}`;
      case "Caught": return `catch - ${fielder}, bowl- ${bowler}`;
      case "Stumped": return `stump - ${fielder}, bowl- ${bowler}`;
      case "Run Out": return `run out - ${fielder}, bowl- ${bowler}`;
      case "Self Out": return `self out`;
      default: return "out";
    }
  }

  battingRows(innings) {
    return Object.values(innings.batting).map((rec) => {
      const sr = rec.balls ? ((rec.runs / rec.balls) * 100).toFixed(2) : "-";
      const statusText = rec.status === "out" ? this.formatDismissal(rec.dismissalInfo) : rec.status;
      return [this.engine.player(rec.playerId)?.name || "-", statusText, rec.runs, rec.balls, rec.fours, rec.sixes, sr];
    });
  }

  bowlingRows(innings) {
    return Object.values(innings.bowling).map((rec) => {
      const econ = rec.legalBalls ? (rec.runsConceded / (rec.legalBalls / 6)).toFixed(2) : "0.00";
      return [this.engine.player(rec.playerId)?.name || "-", oversStr(rec.legalBalls), rec.runsConceded, rec.wickets, rec.extras, econ];
    });
  }

  scorecardTable(title, rows) {
    const heads = title === "Batting" ? ["Player", "Status", "R", "B", "4s", "6s", "SR"] : ["Bowler", "Ov", "Runs", "W", "Ext", "Eco"];
    return `<div class="card table-wrap"><h3>${title}</h3><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  ballLogCompact(innings) {
    const groups = new Map();
    innings.balls.forEach((ball) => {
      if (!groups.has(ball.bowler)) groups.set(ball.bowler, []);
      groups.get(ball.bowler).push(ball.event);
    });
    const rows = [...groups.entries()].map(([bowler, balls]) => `
      <div class="log-line">
        <strong>${bowler}</strong>
        <span>:</span>
        <div class="recent-balls">${balls.map((ball) => `<span class="ball-chip">${ball}</span>`).join("")}</div>
      </div>
    `).join("");
    return `<div class="card compact-log">${rows || `<p>No balls yet.</p>`}</div>`;
  }

  renderHistory() {
    const matches = store.all("matches");
    $("#historyView").innerHTML = `<div class="list">${matches.map((m) => {
      const a = store.get("teams", m.teamAId)?.name || "Unknown";
      const b = store.get("teams", m.teamBId)?.name || "Unknown";

      let matchFours = m.totalFours || 0;
      let matchSixes = m.totalSixes || 0;
      let matchWkts = m.totalWickets || 0;
      
      if (!matchFours && !matchSixes && !matchWkts && m.innings) {
        m.innings.forEach(inn => {
          matchWkts += inn.wickets || 0;
          inn.balls.forEach(b => {
            if (b.event === "4" || b.event.endsWith("+4")) matchFours++;
            if (b.event === "6" || b.event.endsWith("+6")) matchSixes++;
          });
        });
      }

      const mvpBat = m.mvpBatsmanId ? store.get("players", m.mvpBatsmanId) : null;
      const mvpBowl = m.mvpBowlerId ? store.get("players", m.mvpBowlerId) : null;
      const hrPlayer = m.highestRunsPlayerId ? store.get("players", m.highestRunsPlayerId) : null;
      const hwPlayer = m.highestWicketsPlayerId ? store.get("players", m.highestWicketsPlayerId) : null;
      let mvpText = "";
      if (mvpBat || mvpBowl || hrPlayer || hwPlayer) {
        const parts = [];
        if (mvpBat) parts.push(`MVP Bat: ${mvpBat.name}`);
        if (mvpBowl) parts.push(`MVP Bowl: ${mvpBowl.name}`);
        if (hrPlayer) parts.push(`Highest Runs: ${hrPlayer.name}`);
        if (hwPlayer) parts.push(`Highest Wkts: ${hwPlayer.name}`);
        mvpText = ` | ${parts.join(", ")}`;
      }

      return `<div class="row" style="flex-direction: column; align-items: flex-start; gap: 8px;">
        <div style="width: 100%; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong>${a} vs ${b}</strong>
            <div class="meta" style="margin-top: 4px;">
              ${m.status} ${m.result ? ` | ${m.result}` : ""}
            </div>
            <div class="meta" style="font-size: 11px; color: var(--muted); margin-top: 2px;">
              4s: ${matchFours} | 6s: ${matchSixes} | Wkts: ${matchWkts}${mvpText}
            </div>
          </div>
          <div style="display: flex; gap: 6px;">
            ${m.status === "completed" ? `<button class="secondary-btn small-btn" data-view-match="${m.id}">View</button>` : ""}
            <button class="secondary-btn small-btn" data-resume="${m.id}">Resume</button>
            <button class="secondary-btn small-btn" data-duplicate="${m.id}">Duplicate</button>
            <button class="danger-btn small-btn" data-delete-match="${m.id}">Delete</button>
          </div>
        </div>
      </div>`;
    }).join("") || `<div class="empty">No match history.</div>`}</div>`;
    document.querySelectorAll("[data-view-match]").forEach((btn) => btn.addEventListener("click", () => {
      this.selectedMatchId = btn.dataset.viewMatch;
      localStorage.setItem("gully-selected-match-id", this.selectedMatchId);
      this.viewedInningsIndex = 0;
      this.switchView("match");
    }));
    document.querySelectorAll("[data-resume]").forEach((btn) => btn.addEventListener("click", () => {
      this.selectedMatchId = btn.dataset.resume;
      localStorage.setItem("gully-selected-match-id", this.selectedMatchId);
      this.switchView("match");
    }));
    document.querySelectorAll("[data-duplicate]").forEach((btn) => btn.addEventListener("click", async () => {
      const original = store.get("matches", btn.dataset.duplicate);
      const copy = { ...structuredClone(original), id: crypto.randomUUID(), status: "setup", result: "", createdAt: new Date().toISOString() };
      await saveDoc("matches", copy);
      this.render();
    }));
    document.querySelectorAll("[data-delete-match]").forEach((btn) => btn.addEventListener("click", async () => {
      if (confirm("Are you sure you want to delete this match?")) {
        await deleteDocById("matches", btn.dataset.deleteMatch);
        await this.rebuildAllStats();
        this.render();
      }
    }));
  }

  renderSettings() {
    const schema = schemaReference();
    $("#settingsView").innerHTML = `
      <div class="grid two">
        <div class="card"><h3>Firebase Configuration</h3><p>Edit <code>src/js/firebase-config.js</code> with your Firebase web app keys. Until then, the app stores data in localStorage.</p></div>
        <div class="card"><h3>Hosting</h3><p>Run <code>firebase init hosting</code>, select this folder as public root, then deploy with <code>firebase deploy</code>.</p></div>
      </div>
      <div class="section-head"><h2>Firestore Schema</h2></div>
      <div class="card table-wrap"><table><thead><tr><th>Collection</th><th>Shape</th></tr></thead><tbody>${Object.entries(schema).map(([name, shape]) => `<tr><td>${name}</td><td>${shape}</td></tr>`).join("")}</tbody></table></div>
    `;
  }

  openPlayerForm(playerId = null) {
    const player = playerId ? store.get("players", playerId) : null;
    const title = player ? "Edit Player" : "Add Player";
    this.openModal(title, `
      <form id="playerForm" class="form-grid">
        <label class="field">Name<input name="name" required value="${player?.name || ""}"></label>
        <label class="field">Mobile<input name="mobile" value="${player?.mobile || ""}"></label>
        <label class="field full">Email<input name="email" type="email" value="${player?.email || ""}"></label>
        <label class="toggle-row field full"><span>Is Common Player (can play in both teams)</span><input type="checkbox" name="isCommonPlayer" value="true" ${player?.isCommonPlayer ? "checked" : ""}></label>
        <div class="wizard-actions field full"><button class="primary-btn">Save Player</button></div>
      </form>
    `);
    $("#playerForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(event.target);
      const isCommon = fd.has("isCommonPlayer");
      
      let payload;
      if (player) {
        payload = {
          ...player,
          name: fd.get("name").trim(),
          mobile: fd.get("mobile").trim(),
          email: fd.get("email").trim(),
          isCommonPlayer: isCommon
        };
      } else {
        payload = makePlayer({
          name: fd.get("name"),
          mobile: fd.get("mobile"),
          email: fd.get("email"),
          isCommonPlayer: isCommon
        });
      }
      await saveDoc("players", payload);
      this.closeModal();
      this.render();
    });
  }

  openTeamForm(teamId = null) {
    const team = teamId ? store.get("teams", teamId) : null;
    const players = store.all("players");
    this.openModal(team ? "Edit Team" : "Create Team", `
      <form id="teamForm" class="form-grid">
        <label class="field full">Team Name<input name="name" required value="${team?.name || ""}"></label>
        <div class="field full"><span>Players</span>${players.map((p) => `
          <label class="toggle-row"><span>${p.name}</span><input type="checkbox" name="playerIds" value="${p.id}" ${team?.playerIds.includes(p.id) ? "checked" : ""}></label>
        `).join("")}</div>
        <label class="field full">Captain
          <select name="captainId" id="teamCaptainSelect">
            <option value="">Select Captain</option>
          </select>
        </label>
        <div class="wizard-actions field full"><button class="primary-btn">Save Team</button></div>
      </form>
    `);

    const updateCaptainDropdown = () => {
      const checkedIds = Array.from(document.querySelectorAll("#teamForm input[name='playerIds']:checked")).map(el => el.value);
      const captainSelect = document.getElementById("teamCaptainSelect");
      const currentSelected = captainSelect.value || team?.captainId || "";
      
      let html = `<option value="">Select Captain</option>`;
      checkedIds.forEach(id => {
        const p = store.get("players", id);
        if (p && !p.isCommonPlayer) {
          html += `<option value="${p.id}" ${p.id === currentSelected ? "selected" : ""}>${p.name}</option>`;
        }
      });
      captainSelect.innerHTML = html;
    };

    document.querySelectorAll("#teamForm input[name='playerIds']").forEach(cb => {
      cb.addEventListener("change", updateCaptainDropdown);
    });
    updateCaptainDropdown();

    $("#teamForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(event.target);
      const payload = team 
        ? { ...team, name: fd.get("name"), playerIds: fd.getAll("playerIds"), captainId: fd.get("captainId") || "" } 
        : makeTeam({ name: fd.get("name"), playerIds: fd.getAll("playerIds"), captainId: fd.get("captainId") || "" });
      await saveDoc("teams", payload);
      this.closeModal();
      this.render();
    });
  }

  openMatchWizard(defaultTournamentId = null) {
    const teams = store.all("teams");
    const tournaments = store.all("tournaments");
    if (teams.length < 2) {
      this.toast("Create at least two teams first.", "danger");
      this.switchView("teams");
      return;
    }
    if (tournaments.length === 0) {
      this.toast("Create at least one tournament first.", "danger");
      this.switchView("tournaments");
      return;
    }
    this.openModal("Match Setup Wizard", `
      <form id="matchWizard" class="form-grid">
        <label class="field full">Tournament<select name="tournamentId">${tournaments.map((t) => `<option value="${t.id}" ${t.id === defaultTournamentId ? "selected" : ""}>${t.tournamentName}</option>`).join("")}</select></label>
        <label class="field">Team A<select name="teamAId">${teams.map((t) => `<option value="${t.id}">${t.name}</option>`).join("")}</select></label>
        <label class="field">Team B<select name="teamBId">${teams.map((t) => `<option value="${t.id}">${t.name}</option>`).join("")}</select></label>
        <div id="commonPlayerSelectContainer" class="field full" style="display:none;"></div>
        <label class="field">Total Overs<input name="totalOvers" type="number" min="1" max="50" value="${DEFAULT_SETTINGS.totalOvers}"></label>
        <label class="field">Bowler Over Limit<input name="bowlerOverLimit" type="number" min="1" max="20" value="${DEFAULT_SETTINGS.bowlerOverLimit}"></label>
        ${this.settingToggle("extrasEnabled", "Extras Enabled", true)}
        ${this.settingToggle("byesEnabled", "Byes Enabled", true)}
        ${this.settingToggle("singleBattingMode", "Single Batting Mode", false)}
        ${this.settingToggle("allowBabyOvers", "Allow Baby Overs", true)}
        ${this.settingToggle("allowConsecutiveOvers", "Allow Consecutive Overs", false)}
        ${this.settingToggle("lastManStanding", "Last Man Standing", true)}
        <label class="field">Toss Winner<select name="tossWinnerId">${teams.map((t) => `<option value="${t.id}">${t.name}</option>`).join("")}</select></label>
        <label class="field">Toss Choice<select name="tossChoice"><option>Bat</option><option>Bowl</option></select></label>
        <div class="wizard-actions field full"><button class="primary-btn">Start Match</button></div>
      </form>
    `);

    const updateWizardFields = () => {
      const teamAId = $("#matchWizard select[name='teamAId']").value;
      const teamBId = $("#matchWizard select[name='teamBId']").value;
      const teamA = store.get("teams", teamAId);
      const teamB = store.get("teams", teamBId);
      const container = $("#commonPlayerSelectContainer");
      if (!teamA || !teamB || teamAId === teamBId) {
        container.style.display = "none";
        container.innerHTML = "";
        return;
      }
      const countA = teamA.playerIds.length;
      const countB = teamB.playerIds.length;
      const diff = Math.abs(countA - countB);
      if (diff > 1) {
        const largerTeam = countA > countB ? teamA : teamB;
        const eligibleCommonPlayers = store.all("players").filter(p => p.isCommonPlayer && largerTeam.playerIds.includes(p.id));
        
        container.style.display = "block";
        if (eligibleCommonPlayers.length > 0) {
          container.innerHTML = `
            <label class="field full">Common Player to Select
              <span style="display: block; font-size: 11px; color: var(--muted); margin-top: 2px; margin-bottom: 8px; line-height: 1.4;">
                <strong>Purpose:</strong> Selecting a common player from the larger team (${largerTeam.name}) automatically adds them to the smaller team's roster for this match, balancing the rosters so you can start.
              </span>
              <select name="commonPlayerId" required>
                <option value="">Select Common Player</option>
                ${eligibleCommonPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
              </select>
            </label>
          `;
        } else {
          container.innerHTML = `
            <div class="field full" style="font-size: 12px; color: var(--danger); line-height: 1.4; padding: 10px; background: rgba(239, 68, 68, 0.1); border-radius: 6px; border-left: 3px solid var(--danger);">
              <strong>Roster Mismatch:</strong> ${largerTeam.name} has ${diff} more player(s) than the other team. 
              To balance, please mark a player on ${largerTeam.name} as a <strong>Common Player</strong> in the Players tab, or adjust the team rosters.
            </div>
          `;
        }
      } else {
        container.style.display = "none";
        container.innerHTML = "";
      }
    };

    $("#matchWizard select[name='teamAId']").addEventListener("change", updateWizardFields);
    $("#matchWizard select[name='teamBId']").addEventListener("change", updateWizardFields);
    updateWizardFields();

    $("#matchWizard").addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(event.target);
      if (fd.get("teamAId") === fd.get("teamBId")) {
        this.toast("Team A and Team B must be different.", "danger");
        return;
      }

      const teamA = store.get("teams", fd.get("teamAId"));
      const teamB = store.get("teams", fd.get("teamBId"));

      // Clone rosters for pre-validation checks without mutating DB state
      const teamAPlayerIds = [...teamA.playerIds];
      const teamBPlayerIds = [...teamB.playerIds];

      const commonPlayerId = fd.get("commonPlayerId");
      if (commonPlayerId) {
        if (!teamAPlayerIds.includes(commonPlayerId)) {
          teamAPlayerIds.push(commonPlayerId);
        }
        if (!teamBPlayerIds.includes(commonPlayerId)) {
          teamBPlayerIds.push(commonPlayerId);
        }
      }

      const overlappingPlayerIds = teamAPlayerIds.filter(id => teamBPlayerIds.includes(id));
      if (overlappingPlayerIds.length > 1) {
        this.toast(`Validation Failed: Only one player should be there as common in both teams.`, "danger");
        return;
      }

      if (overlappingPlayerIds.length === 1) {
        const cp = store.get("players", overlappingPlayerIds[0]);
        if (cp) {
          if (!cp.isCommonPlayer) {
            const proceed = confirm(`${cp.name} is in both teams but not marked as a Common Player. Do you want to mark them as a Common Player and proceed with them as the common player in both teams for this match?`);
            if (!proceed) return;
            cp.isCommonPlayer = true;
            await saveDoc("players", cp);
          } else {
            const proceed = confirm(`Do you want to proceed with ${cp.name} as the common player in both teams?`);
            if (!proceed) return;
          }
        }
      }

      const playersA = teamAPlayerIds.map(id => store.get("players", id)).filter(Boolean);
      const playersB = teamBPlayerIds.map(id => store.get("players", id)).filter(Boolean);
      const regularA = playersA.filter(p => !p.isCommonPlayer);
      const regularB = playersB.filter(p => !p.isCommonPlayer);

      if (regularA.length !== regularB.length) {
        this.toast(`Validation Failed: Both teams must have the same number of players excluding common players. Currently Team A has ${regularA.length} and Team B has ${regularB.length} regular players.`, "danger");
        return;
      }

      const isCapACommon = teamA.captainId && (store.get("players", teamA.captainId)?.isCommonPlayer || overlappingPlayerIds.includes(teamA.captainId));
      const isCapBCommon = teamB.captainId && (store.get("players", teamB.captainId)?.isCommonPlayer || overlappingPlayerIds.includes(teamB.captainId));

      const startMatchFinalize = async () => {
        // Save database rosters only if all validations passed
        if (commonPlayerId) {
          if (!teamA.playerIds.includes(commonPlayerId)) {
            teamA.playerIds.push(commonPlayerId);
            await saveDoc("teams", teamA);
          }
          if (!teamB.playerIds.includes(commonPlayerId)) {
            teamB.playerIds.push(commonPlayerId);
            await saveDoc("teams", teamB);
          }
        }

        const settings = {
          totalOvers: Number(fd.get("totalOvers")),
          bowlerOverLimit: Number(fd.get("bowlerOverLimit")),
          extrasEnabled: fd.has("extrasEnabled"),
          byesEnabled: fd.has("byesEnabled"),
          singleBattingMode: fd.has("singleBattingMode"),
          allowBabyOvers: fd.has("allowBabyOvers"),
          allowConsecutiveOvers: fd.has("allowConsecutiveOvers"),
          lastManStanding: fd.has("lastManStanding"),
        };
        const match = makeMatch({
          tournamentId: fd.get("tournamentId"),
          teamAId: fd.get("teamAId"),
          teamBId: fd.get("teamBId"),
          settings,
          tossWinnerId: fd.get("tossWinnerId"),
          tossChoice: fd.get("tossChoice"),
        });
        new MatchEngine(match, store.all("teams"), store.all("players"));
        await saveDoc("matches", match);
        this.selectedMatchId = match.id;
        localStorage.setItem("gully-selected-match-id", match.id);
        this.closeModal();
        this.switchView("match");
        this.openBatsmenModal();
      };

      if (isCapACommon || isCapBCommon) {
        this.promptChangeCaptain(teamA, regularA, isCapACommon, teamB, regularB, isCapBCommon, startMatchFinalize);
      } else {
        await startMatchFinalize();
      }
    });
  }

  promptChangeCaptain(teamA, regularA, isCapACommon, teamB, regularB, isCapBCommon, onComplete) {
    let formHtml = `<form id="changeCaptainForm" class="form-grid">`;
    if (isCapACommon) {
      const capA = store.get("players", teamA.captainId);
      formHtml += `
        <div class="field full">
          <p style="color: var(--danger); font-size: 13px; margin-bottom: 8px; line-height: 1.4; font-weight: 500;">
            <strong>Team A (${teamA.name})</strong> captain (${capA ? capA.name : "Selected"}) is a common player. A common player cannot be captain. Please select a new captain:
          </p>
          <select name="captainAId" required>
            <option value="">Select New Captain for ${teamA.name}</option>
            ${regularA.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
          </select>
        </div>
      `;
    }
    if (isCapBCommon) {
      const capB = store.get("players", teamB.captainId);
      formHtml += `
        <div class="field full">
          <p style="color: var(--danger); font-size: 13px; margin-bottom: 8px; line-height: 1.4; font-weight: 500;">
            <strong>Team B (${teamB.name})</strong> captain (${capB ? capB.name : "Selected"}) is a common player. A common player cannot be captain. Please select a new captain:
          </p>
          <select name="captainBId" required>
            <option value="">Select New Captain for ${teamB.name}</option>
            ${regularB.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}
          </select>
        </div>
      `;
    }
    formHtml += `
        <div class="wizard-actions field full">
          <button class="primary-btn" type="submit">Confirm Captain & Start</button>
        </div>
      </form>
    `;

    this.openModal("Select New Captain", formHtml);

    $("#changeCaptainForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(event.target);
      if (isCapACommon) {
        teamA.captainId = fd.get("captainAId");
        await saveDoc("teams", teamA);
      }
      if (isCapBCommon) {
        teamB.captainId = fd.get("captainBId");
        await saveDoc("teams", teamB);
      }
      await onComplete();
    });
  }

  settingToggle(name, label, checked) {
    return `<label class="toggle-row field full"><span>${label}</span><input type="checkbox" name="${name}" ${checked ? "checked" : ""}></label>`;
  }

  openBatsmenModal() {
    const innings = this.engine.currentInnings();
    const available = this.engine.availableBatsmen();
    const currentStriker = this.engine.player(innings.strikerId);
    const currentNonStriker = this.engine.player(innings.nonStrikerId);
    const defaultNonStrikerId = innings.nonStrikerId
      || available.find((player) => player.id !== (innings.strikerId || available[0]?.id))?.id
      || null;
    const strikerOptions = this.playerOptions([currentStriker, ...available], innings.strikerId);
    const nonStrikerOptions = this.playerOptions([currentNonStriker, ...available], defaultNonStrikerId, available.length === 0);
    this.openModal("Select Batsman", `
      <form id="batsmenForm" class="form-grid">
        <label class="field">Striker<select name="strikerId">${strikerOptions}</select></label>
        ${this.engine.match.settings.singleBattingMode ? "" : `<label class="field">Non-Striker<select name="nonStrikerId">${nonStrikerOptions}</select></label>`}
        <div class="wizard-actions field full"><button class="primary-btn">Confirm Batsman</button></div>
      </form>
    `);
    $("#batsmenForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(event.target);
      try {
        this.engine.setBatsmen(fd.get("strikerId"), fd.get("nonStrikerId") || null);
        await saveDoc("matches", this.engine.match);
        this.closeModal();
        this.render();
      } catch (error) {
        this.toast(error.message, "danger");
      }
    });
  }

  playerOptions(players, selectedId, includeBlank = false) {
    const unique = [];
    players.filter(Boolean).forEach((player) => {
      if (!unique.find((row) => row.id === player.id)) unique.push(player);
    });
    return `${includeBlank ? `<option value="">Last man / none</option>` : ""}${unique.map((player) => `<option value="${player.id}" ${player.id === selectedId ? "selected" : ""}>${player.name}</option>`).join("")}`;
  }

  openBowlerModal() {
    const innings = this.engine.currentInnings();
    const spells = this.engine.availableSpellTypes();
    const bowlers = this.engine.teamPlayers(innings.bowlingTeamId)
      .filter((player) => {
        if (player.id === innings.strikerId || player.id === innings.nonStrikerId) return false;
        return spells.some((spell) => this.engine.canSelectSpell(player.id, spell.balls));
      });
    if (!bowlers.length) {
      this.toast("No eligible bowler available for this spell.", "danger");
      return;
    }
    this.openModal("Select Bowler", `
      <form id="bowlerForm" class="form-grid">
        <label class="field">Bowler<select name="bowlerId">${bowlers.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}</select></label>
        <label class="field">Over Type<select name="spell">${spells.map((s) => `<option value="${s.balls}:${s.isBaby}">${s.label} (${s.balls} balls)</option>`).join("")}</select></label>
        <div class="field full"><p>Normal overs are hidden when fewer than 6 legal balls remain. Bowler limits are checked in legal balls.</p></div>
        <div class="wizard-actions field full"><button class="primary-btn">Start Spell</button></div>
      </form>
    `);
    $("#bowlerForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(event.target);
      const [balls, isBaby] = fd.get("spell").split(":");
      try {
        this.engine.setBowlerSpell(fd.get("bowlerId"), Number(balls), isBaby === "true");
        await saveDoc("matches", this.engine.match);
        this.closeModal();
        this.render();
      } catch (error) {
        this.toast(error.message, "danger");
      }
    });
  }

  renderTournaments() {
    const tournaments = store.all("tournaments");
    const matches = store.all("matches");
    const teams = store.all("teams");

    if (this.selectedTournamentId && !tournaments.some(t => t.id === this.selectedTournamentId)) {
      this.selectedTournamentId = null;
      localStorage.removeItem("gully-selected-tournament-id");
    }

    if (!this.selectedTournamentId && tournaments.length > 0) {
      this.selectedTournamentId = tournaments[0].id;
      localStorage.setItem("gully-selected-tournament-id", this.selectedTournamentId);
    }

    const t = tournaments.find(tour => tour.id === this.selectedTournamentId);
    const viewContainer = $("#tournamentsView");
    if (!viewContainer) return;

    if (!t) {
      viewContainer.innerHTML = `
        <div class="section-head"><h2>Tournaments</h2><button class="primary-btn" data-action="add-tournament">Create Tournament</button></div>
        <div class="empty">No tournaments yet. Create one to get started.</div>
      `;
      viewContainer.querySelector("[data-action='add-tournament']").addEventListener("click", () => this.openTournamentForm());
      return;
    }

    // Filter matches belonging to this tournament
    const tMatches = matches.filter(m => m.tournamentId === t.id);

    // Calculate tournament statistics (4s, 6s, wickets, 50s, centuries)
    let tFours = 0;
    let tSixes = 0;
    let tWickets = 0;
    let tFifties = 0;
    let tCenturies = 0;
    tMatches.filter(m => m.status === "completed").forEach(m => {
      let mFours = m.totalFours || 0;
      let mSixes = m.totalSixes || 0;
      let mWkts = m.totalWickets || 0;
      if (!mFours && !mSixes && !mWkts && m.innings) {
        m.innings.forEach(inn => {
          mWkts += inn.wickets || 0;
          inn.balls.forEach(b => {
            if (b.event === "4" || b.event.endsWith("+4")) mFours++;
            if (b.event === "6" || b.event.endsWith("+6")) mSixes++;
          });
        });
      }
      tFours += mFours;
      tSixes += mSixes;
      tWickets += mWkts;

      if (m.innings) {
        m.innings.forEach(inn => {
          Object.values(inn.batting).forEach(bRec => {
            if (bRec.runs >= 100) tCenturies++;
            else if (bRec.runs >= 50) tFifties++;
          });
        });
      }
    });

    // Compute NRR and Points Table dynamically
    const table = {};
    teams.forEach(team => {
      table[team.id] = { teamId: team.id, name: team.name, played: 0, won: 0, lost: 0, tied: 0, points: 0, runsScored: 0, ballsFaced: 0, runsConceded: 0, ballsBowled: 0, fours: 0, sixes: 0, wickets: 0 };
    });

    const completedMatches = tMatches.filter(m => m.status === "completed");
    completedMatches.forEach(m => {
      const inn1 = m.innings[0];
      const inn2 = m.innings[1];
      if (!inn1 || !inn2) return;

      const teamAId = m.teamAId;
      const teamBId = m.teamBId;

      if (!table[teamAId]) table[teamAId] = { teamId: teamAId, name: store.get("teams", teamAId)?.name || "Unknown", played: 0, won: 0, lost: 0, tied: 0, points: 0, runsScored: 0, ballsFaced: 0, runsConceded: 0, ballsBowled: 0, fours: 0, sixes: 0, wickets: 0 };
      if (!table[teamBId]) table[teamBId] = { teamId: teamBId, name: store.get("teams", teamBId)?.name || "Unknown", played: 0, won: 0, lost: 0, tied: 0, points: 0, runsScored: 0, ballsFaced: 0, runsConceded: 0, ballsBowled: 0, fours: 0, sixes: 0, wickets: 0 };

      table[teamAId].played += 1;
      table[teamBId].played += 1;

      const aBattedFirst = inn1.battingTeamId === teamAId;
      const teamAInn = aBattedFirst ? inn1 : inn2;
      const teamBInn = aBattedFirst ? inn2 : inn1;

      table[teamAId].runsScored += teamAInn.totalRuns;
      table[teamAId].ballsFaced += teamAInn.legalBallsTotal;
      table[teamAId].runsConceded += teamBInn.totalRuns;
      table[teamAId].ballsBowled += teamBInn.legalBallsTotal;

      table[teamBId].runsScored += teamBInn.totalRuns;
      table[teamBId].ballsFaced += teamBInn.legalBallsTotal;
      table[teamBId].runsConceded += teamAInn.totalRuns;
      table[teamBId].ballsBowled += teamAInn.legalBallsTotal;

      let teamAFours = 0;
      let teamASixes = 0;
      teamAInn.balls.forEach(b => {
        if (b.event === "4" || b.event.endsWith("+4")) teamAFours++;
        if (b.event === "6" || b.event.endsWith("+6")) teamASixes++;
      });

      let teamBFours = 0;
      let teamBSixes = 0;
      teamBInn.balls.forEach(b => {
        if (b.event === "4" || b.event.endsWith("+4")) teamBFours++;
        if (b.event === "6" || b.event.endsWith("+6")) teamBSixes++;
      });

      table[teamAId].fours += teamAFours;
      table[teamAId].sixes += teamASixes;
      table[teamAId].wickets += teamBInn.wickets || 0;

      table[teamBId].fours += teamBFours;
      table[teamBId].sixes += teamBSixes;
      table[teamBId].wickets += teamAInn.wickets || 0;

      if (m.winnerTeamId === teamAId) {
        table[teamAId].won += 1;
        table[teamAId].points += 2;
        table[teamBId].lost += 1;
      } else if (m.winnerTeamId === teamBId) {
        table[teamBId].won += 1;
        table[teamBId].points += 2;
        table[teamAId].lost += 1;
      } else {
        table[teamAId].tied += 1;
        table[teamAId].points += 1;
        table[teamBId].tied += 1;
        table[teamBId].points += 1;
      }
    });

    const pointsTableRows = Object.values(table).map(row => {
      const oversFaced = row.ballsFaced / 6;
      const oversBowled = row.ballsBowled / 6;
      const nrrScored = oversFaced > 0 ? row.runsScored / oversFaced : 0;
      const nrrConceded = oversBowled > 0 ? row.runsConceded / oversBowled : 0;
      row.nrr = (nrrScored - nrrConceded).toFixed(3);
      return row;
    });

    // Sort by Points (descending), then NRR (descending)
    pointsTableRows.sort((a, b) => b.points - a.points || parseFloat(b.nrr) - parseFloat(a.nrr));

    // Render HTML content
    let subTabContentHtml = "";
    if (this.tournamentSubTab === "matches") {
      subTabContentHtml = `
        <div class="section-head" style="margin-top: 15px;">
          <h3>Matches</h3>
          <button class="primary-btn small-btn" id="tournamentNewMatchBtn">New Match</button>
        </div>
        <div class="list">${tMatches.map((m) => {
          const a = store.get("teams", m.teamAId)?.name || "Unknown";
          const b = store.get("teams", m.teamBId)?.name || "Unknown";
          return `
            <div class="row">
              <div><strong>${a} vs ${b}</strong><div class="meta">${m.status} ${m.result ? ` | ${m.result}` : ""}</div></div>
              <div>
                ${m.status === "completed" ? `<button class="secondary-btn small-btn" data-view-tmatch="${m.id}">View</button>` : ""}
                <button class="secondary-btn small-btn" data-resume-tmatch="${m.id}">Resume</button>
                <button class="danger-btn small-btn" data-delete-tmatch="${m.id}">Delete</button>
              </div>
            </div>`;
        }).join("") || `<div class="empty">No matches in this tournament yet.</div>`}</div>
      `;
    } else if (this.tournamentSubTab === "points") {
      subTabContentHtml = `
        <div class="card table-wrap" style="margin-top: 15px;">
          <h3>Points Table</h3>
          <table>
            <thead>
              <tr>
                <th>Team</th>
                <th>P</th>
                <th>W</th>
                <th>L</th>
                <th>T</th>
                <th>4s</th>
                <th>6s</th>
                <th>Wkts</th>
                <th>Pts</th>
                <th>NRR</th>
              </tr>
            </thead>
            <tbody>
              ${pointsTableRows.map(row => `
                <tr>
                  <td><strong>${row.name}</strong></td>
                  <td>${row.played}</td>
                  <td>${row.won}</td>
                  <td>${row.lost}</td>
                  <td>${row.tied}</td>
                  <td>${row.fours}</td>
                  <td>${row.sixes}</td>
                  <td>${row.wickets}</td>
                  <td><strong>${row.points}</strong></td>
                  <td>${row.nrr}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;
    } else if (this.tournamentSubTab === "stats") {
      subTabContentHtml = this.renderTournamentStats(t.id);
    }

    viewContainer.innerHTML = `
      <div style="display: flex; gap: 15px; margin-bottom: 20px;">
        <div style="flex: 1;">
          <label class="field" style="font-size: 11px;">Active Tournament</label>
          <select id="activeTournamentSelector" style="font-weight: 700; font-size: 16px; padding: 8px; width: 100%;">
            ${tournaments.map(tour => `<option value="${tour.id}" ${tour.id === this.selectedTournamentId ? "selected" : ""}>${tour.tournamentName}</option>`).join("")}
          </select>
        </div>
        <div style="display: flex; align-items: flex-end; gap: 8px;">
          <button class="secondary-btn" id="editTournamentBtn">Edit</button>
          <button class="danger-btn" id="deleteTournamentBtn">Delete</button>
          <button class="primary-btn" id="createTournamentBtn">Create New</button>
        </div>
      </div>

      <div class="card" style="margin-bottom: 20px; background: var(--panel);">
        <h2>${t.tournamentName}</h2>
        <p style="margin-top: 5px;">${t.description || "No description provided."}</p>
        <div style="display: flex; gap: 20px; margin-top: 12px; font-size: 13px; color: var(--muted);">
          <span>📍 <strong>Location:</strong> ${t.location || "N/A"}</span>
          <span>📅 <strong>Duration:</strong> ${t.startDate || "N/A"} to ${t.endDate || "N/A"}</span>
          <span>🏆 <strong>Status:</strong> <span class="pill">${t.status}</span></span>
        </div>
      </div>

      <div class="grid five" style="margin-bottom: 20px; display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;">
        <div class="card" style="text-align: center; padding: 12px; margin: 0;">
          <div style="font-size: 20px;">🏏</div>
          <div style="font-size: 11px; text-transform: uppercase; color: var(--muted); margin-top: 4px;">Fours</div>
          <div style="font-size: 20px; font-weight: 800; color: var(--brand); margin-top: 2px;">${tFours}</div>
        </div>
        <div class="card" style="text-align: center; padding: 12px; margin: 0;">
          <div style="font-size: 20px;">💥</div>
          <div style="font-size: 11px; text-transform: uppercase; color: var(--muted); margin-top: 4px;">Sixes</div>
          <div style="font-size: 20px; font-weight: 800; color: var(--brand-2); margin-top: 2px;">${tSixes}</div>
        </div>
        <div class="card" style="text-align: center; padding: 12px; margin: 0;">
          <div style="font-size: 20px;">☝️</div>
          <div style="font-size: 11px; text-transform: uppercase; color: var(--muted); margin-top: 4px;">Wickets</div>
          <div style="font-size: 20px; font-weight: 800; color: var(--brand); margin-top: 2px;">${tWickets}</div>
        </div>
        <div class="card" style="text-align: center; padding: 12px; margin: 0;">
          <div style="font-size: 20px;">🎖️</div>
          <div style="font-size: 11px; text-transform: uppercase; color: var(--muted); margin-top: 4px;">50s</div>
          <div style="font-size: 20px; font-weight: 800; color: var(--brand-2); margin-top: 2px;">${tFifties}</div>
        </div>
        <div class="card" style="text-align: center; padding: 12px; margin: 0;">
          <div style="font-size: 20px;">💯</div>
          <div style="font-size: 11px; text-transform: uppercase; color: var(--muted); margin-top: 4px;">100s</div>
          <div style="font-size: 20px; font-weight: 800; color: var(--brand); margin-top: 2px;">${tCenturies}</div>
        </div>
      </div>

      <div class="live-tabs" role="tablist" style="margin-bottom: 12px;">
        <button class="${this.tournamentSubTab === "matches" ? "is-active" : ""}" data-t-subtab="matches">Matches</button>
        <button class="${this.tournamentSubTab === "points" ? "is-active" : ""}" data-t-subtab="points">Points Table</button>
        <button class="${this.tournamentSubTab === "stats" ? "is-active" : ""}" data-t-subtab="stats">Statistics</button>
      </div>

      ${subTabContentHtml}
    `;

    // Bind event listeners
    $("#activeTournamentSelector").addEventListener("change", (e) => {
      this.selectedTournamentId = e.target.value;
      localStorage.setItem("gully-selected-tournament-id", this.selectedTournamentId);
      this.renderTournaments();
    });

    $("#editTournamentBtn").addEventListener("click", () => this.openTournamentForm(t.id));
    $("#deleteTournamentBtn").addEventListener("click", async () => {
      if (confirm(`Are you sure you want to delete "${t.tournamentName}"?`)) {
        await deleteDocById("tournaments", t.id);
        
        const tMatchList = matches.filter(m => m.tournamentId === t.id);
        for (const m of tMatchList) {
          await deleteDocById("matches", m.id);
        }
        await this.rebuildAllStats();

        this.selectedTournamentId = null;
        localStorage.removeItem("gully-selected-tournament-id");
        this.render();
      }
    });

    $("#createTournamentBtn").addEventListener("click", () => this.openTournamentForm());

    const newMatchBtn = $("#tournamentNewMatchBtn");
    if (newMatchBtn) {
      newMatchBtn.addEventListener("click", () => this.openMatchWizard(t.id));
    }

    document.querySelectorAll("[data-t-subtab]").forEach(btn => btn.addEventListener("click", () => {
      this.tournamentSubTab = btn.dataset.tSubtab;
      this.renderTournaments();
    }));

    document.querySelectorAll("[data-view-tmatch]").forEach(btn => btn.addEventListener("click", () => {
      this.selectedMatchId = btn.dataset.viewTmatch;
      localStorage.setItem("gully-selected-match-id", this.selectedMatchId);
      this.viewedInningsIndex = 0;
      this.switchView("match");
    }));

    document.querySelectorAll("[data-resume-tmatch]").forEach(btn => btn.addEventListener("click", () => {
      this.selectedMatchId = btn.dataset.resumeTmatch;
      localStorage.setItem("gully-selected-match-id", this.selectedMatchId);
      this.switchView("match");
    }));

    document.querySelectorAll("[data-delete-tmatch]").forEach(btn => btn.addEventListener("click", async () => {
      if (confirm("Are you sure you want to delete this match?")) {
        await deleteDocById("matches", btn.dataset.deleteTmatch);
        await this.rebuildAllStats();
        this.renderTournaments();
      }
    }));
  }

  openTournamentForm(tournamentId = null) {
    const t = tournamentId ? store.get("tournaments", tournamentId) : null;
    this.openModal(t ? "Edit Tournament" : "Create Tournament", `
      <form id="tournamentForm" class="form-grid">
        <label class="field full">Tournament Name<input name="name" required value="${t?.tournamentName || ""}"></label>
        <label class="field full">Description<textarea name="description" rows="2">${t?.description || ""}</textarea></label>
        <label class="field full">Location<input name="location" value="${t?.location || ""}"></label>
        <label class="field">Start Date<input type="date" name="startDate" value="${t?.startDate || ""}"></label>
        <label class="field">End Date<input type="date" name="endDate" value="${t?.endDate || ""}"></label>
        <label class="field full">Status<select name="status">
          <option value="setup" ${t?.status === "setup" ? "selected" : ""}>Setup</option>
          <option value="live" ${t?.status === "live" ? "selected" : ""}>Live</option>
          <option value="completed" ${t?.status === "completed" ? "selected" : ""}>Completed</option>
        </select></label>
        <div class="wizard-actions field full"><button class="primary-btn">Save Tournament</button></div>
      </form>
    `);

    $("#tournamentForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      
      const payload = t ? {
        ...t,
        tournamentName: fd.get("name").trim(),
        description: fd.get("description").trim(),
        location: fd.get("location").trim(),
        startDate: fd.get("startDate"),
        endDate: fd.get("endDate"),
        status: fd.get("status")
      } : makeTournament({
        name: fd.get("name"),
        description: fd.get("description"),
        location: fd.get("location"),
        startDate: fd.get("startDate"),
        endDate: fd.get("endDate"),
        status: fd.get("status")
      });

      await saveDoc("tournaments", payload);
      this.selectedTournamentId = payload.id;
      localStorage.setItem("gully-selected-tournament-id", payload.id);
      this.closeModal();
      this.render();
    });
  }

  renderTournamentStats(tournamentId) {
    const histories = store.all("player_match_history").filter(h => h.tournamentId === tournamentId);
    const players = store.all("players");

    const statsMap = {};
    players.forEach(p => {
      statsMap[p.id] = { name: p.name, runs: 0, wickets: 0, fours: 0, sixes: 0, highest: 0, bestWickets: 0, bestRuns: 999, matches: 0, wins: 0 };
    });

    histories.forEach(h => {
      const p = statsMap[h.playerId];
      if (!p) return;
      p.runs += h.runs || 0;
      p.wickets += h.wickets || 0;
      p.fours += h.fours || 0;
      p.sixes += h.sixes || 0;
      p.matches += 1;
      if (h.result === "win") p.wins += 1;
      if (h.runs > p.highest) p.highest = h.runs;
      
      if (h.wickets > p.bestWickets || (h.wickets === p.bestWickets && h.runsConceded < p.bestRuns)) {
        p.bestWickets = h.wickets;
        p.bestRuns = h.runsConceded;
      }
    });

    const activePlayers = Object.entries(statsMap).map(([id, data]) => ({ id, ...data })).filter(item => item.matches > 0);

    const mostRuns = [...activePlayers].sort((a, b) => b.runs - a.runs).slice(0, 3);
    const mostWickets = [...activePlayers].sort((a, b) => b.wickets - a.wickets).slice(0, 3);
    const mostFours = [...activePlayers].sort((a, b) => b.fours - a.fours).slice(0, 3);
    const mostSixes = [...activePlayers].sort((a, b) => b.sixes - a.sixes).slice(0, 3);
    const highestScores = [...activePlayers].sort((a, b) => b.highest - a.highest).slice(0, 3);
    
    const bestBowlings = [...activePlayers]
      .filter(p => p.bestWickets > 0)
      .sort((a, b) => b.bestWickets - a.bestWickets || a.bestRuns - b.bestRuns)
      .slice(0, 3);

    const mostWins = [...activePlayers].sort((a, b) => b.wins - a.wins).slice(0, 3);

    return `
      <div class="grid three" style="margin-top: 15px;">
        <div class="card">
          <h3>Most Runs</h3>
          <div class="list" style="margin-top: 10px;">
            ${mostRuns.map((p, i) => `<div class="row" style="padding: 8px;"><span>${i+1}. ${p.name}</span><strong>${p.runs} runs</strong></div>`).join("") || '<p class="meta">No stats yet.</p>'}
          </div>
        </div>
        <div class="card">
          <h3>Most Wickets</h3>
          <div class="list" style="margin-top: 10px;">
            ${mostWickets.map((p, i) => `<div class="row" style="padding: 8px;"><span>${i+1}. ${p.name}</span><strong>${p.wickets} wkts</strong></div>`).join("") || '<p class="meta">No stats yet.</p>'}
          </div>
        </div>
        <div class="card">
          <h3>Highest Scores</h3>
          <div class="list" style="margin-top: 10px;">
            ${highestScores.map((p, i) => `<div class="row" style="padding: 8px;"><span>${i+1}. ${p.name}</span><strong>${p.highest}*</strong></div>`).join("") || '<p class="meta">No stats yet.</p>'}
          </div>
        </div>
        <div class="card">
          <h3>Best Bowling Spell</h3>
          <div class="list" style="margin-top: 10px;">
            ${bestBowlings.map((p, i) => `<div class="row" style="padding: 8px;"><span>${i+1}. ${p.name}</span><strong>${p.bestWickets}/${p.bestRuns}</strong></div>`).join("") || '<p class="meta">No stats yet.</p>'}
          </div>
        </div>
        <div class="card">
          <h3>Most Fours</h3>
          <div class="list" style="margin-top: 10px;">
            ${mostFours.map((p, i) => `<div class="row" style="padding: 8px;"><span>${i+1}. ${p.name}</span><strong>${p.fours} fours</strong></div>`).join("") || '<p class="meta">No stats yet.</p>'}
          </div>
        </div>
        <div class="card">
          <h3>Most Sixes</h3>
          <div class="list" style="margin-top: 10px;">
            ${mostSixes.map((p, i) => `<div class="row" style="padding: 8px;"><span>${i+1}. ${p.name}</span><strong>${p.sixes} sixes</strong></div>`).join("") || '<p class="meta">No stats yet.</p>'}
          </div>
        </div>
        <div class="card" style="grid-column: span 1;">
          <h3>Most Wins</h3>
          <div class="list" style="margin-top: 10px;">
            ${mostWins.map((p, i) => `<div class="row" style="padding: 8px;"><span>${i+1}. ${p.name}</span><strong>${p.wins} wins</strong></div>`).join("") || '<p class="meta">No stats yet.</p>'}
          </div>
        </div>
      </div>
    `;
  }

  async rebuildAllStats() {
    const matches = store.all("matches");
    const completedMatches = matches.filter(m => m.status === "completed");
    
    const histories = store.all("player_match_history");
    for (const h of histories) {
      await deleteDocById("player_match_history", h.id);
    }
    const batCards = store.all("batting_scorecards");
    for (const bc of batCards) {
      await deleteDocById("batting_scorecards", bc.id);
    }
    const bowlCards = store.all("bowling_scorecards");
    for (const bow of bowlCards) {
      await deleteDocById("bowling_scorecards", bow.id);
    }
    const teamStats = store.all("team_match_stats");
    for (const ts of teamStats) {
      await deleteDocById("team_match_stats", ts.id);
    }

    const teams = store.all("teams");
    const players = store.all("players");

    for (const match of completedMatches) {
      const inn1 = match.innings[0];
      const inn2 = match.innings[1];
      if (!inn1 || !inn2) continue;

      const teamA = teams.find(t => t.id === match.teamAId);
      const teamB = teams.find(t => t.id === match.teamBId);
      if (!teamA || !teamB) continue;

      let totalRuns = 0;
      let totalWickets = 0;
      let fours = 0;
      let sixes = 0;
      match.innings.forEach(inn => {
        totalRuns += inn.totalRuns || 0;
        totalWickets += inn.wickets || 0;
        inn.balls.forEach(b => {
          if (b.event === "4" || b.event.endsWith("+4")) fours++;
          if (b.event === "6" || b.event.endsWith("+6")) sixes++;
        });
      });
      match.totalRuns = totalRuns;
      match.totalWickets = totalWickets;
      match.totalFours = fours;
      match.totalSixes = sixes;
      
      if (inn2.totalRuns > inn1.totalRuns) {
        match.winnerTeamId = inn2.battingTeamId;
      } else if (inn1.totalRuns > inn2.totalRuns) {
        match.winnerTeamId = inn1.battingTeamId;
      } else {
        match.winnerTeamId = "";
      }

      // Calculate batsman MVP (most runs, strike rate tie-breaker)
      // Restrict to winning team's batting innings if there is a winner; otherwise consider either innings individually.
      const winTeamId = match.winnerTeamId;
      const eligibleBatRecords = [];
      match.innings.forEach(inn => {
        if (winTeamId && inn.battingTeamId !== winTeamId) return;
        Object.entries(inn.batting).forEach(([pid, rec]) => {
          if (rec.status !== "yet to bat" && rec.balls > 0) {
            eligibleBatRecords.push({
              playerId: pid,
              runs: rec.runs,
              balls: rec.balls,
              strikeRate: (rec.runs / rec.balls) * 100
            });
          }
        });
      });

      let bestBat = null;
      eligibleBatRecords.forEach(rec => {
        if (!bestBat) {
          bestBat = rec;
          return;
        }
        if (rec.runs > bestBat.runs) {
          bestBat = rec;
        } else if (rec.runs === bestBat.runs) {
          if (rec.strikeRate > bestBat.strikeRate) {
            bestBat = rec;
          }
        }
      });
      match.mvpBatsmanId = bestBat ? bestBat.playerId : "";

      // Calculate bowler MVP (most wickets, runs conceded tie-breaker)
      // Restrict to winning team's bowling innings if there is a winner; otherwise consider either innings individually.
      const eligibleBowlRecords = [];
      match.innings.forEach(inn => {
        if (winTeamId && inn.bowlingTeamId !== winTeamId) return;
        Object.entries(inn.bowling).forEach(([pid, rec]) => {
          if (rec.legalBalls > 0) {
            eligibleBowlRecords.push({
              playerId: pid,
              wickets: rec.wickets || 0,
              runsConceded: rec.runsConceded || 0,
              legalBalls: rec.legalBalls || 0
            });
          }
        });
      });

      let bestBowl = null;
      eligibleBowlRecords.forEach(rec => {
        if (!bestBowl) {
          bestBowl = rec;
          return;
        }
        if (rec.wickets > bestBowl.wickets) {
          bestBowl = rec;
        } else if (rec.wickets === bestBowl.wickets) {
          if (rec.runsConceded < bestBowl.runsConceded) {
            bestBowl = rec;
          }
        }
      });
      match.mvpBowlerId = bestBowl ? bestBowl.playerId : "";

      // Calculate highest runs player in a single innings across both teams
      const allBatRecords = [];
      match.innings.forEach(inn => {
        Object.entries(inn.batting).forEach(([pid, rec]) => {
          if (rec.status !== "yet to bat" && rec.balls > 0) {
            allBatRecords.push({
              playerId: pid,
              runs: rec.runs,
              balls: rec.balls,
              strikeRate: (rec.runs / rec.balls) * 100
            });
          }
        });
      });

      let bestHR = null;
      allBatRecords.forEach(rec => {
        if (!bestHR) {
          bestHR = rec;
          return;
        }
        if (rec.runs > bestHR.runs) {
          bestHR = rec;
        } else if (rec.runs === bestHR.runs) {
          if (rec.strikeRate > bestHR.strikeRate) {
            bestHR = rec;
          }
        }
      });
      match.highestRunsPlayerId = bestHR ? bestHR.playerId : "";

      // Calculate highest wickets player in a single innings across both teams
      const allBowlRecords = [];
      match.innings.forEach(inn => {
        Object.entries(inn.bowling).forEach(([pid, rec]) => {
          if (rec.legalBalls > 0) {
            allBowlRecords.push({
              playerId: pid,
              wickets: rec.wickets || 0,
              runsConceded: rec.runsConceded || 0,
              legalBalls: rec.legalBalls || 0
            });
          }
        });
      });

      let bestHW = null;
      allBowlRecords.forEach(rec => {
        if (!bestHW) {
          bestHW = rec;
          return;
        }
        if (rec.wickets > bestHW.wickets) {
          bestHW = rec;
        } else if (rec.wickets === bestHW.wickets) {
          if (rec.runsConceded < bestHW.runsConceded) {
            bestHW = rec;
          }
        }
      });
      match.highestWicketsPlayerId = bestHW ? bestHW.playerId : "";

      await saveDoc("matches", match);

      const teamsData = [
        { teamId: match.teamAId, inn: inn1.battingTeamId === match.teamAId ? inn1 : inn2, opponentInn: inn1.battingTeamId === match.teamAId ? inn2 : inn1 },
        { teamId: match.teamBId, inn: inn1.battingTeamId === match.teamBId ? inn1 : inn2, opponentInn: inn1.battingTeamId === match.teamBId ? inn2 : inn1 }
      ];

      for (const td of teamsData) {
        let tFours = 0;
        let tSixes = 0;
        td.inn.balls.forEach(b => {
          if (b.event === "4" || b.event.endsWith("+4")) tFours++;
          if (b.event === "6" || b.event.endsWith("+6")) tSixes++;
        });

        const stats = {
          id: `teamstats_${td.teamId}_${match.id}`,
          teamId: td.teamId,
          matchId: match.id,
          runs: td.inn.totalRuns,
          wickets: td.inn.wickets,
          fours: tFours,
          sixes: tSixes,
          overs: oversStr(td.inn.legalBallsTotal),
          runRate: td.inn.legalBallsTotal > 0 ? parseFloat((td.inn.totalRuns / (td.inn.legalBallsTotal / 6)).toFixed(2)) : 0
        };
        await saveDoc("team_match_stats", stats);
      }

      const processPlayerList = async (playerIds, representedTeamId, opponentTeamId, ownInn, oppInn) => {
        for (const pId of playerIds) {
          const player = players.find(p => p.id === pId);
          if (!player) continue;

          const batRec = ownInn.batting[pId];
          const runs = batRec ? batRec.runs : 0;
          const balls = batRec ? batRec.balls : 0;
          const pFours = batRec ? batRec.fours : 0;
          const pSixes = batRec ? batRec.sixes : 0;
          const strikeRate = balls > 0 ? parseFloat(((runs / balls) * 100).toFixed(2)) : 0;
          const dismissalType = batRec ? (batRec.status === "out" ? "Out" : (batRec.status === "retired" ? "Retired" : "Not Out")) : "DNB";

          const batCard = {
            id: `batcard_${pId}_${match.id}`,
            playerId: pId,
            matchId: match.id,
            runs,
            balls,
            fours: pFours,
            sixes: pSixes,
            strikeRate,
            dismissalType
          };
          await saveDoc("batting_scorecards", batCard);

          const bowlRec = oppInn.bowling[pId];
          const wickets = bowlRec ? bowlRec.wickets : 0;
          const runsConceded = bowlRec ? bowlRec.runsConceded : 0;
          const ballsBowled = bowlRec ? bowlRec.legalBalls : 0;
          const economy = ballsBowled > 0 ? parseFloat((runsConceded / (ballsBowled / 6)).toFixed(2)) : 0;

          const bowlCard = {
            id: `bowlcard_${pId}_${match.id}`,
            playerId: pId,
            matchId: match.id,
            overs: oversStr(ballsBowled),
            runsConceded,
            wickets,
            economy
          };
          await saveDoc("bowling_scorecards", bowlCard);

          let result = "tie";
          if (match.winnerTeamId === representedTeamId) result = "win";
          else if (match.winnerTeamId && match.winnerTeamId !== representedTeamId) result = "loss";

          const history = {
            id: `history_${pId}_${match.id}_${representedTeamId}`,
            playerId: pId,
            matchId: match.id,
            tournamentId: match.tournamentId || "",
            teamId: representedTeamId,
            runs,
            balls,
            fours: pFours,
            sixes: pSixes,
            wickets,
            runsConceded,
            ballsBowled,
            strikeRate,
            economy,
            result,
            playedAsCommonPlayer: teamA.playerIds.includes(pId) && teamB.playerIds.includes(pId),
            createdAt: new Date().toISOString()
          };
          await saveDoc("player_match_history", history);
        }
      };

      await processPlayerList(teamA.playerIds, match.teamAId, match.teamBId, inn1.battingTeamId === match.teamAId ? inn1 : inn2, inn1.battingTeamId === match.teamAId ? inn2 : inn1);
      await processPlayerList(teamB.playerIds, match.teamBId, match.teamAId, inn1.battingTeamId === match.teamBId ? inn1 : inn2, inn1.battingTeamId === match.teamBId ? inn2 : inn1);
    }

    const freshHistories = store.all("player_match_history");
    const freshPlayers = store.all("players");

    for (const player of freshPlayers) {
      const pHists = freshHistories.filter(h => h.playerId === player.id);
      const uniqueMatchIds = [...new Set(pHists.map(h => h.matchId))];
      
      let commonMatchesPlayed = 0;
      uniqueMatchIds.forEach(mId => {
        const mHists = pHists.filter(h => h.matchId === mId);
        if (mHists.some(h => h.playedAsCommonPlayer === true)) {
          commonMatchesPlayed++;
        }
      });

      let matchesPlayed = uniqueMatchIds.length - commonMatchesPlayed;
      
      let matchesWon = 0;
      uniqueMatchIds.forEach(mId => {
        const mHists = pHists.filter(h => h.matchId === mId);
        const isCommon = mHists.some(h => h.playedAsCommonPlayer === true);
        if (!isCommon && mHists.some(h => h.result === "win")) {
          matchesWon++;
        }
      });

      let totalRuns = 0;
      let totalBalls = 0;
      let totalFours = 0;
      let totalSixes = 0;
      let totalWickets = 0;
      let totalRunsConceded = 0;
      let totalBallsBowled = 0;
      let highestScore = 0;
      let totalFifties = 0;
      let totalCenturies = 0;
      
      let bestWickets = 0;
      let bestRunsConceded = 999;
      let bowledAtLeastOnce = false;

      pHists.forEach(h => {
        totalRuns += h.runs || 0;
        totalBalls += h.balls || 0;
        totalFours += h.fours || 0;
        totalSixes += h.sixes || 0;
        totalWickets += h.wickets || 0;
        totalRunsConceded += h.runsConceded || 0;
        totalBallsBowled += h.ballsBowled || 0;

        if (h.runs >= 100) {
          totalCenturies++;
        } else if (h.runs >= 50) {
          totalFifties++;
        }

        if ((h.runs || 0) > highestScore) {
          highestScore = h.runs;
        }

        if (h.ballsBowled > 0 || h.wickets > 0 || h.runsConceded > 0) {
          bowledAtLeastOnce = true;
          const w = h.wickets || 0;
          const r = h.runsConceded || 0;
          if (w > bestWickets || (w === bestWickets && r < bestRunsConceded)) {
            bestWickets = w;
            bestRunsConceded = r;
          }
        }
      });
      const strikeRate = totalBalls > 0 ? parseFloat(((totalRuns / totalBalls) * 100).toFixed(2)) : 0;
      const economy = totalBallsBowled > 0 ? parseFloat((totalRunsConceded / (totalBallsBowled / 6)).toFixed(2)) : 0;
      const bestBowling = bowledAtLeastOnce ? `${bestWickets}/${bestRunsConceded}` : "-";

      const updatedPlayer = {
        ...player,
        matchesPlayed,
        matchesWon,
        totalRuns,
        totalBalls,
        totalFours,
        totalSixes,
        totalWickets,
        totalRunsConceded,
        strikeRate,
        economy,
        highestScore,
        bestBowling,
        commonMatchesPlayed,
        totalFifties,
        totalCenturies
      };
      await saveDoc("players", updatedPlayer);
    }
  }

  drawContributionChart(inn) {
    const canvas = document.getElementById("contributionCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const data = [];
    Object.values(inn.batting).forEach(bat => {
      if (bat.runs > 0 || (bat.status !== "yet to bat" && bat.balls > 0)) {
        const p = this.engine.player(bat.playerId);
        data.push({
          label: p ? p.name : `Player ${bat.playerId.substring(0, 5)}`,
          runs: bat.runs
        });
      }
    });

    if (inn.extras > 0) {
      data.push({
        label: "Extras",
        runs: inn.extras
      });
    }

    const totalRuns = inn.totalRuns || 0;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (totalRuns === 0) {
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) / 2 - 10, 0, 2 * Math.PI);
      ctx.fillStyle = "#e0e0e0";
      ctx.fill();
      ctx.fillStyle = "#666";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No runs scored yet", canvas.width / 2, canvas.height / 2);
      const legend = document.getElementById("contributionLegend");
      if (legend) legend.innerHTML = "";
      return;
    }

    const colors = [
      "#4f46e5", // Indigo
      "#06b6d4", // Cyan
      "#10b981", // Emerald
      "#f59e0b", // Amber
      "#ef4444", // Red
      "#ec4899", // Pink
      "#8b5cf6", // Violet
      "#14b8a6", // Teal
      "#f43f5e", // Rose
      "#3b82f6", // Blue
    ];

    let startAngle = 0;
    const legendItems = [];

    data.forEach((item, index) => {
      const percentage = (item.runs / totalRuns) * 100;
      const angle = (item.runs / totalRuns) * 2 * Math.PI;
      const color = colors[index % colors.length];

      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, canvas.height / 2);
      ctx.arc(
        canvas.width / 2,
        canvas.height / 2,
        Math.min(canvas.width, canvas.height) / 2 - 20,
        startAngle,
        startAngle + angle
      );
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();

      const middleAngle = startAngle + angle / 2;
      const radius = (Math.min(canvas.width, canvas.height) / 2 - 20) * 0.6;
      const x = canvas.width / 2 + Math.cos(middleAngle) * radius;
      const y = canvas.height / 2 + Math.sin(middleAngle) * radius;

      if (percentage > 5) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${item.runs}`, x, y);
      }

      startAngle += angle;

      legendItems.push(`
        <span style="display: inline-flex; align-items: center; gap: 5px;">
          <span style="display: inline-block; width: 12px; height: 12px; border-radius: 3px; background-color: ${color};"></span>
          <span>${item.label}: <strong>${item.runs}</strong> (${percentage.toFixed(1)}%)</span>
        </span>
      `);
    });

    const legend = document.getElementById("contributionLegend");
    if (legend) {
      legend.innerHTML = legendItems.join("");
    }
  }

  openModal(title, html) {
    this.modalTitle.textContent = title;
    this.modalBody.innerHTML = html;
    this.modal.hidden = false;
  }

  closeModal() {
    this.modal.hidden = true;
    this.modalBody.innerHTML = "";
  }

  toast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = "toast";
    if (type === "danger") toast.style.borderLeftColor = "var(--danger)";
    toast.textContent = message;
    $("#toastStack").append(toast);
    setTimeout(() => toast.remove(), 3200);
  }
}

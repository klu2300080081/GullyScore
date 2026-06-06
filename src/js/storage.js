import { COLLECTIONS } from "./models.js";

const STORAGE_KEY = "gully-cricket-scorer-state";

const emptyState = () => ({
  users: [],
  teams: [],
  players: [],
  matches: [],
  innings: [],
  overs: [],
  balls: [],
  scorecards: [],
  settings: [],
  tournaments: [],
  player_match_history: [],
  batting_scorecards: [],
  bowling_scorecards: [],
  team_match_stats: [],
});

export class LocalStore {
  constructor() {
    this.state = this.load();
  }

  load() {
    try {
      return { ...emptyState(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    } catch {
      return emptyState();
    }
  }

  persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  all(collection) {
    return [...this.state[collection]].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  get(collection, id) {
    return this.state[collection].find((item) => item.id === id) || null;
  }

  save(collection, item) {
    if (!COLLECTIONS.includes(collection)) throw new Error(`Unknown collection: ${collection}`);
    const idx = this.state[collection].findIndex((row) => row.id === item.id);
    const next = { ...item, updatedAt: new Date().toISOString() };
    if (idx >= 0) this.state[collection][idx] = next;
    else this.state[collection].push(next);
    this.persist();
    return next;
  }

  delete(collection, id) {
    this.state[collection] = this.state[collection].filter((item) => item.id !== id);
    this.persist();
  }

  seedIfEmpty() {
    if (this.state.players.length || this.state.teams.length) return;
    const namesA = ["Ravi", "Arjun", "Kiran", "Sameer", "Dev", "Manoj"];
    const namesB = ["Rahul", "Vikram", "Nikhil", "Surya", "Aman", "Ravi"];
    const players = [...new Set([...namesA, ...namesB])].map((name) => ({
      id: `player_${name.toLowerCase()}`,
      name,
      mobile: "",
      email: "",
      createdAt: new Date().toISOString(),
      matchesPlayed: 0,
      matchesWon: 0,
      totalRuns: 0,
      totalBalls: 0,
      totalFours: 0,
      totalSixes: 0,
      totalWickets: 0,
      totalRunsConceded: 0,
      strikeRate: 0,
      economy: 0,
      highestScore: 0,
      bestBowling: "-",
      isCommonPlayer: name === "Ravi"
    }));
    const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
    this.state.players = players;
    this.state.teams = [
      { id: "team_street_kings", name: "Street Kings", playerIds: namesA.map((n) => byName[n]), createdAt: new Date().toISOString() },
      { id: "team_lane_legends", name: "Lane Legends", playerIds: namesB.map((n) => byName[n]), createdAt: new Date().toISOString() },
    ];
    this.state.tournaments = [
      {
        id: "tournament_gully_champions",
        tournamentName: "Gully Champions Trophy 2026",
        description: "Ultimate local street cricket tournament with custom rules and baby overs.",
        location: "KL Ground",
        startDate: "2026-06-01",
        endDate: "2026-06-10",
        status: "live",
        totalTeams: 2,
        totalMatches: 0,
        winnerTeamId: "",
        createdBy: "user",
        createdAt: new Date().toISOString()
      }
    ];
    this.persist();
  }
}

export const store = new LocalStore();

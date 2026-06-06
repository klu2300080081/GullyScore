export const COLLECTIONS = [
  "users",
  "teams",
  "players",
  "matches",
  "innings",
  "overs",
  "balls",
  "scorecards",
  "settings",
  "tournaments",
  "player_match_history",
  "batting_scorecards",
  "bowling_scorecards",
  "team_match_stats",
];

export const BALL_EVENTS = [
  "0", "1", "2", "3", "4", "6",
  "NB", "NB+1", "NB+2", "NB+3", "NB+4", "NB+6",
  "WD", "WD+1", "WD+2", "WD+3", "WD+4",
  "BYE+1", "BYE+2", "BYE+3", "BYE+4",
  "LB+1", "LB+2", "LB+3", "LB+4",
  "W",
  "RO-S+0", "RO-S+1", "RO-S+2", "RO-S+3", "RO-S+4",
  "RO-NS+0", "RO-NS+1", "RO-NS+2", "RO-NS+3", "RO-NS+4",
  "RETIRED", "ROTATE", "DB", "UNDO",
];

export const DEFAULT_SETTINGS = {
  totalOvers: 6,
  extrasEnabled: true,
  byesEnabled: true,
  singleBattingMode: false,
  allowBabyOvers: true,
  bowlerOverLimit: 2,
  allowConsecutiveOvers: false,
  lastManStanding: true,
};

export function uid(prefix = "id") {
  return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`;
}

export function makePlayer({ name, mobile = "", email = "", isCommonPlayer = false }) {
  return {
    id: uid("player"),
    name: name.trim(),
    mobile: mobile.trim(),
    email: email.trim(),
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
    isCommonPlayer: !!isCommonPlayer,
    commonMatchesPlayed: 0,
    totalFifties: 0,
    totalCenturies: 0,
  };
}

export function makeTeam({ name, playerIds = [], captainId = "" }) {
  return {
    id: uid("team"),
    name: name.trim(),
    playerIds: [...new Set(playerIds)],
    captainId: captainId,
    createdAt: new Date().toISOString(),
  };
}

export function makeMatch({ tournamentId = "", teamAId, teamBId, settings, tossWinnerId, tossChoice }) {
  return {
    id: uid("match"),
    tournamentId,
    teamAId,
    teamBId,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    tossWinnerId,
    tossChoice,
    status: "setup",
    inningsIndex: 0,
    innings: [],
    result: "",
    winnerTeamId: "",
    totalRuns: 0,
    totalWickets: 0,
    totalFours: 0,
    totalSixes: 0,
    mvpBatsmanId: "",
    mvpBowlerId: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function makeTournament({ name, description = "", location = "", startDate = "", endDate = "", status = "setup", totalTeams = 0, totalMatches = 0 }) {
  return {
    id: uid("tournament"),
    tournamentName: name.trim(),
    description: description.trim(),
    location: location.trim(),
    startDate: startDate,
    endDate: endDate,
    status,
    totalTeams,
    totalMatches,
    winnerTeamId: "",
    createdBy: "user",
    createdAt: new Date().toISOString(),
  };
}

export class WicketFallen {
  constructor({ wicketNumber, batsmanId, bowlerId, cause, overNumber, ballInOver, fielderId = "" }) {
    this.wicketNumber = wicketNumber;
    this.batsmanId = batsmanId;
    this.bowlerId = bowlerId;
    this.cause = cause;
    this.overNumber = overNumber;
    this.ballInOver = ballInOver;
    this.fielderId = fielderId;
  }
}


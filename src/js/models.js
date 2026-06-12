export const COLLECTIONS = [
  "users",
  "teams",
  "players",
  "matches",
  "adminRequests",
  "guestClaims",
  "notifications"
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
  return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11)}`;
}

export function makeUser({ uid: authUid, name, email, mobile, gender, role = "player" }) {
  return {
    id: authUid,
    authUid,
    name: name.trim(),
    email: email.trim(),
    mobile: mobile.trim(),
    gender,
    role, // 'superadmin' | 'admin' | 'player'
    createdAt: new Date().toISOString()
  };
}

export function makePlayer({ name, mobile = "", email = "", gender = "Other", isGuest = false, createdByAdminId = "", userId = "" }) {
  return {
    id: uid("player"),
    userId: userId || null,
    name: name.trim(),
    mobile: mobile.trim(),
    email: email.trim(),
    gender,
    isGuest: !!isGuest,
    createdByAdminId: createdByAdminId || null,
    claimedBy: null,
    claimedAt: null,
    claimable: !isGuest, // Regular players are not claimable; guest players are claimable when created, and become false when claimed.
    teamIds: [],
    createdAt: new Date().toISOString(),
    
    // Core batting statistics
    matchesPlayed: 0,
    matchesWon: 0,
    totalRuns: 0,
    totalBalls: 0,
    totalFours: 0,
    totalSixes: 0,
    strikeRate: 0,
    highestScore: 0,
    totalFifties: 0,
    totalCenturies: 0,
    
    // Core bowling statistics
    totalWickets: 0,
    totalRunsConceded: 0,
    totalOversBowled: 0, // In decimal format or ball count
    totalBallsBowled: 0,
    economy: 0,
    bestBowling: "-", // e.g. "3/12"
    
    // Umpiring/Creation stats
    matchesAsUmpire: 0,
    teamsCreatedCount: 0,
    mvpCount: 0 // Track total MVP Bat/Bowl awards
  };
}

export function makeTeam({ name, playerIds = [], captainId = "", createdByAdminId = "" }) {
  return {
    id: uid("team"),
    name: name.trim(),
    playerIds: [...new Set(playerIds)],
    captainId: captainId,
    createdByAdminId: createdByAdminId,
    captainHistory: captainId ? [{ captainId, fromDate: new Date().toISOString(), toDate: null }] : [],
    createdAt: new Date().toISOString(),
    
    // Team stats
    matchesPlayed: 0,
    matchesWon: 0,
    matchesLost: 0,
    matchesTied: 0,
    totalRunsScored: 0,
    totalOversFaced: 0,
    totalRunsConceded: 0,
    totalOversBowled: 0,
    netRunRate: 0
  };
}

export function makeMatch({ tournamentId = "", teamAId, teamBId, settings, umpireId = "" }) {
  return {
    id: uid("match"),
    tournamentId,
    teamAId,
    teamBId,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    umpireId, // the admin who created the match
    status: "setup", // 'setup' | 'live' | 'completed'
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
    updatedAt: new Date().toISOString()
  };
}

export function makeTournament({ name, description = "", location = "", startDate = "", endDate = "", structure = "None", createdByAdminId = "" }) {
  return {
    id: uid("tournament"),
    tournamentName: name.trim(),
    description: description.trim(),
    location: location.trim(),
    startDate,
    endDate,
    structure, // 'None' | 'T20' | 'Knockout' | 'ICC-style'
    status: "ongoing", // 'ongoing' | 'completed'
    teamIds: [],
    createdByAdminId,
    champion: null,
    runnerUp: null,
    manOfTheSeries: null,
    createdAt: new Date().toISOString()
  };
}

export function makeGuestClaim({ guestPlayerId, claimantPlayerId, adminId }) {
  return {
    id: uid("claim"),
    guestPlayerId,
    claimantPlayerId,
    adminId, // Only the admin who created the guest can approve
    status: "pending", // 'pending' | 'approved' | 'rejected'
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    notifiedClaimant: false
  };
}

export function makeAdminRequest({ playerId }) {
  return {
    id: uid("request"),
    playerId,
    status: "pending", // 'pending' | 'approved' | 'rejected'
    createdAt: new Date().toISOString()
  };
}

export function makeNotification({ message, type, linkTo = "" }) {
  return {
    id: uid("notif"),
    message: message.trim(),
    type, // 'claim_request' | 'claim_approved' | 'claim_rejected' | 'admin_request_approved' | 'admin_request_rejected'
    read: false,
    linkTo,
    createdAt: new Date().toISOString()
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

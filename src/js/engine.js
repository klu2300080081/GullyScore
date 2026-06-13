import { BALL_EVENTS, DEFAULT_SETTINGS, uid } from "./models.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const oversStr = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;

const matchSnapshots = new Map();

export class MatchEngine {
  constructor(match, teams, players) {
    this.match = match;
    this.teams = teams;
    this.players = players;
    if (!matchSnapshots.has(this.match.id)) {
      matchSnapshots.set(this.match.id, []);
    }
    this.snapshots = matchSnapshots.get(this.match.id);
    this.notice = null;
    if (!this.match.innings.length) this.createFirstInnings();
  }

  player(id) { return this.players.find((p) => p.id === id); }
  team(id) { return this.teams.find((t) => t.id === id); }
  teamPlayers(teamId) {
    const t = this.team(teamId);
    if (!t) return [];
    return t.playerIds.map((id) => this.player(id)).filter(Boolean);
  }

  battingOrder() {
    const tossWonBat = this.match.tossChoice === "Bat";
    const firstBat = tossWonBat ? this.match.tossWinnerId : this.otherTeamId(this.match.tossWinnerId);
    const firstBowl = this.otherTeamId(firstBat);
    return [
      { battingTeamId: firstBat, bowlingTeamId: firstBowl, target: null },
      { battingTeamId: firstBowl, bowlingTeamId: firstBat, target: (this.match.innings[0]?.totalRuns || 0) + 1 },
    ];
  }

  otherTeamId(teamId) {
    return teamId === this.match.teamAId ? this.match.teamBId : this.match.teamAId;
  }

  createFirstInnings() {
    const order = this.battingOrder()[0];
    this.match.innings = [this.newInnings(1, order)];
    this.match.status = "live";
  }

  newInnings(number, order) {
    const battingPlayers = this.teamPlayers(order.battingTeamId);
    return {
      id: uid("innings"),
      inningsNumber: number,
      battingTeamId: order.battingTeamId,
      bowlingTeamId: order.bowlingTeamId,
      target: order.target,
      totalRuns: 0,
      wickets: 0,
      extras: 0,
      legalBallsTotal: 0,
      strikerId: null,
      nonStrikerId: null,
      currentBowlerId: null,
      currentBowlerBallsRemaining: 0,
      currentOver: null,
      lastBowlerId: null,
      dismissedPlayerIds: [],
      retiredPlayerIds: [],
      bowlerBalls: {},
      batting: Object.fromEntries(battingPlayers.map((p, index) => [p.id, {
        playerId: p.id,
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        status: "yet to bat",
      }])),
      bowling: {},
      balls: [],
      completedOvers: [],
      startTime: null,
      endTime: null,
      isPaused: false,
      lastPauseTime: null,
      pausedDuration: 0,
      active: true,
    };
  }

  currentInnings() {
    return this.match.innings[this.match.inningsIndex || 0];
  }

  availableBatsmen() {
    const innings = this.currentInnings();
    return Object.values(innings.batting)
      .filter((rec) => rec.status === "yet to bat" || rec.status === "retired")
      .map((rec) => this.player(rec.playerId))
      .filter(Boolean);
  }

  setBatsmen(strikerId, nonStrikerId = null) {
    const innings = this.currentInnings();
    if (!strikerId) throw new Error("Select a striker.");
    if (!this.match.settings.singleBattingMode && strikerId === nonStrikerId) {
      throw new Error("Striker and non-striker must be different.");
    }
    const availablePartner = Object.values(innings.batting)
      .some((rec) => rec.playerId !== strikerId && (rec.status === "yet to bat" || rec.status === "retired"));
    if (!this.match.settings.singleBattingMode && !nonStrikerId && availablePartner) {
      throw new Error("Select a non-striker.");
    }
    [innings.strikerId, innings.nonStrikerId].filter(Boolean).forEach((id) => {
      if (innings.batting[id]?.status === "batting") innings.batting[id].status = "yet to bat";
    });
    innings.strikerId = strikerId;
    innings.nonStrikerId = this.match.settings.singleBattingMode ? null : nonStrikerId;
    innings.batting[strikerId].status = "batting";
    if (innings.nonStrikerId) innings.batting[innings.nonStrikerId].status = "batting";

    if (innings.strikerId === innings.currentBowlerId || innings.nonStrikerId === innings.currentBowlerId) {
      innings.currentBowlerId = null;
      this.notice = "Common player stopped bowling to bat. Select a new bowler.";
    }

    // Manage partnership
    if (innings.strikerId && innings.nonStrikerId) {
      const newPair = [innings.strikerId, innings.nonStrikerId].sort();
      if (!innings.currentPartnership || 
          innings.currentPartnership.playerIds[0] !== newPair[0] || 
          innings.currentPartnership.playerIds[1] !== newPair[1]) {
        innings.currentPartnership = {
          playerIds: newPair,
          runs: 0,
          balls: 0
        };
      }
    } else {
      innings.currentPartnership = null;
    }

    this.notice = this.notice || "Batsmen selected";
  }

  inningsBallsLimit() {
    return this.match.settings.totalOvers * 6;
  }

  inningsBallsRemaining(innings = this.currentInnings()) {
    return Math.max(0, this.inningsBallsLimit() - innings.legalBallsTotal);
  }

  scoreSummary(innings = this.currentInnings()) {
    const need = innings.target ? Math.max(0, innings.target - innings.totalRuns) : null;
    const crr = innings.legalBallsTotal ? (innings.totalRuns / (innings.legalBallsTotal / 6)).toFixed(2) : "0.00";
    const rrr = need !== null && this.inningsBallsRemaining(innings) > 0
      ? (need / (this.inningsBallsRemaining(innings) / 6)).toFixed(2)
      : "0.00";
    return {
      score: `${innings.totalRuns}/${innings.wickets}`,
      overs: oversStr(innings.legalBallsTotal),
      crr,
      rrr,
      need,
      recent: innings.balls.slice(-10).reverse(),
    };
  }

  canSelectSpell(bowlerId, spellBalls) {
    const innings = this.currentInnings();
    const settings = this.match.settings;
    const limit = settings.bowlerOverLimit * 6;
    const bowled = innings.bowlerBalls[bowlerId] || 0;
    if (bowled + spellBalls > limit) return false;
    if (!settings.allowConsecutiveOvers && innings.lastBowlerId === bowlerId && innings.currentBowlerBallsRemaining <= 0) return false;
    return true;
  }

  availableSpellTypes() {
    const innings = this.currentInnings();
    if (innings.currentOver) {
      // We are completing an over mid-over (after a bowler retirement)
      const ballsLeftInOver = innings.currentBowlerBallsRemaining;
      return [{ label: "Complete Over", balls: ballsLeftInOver, isBaby: innings.currentOver.isBaby }];
    }
    const remaining = this.inningsBallsRemaining();
    if (remaining <= 3) return [{ label: "Baby Over", balls: remaining, isBaby: true }];
    if (remaining < 6) return [{ label: "Baby Over", balls: 3, isBaby: true }];
    if (!this.match.settings.allowBabyOvers) return [{ label: "Normal Over", balls: 6, isBaby: false }];
    return [
      { label: "Normal Over", balls: 6, isBaby: false },
      { label: "Baby Over", balls: 3, isBaby: true },
    ];
  }

  setBowlerSpell(bowlerId, spellBalls, isBaby) {
    const innings = this.currentInnings();
    if (!this.canSelectSpell(bowlerId, spellBalls)) throw new Error("Bowler is not eligible for this spell.");
    innings.currentBowlerId = bowlerId;
    innings.currentBowlerBallsRemaining = spellBalls;
    
    if (innings.currentOver) {
      // Mid-over bowler replacement
      innings.currentOver.bowlerId = bowlerId;
    } else {
      // Starting a new over
      innings.currentOver = {
        inningsOverNumber: Math.floor(innings.legalBallsTotal / 6) + 1,
        bowlerId,
        isBaby,
        ballsRequired: spellBalls,
        inningsLegalBallsInOver: innings.legalBallsTotal % 6,
        totalBalls: 0,
        runs: 0,
        wickets: 0,
      };
    }
    this.ensureBowlerRecord(innings, bowlerId);
  }

  retireBowler() {
    const innings = this.currentInnings();
    if (!innings.currentBowlerId) throw new Error("No active bowler to retire.");
    this.saveSnapshot();
    innings.currentBowlerId = null;
    this.notice = "Bowler retired. Select Next Bowler to complete the over.";
  }

  applyEvent(event, dismissalInfo = null) {
    if (!this.isSupportedEvent(event)) throw new Error(`Unsupported event: ${event}`);
    if (event === "UNDO") return this.undo();
    if (event === "ROTATE") return this.rotateStrike(true);
    if (event === "DB") return this.deadBall();
    if (event === "RETIRED") return this.retireStriker();
    if (event === "RETIRE_BOWLER") return this.retireBowler();

    const innings = this.currentInnings();
    if (!innings.strikerId) throw new Error("Select batsman before scoring.");
    if (!innings.currentBowlerId || !innings.currentOver) throw new Error("Select a bowler first.");
    if (innings.currentBowlerBallsRemaining <= 0) throw new Error("Select the next bowler before scoring.");
    
    if (innings.isPaused) throw new Error("Match is paused. Resume to record events.");

    this.saveSnapshot();
    if (!innings.startTime) {
      innings.startTime = Date.now();
    }
    const parsed = this.parseEvent(event);
    this.scoreBall(event, parsed, dismissalInfo);
    this.checkEndState();
    return this.notice;
  }

  isSupportedEvent(event) {
    return BALL_EVENTS.includes(event)
      || /^CUSTOM\+\d+$/.test(event)
      || /^WD\+\d+$/.test(event)
      || /^NB\+\d+$/.test(event)
      || /^BYE\+\d+$/.test(event)
      || /^LB\+\d+$/.test(event)
      || event === "RETIRE_BOWLER";
  }

  parseEvent(event) {
    const extras = this.match.settings.extrasEnabled;
    const byes = this.match.settings.byesEnabled;
    const simple = { "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "6": 6 };
    if (event in simple) {
      const runs = simple[event];
      return { teamRuns: runs, batsmanRuns: runs, legal: true, wicket: false, rotate: runs % 2 === 1 };
    }
    if (event === "W") return { teamRuns: 0, batsmanRuns: 0, legal: true, wicket: true, rotate: false };
    if (event.startsWith("CUSTOM+")) {
      const runs = Number(event.split("+")[1] || 0);
      return { teamRuns: runs, batsmanRuns: runs, legal: true, wicket: false, rotate: runs % 2 === 1 };
    }
    if (event.startsWith("NB")) {
      const bat = Number(event.split("+")[1] || 0);
      return { teamRuns: bat + (extras ? 1 : 0), batsmanRuns: bat, legal: false, wicket: false, rotate: bat % 2 === 1 };
    }
    if (event.startsWith("WD")) {
      const bat = extras ? Number(event.split("+")[1] || 0) : 0;
      return { teamRuns: extras ? bat + 1 : 0, batsmanRuns: bat, legal: false, wicket: false, rotate: false };
    }
    if (event.startsWith("BYE") || event.startsWith("LB")) {
      const runs = byes ? Number(event.split("+")[1] || 0) : 0;
      return { teamRuns: runs, batsmanRuns: 0, legal: true, wicket: false, rotate: runs % 2 === 1 };
    }
    if (event.startsWith("RO-S") || event.startsWith("RO-NS")) {
      const runs = Number(event.split("+")[1] || 0);
      return { teamRuns: runs, batsmanRuns: runs, legal: true, wicket: false, rotate: false, runOut: event.startsWith("RO-S") ? "striker" : "nonStriker" };
    }
    throw new Error(`Cannot parse event: ${event}`);
  }

  scoreBall(event, parsed, dismissalInfo = null) {
    const innings = this.currentInnings();
    const bowlerId = innings.currentBowlerId;
    const strikerId = innings.strikerId;
    const over = innings.currentOver;
    const isNb = event.startsWith("NB");
    const isWd = event.startsWith("WD");

    innings.totalRuns += parsed.teamRuns;
    innings.extras += parsed.teamRuns - parsed.batsmanRuns;

    // Update partnership
    if (innings.currentPartnership) {
      innings.currentPartnership.runs += parsed.teamRuns;
      if (parsed.legal) {
        innings.currentPartnership.balls += 1;
      }
    }

    const bat = innings.batting[strikerId];
    if (bat) {
      if (parsed.legal) bat.balls += 1;
      bat.runs += parsed.batsmanRuns;
      if (parsed.batsmanRuns === 4) bat.fours += 1;
      if (parsed.batsmanRuns === 6) bat.sixes += 1;
    }

    const bowl = this.ensureBowlerRecord(innings, bowlerId);
    bowl.runsConceded += parsed.teamRuns;
    if (parsed.teamRuns === 0) {
      bowl.dotBalls = (bowl.dotBalls || 0) + 1;
    }
    if (isNb || isWd) bowl.extras += this.match.settings.extrasEnabled ? 1 : 0;
    if (parsed.legal) {
      bowl.legalBalls += 1;
      innings.legalBallsTotal += 1;
      innings.bowlerBalls[bowlerId] = (innings.bowlerBalls[bowlerId] || 0) + 1;
      over.inningsLegalBallsInOver += 1;
      innings.currentBowlerBallsRemaining -= 1;
    }
    over.totalBalls += 1;
    over.runs += parsed.teamRuns;

    if (parsed.wicket) {
      bowl.wickets += 1;
      this.dismissPlayer("striker", 0, dismissalInfo, parsed.legal);
    }
    if (parsed.runOut) {
      bowl.wickets += 1;
      this.dismissPlayer(parsed.runOut, parsed.teamRuns, dismissalInfo, parsed.legal);
    }

    innings.balls.push({
      id: uid("ball"),
      matchId: this.match.id,
      innings: innings.inningsNumber,
      ballNumber: innings.balls.length + 1,
      overDisplay: oversStr(innings.legalBallsTotal),
      batsman: this.player(strikerId)?.name || "-",
      bowler: this.player(bowlerId)?.name || "-",
      event,
      runs: parsed.teamRuns,
      legalBall: parsed.legal,
      timestamp: new Date().toISOString(),
    });

    if (parsed.rotate && !parsed.wicket && !parsed.runOut && !this.match.settings.singleBattingMode) {
      this.rotateStrike(false);
    }

    if (parsed.legal && over.inningsLegalBallsInOver >= 6) {
      this.handleOverBoundary();
    } else if (parsed.legal && innings.currentBowlerBallsRemaining <= 0) {
      innings.completedOvers.push(innings.currentOver);
      innings.lastBowlerId = bowlerId;
      innings.currentOver = null;
      innings.currentBowlerId = null;
      this.notice = "Select Next Bowler";
    }
  }

  ensureBowlerRecord(innings, bowlerId) {
    innings.bowling[bowlerId] ||= { playerId: bowlerId, legalBalls: 0, runsConceded: 0, wickets: 0, extras: 0, dotBalls: 0 };
    return innings.bowling[bowlerId];
  }

  dismissPlayer(which, completedRuns = 0, dismissalInfo = null, isLegal = true) {
    const innings = this.currentInnings();
    const key = which === "striker" ? "strikerId" : "nonStrikerId";
    const outId = innings[key];
    if (!outId) return;
    innings.batting[outId].status = "out";
    
    // Save dismissal info to batsman record
    const info = dismissalInfo || {
      cause: "Bowled",
      bowlerId: innings.currentBowlerId,
      fielderId: ""
    };
    innings.batting[outId].dismissalInfo = info;

    // Maintain wicketsFallen timeline (plain object — NOT a class instance, for Firestore compatibility)
    innings.wicketsFallen ||= [];
    const wicketNum = innings.wickets + 1;
    
    // Calculate over and ball numbers accurately
    const ballIndex = isLegal ? innings.legalBallsTotal : innings.legalBallsTotal + 1;
    const overNum = Math.floor((ballIndex - 1) / 6);
    const ballInOver = ((ballIndex - 1) % 6) + 1;

    innings.wicketsFallen.push({
      wicketNumber: wicketNum,
      batsmanId: outId,
      bowlerId: info.bowlerId,
      cause: info.cause,
      fielderId: info.fielderId || "",
      overNumber: overNum,
      ballInOver: ballInOver
    });

    innings.dismissedPlayerIds.push(outId);
    innings.wickets += 1;
    innings.currentPartnership = null;

    if (which === "striker") {
      innings.strikerId = null;
      if (completedRuns % 2 === 1 && !this.match.settings.singleBattingMode) {
        innings.strikerId = innings.nonStrikerId;
        innings.nonStrikerId = null;
      } else {
        innings.strikerId = null;
      }
      if (!innings.strikerId && this.match.settings.lastManStanding && innings.nonStrikerId && this.availableBatsmen().length === 0) {
        innings.strikerId = innings.nonStrikerId;
        innings.nonStrikerId = null;
      }
    } else {
      innings.nonStrikerId = null;
      if (completedRuns % 2 === 1 && !this.match.settings.singleBattingMode) {
        innings.nonStrikerId = innings.strikerId;
        innings.strikerId = null;
      }
    }
    this.notice = "Select Next Batsman";
  }

  nextBatsmanId() {
    const innings = this.currentInnings();
    const next = Object.values(innings.batting).find((rec) => rec.status === "yet to bat");
    if (!next) return null;
    next.status = "batting";
    return next.playerId;
  }

  retireStriker() {
    const innings = this.currentInnings();
    if (!innings.strikerId) return;
    this.saveSnapshot();
    innings.batting[innings.strikerId].status = "retired";
    innings.retiredPlayerIds.push(innings.strikerId);
    innings.strikerId = null;
    innings.currentPartnership = null;
    this.notice = "Select Next Batsman";
  }

  rotateStrike(manual) {
    const innings = this.currentInnings();
    if (this.match.settings.singleBattingMode) {
      this.notice = "Single batting mode keeps the same striker.";
      return;
    }
    if (!innings.strikerId || !innings.nonStrikerId) {
      this.notice = "Last man standing keeps the striker.";
      return;
    }
    if (manual) this.saveSnapshot();
    [innings.strikerId, innings.nonStrikerId] = [innings.nonStrikerId, innings.strikerId];
    this.notice = "Strike rotated";
  }

  deadBall() {
    const innings = this.currentInnings();
    this.saveSnapshot();
    innings.balls.push({
      id: uid("ball"),
      matchId: this.match.id,
      innings: innings.inningsNumber,
      ballNumber: innings.balls.length + 1,
      overDisplay: oversStr(innings.legalBallsTotal),
      batsman: this.player(innings.strikerId)?.name || "-",
      bowler: this.player(innings.currentBowlerId)?.name || "-",
      event: "DB",
      runs: 0,
      legalBall: false,
      timestamp: new Date().toISOString(),
    });
    this.notice = "Dead ball recorded";
  }

  handleOverBoundary() {
    const innings = this.currentInnings();
    innings.completedOvers.push(innings.currentOver);
    innings.lastBowlerId = innings.currentOver.bowlerId;
    if (!this.match.settings.singleBattingMode) this.rotateStrike(false);
    this.notice = "Over Completed";
    if (innings.currentBowlerBallsRemaining > 0) {
      innings.currentOver = {
        ...innings.currentOver,
        inningsOverNumber: Math.floor(innings.legalBallsTotal / 6) + 1,
        inningsLegalBallsInOver: 0,
        totalBalls: 0,
        runs: 0,
        wickets: 0,
      };
      this.notice = `${this.notice}. Bowler continues ${innings.currentBowlerBallsRemaining} ball(s).`;
    } else {
      innings.currentOver = null;
      innings.currentBowlerId = null;
      this.notice = "Over Completed. Select Next Bowler";
    }
  }

  checkEndState() {
    const innings = this.currentInnings();
    const battingCount = this.teamPlayers(innings.battingTeamId).length;
    const nextAvailable = Object.values(innings.batting).some((rec) => rec.status === "yet to bat");
    const allOut = this.match.settings.singleBattingMode || this.match.settings.lastManStanding
      ? !innings.strikerId && !nextAvailable
      : innings.wickets >= Math.max(0, battingCount - 1);
    const ballsDone = innings.legalBallsTotal >= this.inningsBallsLimit();
    const targetChased = innings.target && innings.totalRuns >= innings.target;
    if (!allOut && !ballsDone && !targetChased) return;
    innings.active = false;
    innings.endTime = Date.now();
    Object.values(innings.batting).forEach((rec) => {
      if (rec.status === "batting") rec.status = "not out";
    });
    if (this.match.inningsIndex === 0) {
      const order = this.battingOrder()[1];
      this.match.innings.push(this.newInnings(2, order));
      this.match.inningsIndex = 1;
      this.notice = "Start Second Innings";
    } else {
      this.match.status = "completed";
      this.match.result = this.resultText();
      
      // Calculate match total runs, wickets, fours, sixes
      let totalRuns = 0;
      let totalWickets = 0;
      let fours = 0;
      let sixes = 0;
      this.match.innings.forEach(inn => {
        totalRuns += inn.totalRuns || 0;
        totalWickets += inn.wickets || 0;
        inn.balls.forEach(b => {
          if (b.event === "4" || b.event.endsWith("+4")) fours++;
          if (b.event === "6" || b.event.endsWith("+6")) sixes++;
        });
      });
      this.match.totalRuns = totalRuns;
      this.match.totalWickets = totalWickets;
      this.match.totalFours = fours;
      this.match.totalSixes = sixes;
      
      // Winner team ID
      const [one, two] = this.match.innings;
      if (two.totalRuns > one.totalRuns) {
        this.match.winnerTeamId = two.battingTeamId;
      } else if (one.totalRuns > two.totalRuns) {
        this.match.winnerTeamId = one.battingTeamId;
      } else {
        this.match.winnerTeamId = ""; // Tied
      }

      // Calculate batsman MVP (most runs, strike rate tie-breaker)
      let bestBatsmanId = "";
      let maxBatsmanRuns = -1;
      let bestBatsmanSR = -1;

      const batsmanStats = {};
      this.match.innings.forEach(inn => {
        Object.entries(inn.batting).forEach(([pid, rec]) => {
          if (rec.status !== "yet to bat" && rec.balls > 0) {
            batsmanStats[pid] ||= { runs: 0, balls: 0 };
            batsmanStats[pid].runs += rec.runs;
            batsmanStats[pid].balls += rec.balls;
          }
        });
      });

      Object.entries(batsmanStats).forEach(([pid, stat]) => {
        const sr = stat.balls > 0 ? (stat.runs / stat.balls) * 100 : 0;
        if (stat.runs > maxBatsmanRuns) {
          maxBatsmanRuns = stat.runs;
          bestBatsmanSR = sr;
          bestBatsmanId = pid;
        } else if (stat.runs === maxBatsmanRuns) {
          if (sr > bestBatsmanSR) {
            bestBatsmanSR = sr;
            bestBatsmanId = pid;
          }
        }
      });

      // Calculate bowler MVP (most wickets, runs conceded tie-breaker)
      let bestBowlerId = "";
      let maxBowlerWickets = -1;
      let minBowlerRunsConceded = Infinity;

      const bowlerStats = {};
      this.match.innings.forEach(inn => {
        Object.entries(inn.bowling).forEach(([pid, rec]) => {
          if (rec.legalBalls > 0) {
            bowlerStats[pid] ||= { wickets: 0, runsConceded: 0 };
            bowlerStats[pid].wickets += rec.wickets;
            bowlerStats[pid].runsConceded += rec.runsConceded;
          }
        });
      });

      Object.entries(bowlerStats).forEach(([pid, stat]) => {
        if (stat.wickets > maxBowlerWickets) {
          maxBowlerWickets = stat.wickets;
          minBowlerRunsConceded = stat.runsConceded;
          bestBowlerId = pid;
        } else if (stat.wickets === maxBowlerWickets) {
          if (stat.runsConceded < minBowlerRunsConceded) {
            minBowlerRunsConceded = stat.runsConceded;
            bestBowlerId = pid;
          }
        }
      });

      this.match.mvpBatsmanId = bestBatsmanId;
      this.match.mvpBowlerId = bestBowlerId;
      
      this.notice = "Match complete. View Match Summary";
    }
  }

  resultText() {
    const [one, two] = this.match.innings;
    const teamOne = this.team(one.battingTeamId)?.name;
    const teamTwo = this.team(two.battingTeamId)?.name;
    if (two.totalRuns > one.totalRuns) return `${teamTwo} won by ${this.teamPlayers(two.battingTeamId).length - two.wickets} wicket(s)`;
    if (one.totalRuns > two.totalRuns) return `${teamOne} won by ${one.totalRuns - two.totalRuns} run(s)`;
    return "Match tied";
  }

  declareTie() {
    this.saveSnapshot();
    const innings = this.currentInnings();
    if (innings) {
      innings.active = false;
      Object.values(innings.batting).forEach((rec) => {
        if (rec.status === "batting") rec.status = "not out";
      });
    }

    this.match.status = "completed";
    this.match.result = "Match Tied";
    this.match.winnerTeamId = "";

    let totalRuns = 0;
    let totalWickets = 0;
    let fours = 0;
    let sixes = 0;
    this.match.innings.forEach(inn => {
      totalRuns += inn.totalRuns || 0;
      totalWickets += inn.wickets || 0;
      inn.balls.forEach(b => {
        if (b.event === "4" || b.event.endsWith("+4")) fours++;
        if (b.event === "6" || b.event.endsWith("+6")) sixes++;
      });
    });
    this.match.totalRuns = totalRuns;
    this.match.totalWickets = totalWickets;
    this.match.totalFours = fours;
    this.match.totalSixes = sixes;

    // Calculate batsman MVP
    let bestBatsmanId = "";
    let maxBatsmanRuns = -1;
    let bestBatsmanSR = -1;
    const batsmanStats = {};
    this.match.innings.forEach(inn => {
      Object.entries(inn.batting).forEach(([pid, rec]) => {
        if (rec.status !== "yet to bat" && rec.balls > 0) {
          batsmanStats[pid] ||= { runs: 0, balls: 0 };
          batsmanStats[pid].runs += rec.runs;
          batsmanStats[pid].balls += rec.balls;
        }
      });
    });
    Object.entries(batsmanStats).forEach(([pid, stat]) => {
      const sr = stat.balls > 0 ? (stat.runs / stat.balls) * 100 : 0;
      if (stat.runs > maxBatsmanRuns) {
        maxBatsmanRuns = stat.runs;
        bestBatsmanSR = sr;
        bestBatsmanId = pid;
      } else if (stat.runs === maxBatsmanRuns) {
        if (sr > bestBatsmanSR) {
          bestBatsmanSR = sr;
          bestBatsmanId = pid;
        }
      }
    });

    // Calculate bowler MVP
    let bestBowlerId = "";
    let maxBowlerWickets = -1;
    let minBowlerRunsConceded = Infinity;
    const bowlerStats = {};
    this.match.innings.forEach(inn => {
      Object.entries(inn.bowling).forEach(([pid, rec]) => {
        if (rec.legalBalls > 0) {
          bowlerStats[pid] ||= { wickets: 0, runsConceded: 0 };
          bowlerStats[pid].wickets += rec.wickets;
          bowlerStats[pid].runsConceded += rec.runsConceded;
        }
      });
    });
    Object.entries(bowlerStats).forEach(([pid, stat]) => {
      if (stat.wickets > maxBowlerWickets) {
        maxBowlerWickets = stat.wickets;
        minBowlerRunsConceded = stat.runsConceded;
        bestBowlerId = pid;
      } else if (stat.wickets === maxBowlerWickets) {
        if (stat.runsConceded < minBowlerRunsConceded) {
          minBowlerRunsConceded = stat.runsConceded;
          bestBowlerId = pid;
        }
      }
    });

    this.match.mvpBatsmanId = bestBatsmanId;
    this.match.mvpBowlerId = bestBowlerId;
    this.notice = "Match Tied by Scorer";
  }

  saveSnapshot() {
    this.snapshots.push(clone(this.match));
    if (this.snapshots.length > 20) this.snapshots.shift();
  }

  undo() {
    const last = this.snapshots.pop();
    if (!last) {
      this.notice = "Nothing to undo";
      return;
    }
    Object.assign(this.match, last);
    this.notice = "Last ball undone";
  }
}

export { oversStr };

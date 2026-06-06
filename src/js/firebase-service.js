import { firebaseConfig, hasFirebaseConfig } from "./firebase-config.js";
import { store } from "./storage.js";

let app;
let auth;
let db;
let firebaseReady = false;

export async function initFirebase() {
  if (!hasFirebaseConfig()) return { ready: false, reason: "Firebase config not set" };
  const [{ initializeApp }, authFns, firestoreFns] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
  ]);
  app = initializeApp(firebaseConfig);
  auth = authFns.getAuth(app);
  db = firestoreFns.getFirestore(app);
  firebaseReady = true;
  return { ready: true, authFns, firestoreFns };
}

export async function signInGoogle() {
  if (!firebaseReady) return null;
  const { GoogleAuthProvider, signInWithPopup } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  return signInWithPopup(auth, new GoogleAuthProvider());
}

export async function signInAnon() {
  if (!firebaseReady) return null;
  const { signInAnonymously } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  return signInAnonymously(auth);
}

export function currentUser() {
  return auth?.currentUser || null;
}

export async function saveDoc(collectionName, item) {
  const local = store.save(collectionName, item);
  if (!firebaseReady) return local;
  const { doc, setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  await setDoc(doc(db, collectionName, item.id), { ...item, updatedAt: serverTimestamp() }, { merge: true });
  return local;
}

export async function deleteDocById(collectionName, id) {
  store.delete(collectionName, id);
  if (!firebaseReady) return;
  const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  await deleteDoc(doc(db, collectionName, id));
}

export function schemaReference() {
  return {
    users: "{ id, authUid, displayName, email, createdAt }",
    teams: "{ id, name, playerIds[], createdAt, updatedAt }",
    players: "{ id, name, mobile, email, createdAt, matchesPlayed, matchesWon, totalRuns, strikeRate, economy, isCommonPlayer }",
    matches: "{ id, tournamentId, teamAId, teamBId, settings, status, innings[], result, winnerTeamId, totalFours, totalSixes }",
    innings: "{ id, matchId, inningsNumber, battingTeamId, bowlingTeamId, target, scoreState }",
    overs: "{ id, matchId, inningsId, overNumber, bowlerId, isBaby, legalBalls, runs, wickets }",
    balls: "{ id, matchId, inningsId, innings, ballNumber, overDisplay, batsman, bowler, event, runs, legalBall, timestamp }",
    scorecards: "{ id, matchId, inningsId, battingRecords[], bowlingRecords[] }",
    settings: "{ id, userId, theme, defaults }",
    tournaments: "{ id, tournamentName, description, location, status, winnerTeamId, totalTeams, totalMatches }",
    player_match_history: "{ id, playerId, matchId, tournamentId, teamId, runs, balls, fours, sixes, wickets, runsConceded, result }",
    batting_scorecards: "{ id, playerId, matchId, runs, balls, fours, sixes, strikeRate, dismissalType }",
    bowling_scorecards: "{ id, playerId, matchId, overs, maidens, runsConceded, wickets, economy }",
    team_match_stats: "{ id, teamId, matchId, runs, wickets, fours, sixes, overs, runRate }",
  };
}

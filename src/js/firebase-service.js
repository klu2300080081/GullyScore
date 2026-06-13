import { firebaseConfig, hasFirebaseConfig } from "./firebase-config.js";
import { makeUser, makePlayer, makeNotification } from "./models.js";

// Export variables that will be populated after initialization
export let app = null;
export let auth = null;
export let db = null;
export let fStore = null;
export let fAuth = null;
export let firebaseReady = false;

// Global cache of listeners so we can unsubscribe when logging out
const activeListeners = [];

export async function initFirebase() {
  if (!hasFirebaseConfig()) {
    return { ready: false, reason: "Firebase config not set" };
  }
  if (firebaseReady) {
    return { ready: true, authFns: fAuth, firestoreFns: fStore };
  }

  try {
    const [{ initializeApp }, authModule, firestoreModule] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
    ]);

    app = initializeApp(firebaseConfig);
    fAuth = authModule;
    fStore = firestoreModule;
    auth = fAuth.getAuth(app);
    db = fStore.getFirestore(app);
    firebaseReady = true;

    return { ready: true, authFns: fAuth, firestoreFns: fStore };
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    return { ready: false, reason: error.message };
  }
}

// Authentication Helpers
export async function loginUser(email, password) {
  if (!firebaseReady) throw new Error("Firebase not ready");
  const result = await fAuth.signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

export async function registerUser(name, email, mobile, gender, password) {
  if (!firebaseReady) throw new Error("Firebase not ready");

  // Validate uniqueness at client-level
  const emailUnique = await isEmailUnique(email);
  if (!emailUnique) throw new Error("Email address is already registered.");

  const mobileUnique = await isMobileUnique(mobile);
  if (!mobileUnique) throw new Error("Mobile number is already registered.");

  // Create Firebase Auth user
  const result = await fAuth.createUserWithEmailAndPassword(auth, email, password);
  const authUid = result.user.uid;

  // Seeding Super Admin rule
  const role = email === "superadmin006@gmail.com" ? "superadmin" : "player";

  // Auto-create Player profile linked to this User
  const playerProfile = makePlayer({
    name,
    mobile,
    email,
    gender,
    isGuest: false,
    userId: authUid
  });
  await saveDoc("players", playerProfile);

  // Create User document in Firestore
  const userProfile = makeUser({ uid: authUid, name, email, mobile, gender, role });
  userProfile.playerId = playerProfile.id;
  await saveDoc("users", userProfile);

  return result.user;
}

export async function signInAnon() {
  if (!firebaseReady) throw new Error("Firebase not ready");
  const result = await fAuth.signInAnonymously(auth);
  
  // For anonymous players, create a temporary Player record
  const name = `Guest_${result.user.uid.substring(0, 5)}`;
  
  const playerProfile = makePlayer({
    name,
    mobile: "",
    email: "",
    gender: "Other",
    isGuest: false,
    userId: result.user.uid
  });
  await saveDoc("players", playerProfile);

  const userProfile = makeUser({ uid: result.user.uid, name, email: "", mobile: "", gender: "Other", role: "player" });
  userProfile.playerId = playerProfile.id;
  await saveDoc("users", userProfile);

  return result;
}

export async function logoutUser() {
  if (!firebaseReady) return;
  
  // Unsubscribe all active listeners
  while (activeListeners.length) {
    const unsub = activeListeners.pop();
    if (typeof unsub === "function") unsub();
  }

  await fAuth.signOut(auth);
}

// Uniqueness check helpers
export async function isEmailUnique(email) {
  if (!email || !email.trim()) return true;
  if (!firebaseReady) return true;
  
  const formattedEmail = email.trim().toLowerCase();
  
  // Check users collection
  const usersRef = fStore.collection(db, "users");
  const qUsers = fStore.query(usersRef, fStore.where("email", "==", formattedEmail));
  const snapUsers = await fStore.getDocs(qUsers);
  return snapUsers.empty;
}

export async function isMobileUnique(mobile) {
  if (!mobile || !mobile.trim()) return true;
  if (!firebaseReady) return true;
  
  const formattedMobile = mobile.trim();
  
  // Check users collection
  const usersRef = fStore.collection(db, "users");
  const qUsers = fStore.query(usersRef, fStore.where("mobile", "==", formattedMobile));
  const snapUsers = await fStore.getDocs(qUsers);
  return snapUsers.empty;
}

// Database standard CRUD helpers
export async function saveDoc(collectionName, item) {
  if (!firebaseReady) throw new Error("Firebase not initialized");
  const docRef = fStore.doc(db, collectionName, item.id);
  const updatedItem = {
    ...item,
    updatedAt: fStore.serverTimestamp()
  };
  await fStore.setDoc(docRef, updatedItem, { merge: true });
  return item;
}

export async function getDocById(collectionName, id) {
  if (!firebaseReady) return null;
  const docRef = fStore.doc(db, collectionName, id);
  const snap = await fStore.getDoc(docRef);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function deleteDocById(collectionName, id) {
  if (!firebaseReady) return;
  const docRef = fStore.doc(db, collectionName, id);
  await fStore.deleteDoc(docRef);
}

export async function getAllDocs(collectionName) {
  if (!firebaseReady) return [];
  const colRef = fStore.collection(db, collectionName);
  const snap = await fStore.getDocs(colRef);
  const docs = [];
  snap.forEach(doc => docs.push({ id: doc.id, ...doc.data() }));
  return docs;
}

// Query listeners
export function listenToDoc(collectionName, id, callback) {
  if (!firebaseReady) return () => {};
  const docRef = fStore.doc(db, collectionName, id);
  const unsub = fStore.onSnapshot(docRef, (snapshot) => {
    if (snapshot.exists()) {
      callback({ id: snapshot.id, ...snapshot.data() });
    } else {
      callback(null);
    }
  });
  activeListeners.push(unsub);
  return unsub;
}

export function listenToCollection(collectionName, callback) {
  if (!firebaseReady) return () => {};
  const colRef = fStore.collection(db, collectionName);
  const unsub = fStore.onSnapshot(colRef, (snapshot) => {
    const list = [];
    snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
    callback(list);
  });
  activeListeners.push(unsub);
  return unsub;
}

export function listenToQuery(colName, queryConstraints, callback) {
  if (!firebaseReady) return () => {};
  const colRef = fStore.collection(db, colName);
  const q = fStore.query(colRef, ...queryConstraints);
  const unsub = fStore.onSnapshot(q, (snapshot) => {
    const list = [];
    snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
    callback(list);
  });
  activeListeners.push(unsub);
  return unsub;
}

// Admin Role Request Logic
export async function createAdminRequest(playerId) {
  const qRef = fStore.collection(db, "adminRequests");
  const checkQ = fStore.query(qRef, fStore.where("playerId", "==", playerId), fStore.where("status", "==", "pending"));
  const existing = await fStore.getDocs(checkQ);
  if (!existing.empty) {
    throw new Error("You already have a pending admin request.");
  }

  const requestId = uid("request");
  const requestDoc = {
    id: requestId,
    playerId,
    status: "pending",
    createdAt: new Date().toISOString()
  };
  await saveDoc("adminRequests", requestDoc);
  return requestDoc;
}

export async function approveAdminRequest(requestId) {
  const req = await getDocById("adminRequests", requestId);
  if (!req) throw new Error("Request not found");

  // Get Player and User profile
  const player = await getDocById("players", req.playerId);
  if (!player) throw new Error("Player not found");
  if (!player.userId) throw new Error("Player is a guest and cannot be promoted.");

  // Update user role
  const user = await getDocById("users", player.userId);
  if (user) {
    user.role = "admin";
    await saveDoc("users", user);
  }

  // Update request status
  req.status = "approved";
  req.resolvedAt = new Date().toISOString();
  await saveDoc("adminRequests", req);

  // Send Notification to player
  await sendNotification(player.userId, "Your request for Admin role has been approved! Please sign in again or refresh to see your tools.", "admin_request_approved", "#/profile");
}

export async function rejectAdminRequest(requestId) {
  const req = await getDocById("adminRequests", requestId);
  if (!req) throw new Error("Request not found");

  req.status = "rejected";
  req.resolvedAt = new Date().toISOString();
  await saveDoc("adminRequests", req);

  const player = await getDocById("players", req.playerId);
  if (player && player.userId) {
    await sendNotification(player.userId, "Your request for Admin role has been rejected by the Super Admin.", "admin_request_rejected", "#/profile");
  }
}

// Notifications Sub-collection Helpers
export async function sendNotification(userId, message, type, linkTo = "") {
  const notifId = uid("notif");
  const notif = makeNotification({ message, type, linkTo });
  notif.id = notifId;

  // Store in users/{userId}/notifications/{notifId}
  const notifRef = fStore.doc(db, "users", userId, "notifications", notifId);
  await fStore.setDoc(notifRef, notif);
}

export function listenToUserNotifications(userId, callback) {
  if (!firebaseReady || !userId) return () => {};
  const colRef = fStore.collection(db, "users", userId, "notifications");
  const q = fStore.query(colRef, fStore.orderBy("createdAt", "desc"));
  const unsub = fStore.onSnapshot(q, (snapshot) => {
    const list = [];
    snapshot.forEach(doc => list.push(doc.data()));
    callback(list);
  }, (err) => {
    // Fallback if ordering fails due to missing index initially
    const unsubFallback = fStore.onSnapshot(colRef, (snapshot) => {
      const list = [];
      snapshot.forEach(doc => list.push(doc.data()));
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      callback(list);
    });
    activeListeners.push(unsubFallback);
  });
  activeListeners.push(unsub);
  return unsub;
}

export async function markNotificationAsRead(userId, notifId) {
  const notifRef = fStore.doc(db, "users", userId, "notifications", notifId);
  await fStore.updateDoc(notifRef, { read: true });
}

// Unique IDs for models inside this file
function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).substring(2, 11)}`;
}

// Guest Score claiming flow
export async function createGuestClaim(guestPlayerId, claimantPlayerId, adminId) {
  if (!firebaseReady) throw new Error("Firebase not ready");
  
  // Ensure no existing pending claim for this guest
  const claimsRef = fStore.collection(db, "guestClaims");
  const q = fStore.query(claimsRef, fStore.where("guestPlayerId", "==", guestPlayerId), fStore.where("status", "==", "pending"));
  const snap = await fStore.getDocs(q);
  if (!snap.empty) {
    throw new Error("A claim request for this guest player is already pending approval.");
  }

  const claimId = uid("claim");
  const claimDoc = {
    id: claimId,
    guestPlayerId,
    claimantPlayerId,
    adminId,
    status: "pending",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    notifiedClaimant: false
  };
  await saveDoc("guestClaims", claimDoc);

  // Notify the admin who created the guest player
  const adminUser = await getDocById("users", adminId);
  if (adminUser) {
    const claimant = await getDocById("players", claimantPlayerId);
    const guest = await getDocById("players", guestPlayerId);
    await sendNotification(adminId, `Player ${claimant.name} is claiming score of guest player ${guest.name}. Please review.`, "claim_request", `#/profile`);
  }

  return claimDoc;
}

export async function approveGuestClaim(claimId) {
  if (!firebaseReady) throw new Error("Firebase not ready");
  
  const claim = await getDocById("guestClaims", claimId);
  if (!claim) throw new Error("Claim not found");
  if (claim.status !== "pending") throw new Error("Claim has already been resolved.");

  const guest = await getDocById("players", claim.guestPlayerId);
  const claimant = await getDocById("players", claim.claimantPlayerId);

  if (!guest || !claimant) throw new Error("Guest or Claimant player profiles not found");

  // 1. Merge stats from Guest player to Claimant player
  claimant.matchesPlayed += (guest.matchesPlayed || 0);
  claimant.matchesWon += (guest.matchesWon || 0);
  claimant.totalRuns += (guest.totalRuns || 0);
  claimant.totalBalls += (guest.totalBalls || 0);
  claimant.totalFours += (guest.totalFours || 0);
  claimant.totalSixes += (guest.totalSixes || 0);
  claimant.totalFifties += (guest.totalFifties || 0);
  claimant.totalCenturies += (guest.totalCenturies || 0);
  
  claimant.totalWickets += (guest.totalWickets || 0);
  claimant.totalRunsConceded += (guest.totalRunsConceded || 0);
  claimant.totalBallsBowled += (guest.totalBallsBowled || 0);
  claimant.mvpCount += (guest.mvpCount || 0);

  // Recalculate averages/rates
  if (claimant.totalBalls > 0) {
    claimant.strikeRate = parseFloat(((claimant.totalRuns / claimant.totalBalls) * 100).toFixed(2));
  }
  if (claimant.totalBallsBowled > 0) {
    claimant.economy = parseFloat(((claimant.totalRunsConceded / claimant.totalBallsBowled) * 6).toFixed(2));
    claimant.totalOversBowled = parseFloat((claimant.totalBallsBowled / 6).toFixed(1));
  }

  if ((guest.highestScore || 0) > (claimant.highestScore || 0)) {
    claimant.highestScore = guest.highestScore;
  }

  // Best Bowling merge (e.g. comparing "3/12" vs "2/5")
  if (guest.bestBowling && guest.bestBowling !== "-") {
    if (claimant.bestBowling === "-") {
      claimant.bestBowling = guest.bestBowling;
    } else {
      const [gW, gR] = guest.bestBowling.split("/").map(Number);
      const [cW, cR] = claimant.bestBowling.split("/").map(Number);
      if (gW > cW || (gW === cW && gR < cR)) {
        claimant.bestBowling = guest.bestBowling;
      }
    }
  }

  // Update claimant profile
  await saveDoc("players", claimant);

  // 2. Mark guest player as claimed
  guest.claimedBy = claimant.id;
  guest.claimedAt = new Date().toISOString();
  guest.claimable = false;
  await saveDoc("players", guest);

  // 3. Update matches: replace guest player ID with claimant player ID in scorecards
  const matches = await getAllDocs("matches");
  for (const match of matches) {
    let matchUpdated = false;
    
    // In each innings, scan batsmen and bowlers records
    if (match.innings && match.innings.length) {
      match.innings.forEach(inn => {
        // Update striker / non-striker reference
        if (inn.strikerId === guest.id) { inn.strikerId = claimant.id; matchUpdated = true; }
        if (inn.nonStrikerId === guest.id) { inn.nonStrikerId = claimant.id; matchUpdated = true; }
        if (inn.currentBowlerId === guest.id) { inn.currentBowlerId = claimant.id; matchUpdated = true; }
        if (inn.lastBowlerId === guest.id) { inn.lastBowlerId = claimant.id; matchUpdated = true; }

        if (inn.dismissedPlayerIds && inn.dismissedPlayerIds.includes(guest.id)) {
          inn.dismissedPlayerIds = inn.dismissedPlayerIds.map(id => id === guest.id ? claimant.id : id);
          matchUpdated = true;
        }

        // Batting records
        if (inn.batting && inn.batting[guest.id]) {
          const guestBatRec = inn.batting[guest.id];
          guestBatRec.playerId = claimant.id;
          inn.batting[claimant.id] = guestBatRec;
          delete inn.batting[guest.id];
          matchUpdated = true;
        }

        // Bowling records
        if (inn.bowling && inn.bowling[guest.id]) {
          const guestBowlRec = inn.bowling[guest.id];
          guestBowlRec.bowlerId = claimant.id;
          inn.bowling[claimant.id] = guestBowlRec;
          delete inn.bowling[guest.id];
          matchUpdated = true;
        }

        // Bowler balls record count
        if (inn.bowlerBalls && inn.bowlerBalls[guest.id] !== undefined) {
          inn.bowlerBalls[claimant.id] = inn.bowlerBalls[guest.id];
          delete inn.bowlerBalls[guest.id];
          matchUpdated = true;
        }

        // Balls array
        if (inn.balls && inn.balls.length) {
          inn.balls.forEach(ball => {
            if (ball.batsman === guest.id) { ball.batsman = claimant.id; matchUpdated = true; }
            if (ball.bowler === guest.id) { ball.bowler = claimant.id; matchUpdated = true; }
          });
        }
      });
    }

    if (match.mvpBatsmanId === guest.id) { match.mvpBatsmanId = claimant.id; matchUpdated = true; }
    if (match.mvpBowlerId === guest.id) { match.mvpBowlerId = claimant.id; matchUpdated = true; }

    if (matchUpdated) {
      await saveDoc("matches", match);
    }
  }

  // 4. Resolve claim doc
  claim.status = "approved";
  claim.resolvedAt = new Date().toISOString();
  await saveDoc("guestClaims", claim);

  // 5. Notify claimant
  if (claimant.userId) {
    await sendNotification(claimant.userId, `Your claim for guest player ${guest.name}'s stats has been APPROVED. Stats are merged!`, "claim_approved", "#/profile");
  }
}

export async function rejectGuestClaim(claimId) {
  if (!firebaseReady) throw new Error("Firebase not ready");

  const claim = await getDocById("guestClaims", claimId);
  if (!claim) throw new Error("Claim not found");
  if (claim.status !== "pending") throw new Error("Claim has already been resolved.");

  claim.status = "rejected";
  claim.resolvedAt = new Date().toISOString();
  await saveDoc("guestClaims", claim);

  const claimant = await getDocById("players", claim.claimantPlayerId);
  const guest = await getDocById("players", claim.guestPlayerId);

  if (claimant && claimant.userId) {
    await sendNotification(claimant.userId, `Your claim for guest player ${guest.name}'s stats has been rejected by the admin.`, "claim_rejected", "#/profile");
  }
}

export async function recalculateStats() {
  if (!firebaseReady) return;
  const players = await getAllDocs("players");
  const teams = await getAllDocs("teams");
  const matches = await getAllDocs("matches");

  const playerMap = {};
  players.forEach(p => {
    playerMap[p.id] = {
      ...p,
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
      totalWickets: 0,
      totalRunsConceded: 0,
      totalBallsBowled: 0,
      totalOversBowled: 0,
      economy: 0,
      bestBowling: "-",
      mvpCount: 0,
      matchesAsUmpire: 0,
      teamsCreatedCount: 0
    };
  });

  // Calculate teamsCreatedCount
  teams.forEach(t => {
    if (t.createdByAdminId) {
      const creatorPlayer = Object.values(playerMap).find(p => p.id === t.createdByAdminId || p.userId === t.createdByAdminId);
      if (creatorPlayer) {
        creatorPlayer.teamsCreatedCount = (creatorPlayer.teamsCreatedCount || 0) + 1;
      }
    }
  });

  const teamMap = {};
  teams.forEach(t => {
    teamMap[t.id] = {
      ...t,
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
  });

  matches.forEach(m => {
    if (m.umpireId) {
      const umpirePlayer = Object.values(playerMap).find(p => p.id === m.umpireId || p.userId === m.umpireId);
      if (umpirePlayer) {
        umpirePlayer.matchesAsUmpire = (umpirePlayer.matchesAsUmpire || 0) + 1;
      }
    }

    if (m.status !== "completed") return;

    const teamA = teamMap[m.teamAId];
    const teamB = teamMap[m.teamBId];

    if (teamA) teamA.matchesPlayed++;
    if (teamB) teamB.matchesPlayed++;

    if (m.winnerTeamId) {
      if (m.winnerTeamId === m.teamAId) {
        if (teamA) teamA.matchesWon++;
        if (teamB) teamB.matchesLost++;
      } else {
        if (teamB) teamB.matchesWon++;
        if (teamA) teamA.matchesLost++;
      }
    } else {
      if (teamA) teamA.matchesTied++;
      if (teamB) teamB.matchesTied++;
    }

    if (m.mvpBatsmanId && playerMap[m.mvpBatsmanId]) {
      playerMap[m.mvpBatsmanId].mvpCount = (playerMap[m.mvpBatsmanId].mvpCount || 0) + 1;
    }
    if (m.mvpBowlerId && playerMap[m.mvpBowlerId]) {
      playerMap[m.mvpBowlerId].mvpCount = (playerMap[m.mvpBowlerId].mvpCount || 0) + 1;
    }

    // Aggregating players matches played
    if (teamA && teamA.playerIds) {
      teamA.playerIds.forEach(pid => {
        if (playerMap[pid]) playerMap[pid].matchesPlayed++;
      });
    }
    if (teamB && teamB.playerIds) {
      teamB.playerIds.forEach(pid => {
        if (playerMap[pid]) playerMap[pid].matchesPlayed++;
      });
    }

    m.innings.forEach(inn => {
      const batTeam = teamMap[inn.battingTeamId];
      const bowlTeam = teamMap[inn.bowlingTeamId];

      if (batTeam) {
        batTeam.totalRunsScored += (inn.totalRuns || 0);
        batTeam.totalOversFaced += (inn.legalBallsTotal || 0) / 6;
      }
      if (bowlTeam) {
        bowlTeam.totalRunsConceded += (inn.totalRuns || 0);
        bowlTeam.totalOversBowled += (inn.legalBallsTotal || 0) / 6;
      }

      if (inn.batting) {
        Object.entries(inn.batting).forEach(([pid, rec]) => {
          const player = playerMap[pid];
          if (!player || rec.status === "yet to bat") return;

          player.totalRuns += (rec.runs || 0);
          player.totalBalls += (rec.balls || 0);
          player.totalFours += (rec.fours || 0);
          player.totalSixes += (rec.sixes || 0);

          if (rec.runs > (player.highestScore || 0)) {
            player.highestScore = rec.runs;
          }
          if (rec.runs >= 100) {
            player.totalCenturies = (player.totalCenturies || 0) + 1;
          } else if (rec.runs >= 50) {
            player.totalFifties = (player.totalFifties || 0) + 1;
          }
        });
      }

      if (inn.bowling) {
        Object.entries(inn.bowling).forEach(([pid, rec]) => {
          const player = playerMap[pid];
          if (!player) return;

          player.totalWickets += (rec.wickets || 0);
          player.totalRunsConceded += (rec.runsConceded || 0);
          player.totalBallsBowled += (rec.legalBalls || 0);

          const curBest = player.bestBowling;
          const newW = rec.wickets || 0;
          const newR = rec.runsConceded || 0;
          
          if (curBest === "-") {
            player.bestBowling = `${newW}/${newR}`;
          } else {
            const [curW, curR] = curBest.split("/").map(Number);
            if (newW > curW || (newW === curW && newR < curR)) {
              player.bestBowling = `${newW}/${newR}`;
            }
          }
        });
      }
    });
  });

  Object.values(teamMap).forEach(t => {
    const batAvg = t.totalOversFaced > 0 ? (t.totalRunsScored / t.totalOversFaced) : 0;
    const bowlAvg = t.totalOversBowled > 0 ? (t.totalRunsConceded / t.totalOversBowled) : 0;
    t.netRunRate = parseFloat((batAvg - bowlAvg).toFixed(3));
  });

  Object.values(playerMap).forEach(p => {
    if (p.totalBalls > 0) {
      p.strikeRate = parseFloat(((p.totalRuns / p.totalBalls) * 100).toFixed(2));
    } else {
      p.strikeRate = 0;
    }

    if (p.totalBallsBowled > 0) {
      p.economy = parseFloat(((p.totalRunsConceded / p.totalBallsBowled) * 6).toFixed(2));
      p.totalOversBowled = parseFloat((p.totalBallsBowled / 6).toFixed(1));
    } else {
      p.economy = 0;
      p.totalOversBowled = 0;
    }
  });

  const promises = [];
  Object.values(playerMap).forEach(p => promises.push(saveDoc("players", p)));
  Object.values(teamMap).forEach(t => promises.push(saveDoc("teams", t)));
  await Promise.all(promises);
}



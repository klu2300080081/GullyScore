import { initFirebase, getDocById, auth, fAuth, db, fStore } from "./firebase-service.js";

export let currentUserProfile = null;
export let currentPlayerProfile = null;
let authStateListeners = [];

// Getter functions — always return the live value.
// Use these instead of importing the variables directly, to avoid
// stale ES module binding in cached browser environments.
export function getCurrentUser() { return currentUserProfile; }
export function getCurrentPlayer() { return currentPlayerProfile; }

function setProfiles(user, player) {
  currentUserProfile = user;
  currentPlayerProfile = player;
}

export function getActiveRole() {
  return currentUserProfile ? currentUserProfile.role : null;
}

export function addAuthStateListener(callback) {
  authStateListeners.push(callback);
  // Immediate call if already logged in
  if (currentUserProfile) {
    callback(currentUserProfile);
  }
}

function notifyListeners(user) {
  authStateListeners.forEach(cb => cb(user));
}

export async function listenToAuth() {
  await initFirebase();
  
  let userUnsub = null;

  fAuth.onAuthStateChanged(auth, async (firebaseUser) => {
    if (userUnsub) {
      userUnsub();
      userUnsub = null;
    }

    if (firebaseUser) {
      try {
        userUnsub = fStore.onSnapshot(fStore.doc(db, "users", firebaseUser.uid), async (snapshot) => {
          if (snapshot.exists()) {
            const userDoc = { id: snapshot.id, ...snapshot.data() };
            const playerDoc = userDoc.playerId ? await getDocById("players", userDoc.playerId) : null;
            setProfiles(userDoc, playerDoc);
            notifyListeners(currentUserProfile);
          } else {
            // Handle race condition/initial registration delay
            let userDocFallback = await getDocById("users", firebaseUser.uid);
            let attempts = 0;
            while (!userDocFallback && attempts < 5) {
              await new Promise(r => setTimeout(r, 600));
              userDocFallback = await getDocById("users", firebaseUser.uid);
              attempts++;
            }
            
            if (userDocFallback) {
              const userDocWithId = { id: firebaseUser.uid, ...userDocFallback };
              const playerDoc = userDocWithId.playerId ? await getDocById("players", userDocWithId.playerId) : null;
              setProfiles(userDocWithId, playerDoc);
              notifyListeners(currentUserProfile);
            } else {
              setProfiles(null, null);
              notifyListeners(null);
            }
          }
        }, (err) => {
          console.error("User document real-time listener failed:", err);
        });
      } catch (error) {
        console.error("Error setting up user listener:", error);
        setProfiles(null, null);
        notifyListeners(null);
      }
    } else {
      setProfiles(null, null);
      notifyListeners(null);
    }
  });
}

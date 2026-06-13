import { initFirebase, getDocById, auth, fAuth, db, fStore, saveDoc } from "./firebase-service.js";
import { makeUser, makePlayer } from "./models.js";

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
          try {
            if (snapshot.exists()) {
              let userDoc = { id: snapshot.id, ...snapshot.data() };
              
              // Self-healing: if user exists but has no playerId, create one
              if (!userDoc.playerId) {
                try {
                  const playerProfile = makePlayer({
                    name: userDoc.name || firebaseUser.displayName || (userDoc.email ? userDoc.email.split("@")[0] : "Player"),
                    mobile: userDoc.mobile || "",
                    email: userDoc.email || firebaseUser.email || "",
                    gender: userDoc.gender || "Other",
                    isGuest: false,
                    userId: firebaseUser.uid
                  });
                  await saveDoc("players", playerProfile);
                  userDoc.playerId = playerProfile.id;
                  await saveDoc("users", userDoc);
                  return;
                } catch (e) {
                  console.error("Failed to self-heal missing playerId:", e);
                }
              }

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
                let userDocWithId = { id: firebaseUser.uid, ...userDocFallback };
                
                // Self-healing in fallback block
                if (!userDocWithId.playerId) {
                  try {
                    const playerProfile = makePlayer({
                      name: userDocWithId.name || firebaseUser.displayName || (userDocWithId.email ? userDocWithId.email.split("@")[0] : "Player"),
                      mobile: userDocWithId.mobile || "",
                      email: userDocWithId.email || firebaseUser.email || "",
                      gender: userDocWithId.gender || "Other",
                      isGuest: false,
                      userId: firebaseUser.uid
                    });
                    await saveDoc("players", playerProfile);
                    userDocWithId.playerId = playerProfile.id;
                    await saveDoc("users", userDocWithId);
                  } catch (e) {
                    console.error("Failed to self-heal missing playerId in fallback:", e);
                  }
                }

                const playerDoc = userDocWithId.playerId ? await getDocById("players", userDocWithId.playerId) : null;
                setProfiles(userDocWithId, playerDoc);
                notifyListeners(currentUserProfile);
              } else {
                // Self-healing: Create user document on the fly if it is completely missing after 5 attempts
                try {
                  const name = firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split("@")[0] : "Player");
                  const email = firebaseUser.email || "";
                  const role = email === "superadmin006@gmail.com" ? "superadmin" : "player";

                  const newUserProfile = makeUser({ uid: firebaseUser.uid, name, email, mobile: "", gender: "Other", role });
                  await saveDoc("users", newUserProfile);

                  const newPlayerProfile = makePlayer({
                    name,
                    mobile: "",
                    email,
                    gender: "Other",
                    isGuest: false,
                    userId: firebaseUser.uid
                  });
                  await saveDoc("players", newPlayerProfile);

                  newUserProfile.playerId = newPlayerProfile.id;
                  await saveDoc("users", newUserProfile);
                } catch (e) {
                  console.error("Failed to self-heal missing user document:", e);
                  setProfiles(null, null);
                  notifyListeners(null);
                }
              }
            }
          } catch (innerError) {
            console.error("Error inside onSnapshot callback:", innerError);
            setProfiles(null, null);
            notifyListeners(null);
          }
        }, (err) => {
          console.error("User document real-time listener failed:", err);
          setProfiles(null, null);
          notifyListeners(null);
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

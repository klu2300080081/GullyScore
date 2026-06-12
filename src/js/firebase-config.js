export const  firebaseConfig = {
  apiKey: "AIzaSyCo2SuuKxZItzQY4_87hmQTkK_FomhoilA",
  authDomain: "gully-score-fbb1e.firebaseapp.com",
  projectId: "gully-score-fbb1e",
  storageBucket: "gully-score-fbb1e.firebasestorage.app",
  messagingSenderId: "513452254509",
  appId: "1:513452254509:web:1fea3532857959bf521fa4",
  measurementId: "G-9HEQ0WVQ73"
};

export function hasFirebaseConfig() {
  return !firebaseConfig.apiKey.startsWith("PASTE_") && !firebaseConfig.projectId.startsWith("PASTE_");
}

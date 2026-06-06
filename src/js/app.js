import { initFirebase, signInAnon, signInGoogle } from "./firebase-service.js";
import { UI } from "./ui.js";

const savedTheme = localStorage.getItem("gully-theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

const ui = new UI();
ui.init();

const firebaseState = await initFirebase();
document.querySelector("#authStatus").textContent = firebaseState.ready ? "Firebase ready" : "Local session";

document.querySelector("#googleLoginBtn").addEventListener("click", async () => {
  try {
    const result = await signInGoogle();
    document.querySelector("#authStatus").textContent = result?.user?.displayName || "Google user";
  } catch (error) {
    ui.toast(error.message, "danger");
  }
});

document.querySelector("#anonLoginBtn").addEventListener("click", async () => {
  try {
    const result = await signInAnon();
    document.querySelector("#authStatus").textContent = result?.user?.uid ? "Anonymous user" : "Local session";
  } catch (error) {
    ui.toast(error.message, "danger");
  }
});

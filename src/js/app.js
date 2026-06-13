import { initFirebase, loginUser, registerUser, signInAnon, logoutUser } from "./firebase-service.js";
import { listenToAuth, addAuthStateListener } from "./auth.js";
import { router } from "./router.js";
import { ui } from "./ui.js";

// Load Theme preference
const savedTheme = localStorage.getItem("gully-theme") || "dark";
document.documentElement.setAttribute("data-theme", savedTheme);

async function boot() {
  // 1. Initialize Firebase
  const firebaseState = await initFirebase();
  if (!firebaseState.ready) {
    console.error("Firebase load failed:", firebaseState.reason);
    ui.toast(`Firebase error: ${firebaseState.reason}`, "danger");
    return;
  }

  // 2. Initialize UI modules
  ui.init();

  // 3. Register Hash Routes
  router.addRoute("#/about", () => ui.showAbout());
  router.addRoute("#/dashboard", () => ui.showDashboard());

  router.addRoute("#/tournaments", () => ui.showTournaments());
  router.addRoute("#/tournament/:id", (params) => ui.showTournamentDetail(params.id));
  router.addRoute("#/teams", () => ui.showTeams());
  router.addRoute("#/team/:id", (params) => ui.showTeamDetail(params.id));
  router.addRoute("#/players", () => ui.showPlayers());
  router.addRoute("#/player/:id", (params) => ui.showPlayerDetail(params.id));
  router.addRoute("#/admins", () => ui.showAdmins(), ["superadmin"]);
  router.addRoute("#/admin/:id", (params) => ui.showAdminDetail(params.id), ["superadmin"]);
  router.addRoute("#/matches", () => ui.showMatches());
  router.addRoute("#/match/:id", (params) => ui.showMatchDetail(params.id));
  router.addRoute("#/profile", () => ui.showProfile());

  // 4. Register Auth State Listener
  addAuthStateListener((user) => {
    if (user) {
      ui.onLogin(user);
      router.resolve();
    } else {
      ui.onLogout();
      router.resolve();
    }
  });

  // 5. Start listening to Firebase Auth state
  await listenToAuth();
}

// Auth screen UI interactions
const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const anonLoginBtn = document.getElementById("anon-login-btn");

tabLogin.addEventListener("click", () => {
  tabLogin.classList.add("active");
  tabRegister.classList.remove("active");
  loginForm.style.display = "flex";
  registerForm.style.display = "none";
});

tabRegister.addEventListener("click", () => {
  tabRegister.classList.add("active");
  tabLogin.classList.remove("active");
  registerForm.style.display = "flex";
  loginForm.style.display = "none";
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error-msg");
  errEl.style.display = "none";
  
  try {
    ui.showLoader();
    await loginUser(email, password);
    ui.toast("Successfully signed in!", "success");
  } catch (error) {
    // Show inline error near the form
    let msg = error.message || "Sign in failed. Please try again.";
    if (msg.includes("invalid-credential") || msg.includes("wrong-password") || msg.includes("user-not-found")) {
      msg = "Invalid email or password. Please check your credentials.";
    } else if (msg.includes("too-many-requests")) {
      msg = "Too many failed attempts. Please try again later.";
    } else if (msg.includes("network")) {
      msg = "Network error. Check your connection and try again.";
    }
    errEl.textContent = msg;
    errEl.style.display = "block";
  } finally {
    ui.hideLoader();
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("register-name").value;
  const email = document.getElementById("register-email").value;
  const mobile = document.getElementById("register-mobile").value;
  const gender = document.getElementById("register-gender").value;
  const password = document.getElementById("register-password").value;
  const passwordConfirm = document.getElementById("register-password-confirm").value;
  const errEl = document.getElementById("register-error-msg");
  errEl.style.display = "none";

  if (password.length < 6) {
    errEl.textContent = "Password must be at least 6 characters.";
    errEl.style.display = "block";
    return;
  }

  if (password !== passwordConfirm) {
    errEl.textContent = "Passwords do not match. Please re-enter.";
    errEl.style.display = "block";
    return;
  }

  try {
    ui.showLoader();
    await registerUser(name, email, mobile, gender, password);
    ui.toast("Account created successfully!", "success");
  } catch (error) {
    let msg = error.message || "Registration failed. Please try again.";
    if (msg.includes("email-already-in-use")) {
      msg = "This email is already registered. Try signing in instead.";
    }
    errEl.textContent = msg;
    errEl.style.display = "block";
  } finally {
    ui.hideLoader();
  }
});

anonLoginBtn.addEventListener("click", async () => {
  try {
    ui.showLoader();
    await signInAnon();
    ui.toast("Signed in as temporary Guest Player.", "success");
  } catch (error) {
    ui.toast(error.message, "danger");
  } finally {
    ui.hideLoader();
  }
});

// Sidebar Sign Out Button
document.getElementById("sidebar-logout-btn").addEventListener("click", async () => {
  try {
    ui.showLoader();
    await logoutUser();
    ui.toast("Signed out successfully.", "success");
  } catch (error) {
    ui.toast(error.message, "danger");
  } finally {
    ui.hideLoader();
  }
});

// Theme Toggle Button
document.getElementById("theme-toggle-btn").addEventListener("click", () => {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", nextTheme);
  localStorage.setItem("gully-theme", nextTheme);
});

// Close Player warning banner
document.getElementById("closePlayerBannerBtn").addEventListener("click", () => {
  document.getElementById("player-banner").style.display = "none";
});

// Mobile Sidebar Menu Toggling and Brand Clicks
const menuToggleBtn = document.getElementById("menu-toggle-btn");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const sidebar = document.querySelector(".sidebar");
const mobileBrand = document.getElementById("mobile-brand");
const desktopBrand = document.querySelector(".sidebar .brand");

if (menuToggleBtn && sidebar && sidebarOverlay) {
  menuToggleBtn.addEventListener("click", () => {
    sidebar.classList.toggle("open");
    sidebarOverlay.classList.toggle("active");
  });

  sidebarOverlay.addEventListener("click", () => {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("active");
  });
}

// Close mobile sidebar on navigation link clicks
document.addEventListener("click", (e) => {
  if (e.target.closest("#sidebar-nav button") || e.target.closest("#sidebar-logout-btn")) {
    if (sidebar && sidebar.classList.contains("open")) {
      sidebar.classList.remove("open");
      sidebarOverlay.classList.remove("active");
    }
  }
});

if (mobileBrand) {
  mobileBrand.addEventListener("click", () => {
    window.location.hash = "#/dashboard";
  });
}

if (desktopBrand) {
  desktopBrand.style.cursor = "pointer";
  desktopBrand.addEventListener("click", () => {
    window.location.hash = "#/dashboard";
  });
}

// Boot the application
boot();

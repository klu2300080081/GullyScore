import { getActiveRole, getCurrentUser } from "./auth.js";

export class HashRouter {
  constructor() {
    this.routes = [];
    this.defaultRoute = "#/dashboard";
    window.addEventListener("hashchange", () => this.resolve());
  }

  addRoute(pattern, handler, requiredRoles = []) {
    // Convert e.g., "#/tournament/:id" -> regex and param name mapping
    const paramNames = [];
    const regexSource = pattern
      .replace(/:([^/]+)/g, (_, name) => {
        paramNames.push(name);
        return "([^/]+)";
      });
    
    const regex = new RegExp(`^${regexSource}$`);
    this.routes.push({ pattern, regex, paramNames, handler, requiredRoles });
  }

  navigate(hash) {
    window.location.hash = hash;
  }

  resolve() {
    const hash = window.location.hash || "#/";
    
    // Auth Guard check
    const authScreen = document.getElementById("auth-screen");
    const appShell = document.getElementById("app-shell");

    if (!getCurrentUser()) {
      // Not logged in -> show login screen, hide app shell
      authScreen.style.display = "grid";
      appShell.style.display = "none";
      // Clear hash to prevent rendering restricted pages under the hood
      if (window.location.hash !== "" && window.location.hash !== "#/") {
        window.location.hash = "";
      }
      return;
    }

    // Logged in -> show app shell, hide auth screen
    authScreen.style.display = "none";
    appShell.style.display = "grid";

    // Handle empty route
    if (hash === "#/" || hash === "#") {
      this.navigate(this.defaultRoute);
      return;
    }

    // Match routes
    let matched = false;
    for (const route of this.routes) {
      const match = hash.match(route.regex);
      if (match) {
        matched = true;
        
        // Role Guard check
        const userRole = getActiveRole();
        if (route.requiredRoles.length && !route.requiredRoles.includes(userRole)) {
          console.warn(`Access denied to ${hash}. Required: ${route.requiredRoles.join(",")}, User role: ${userRole}`);
          this.navigate(this.defaultRoute);
          return;
        }

        // Extract params
        const params = {};
        route.paramNames.forEach((name, index) => {
          params[name] = match[index + 1];
        });

        // Toggle active navigation link style in sidebar
        this.updateActiveNavLink(route.pattern);

        // Execute route handler
        route.handler(params);
        break;
      }
    }

    if (!matched) {
      console.warn(`Route not found: ${hash}`);
      this.navigate(this.defaultRoute);
    }
  }

  updateActiveNavLink(routePattern) {
    // Map detail sub-routes back to their parent nav item
    let viewName = "";
    if (routePattern.startsWith("#/dashboard")) viewName = "dashboard";
    else if (routePattern.startsWith("#/tournament")) viewName = "tournaments";
    else if (routePattern.startsWith("#/team")) viewName = "teams";
    else if (routePattern.startsWith("#/player")) viewName = "players";
    else if (routePattern.startsWith("#/admin")) viewName = "admins";
    else if (routePattern.startsWith("#/match")) viewName = "match";
    else if (routePattern.startsWith("#/profile")) viewName = "profile";

    const navItems = document.querySelectorAll("#sidebar-nav .nav-item");
    navItems.forEach(item => {
      if (item.getAttribute("data-view") === viewName) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }
    });
  }
}

export const router = new HashRouter();

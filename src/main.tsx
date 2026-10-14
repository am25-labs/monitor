import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation
} from "react-router-dom";
import { Dashboard } from "./pages/dashboard";
import { PublicStatus } from "./pages/status";
import { NotFound } from "./pages/not-found";
import { TooltipProvider } from "./components/ui/tooltip";
import "./styles.css";

function App() {
  const { pathname } = useLocation();
  const storageKey = pathname.startsWith("/status/")
    ? "monitor-public-theme"
    : "monitor-theme";
  return <ThemedApp key={storageKey} storageKey={storageKey} />;
}

function ThemedApp({ storageKey }: { storageKey: string }) {
  const [preference, setPreference] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored === "dark" || stored === "light") return stored;
    return storageKey === "monitor-theme"
      ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : null;
  });
  const [systemTheme, setSystemTheme] = useState(
    () =>
      matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );
  const theme = preference ?? systemTheme;
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemTheme(media.matches ? "dark" : "light");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    if (storageKey === "monitor-theme") localStorage.setItem(storageKey, theme);
  }, [storageKey, theme]);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    localStorage.setItem(storageKey, next);
    setPreference(next);
  };
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app/" replace />} />
      <Route
        path="/app/"
        element={<Dashboard theme={theme} toggleTheme={toggleTheme} />}
      />
      <Route
        path="/app/:section"
        element={<Dashboard theme={theme} toggleTheme={toggleTheme} />}
      />
      <Route
        path="/app/:section/:id"
        element={<Dashboard theme={theme} toggleTheme={toggleTheme} />}
      />
      <Route
        path="/status/:slug"
        element={<PublicStatus theme={theme} toggleTheme={toggleTheme} />}
      />
      <Route
        path="*"
        element={<NotFound />}
      />
    </Routes>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </BrowserRouter>
  </StrictMode>
);

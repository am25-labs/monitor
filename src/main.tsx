import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Dashboard } from "./pages/dashboard";
import { PublicStatus } from "./pages/status";
import "./styles.css";

function App() {
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem("monitor-theme") ??
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("monitor-theme", theme);
  }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return (
    <BrowserRouter>
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
          element={<PublicStatus toggleTheme={toggleTheme} />}
        />
        <Route
          path="*"
          element={<main className="p-8">Página no encontrada.</main>}
        />
      </Routes>
    </BrowserRouter>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

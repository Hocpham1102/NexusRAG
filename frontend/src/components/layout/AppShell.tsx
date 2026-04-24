import { useCallback, useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

const STORAGE_KEY = "sidebar-collapsed";
const AUTO_COLLAPSE_WIDTH = 1440;

export function AppShell() {
  const [userCollapsed, setUserCollapsed] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "true";
  });
  const [autoCollapsed, setAutoCollapsed] = useState(false);

  useEffect(() => {
    const check = () =>
      setAutoCollapsed(window.innerWidth < AUTO_COLLAPSE_WIDTH);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const collapsed = userCollapsed || autoCollapsed;

  const toggleSidebar = useCallback(() => {
    setUserCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return (
    <div className="h-screen flex overflow-hidden bg-background relative">
      {/* Dynamic Background Effects */}
      <div className="glow-blob w-[600px] h-[600px] bg-primary/5 -top-64 -left-64" />
      <div className="glow-blob w-[500px] h-[500px] bg-accent/5 -bottom-48 -right-48" />
      
      {/* Slim Integrated Sidebar */}
      <div className="relative flex-shrink-0 border-r border-white/5 bg-card/20 backdrop-blur-3xl">
        <Sidebar collapsed={true} onToggle={() => {}} />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <main className="flex-1 overflow-hidden p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

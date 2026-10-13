import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider, useTheme } from "next-themes";
import Welcome from "@/pages/Welcome";
import "@/index.css";

const params = new URLSearchParams(location.search);
function RequestedTheme() { const { setTheme } = useTheme(); useEffect(() => { setTheme(params.get("theme") === "dark" ? "dark" : "light"); }, [setTheme]); return null; }
createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme={params.get("theme") === "dark" ? "dark" : "light"} enableSystem={false}>
    <RequestedTheme />
    <div className="fixed left-2 top-2 z-50 text-xs text-muted-foreground">Synthetic Welcome render — no Auth, database or provider requests</div>
    <MemoryRouter initialEntries={["/welcome?checkout=success"]}>
      <Routes><Route path="/welcome" element={<Welcome />} /><Route path="*" element={<main className="grid min-h-screen place-items-center"><div><h1>Handoff reached the synthetic destination</h1><p>Actual customer workspace and authentication are unverified.</p></div></main>} /></Routes>
    </MemoryRouter>
  </ThemeProvider>
);

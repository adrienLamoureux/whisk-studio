import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export const THEMES = [
  { id: "sakura", label: "Sakura", swatch: "#FF6B9D", swatchSecondary: "#C084FC" },
  { id: "moonrise", label: "Moonrise", swatch: "#38BDF8", swatchSecondary: "#818CF8" },
  { id: "bamboo", label: "Bamboo", swatch: "#4ADE80", swatchSecondary: "#FBBF24" },
  { id: "ember", label: "Ember", swatch: "#F87171", swatchSecondary: "#FB923C" },
  { id: "void", label: "Void", swatch: "#A855F7", swatchSecondary: "#22D3EE" },
  { id: "glacier", label: "Glacier", swatch: "#2DD4BF", swatchSecondary: "#94A3B8" },
  { id: "dusk", label: "Dusk", swatch: "#FB923C", swatchSecondary: "#F472B6" },
  { id: "aurora", label: "Aurora", swatch: "#34D399", swatchSecondary: "#22D3EE" },
  { id: "crimson", label: "Crimson", swatch: "#F43F5E", swatchSecondary: "#F59E0B" },
  { id: "storm", label: "Storm", swatch: "#FDE047", swatchSecondary: "#94A3B8" },
];

// The aesthetic axis sits above the color themes: the 10 THEMES palettes only
// apply under "sakura"; "obscura" (dark painterly, ADR-010) carries its own
// palette and suppresses data-theme entirely while active.
export const AESTHETICS = [
  { id: "sakura", label: "Sakura Bloom" },
  { id: "obscura", label: "Obscura" },
];
const AESTHETIC_IDS = AESTHETICS.map((a) => a.id);

const STORAGE_KEY = "skr-theme";
const BRIGHTNESS_KEY = "skr-brightness";
const AESTHETIC_KEY = "skr-aesthetic";
const DEFAULT_THEME = "sakura";
const DEFAULT_AESTHETIC = "obscura";
// Must match the pre-paint fallback in public/index.html.
const AESTHETIC_TRANSITION_MS = 900;

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
  });

  const [brightness, setBrightnessState] = useState(() => {
    // Dark is the flagship Obscura look (ADR-010); stored prefs still win.
    return localStorage.getItem(BRIGHTNESS_KEY) || "dark";
  });

  const [aesthetic, setAestheticState] = useState(() => {
    const stored = localStorage.getItem(AESTHETIC_KEY);
    return AESTHETIC_IDS.includes(stored) ? stored : DEFAULT_AESTHETIC;
  });

  // While obscura is active data-theme is removed so no [data-theme=X] block
  // can fight the obscura token set; the stored skr-theme survives for
  // switch-back.
  useEffect(() => {
    const root = document.documentElement;
    if (aesthetic === "obscura" || theme === DEFAULT_THEME) {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme, aesthetic]);

  useEffect(() => {
    const root = document.documentElement;
    // Always set data-brightness; light-themes.css targets [data-brightness="light"]
    // tokens.css (dark) applies when this attribute is absent or "dark"
    if (brightness === "light") {
      root.setAttribute("data-brightness", "light");
    } else {
      root.removeAttribute("data-brightness");
    }
  }, [brightness]);

  // data-aesthetic is always set explicitly (unlike data-theme) so CSS stays
  // debuggable. Aesthetic changes after mount trigger the transient
  // chiaroscuro-sweep transition class (same pattern as ModeContext).
  const aestheticMounted = useRef(false);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-aesthetic", aesthetic);
    if (!aestheticMounted.current) {
      aestheticMounted.current = true;
      return undefined;
    }
    root.classList.add("skr-aesthetic-transition");
    const timer = window.setTimeout(() => {
      root.classList.remove("skr-aesthetic-transition");
    }, AESTHETIC_TRANSITION_MS);
    return () => {
      window.clearTimeout(timer);
      root.classList.remove("skr-aesthetic-transition");
    };
  }, [aesthetic]);

  const setTheme = useCallback((id) => {
    localStorage.setItem(STORAGE_KEY, id);
    setThemeState(id);
  }, []);

  const setBrightness = useCallback((mode) => {
    localStorage.setItem(BRIGHTNESS_KEY, mode);
    setBrightnessState(mode);
  }, []);

  // Enum-validated write: invalid ids are ignored (this is also the write
  // path for agent-driven set_aesthetic client actions).
  const setAesthetic = useCallback((id) => {
    if (!AESTHETIC_IDS.includes(id)) return;
    localStorage.setItem(AESTHETIC_KEY, id);
    setAestheticState(id);
  }, []);

  const toggleAesthetic = useCallback(() => {
    setAesthetic(aesthetic === "obscura" ? "sakura" : "obscura");
  }, [aesthetic, setAesthetic]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        themes: THEMES,
        brightness,
        setBrightness,
        aesthetic,
        setAesthetic,
        toggleAesthetic,
        aesthetics: AESTHETICS,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

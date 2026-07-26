/**
 * NAV_ITEMS — single source of truth for app navigation.
 *
 * Consumed by the main shell HUD (App.js), the desktop Sidebar, and the
 * companion drive surface (CompanionStage) so all three render the same nav,
 * filtered identically by auth + role.
 */

const NAV_ITEMS = [
  { label: "Realm", path: "/", icon: "✦", isPublic: true },
  { label: "Atelier", path: "/atelier", icon: "◈", isPublic: false },
  { label: "Chronicle", path: "/chronicle", icon: "▤", isPublic: false },
  { label: "Sanctum", path: "/sanctum", icon: "⚙", requiredRole: "admin" },
  { label: "About", path: "/about", icon: "✧", isPublic: true },
];

export default NAV_ITEMS;

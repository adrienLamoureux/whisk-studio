/**
 * NAV_ITEMS — single source of truth for the bottom-HUD navigation.
 *
 * Consumed by the main shell (App.js) and by the companion drive surface
 * (CompanionStage) so both render the same nav, filtered identically by
 * auth + role.
 */

const NAV_ITEMS = [
  { label: "Realm", path: "/", icon: "✦", isPublic: true },
  { label: "Atelier", path: "/atelier", icon: "◈", isPublic: false },
  { label: "Chronicle", path: "/chronicle", icon: "▤", isPublic: false },
  { label: "Sanctum", path: "/sanctum", icon: "⚙", requiredRole: "admin" },
];

export default NAV_ITEMS;

// Route aggregation: every module exports `routes`; this file is the single
// registry used by the HTTP server and the OpenAPI generator.
import { routes as postalRoutes } from "./modules/postal.js";
import { routes as calendarRoutes } from "./modules/calendar.js";
import { routes as warekiRoutes } from "./modules/wareki.js";
import { routes as textRoutes } from "./modules/text.js";
import { routes as datetimeRoutes } from "./modules/datetime.js";
import { routes as convertRoutes } from "./modules/convert.js";
import { routes as qrRoutes } from "./modules/qr.js";
import { routes as webRoutes } from "./modules/web.js";

export const allRoutes = [
  ...postalRoutes,
  ...calendarRoutes,
  ...warekiRoutes,
  ...textRoutes,
  ...datetimeRoutes,
  ...convertRoutes,
  ...qrRoutes,
  ...webRoutes,
];

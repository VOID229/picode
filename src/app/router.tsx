import { createHashRouter } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { SettingsScreen } from "../components/settings/SettingsScreen";

export const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
  },
  {
    path: "/settings",
    element: <SettingsScreen />,
  },
]);

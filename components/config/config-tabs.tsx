"use client";

/**
 * Tab switcher for the config editor. Each tab is self-contained:
 * fetches its own data, owns its own edit buffer, and runs its own
 * save flow. All the shared wiring lives in `useConfigBuffer`.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ServerIniTab } from "./server-ini-tab";
import { SandboxTab } from "./sandbox-tab";
import type { Role } from "@/lib/auth/role";

export function ConfigTabs({ role }: { role: Role }) {
  return (
    <Tabs defaultValue="ini" className="w-full">
      <TabsList variant="line" className="self-start">
        <TabsTrigger value="ini">Server INI</TabsTrigger>
        <TabsTrigger value="sandbox">Sandbox Vars</TabsTrigger>
      </TabsList>
      <TabsContent value="ini" className="mt-3">
        <ServerIniTab role={role} />
      </TabsContent>
      <TabsContent value="sandbox" className="mt-3">
        <SandboxTab role={role} />
      </TabsContent>
    </Tabs>
  );
}

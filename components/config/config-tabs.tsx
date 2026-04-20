"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ServerIniTab } from "./server-ini-tab";
import { SandboxTab } from "./sandbox-tab";

interface IniProps {
  ok: boolean;
  path: string;
  prefix: string;
  error?: string;
  entries?: { key: string; value: string }[];
}

interface SandboxProps {
  ok: boolean;
  path: string;
  prefix: string;
  error?: string;
  sections?: {
    name: string;
    entries: {
      key: string;
      value: number | string | boolean;
      kind: "number" | "string" | "boolean" | "raw";
    }[];
  }[];
}

export function ConfigTabs({ ini, sandbox }: { ini: IniProps; sandbox: SandboxProps }) {
  return (
    <Tabs defaultValue="ini" className="w-full">
      <TabsList variant="line" className="self-start">
        <TabsTrigger value="ini">Server INI</TabsTrigger>
        <TabsTrigger value="sandbox">Sandbox Vars</TabsTrigger>
      </TabsList>
      <TabsContent value="ini" className="mt-3">
        <ServerIniTab {...ini} />
      </TabsContent>
      <TabsContent value="sandbox" className="mt-3">
        <SandboxTab {...sandbox} />
      </TabsContent>
    </Tabs>
  );
}

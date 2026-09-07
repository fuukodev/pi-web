import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/hooks/useI18n";
import { KeybindingsProvider } from "@/hooks/useKeybindings";

export default function Home() {
  return (
    <Suspense>
      <I18nProvider>
        <KeybindingsProvider>
          <AppShell />
        </KeybindingsProvider>
      </I18nProvider>
    </Suspense>
  );
}

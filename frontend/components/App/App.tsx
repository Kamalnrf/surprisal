import React, { useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import JevKeySettings from "../JevKeySettings/index.ts";
import Onboarding from "../Onboarding/index.ts";
import Workspace from "./Workspace.tsx";
import useWriting from "../../hooks/use-writing.ts";
import { API_KEY_STORAGE, INTRO_STORAGE } from "../../helpers/storage.ts";
import { sections } from "../../../shared/stream.ts";

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(() => {
    try {
      return localStorage.getItem(API_KEY_STORAGE)?.trim() || null;
    } catch {
      return null;
    }
  });
  const [keyStorageError, setKeyStorageError] = useState("");
  const [keySettingsOpen, setKeySettingsOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const writing = useWriting();
  const loaded = writing.status !== "loading";
  // Once, on load: only someone who has not seen the intro and has written
  // nothing outside the starter rules and guide.
  useEffect(() => {
    if (!loaded) return;
    let seen = true;
    try {
      seen = !!localStorage.getItem(INTRO_STORAGE);
    } catch {
      // Without storage the intro would return on every load; skip it.
    }
    const blank = sections(writing.text).every((section) =>
      ["@rules", "@guide", "@inactive-rules"].includes(section.tag) ||
      !section.text.trim()
    );
    if (!seen && blank) setIntroOpen(true);
  }, [loaded]);

  function changeKey() {
    setKeySettingsOpen(true);
  }

  function forgetKey() {
    setKeyStorageError("");
    try {
      localStorage.removeItem(API_KEY_STORAGE);
    } catch {
      setKeyStorageError(
        "This browser could not remove the saved key. Clear it in your browser’s site storage settings before using a shared browser.",
      );
    }
    setApiKey(null);
  }

  if (writing.status === "loading") {
    return <p id="boot">Opening your writing…</p>;
  }

  return (
    <>
      <Workspace
        initialText={writing.text}
        recovered={writing.recovered}
        storageError={writing.storageError}
        apiKey={apiKey ?? ""}
        changeKey={changeKey}
        showIntro={() => setIntroOpen(true)}
      />
      <Onboarding
        open={introOpen}
        onClose={() => setIntroOpen(false)}
        onKey={setApiKey}
      />
      <Dialog.Root open={keySettingsOpen} onOpenChange={setKeySettingsOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="debug-backdrop" />
          <Dialog.Popup className="key-settings">
            <Dialog.Close
              type="button"
              className="debug-close"
              aria-label="Close Jev key settings"
            >
              ×
            </Dialog.Close>
            {keySettingsOpen && (
              <JevKeySettings
                initialKey={apiKey ?? ""}
                onSave={(key) => {
                  setApiKey(key);
                  setKeyStorageError("");
                  setKeySettingsOpen(false);
                }}
                onForget={forgetKey}
                storageError={keyStorageError}
              />
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

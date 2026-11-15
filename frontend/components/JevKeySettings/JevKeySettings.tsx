/** @jsxImportSource https://esm.sh/react@19.3.0 */
import React, { useState } from "https://esm.sh/react@19.3.0";
import { Button } from "https://esm.sh/@base-ui/react@1.9.0/button?deps=react@19.3.0,react-dom@19.3.0";
import { Input } from "https://esm.sh/@base-ui/react@1.9.0/input?deps=react@19.3.0,react-dom@19.3.0";
import { Checkbox } from "https://esm.sh/@base-ui/react@1.9.0/checkbox?deps=react@19.3.0,react-dom@19.3.0";
import { Dialog } from "https://esm.sh/@base-ui/react@1.9.0/dialog?deps=react@19.3.0,react-dom@19.3.0";
import { API_KEY_STORAGE } from "../../helpers/storage.ts";

export default function JevKeySettings(
  { initialKey = "", onSave, onForget, storageError }: {
    initialKey?: string;
    onSave: (key: string) => void;
    onForget: () => void;
    storageError: string;
  },
) {
  const [key, setKey] = useState(initialKey);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!key.trim()) return;
          if (remember) {
            try {
              localStorage.setItem(API_KEY_STORAGE, key.trim());
            } catch {
              setRemember(false);
              setError(
                "This browser could not save your key. Save again to use it only in this tab, or retry remembering it.",
              );
              return;
            }
          } else {
            try {
              localStorage.removeItem(API_KEY_STORAGE);
            } catch {
              setError(
                "This browser could not remove the remembered key. Clear this site’s storage before using a shared browser.",
              );
              return;
            }
          }
          onSave(key.trim());
        }}
      >
        <Dialog.Title>Jev predictions</Dialog.Title>
        <Dialog.Description>
          Writing needs no key. Add a Jev API key only if you want optional
          predictions for your writing.
        </Dialog.Description>
        <label htmlFor="api-key">Jev API key</label>
        <Input
          id="api-key"
          type="password"
          autoComplete="off"
          autoFocus
          required
          value={key}
          onValueChange={setKey}
        />
        <label className="remember-key">
          <Checkbox.Root
            className="checkbox"
            checked={remember}
            onCheckedChange={setRemember}
          >
            <Checkbox.Indicator aria-hidden="true">✓</Checkbox.Indicator>
          </Checkbox.Root>Remember on this browser
        </label>
        <p className="small">
          Save your key in this browser so you can return without entering it
          again. It is not encrypted: use this only on a trusted browser.
          Uncheck to keep it only in this tab.
        </p>
        {(error || storageError) && (
          <p className="error" role="alert">{error || storageError}</p>
        )}
        <Button className="action" type="submit" disabled={!key.trim()}>
          Save key
        </Button>
        <Button
          type="button"
          className="link"
          onClick={() => {
            setKey("");
            setError("");
            onForget();
          }}
        >
          Forget saved key
        </Button>
      </form>
    </div>
  );
}

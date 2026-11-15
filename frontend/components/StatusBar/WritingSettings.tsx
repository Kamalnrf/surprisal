/** @jsxImportSource https://esm.sh/react@19.3.0 */
import React from "https://esm.sh/react@19.3.0";
import { Button } from "https://esm.sh/@base-ui/react@1.9.0/button?deps=react@19.3.0,react-dom@19.3.0";
import { Checkbox } from "https://esm.sh/@base-ui/react@1.9.0/checkbox?deps=react@19.3.0,react-dom@19.3.0";
import { Popover } from "https://esm.sh/@base-ui/react@1.9.0/popover?deps=react@19.3.0,react-dom@19.3.0";
import { SlidersHorizontalIcon } from "https://esm.sh/@phosphor-icons/react@2.1.10/dist/csr/SlidersHorizontal?deps=react@19.3.0,react-dom@19.3.0";

export interface WritingSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analysisOn: boolean;
  variantsOn: boolean;
  onVariantsChange: (on: boolean) => void;
  onAnalysisChange: (on: boolean) => void;
  surprisalOn: boolean;
  onSurprisalChange: (on: boolean) => void;
  smartOn: boolean;
  onSmartChange: (on: boolean) => void;
  typewriterOn: boolean;
  onTypewriterChange: (on: boolean) => void;
  status: string;
  error?: string;
  retry: () => void;
  children: React.ReactNode;
}

export default function WritingSettings({
  open,
  onOpenChange,
  analysisOn,
  variantsOn,
  onVariantsChange,
  onAnalysisChange,
  surprisalOn,
  onSurprisalChange,
  smartOn,
  onSmartChange,
  typewriterOn,
  onTypewriterChange,
  status,
  error,
  retry,
  children,
}: WritingSettingsProps) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        className="rail-icon"
        aria-label="Writing settings"
        title="Writing settings"
      >
        <SlidersHorizontalIcon size={18} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="rail-menu-positioner"
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
        >
          <Popover.Popup className="rail-menu">
            <Popover.Title>Writing settings</Popover.Title>
            <label className="analysis-setting">
              <Checkbox.Root
                className="checkbox"
                checked={variantsOn}
                onCheckedChange={onVariantsChange}
              >
                <Checkbox.Indicator aria-hidden="true">✓</Checkbox.Indicator>
              </Checkbox.Root>
              Writing variants
            </label>
            <label className="analysis-setting">
              <Checkbox.Root
                className="checkbox"
                checked={surprisalOn}
                onCheckedChange={onSurprisalChange}
              >
                <Checkbox.Indicator aria-hidden="true">✓</Checkbox.Indicator>
              </Checkbox.Root>
              Surprisal
            </label>
            <label className="analysis-setting">
              <Checkbox.Root
                className="checkbox"
                checked={smartOn}
                onCheckedChange={onSmartChange}
              >
                <Checkbox.Indicator aria-hidden="true">✓</Checkbox.Indicator>
              </Checkbox.Root>
              Smart punctuation
            </label>
            <label className="analysis-setting">
              <Checkbox.Root
                className="checkbox"
                checked={typewriterOn}
                onCheckedChange={onTypewriterChange}
              >
                <Checkbox.Indicator aria-hidden="true">✓</Checkbox.Indicator>
              </Checkbox.Root>
              Typewriter scrolling
            </label>
            <label className="analysis-setting">
              <Checkbox.Root
                className="checkbox"
                checked={analysisOn}
                onCheckedChange={onAnalysisChange}
              >
                <Checkbox.Indicator aria-hidden="true">
                  ✓
                </Checkbox.Indicator>
              </Checkbox.Root>
              Rules
            </label>
            <p className="small" role="status">{status}</p>
            {error && (
              <>
                <p className="error" role="alert">{error}</p>
                <Button type="button" className="link" onClick={retry}>
                  Retry observations
                </Button>
              </>
            )}
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

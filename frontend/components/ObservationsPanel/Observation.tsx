/** @jsxImportSource https://esm.sh/react@19.3.0 */
import React from "https://esm.sh/react@19.3.0";
import type { Observation as Finding, Rule } from "../../../shared/types.ts";

export default function Observation(
  { finding, rule }: {
    finding: Finding;
    rule: Rule;
  },
) {
  return (
    <section className="note">
      <span className="mono">RULE</span>
      <h3>{rule.instruction}</h3>
      <blockquote>
        <span>{finding.quote}</span>
      </blockquote>
    </section>
  );
}

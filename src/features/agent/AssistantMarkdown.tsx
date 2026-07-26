import { Streamdown } from "streamdown";
import "streamdown/styles.css";

/**
 * Assistant/reasoning prose. All typography lives in `.agent-md` (global.css)
 * because Streamdown ships animations only — no element styling of its own.
 */
export default function AssistantMarkdown({
  text,
  tone = "normal",
}: {
  text: string;
  tone?: "normal" | "quiet";
}) {
  return (
    <div className={`agent-md${tone === "quiet" ? " agent-md-quiet" : ""}`}>
      <Streamdown mode="streaming">{text}</Streamdown>
    </div>
  );
}

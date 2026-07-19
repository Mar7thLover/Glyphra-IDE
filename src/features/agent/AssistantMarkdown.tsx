import { Streamdown } from "streamdown";
import "streamdown/styles.css";

export default function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="agent-md text-ink-2 [&_code]:font-mono [&_p]:my-1 [&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-panel [&_pre]:p-2">
      <Streamdown mode="streaming">{text}</Streamdown>
    </div>
  );
}
